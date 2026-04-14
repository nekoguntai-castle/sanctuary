/**
 * Wallet Approval API Routes
 *
 * Endpoints for the approval workflow: listing approvals, casting votes,
 * and owner override.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { approvalService } from '../../services/vaultPolicy/approvalService';
import { auditService, AuditAction, AuditCategory } from '../../services/auditService';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';

const router = Router();

const VoteBodySchema = z.object({
  decision: z.enum(['approve', 'reject', 'veto']),
  reason: z.string().optional(),
});

const OverrideBodySchema = z.object({
  reason: z.string().trim().min(1),
});

const decisionValidationMessage = 'decision is required and must be one of: approve, reject, veto';
const overrideValidationMessage = 'A reason is required for owner override';

/**
 * GET /:walletId/drafts/:draftId/approvals - List approval requests for a draft
 */
router.get('/:walletId/drafts/:draftId/approvals', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const { draftId } = req.params;

  const approvals = await approvalService.getApprovalsForDraft(draftId);

  res.json({ approvals });
}));

/**
 * POST /:walletId/drafts/:draftId/approvals/:requestId/vote - Cast a vote
 * Requires 'approve' access level (owner or approver role)
 */
router.post(
  '/:walletId/drafts/:draftId/approvals/:requestId/vote',
  requireWalletAccess('approve'),
  validate(
    { body: VoteBodySchema },
    { message: decisionValidationMessage, code: ErrorCodes.INVALID_INPUT }
  ),
  asyncHandler(async (req, res) => {
    const { walletId, draftId, requestId } = req.params;
    const userId = req.user!.userId;
    const { decision, reason } = req.body;

    const { vote, request } = await approvalService.castVote(requestId, userId, decision, reason);

    await auditService.logFromRequest(req, AuditAction.POLICY_APPROVAL_VOTE, AuditCategory.WALLET, {
      details: {
        walletId,
        draftId,
        requestId,
        decision,
        reason: reason ?? null,
        requestStatus: request.status,
      },
    });

    res.json({
      vote: {
        id: vote.id,
        decision: vote.decision,
        reason: vote.reason,
        createdAt: vote.createdAt,
      },
      request: {
        id: request.id,
        status: request.status,
        requiredApprovals: request.requiredApprovals,
        currentApprovals: request.votes.filter(v => v.decision === 'approve').length,
        totalVotes: request.votes.length,
      },
    });
  })
);

/**
 * POST /:walletId/drafts/:draftId/override - Owner force-approve
 * Requires 'owner' access level
 */
router.post('/:walletId/drafts/:draftId/override', requireWalletAccess('owner'), validate(
  { body: OverrideBodySchema },
  { message: overrideValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { walletId, draftId } = req.params;
  const userId = req.user!.userId;
  const { reason } = req.body;

  await approvalService.ownerOverride(draftId, walletId, userId, reason);

  await auditService.logFromRequest(req, AuditAction.POLICY_OVERRIDE, AuditCategory.WALLET, {
    details: {
      walletId,
      draftId,
      reason,
    },
  });

  res.json({ success: true, message: 'All pending approvals have been force-approved' });
}));

export default router;
