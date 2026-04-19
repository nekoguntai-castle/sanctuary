import { requireAgentFundingDraftAccess, type AgentRequestContext } from '../agent/auth';
import { MIN_FEE_RATE, MAX_FEE_RATE } from '../constants';
import { ApiError, ConflictError, ForbiddenError, InvalidInputError, InvalidPsbtError, NotFoundError } from '../errors';
import { agentRepository, utxoRepository, walletRepository } from '../repositories';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { evaluateRejectedFundingAttemptAlert } from './agentMonitoringService';
import { validateAgentFundingDraftSubmission } from './agentFundingDraftValidation';
import { enforceAgentFundingPolicy } from './agentFundingPolicy';
import { draftService } from './draftService';

const log = createLogger('AGENT:API_SVC');

export interface AgentFundingDraftRequestBody {
  operationalWalletId: string;
  recipient: string;
  amount: number | string;
  feeRate: number | string;
  subtractFees?: boolean;
  sendMax?: boolean;
  label?: string | null;
  memo?: string | null;
  psbtBase64: string;
  signedPsbtBase64: string;
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

export interface SubmitAgentFundingDraftResult {
  draft: SubmittedAgentFundingDraft;
  usedOverrideId: string | null;
}

function parseOptionalAttemptAmount(value: unknown): bigint | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }

  return null;
}

function parseOptionalAttemptFeeRate(value: unknown): number | null {
  const feeRate = Number(value);
  return Number.isFinite(feeRate) ? feeRate : null;
}

function getAttemptReasonCode(error: unknown): string {
  const message = getErrorMessage(error).toLowerCase();

  if (message.includes('feeRate'.toLowerCase())) return 'fee_rate_out_of_bounds';
  if (message.includes('per-request cap')) return 'policy_max_funding_amount';
  if (message.includes('balance cap')) return 'policy_operational_balance_cap';
  if (message.includes('cooldown')) return 'policy_cooldown';
  if (message.includes('daily funding limit')) return 'policy_daily_limit';
  if (message.includes('weekly funding limit')) return 'policy_weekly_limit';
  if (message.includes('not active')) return 'agent_inactive';
  if (message.includes('linked operational wallet')) return 'policy_destination_mismatch';
  if (message.includes('frozen')) return 'utxo_frozen';
  if (error instanceof ConflictError || message.includes('locked')) return 'utxo_locked';
  if (error instanceof InvalidPsbtError) return 'invalid_psbt';
  if (error instanceof ForbiddenError) return 'forbidden_scope';
  if (error instanceof NotFoundError) return 'not_found';
  if (error instanceof InvalidInputError) return 'invalid_input';
  if (error instanceof ApiError) return error.code.toLowerCase();
  return 'unexpected_error';
}

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

export async function getAgentWalletSummary(
  context: AgentRequestContext,
  fundingWalletId: string
) {
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
    psbtBase64,
    signedPsbtBase64,
  } = input.body;
  let draft: SubmittedAgentFundingDraft | null = null;
  let usedOverrideId: string | null = null;

  try {
    requireAgentFundingDraftAccess(context, fundingWalletId, operationalWalletId);
    const feeRateNumber = Number(feeRate);
    if (!Number.isFinite(feeRateNumber) || feeRateNumber < MIN_FEE_RATE || feeRateNumber > MAX_FEE_RATE) {
      throw new InvalidInputError(`feeRate must be between ${MIN_FEE_RATE} and ${MAX_FEE_RATE} sat/vB`, 'feeRate');
    }

    const validatedDraft = await validateAgentFundingDraftSubmission({
      fundingWalletId,
      operationalWalletId,
      signerDeviceId: context.signerDeviceId,
      recipient,
      amount,
      psbtBase64,
      signedPsbtBase64,
    });
    const draftLabel = typeof label === 'string' && label.trim()
      ? label.trim()
      : `Agent funding request: ${context.agentName}`;

    draft = await agentRepository.withAgentFundingLock(context.agentId, async () => {
      const policyDecision = await enforceAgentFundingPolicy(
        context.agentId,
        operationalWalletId,
        BigInt(validatedDraft.amount)
      );
      const effectiveDraftLabel = policyDecision.overrideId
        ? `${draftLabel} (owner override)`
        : draftLabel;

      const createdDraft = await draftService.createDraft(fundingWalletId, context.userId, {
        recipient: validatedDraft.recipient,
        amount: validatedDraft.amount,
        feeRate: feeRateNumber,
        selectedUtxoIds: validatedDraft.selectedUtxoIds,
        enableRBF: validatedDraft.enableRBF,
        subtractFees,
        sendMax,
        outputs: validatedDraft.outputs,
        inputs: validatedDraft.inputs,
        isRBF: false,
        label: effectiveDraftLabel,
        memo: memo ?? undefined,
        psbtBase64,
        signedPsbtBase64,
        signedDeviceId: context.signerDeviceId,
        fee: validatedDraft.fee,
        totalInput: validatedDraft.totalInput,
        totalOutput: validatedDraft.totalOutput,
        changeAmount: validatedDraft.changeAmount,
        changeAddress: validatedDraft.changeAddress,
        effectiveAmount: validatedDraft.effectiveAmount,
        inputPaths: validatedDraft.inputPaths,
        agentId: context.agentId,
        agentOperationalWalletId: operationalWalletId,
        notificationCreatedByUserId: null,
        notificationCreatedByLabel: context.agentName,
      });

      if (policyDecision.overrideId) {
        await agentRepository.markFundingOverrideUsed(policyDecision.overrideId, createdDraft.id);
        usedOverrideId = policyDecision.overrideId;
      }

      await agentRepository.markAgentFundingDraftCreated(context.agentId);
      await recordAgentFundingAttempt({
        agentId: context.agentId,
        keyId: context.keyId,
        keyPrefix: context.keyPrefix,
        fundingWalletId,
        operationalWalletId,
        draftId: createdDraft.id,
        status: 'accepted',
        amount: validatedDraft.amount,
        feeRate: feeRateNumber,
        recipient: validatedDraft.recipient,
        ipAddress,
        userAgent,
      });

      return createdDraft;
    });

  } catch (error) {
    await recordAgentFundingAttempt({
      agentId: context.agentId,
      keyId: context.keyId,
      keyPrefix: context.keyPrefix,
      fundingWalletId,
      operationalWalletId,
      status: 'rejected',
      error,
      amount,
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

  return { draft, usedOverrideId };
}
