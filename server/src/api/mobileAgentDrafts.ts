/**
 * Mobile Agent Draft Routes
 *
 * Mobile-friendly review and signing foundation for agent-submitted funding
 * drafts. These routes require human JWT auth and enforce mobile wallet
 * permissions before exposing draft details or accepting signed PSBT updates.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../errors/errorHandler';
import { ErrorCodes } from '../errors/ApiError';
import { auditService, AuditAction, AuditCategory } from '../services/auditService';
import { mobileAgentDraftService } from '../services/mobileAgentDraftService';

const router = Router();

const DraftParamsSchema = z.object({
  draftId: z.string().min(1),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const ReviewCommentSchema = z.string().trim().min(1).max(1000);

const ApproveBodySchema = z.object({
  comment: ReviewCommentSchema.optional(),
}).default({});

const CommentBodySchema = z.object({
  comment: ReviewCommentSchema,
});

const RejectBodySchema = z.object({
  reason: ReviewCommentSchema,
});

const SignatureBodySchema = z.object({
  signedPsbtBase64: z.string().min(1),
  signedDeviceId: z.string().trim().min(1).max(200),
  status: z.enum(['unsigned', 'partial', 'signed']).optional(),
});

const validationOptions = {
  message: 'Invalid mobile agent draft request',
  code: ErrorCodes.INVALID_INPUT,
} as const;

function getUserId(req: Parameters<typeof requireAuthenticatedUser>[0]): string {
  return requireAuthenticatedUser(req).userId;
}

function buildDraftAuditDetails(draft: {
  id: string;
  walletId: string;
  agentId: string;
  agentOperationalWalletId: string | null;
}) {
  return {
    draftId: draft.id,
    walletId: draft.walletId,
    agentId: draft.agentId,
    agentOperationalWalletId: draft.agentOperationalWalletId,
  };
}

router.use(authenticate);

/**
 * GET /api/v1/mobile/agent-funding-drafts
 * List pending agent funding drafts visible to the authenticated mobile user.
 */
router.get('/agent-funding-drafts', validate({
  query: ListQuerySchema,
}, validationOptions), asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { limit } = req.query as unknown as z.infer<typeof ListQuerySchema>;

  const drafts = await mobileAgentDraftService.listPendingAgentFundingDrafts(userId, limit);

  res.json({ drafts });
}));

/**
 * GET /api/v1/mobile/agent-funding-drafts/:draftId
 * Fetch one pending agent funding draft review payload.
 */
router.get('/agent-funding-drafts/:draftId', validate({
  params: DraftParamsSchema,
}, validationOptions), asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { draftId } = req.params;

  const draft = await mobileAgentDraftService.getAgentFundingDraftForReview(userId, draftId);

  res.json({ draft });
}));

/**
 * POST /api/v1/mobile/agent-funding-drafts/:draftId/approve
 * Record an audited mobile approval intent. The actual spend still requires a
 * human signature submitted through the signature endpoint.
 */
router.post('/agent-funding-drafts/:draftId/approve', validate({
  body: ApproveBodySchema,
  params: DraftParamsSchema,
}, validationOptions), asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { draftId } = req.params;
  const { comment } = req.body as z.infer<typeof ApproveBodySchema>;

  const result = await mobileAgentDraftService.approveAgentFundingDraft(userId, draftId, comment);

  await auditService.logFromRequest(req, AuditAction.MOBILE_AGENT_DRAFT_APPROVE, AuditCategory.WALLET, {
    details: {
      ...buildDraftAuditDetails(result.draft),
      comment: result.comment,
      nextAction: result.nextAction,
    },
  });

  res.json(result);
}));

/**
 * POST /api/v1/mobile/agent-funding-drafts/:draftId/comment
 * Record an audited mobile comment for a pending agent funding draft.
 */
router.post('/agent-funding-drafts/:draftId/comment', validate({
  body: CommentBodySchema,
  params: DraftParamsSchema,
}, validationOptions), asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { draftId } = req.params;
  const { comment } = req.body as z.infer<typeof CommentBodySchema>;

  const result = await mobileAgentDraftService.commentOnAgentFundingDraft(userId, draftId, comment);

  await auditService.logFromRequest(req, AuditAction.MOBILE_AGENT_DRAFT_COMMENT, AuditCategory.WALLET, {
    details: {
      ...buildDraftAuditDetails(result.draft),
      comment,
      nextAction: result.nextAction,
    },
  });

  res.json(result);
}));

/**
 * POST /api/v1/mobile/agent-funding-drafts/:draftId/reject
 * Reject a pending agent funding draft so it is no longer offered for mobile review.
 */
router.post('/agent-funding-drafts/:draftId/reject', validate({
  body: RejectBodySchema,
  params: DraftParamsSchema,
}, validationOptions), asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { draftId } = req.params;
  const { reason } = req.body as z.infer<typeof RejectBodySchema>;

  const result = await mobileAgentDraftService.rejectAgentFundingDraft(userId, draftId, reason);

  await auditService.logFromRequest(req, AuditAction.MOBILE_AGENT_DRAFT_REJECT, AuditCategory.WALLET, {
    details: {
      ...buildDraftAuditDetails(result.draft),
      reason,
    },
  });

  res.json(result);
}));

/**
 * POST /api/v1/mobile/agent-funding-drafts/:draftId/signature
 * Submit a mobile-produced signed PSBT for the draft using the existing draft
 * update path.
 */
router.post('/agent-funding-drafts/:draftId/signature', validate({
  body: SignatureBodySchema,
  params: DraftParamsSchema,
}, validationOptions), asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { draftId } = req.params;
  const { signedPsbtBase64, signedDeviceId, status } = req.body as z.infer<typeof SignatureBodySchema>;

  const draft = await mobileAgentDraftService.submitAgentFundingDraftSignature(userId, draftId, {
    signedPsbtBase64,
    signedDeviceId,
    status,
  });

  await auditService.logFromRequest(req, AuditAction.MOBILE_AGENT_DRAFT_SIGN, AuditCategory.WALLET, {
    details: {
      ...buildDraftAuditDetails(draft),
      signedDeviceId,
      status: draft.status,
    },
  });

  res.json({ draft });
}));

export default router;
