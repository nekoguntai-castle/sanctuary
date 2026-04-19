/**
 * Agent API Routes
 *
 * Scoped endpoints for non-human wallet agents. These routes do not use human
 * JWT auth; they require an `agt_` bearer token that is scoped to one agent.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAgentFundingDraftAccess } from '../agent/auth';
import { ForbiddenError } from '../errors';
import { asyncHandler } from '../errors/errorHandler';
import { authenticateAgent, requireAgentContext } from '../middleware/agentAuth';
import { validate } from '../middleware/validate';
import { validateAgentFundingDraftSubmission } from '../services/agentFundingDraftValidation';
import { getAgentWalletSummary, submitAgentFundingDraft } from '../services/agentApiService';
import {
  getOrCreateOperationalReceiveAddress,
  verifyOperationalReceiveAddress,
} from '../services/agentOperationalAddressService';
import { draftService } from '../services/draftService';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../services/auditService';
import { serializeDraftTransaction } from '../utils/serialization';

const router = Router();

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

  res.json(await getAgentWalletSummary(context, fundingWalletId));
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
  const { operationalWalletId } = req.body;
  const { ipAddress, userAgent } = getClientInfo(req);
  const { draft, usedOverrideId } = await submitAgentFundingDraft({
    context,
    fundingWalletId,
    body: req.body,
    ipAddress,
    userAgent,
  });

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
