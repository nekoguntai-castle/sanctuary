import { requireAgentFundingDraftAccess, type AgentRequestContext } from '../agent/auth';
import { MIN_FEE_RATE, MAX_FEE_RATE } from '../constants';
import { ApiError, ConflictError, ForbiddenError, InvalidInputError, InvalidPsbtError, NotFoundError } from '../errors';
import { agentRepository, utxoRepository, walletRepository } from '../repositories';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { evaluateRejectedFundingAttemptAlert } from './agentMonitoringService';
import { verifyOperationalReceiveAddress } from './agentOperationalAddressService';
import { enforceAgentFundingPolicy } from './agentFundingPolicy';
import * as txService from './bitcoin/transactionService';
import { draftService } from './draftService';
import { policyEvaluationEngine } from './vaultPolicy';
import { assertWalletHardwareCapabilityById } from './hardwareWalletCapabilities';
import { createSigningIntent } from './bitcoin/signingIntent';
import { isBitcoinNetwork } from './bitcoin/networks';

const log = createLogger('AGENT:API_SVC');

export interface AgentFundingDraftRequestBody {
  operationalWalletId: string;
  recipient: string;
  amount: number | string;
  feeRate: number | string;
  selectedUtxoIds?: string[];
  enableRBF?: boolean;
  subtractFees?: boolean;
  sendMax?: boolean;
  label?: string | null;
  memo?: string | null;
  decoyOutputs?: { enabled: boolean; count: number };
}

export interface SubmitAgentFundingDraftInput {
  context: AgentRequestContext;
  fundingWalletId: string;
  body: AgentFundingDraftRequestBody;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AgentFundingAttemptInput {
  agentId: string;
  keyId: string;
  keyPrefix: string;
  fundingWalletId: string;
  operationalWalletId?: string | null;
  draftId?: string | null;
  status: 'accepted' | 'rejected';
  error?: unknown;
  amount?: unknown;
  feeRate?: unknown;
  recipient?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type SubmittedAgentFundingDraft = Awaited<ReturnType<typeof draftService.createDraft>>;
type AgentDraftCreatePayload = Parameters<typeof draftService.createDraft>[2];

interface AgentDraftSideEffects {
  walletId: string;
  userId: string;
  draft: SubmittedAgentFundingDraft;
  data: AgentDraftCreatePayload;
}

export interface SubmitAgentFundingDraftResult {
  draft: SubmittedAgentFundingDraft;
  usedOverrideId: string | null;
}

const ATTEMPT_REASON_MESSAGE_CODES: ReadonlyArray<readonly [needle: string, code: string]> = [
  ['feerate', 'fee_rate_out_of_bounds'],
  ['per-request cap', 'policy_max_funding_amount'],
  ['balance cap', 'policy_operational_balance_cap'],
  ['cooldown', 'policy_cooldown'],
  ['daily funding limit', 'policy_daily_limit'],
  ['weekly funding limit', 'policy_weekly_limit'],
  ['not active', 'agent_inactive'],
  ['linked operational wallet', 'policy_destination_mismatch'],
  ['frozen', 'utxo_frozen'],
];
const AGENT_FUNDING_REASON_DETAIL_KEY = 'reasonCode';

const parseOptionalAttemptAmount = (value: unknown): bigint | null => {
  switch (typeof value) {
    case 'number':
      return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
    case 'string': {
      const trimmed = value.trim();
      return /^\d+$/.test(trimmed) ? BigInt(trimmed) : null;
    }
    default:
      return null;
  }
};

const parseOptionalAttemptFeeRate = (value: unknown): number | null => {
  const feeRate = Number(value);
  return Number.isFinite(feeRate) ? feeRate : null;
};

const parseDraftAmount = (value: number | string): number => {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    throw new InvalidInputError('amount must be a non-negative safe integer', 'amount', {
      reasonCode: 'invalid_amount',
    });
  }

  const amount = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new InvalidInputError('amount must be a non-negative safe integer', 'amount', {
      reasonCode: 'invalid_amount',
    });
  }
  return amount;
};

const formatUtxoId = (utxo: { txid: string; vout: number }): string => `${utxo.txid}:${utxo.vout}`;

const buildInputMetadata = (
  utxos: Array<{
    txid: string;
    vout: number;
    address?: string;
    amount?: number;
  }>
) =>
  utxos.map(utxo => ({
    txid: utxo.txid,
    vout: utxo.vout,
    address: utxo.address ?? '',
    amount: utxo.amount ?? 0,
  }));

const buildOutputMetadata = (input: {
  recipient: string;
  effectiveAmount: number;
  changeAddress?: string;
  changeAmount: number;
  decoyOutputs?: Array<{ address: string; amount: number }>;
}) => {
  const outputs = [
    {
      address: input.recipient,
      amount: input.effectiveAmount,
      outputType: 'recipient',
      isOurs: true,
    },
  ];

  if (input.changeAddress && input.changeAmount > 0) {
    outputs.push({
      address: input.changeAddress,
      amount: input.changeAmount,
      outputType: 'change',
      isOurs: true,
    });
  }

  for (const decoy of input.decoyOutputs ?? []) {
    outputs.push({
      address: decoy.address,
      amount: decoy.amount,
      outputType: 'decoy',
      isOurs: true,
    });
  }

  return outputs;
};

function toEffectivePolicyAmount(effectiveAmount: number): bigint {
  if (!Number.isSafeInteger(effectiveAmount) || effectiveAmount < 0) {
    throw new InvalidInputError('effective transaction amount must be a non-negative safe integer', 'amount', {
      reasonCode: 'invalid_amount',
    });
  }

  return BigInt(effectiveAmount);
}

async function assertOperationalRecipient(operationalWalletId: string, recipient: string): Promise<void> {
  const verification = await verifyOperationalReceiveAddress({
    operationalWalletId,
    address: recipient,
  });

  if (!verification.verified) {
    throw new InvalidInputError('recipient must belong to the linked operational wallet', 'recipient', {
      reasonCode: 'policy_destination_mismatch',
    });
  }
}

const getAttemptReasonCodeFromMessage = (message: string): string | null => {
  for (const [needle, code] of ATTEMPT_REASON_MESSAGE_CODES) {
    if (message.includes(needle)) return code;
  }
  return null;
};

const getStructuredAttemptReasonCode = (error: unknown): string | null => {
  if (!(error instanceof ApiError)) return null;
  const reasonCode = error.details?.[AGENT_FUNDING_REASON_DETAIL_KEY];
  return typeof reasonCode === 'string' && reasonCode ? reasonCode : null;
};

const getAttemptReasonCode = (error: unknown): string => {
  const structuredReasonCode = getStructuredAttemptReasonCode(error);
  if (structuredReasonCode) return structuredReasonCode;

  if (error instanceof InvalidPsbtError) return 'invalid_psbt';
  if (error instanceof ForbiddenError) return 'forbidden_scope';
  if (error instanceof NotFoundError) return 'not_found';
  if (error instanceof ConflictError) return 'utxo_locked';

  const message = getErrorMessage(error).toLowerCase();
  const reasonCode = getAttemptReasonCodeFromMessage(message);

  if (reasonCode) return reasonCode;
  if (message.includes('locked')) return 'utxo_locked';
  if (error instanceof InvalidInputError) return 'invalid_input';
  if (error instanceof ApiError) return error.code.toLowerCase();
  return 'unexpected_error';
};

export async function recordAgentFundingAttempt(input: AgentFundingAttemptInput): Promise<void> {
  try {
    const reasonCode = input.error ? getAttemptReasonCode(input.error) : null;
    await agentRepository.createFundingAttempt({
      agentId: input.agentId,
      keyId: input.keyId,
      keyPrefix: input.keyPrefix,
      fundingWalletId: input.fundingWalletId,
      /* v8 ignore start -- optional attempt metadata defaults are defensive for rejected submissions */
      operationalWalletId: input.operationalWalletId ?? null,
      draftId: input.draftId ?? null,
      /* v8 ignore stop */
      status: input.status,
      reasonCode,
      reasonMessage: input.error ? getErrorMessage(input.error).slice(0, 500) : null,
      amount: parseOptionalAttemptAmount(input.amount),
      feeRate: parseOptionalAttemptFeeRate(input.feeRate),
      /* v8 ignore start -- optional HTTP metadata defaults are defensive for non-request callers */
      recipient: typeof input.recipient === 'string' ? input.recipient.slice(0, 200) : null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      /* v8 ignore stop */
    });
    if (input.status === 'rejected') {
      await evaluateRejectedFundingAttemptAlert(input.agentId, reasonCode);
    }
  } catch (recordError) {
    log.warn('Failed to record agent funding attempt', {
      agentId: input.agentId,
      status: input.status,
      error: getErrorMessage(recordError),
    });
  }
}

export async function getAgentWalletSummary(context: AgentRequestContext, fundingWalletId: string) {
  requireAgentFundingDraftAccess(context, fundingWalletId, context.operationalWalletId);

  const [fundingWallet, operationalWallet, fundingBalance, operationalBalance] = await Promise.all([
    walletRepository.findById(fundingWalletId),
    walletRepository.findById(context.operationalWalletId),
    utxoRepository.getUnspentBalance(fundingWalletId),
    utxoRepository.getUnspentBalance(context.operationalWalletId),
  ]);

  if (!fundingWallet) {
    throw new NotFoundError('Funding wallet not found');
  }
  if (!operationalWallet) {
    throw new NotFoundError('Operational wallet not found');
  }

  return {
    agent: {
      id: context.agentId,
      name: context.agentName,
      status: context.agentStatus,
      signerDeviceId: context.signerDeviceId,
    },
    fundingWallet: {
      id: fundingWallet.id,
      name: fundingWallet.name,
      type: fundingWallet.type,
      network: fundingWallet.network,
      balance: fundingBalance.toString(),
    },
    operationalWallet: {
      id: operationalWallet.id,
      name: operationalWallet.name,
      type: operationalWallet.type,
      network: operationalWallet.network,
      balance: operationalBalance.toString(),
    },
    allowedActions: context.scope.allowedActions ?? [],
  };
}

export async function submitAgentFundingDraft(
  input: SubmitAgentFundingDraftInput
): Promise<SubmitAgentFundingDraftResult> {
  const { context, fundingWalletId, ipAddress, userAgent } = input;
  const {
    operationalWalletId,
    recipient,
    amount,
    feeRate,
    subtractFees,
    sendMax,
    label,
    memo,
    selectedUtxoIds,
    enableRBF,
    decoyOutputs,
  } = input.body;
  let draft: SubmittedAgentFundingDraft | null = null;
  let usedOverrideId: string | null = null;
  let draftSideEffects: AgentDraftSideEffects | null = null;
  let attemptAmount: unknown = amount;

  try {
    requireAgentFundingDraftAccess(context, fundingWalletId, operationalWalletId);
    const feeRateNumber = Number(feeRate);
    if (!Number.isFinite(feeRateNumber) || feeRateNumber < MIN_FEE_RATE || feeRateNumber > MAX_FEE_RATE) {
      throw new InvalidInputError(`feeRate must be between ${MIN_FEE_RATE} and ${MAX_FEE_RATE} sat/vB`, 'feeRate', {
        reasonCode: 'fee_rate_out_of_bounds',
      });
    }

    const amountNumber = parseDraftAmount(amount);
    await assertOperationalRecipient(operationalWalletId, recipient);
    await assertWalletHardwareCapabilityById(fundingWalletId, 'sign');
    const draftLabel =
      typeof label === 'string' && label.trim() ? label.trim() : `Agent funding request: ${context.agentName}`;

    const transactionResult = await agentRepository.withAgentFundingTransaction(context.agentId, async tx => {
      const txData = await txService.createTransaction(fundingWalletId, recipient, amountNumber, feeRateNumber, {
        selectedUtxoIds,
        enableRBF,
        subtractFees,
        sendMax,
        decoyOutputs,
      });
      const effectiveAmountSats = toEffectivePolicyAmount(txData.effectiveAmount);
      const effectiveAmount = effectiveAmountSats.toString();
      attemptAmount = effectiveAmount;
      const policyDecision = await enforceAgentFundingPolicy(context.agentId, operationalWalletId, effectiveAmountSats);
      const effectiveDraftLabel = policyDecision.overrideId ? `${draftLabel} (owner override)` : draftLabel;
      const vaultPolicyDecision = await policyEvaluationEngine.evaluatePolicies({
        walletId: fundingWalletId,
        userId: context.userId,
        recipient,
        amount: effectiveAmountSats,
      });

      if (!vaultPolicyDecision.allowed) {
        throw new ForbiddenError('Transaction blocked by vault policy');
      }

      const walletNetwork = await walletRepository.findNetwork(fundingWalletId);
      if (!walletNetwork || !isBitcoinNetwork(walletNetwork)) {
        throw new NotFoundError('Funding wallet not found');
      }
      const intent = await createSigningIntent({
        walletId: fundingWalletId,
        createdByUserId: context.userId,
        network: walletNetwork,
        source: 'agent',
        unsignedPsbtBase64: txData.psbtBase64,
        feePolicy: txData.feePolicy,
        signingContext: txData.signingContext,
      });

      const draftData: AgentDraftCreatePayload = {
        recipient,
        amount: effectiveAmount,
        feeRate: feeRateNumber,
        selectedUtxoIds: txData.utxos.map(formatUtxoId),
        enableRBF,
        subtractFees,
        sendMax,
        outputs: buildOutputMetadata({
          recipient,
          effectiveAmount: txData.effectiveAmount,
          changeAddress: txData.changeAddress,
          changeAmount: txData.changeAmount,
          decoyOutputs: txData.decoyOutputs,
        }),
        inputs: buildInputMetadata(txData.utxos),
        decoyOutputs: txData.decoyOutputs ?? undefined,
        isRBF: false,
        label: effectiveDraftLabel,
        memo: memo ?? undefined,
        psbtBase64: txData.psbtBase64,
        intentId: intent.intentId,
        intentDigest: intent.intentDigest,
        fee: txData.fee,
        totalInput: txData.totalInput,
        totalOutput: txData.totalOutput,
        changeAmount: txData.changeAmount,
        changeAddress: txData.changeAddress,
        effectiveAmount,
        inputPaths: txData.inputPaths,
        agentId: context.agentId,
        agentOperationalWalletId: operationalWalletId,
        notificationCreatedByUserId: null,
        notificationCreatedByLabel: context.agentName,
        policyEvaluation: vaultPolicyDecision.triggered.length > 0 ? vaultPolicyDecision : undefined,
      };

      const createdDraft = await draftService.createDraft(fundingWalletId, context.userId, draftData, {
        client: tx,
        runSideEffects: false,
      });

      if (policyDecision.overrideId) {
        await agentRepository.markFundingOverrideUsed(policyDecision.overrideId, createdDraft.id, tx);
      }

      await agentRepository.markAgentFundingDraftCreated(context.agentId, new Date(), tx);
      await agentRepository.createFundingAttempt({
        agentId: context.agentId,
        keyId: context.keyId,
        keyPrefix: context.keyPrefix,
        fundingWalletId,
        operationalWalletId,
        draftId: createdDraft.id,
        status: 'accepted',
        amount: effectiveAmountSats,
        feeRate: feeRateNumber,
        recipient,
        ipAddress,
        userAgent,
      }, tx);

      return {
        draft: createdDraft,
        usedOverrideId: policyDecision.overrideId ?? null,
        sideEffects: {
          walletId: fundingWalletId,
          userId: context.userId,
          draft: createdDraft,
          data: draftData,
        },
      };
    });

    if (transactionResult) {
      draft = transactionResult.draft;
      usedOverrideId = transactionResult.usedOverrideId;
      draftSideEffects = transactionResult.sideEffects;
    }
  } catch (error) {
    await recordAgentFundingAttempt({
      agentId: context.agentId,
      keyId: context.keyId,
      keyPrefix: context.keyPrefix,
      fundingWalletId,
      operationalWalletId,
      status: 'rejected',
      error,
      amount: attemptAmount,
      feeRate,
      recipient,
      ipAddress,
      userAgent,
    });
    throw error;
  }

  if (!draft) {
    throw new InvalidInputError('Agent funding draft was not created');
  }

  if (draftSideEffects) {
    draftService.dispatchDraftCreatedPostCommitNotifications(
      draftSideEffects.walletId,
      draftSideEffects.userId,
      draftSideEffects.draft,
      draftSideEffects.data
    );
  }

  return { draft, usedOverrideId };
}
