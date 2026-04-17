/**
 * Agent API Routes
 *
 * Scoped endpoints for non-human wallet agents. These routes do not use human
 * JWT auth; they require an `agt_` bearer token that is scoped to one agent.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAgentFundingDraftAccess } from '../agent/auth';
import { MIN_FEE_RATE, MAX_FEE_RATE } from '../constants';
import { ApiError, ConflictError, ForbiddenError, InvalidInputError, InvalidPsbtError, NotFoundError } from '../errors';
import { asyncHandler } from '../errors/errorHandler';
import { authenticateAgent, requireAgentContext } from '../middleware/agentAuth';
import { validate } from '../middleware/validate';
import { validateAgentFundingDraftSubmission } from '../services/agentFundingDraftValidation';
import { enforceAgentFundingPolicy } from '../services/agentFundingPolicy';
import {
  getOrCreateOperationalReceiveAddress,
  verifyOperationalReceiveAddress,
} from '../services/agentOperationalAddressService';
import { evaluateRejectedFundingAttemptAlert } from '../services/agentMonitoringService';
import { draftService } from '../services/draftService';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../services/auditService';
import { agentRepository, utxoRepository, walletRepository } from '../repositories';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { serializeDraftTransaction } from '../utils/serialization';

const router = Router();
const log = createLogger('AGENT:API');

const DraftNumericValueSchema = z.union([z.number(), z.string()]);
const OptionalDraftTextSchema = z.union([z.string(), z.null()]);

const FundingDraftParamsSchema = z.object({
  fundingWalletId: z.string().min(1),
});

const FundingDraftSignatureParamsSchema = FundingDraftParamsSchema.extend({
  draftId: z.string().min(1),
});

const FundingDraftSignatureBodySchema = z.object({
  signedPsbtBase64: z.string().min(1),
});

const OperationalAddressVerifyBodySchema = z.object({
  address: z.string().min(1),
});

const FundingDraftBodySchema = z.object({
  operationalWalletId: z.string().min(1),
  recipient: z.string().min(1),
  amount: DraftNumericValueSchema,
  feeRate: DraftNumericValueSchema,
  selectedUtxoIds: z.array(z.string()).optional(),
  enableRBF: z.boolean().optional(),
  subtractFees: z.boolean().optional(),
  sendMax: z.boolean().optional(),
  outputs: z.unknown().optional(),
  inputs: z.unknown().optional(),
  decoyOutputs: z.unknown().optional(),
  payjoinUrl: z.string().optional(),
  isRBF: z.boolean().optional(),
  label: OptionalDraftTextSchema.optional(),
  memo: OptionalDraftTextSchema.optional(),
  psbtBase64: z.string().min(1),
  signedPsbtBase64: z.string().min(1),
  fee: DraftNumericValueSchema.optional(),
  totalInput: DraftNumericValueSchema.optional(),
  totalOutput: DraftNumericValueSchema.optional(),
  changeAmount: DraftNumericValueSchema.optional(),
  changeAddress: z.string().optional(),
  effectiveAmount: DraftNumericValueSchema.optional(),
  inputPaths: z.unknown().optional(),
});

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

async function recordAgentFundingAttempt(input: {
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
}): Promise<void> {
  try {
    const reasonCode = input.error ? getAttemptReasonCode(input.error) : null;
    await agentRepository.createFundingAttempt({
      agentId: input.agentId,
      keyId: input.keyId,
      keyPrefix: input.keyPrefix,
      fundingWalletId: input.fundingWalletId,
      operationalWalletId: input.operationalWalletId ?? null,
      draftId: input.draftId ?? null,
      status: input.status,
      reasonCode,
      reasonMessage: input.error ? getErrorMessage(input.error).slice(0, 500) : null,
      amount: parseOptionalAttemptAmount(input.amount),
      feeRate: parseOptionalAttemptFeeRate(input.feeRate),
      recipient: typeof input.recipient === 'string' ? input.recipient.slice(0, 200) : null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
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

router.use(authenticateAgent);

/**
 * GET /api/v1/agent/wallets/:fundingWalletId/summary
 * Return minimal linked wallet metadata for the authenticated agent.
 */
router.get('/wallets/:fundingWalletId/summary', validate({
  params: FundingDraftParamsSchema,
}), asyncHandler(async (req, res) => {
  const context = requireAgentContext(req);
  const { fundingWalletId } = req.params;

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

  res.json({
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
  });
}));

/**
 * GET /api/v1/agent/wallets/:fundingWalletId/operational-address
 * Return or derive the next unused receive address for the linked operational wallet.
 */
router.get('/wallets/:fundingWalletId/operational-address', validate({
  params: FundingDraftParamsSchema,
}), asyncHandler(async (req, res) => {
  const context = requireAgentContext(req);
  const { fundingWalletId } = req.params;

  requireAgentFundingDraftAccess(context, fundingWalletId, context.operationalWalletId);

  const address = await getOrCreateOperationalReceiveAddress({
    agentId: context.agentId,
    operationalWalletId: context.operationalWalletId,
  });

  res.json({
    walletId: address.walletId,
    address: address.address,
    derivationPath: address.derivationPath,
    index: address.index,
    generated: address.generated,
  });
}));

/**
 * POST /api/v1/agent/wallets/:fundingWalletId/operational-address/verify
 * Verify that an agent-provided destination is a linked operational receive address.
 */
router.post('/wallets/:fundingWalletId/operational-address/verify', validate({
  body: OperationalAddressVerifyBodySchema,
  params: FundingDraftParamsSchema,
}), asyncHandler(async (req, res) => {
  const context = requireAgentContext(req);
  const { fundingWalletId } = req.params;

  requireAgentFundingDraftAccess(context, fundingWalletId, context.operationalWalletId);

  const result = await verifyOperationalReceiveAddress({
    operationalWalletId: context.operationalWalletId,
    address: req.body.address,
  });

  res.json(result);
}));

/**
 * POST /api/v1/agent/wallets/:fundingWalletId/funding-drafts
 * Submit an agent-signed funding draft for human multisig review.
 */
router.post('/wallets/:fundingWalletId/funding-drafts', validate({
  body: FundingDraftBodySchema,
  params: FundingDraftParamsSchema,
}), asyncHandler(async (req, res) => {
  const context = requireAgentContext(req);
  const { fundingWalletId } = req.params;
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
  } = req.body;
  const { ipAddress, userAgent } = getClientInfo(req);
  let draft: Awaited<ReturnType<typeof draftService.createDraft>> | null = null;
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
        memo,
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

  await auditService.log({
    userId: context.userId,
    username: `agent:${context.agentName}`,
    action: AuditAction.AGENT_FUNDING_DRAFT_SUBMIT,
    category: AuditCategory.WALLET,
    ipAddress,
    userAgent,
    details: {
      agentId: context.agentId,
      agentKeyPrefix: context.keyPrefix,
      fundingWalletId,
      operationalWalletId,
      signerDeviceId: context.signerDeviceId,
      draftId: draft.id,
      amount: draft.amount.toString(),
      feeRate: draft.feeRate,
      overrideId: usedOverrideId,
    },
  });

  if (usedOverrideId) {
    await auditService.log({
      userId: context.userId,
      username: `agent:${context.agentName}`,
      action: AuditAction.AGENT_OVERRIDE_USE,
      category: AuditCategory.WALLET,
      ipAddress,
      userAgent,
      details: {
        agentId: context.agentId,
        overrideId: usedOverrideId,
        draftId: draft.id,
        fundingWalletId,
        operationalWalletId,
        amount: draft.amount.toString(),
      },
    });
  }

  res.status(201).json(serializeDraftTransaction(draft));
}));

/**
 * PATCH /api/v1/agent/wallets/:fundingWalletId/funding-drafts/:draftId/signature
 * Add or refresh the agent signature for one of the agent's own funding drafts.
 */
router.patch('/wallets/:fundingWalletId/funding-drafts/:draftId/signature', validate({
  body: FundingDraftSignatureBodySchema,
  params: FundingDraftSignatureParamsSchema,
}), asyncHandler(async (req, res) => {
  const context = requireAgentContext(req);
  const { fundingWalletId, draftId } = req.params;
  const { signedPsbtBase64 } = req.body;

  requireAgentFundingDraftAccess(context, fundingWalletId, context.operationalWalletId);

  const existingDraft = await draftService.getDraft(fundingWalletId, draftId);
  if (existingDraft.agentId !== context.agentId || existingDraft.agentOperationalWalletId !== context.operationalWalletId) {
    throw new ForbiddenError('Agent can only update its own funding drafts');
  }

  await validateAgentFundingDraftSubmission({
    fundingWalletId,
    operationalWalletId: context.operationalWalletId,
    signerDeviceId: context.signerDeviceId,
    recipient: existingDraft.recipient,
    amount: existingDraft.amount.toString(),
    psbtBase64: existingDraft.psbtBase64,
    signedPsbtBase64,
    allowedDraftLockId: existingDraft.id,
  });

  const draft = await draftService.updateDraft(fundingWalletId, draftId, {
    signedPsbtBase64,
    signedDeviceId: context.signerDeviceId,
    status: 'partial',
  });

  res.json(serializeDraftTransaction(draft));
}));

export default router;
