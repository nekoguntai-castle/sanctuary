/**
 * Global Approvals API Routes
 *
 * Cross-wallet approval endpoints for the current user.
 */

import { Router } from 'express';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { approvalService } from '../services/vaultPolicy/approvalService';
import { walletSharingRepository } from '../repositories';
import { asyncHandler } from '../errors/errorHandler';

const router = Router();

router.use(authenticate);

/**
 * GET /api/v1/approvals/pending - List all pending approvals for the current user
 * Returns approvals for wallets where the user has owner or approver role.
 */
router.get('/approvals/pending', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;

  // Single query: get wallet IDs where user has approve-capable role (owner or approver)
  const approveWalletIds = await walletSharingRepository.findWalletIdsByUserRole(userId, ['owner', 'approver']);

  const pending = await approvalService.getPendingApprovalsForUser(approveWalletIds);

  res.json({
    approvals: pending.map(a => ({
      id: a.id,
      draftTransactionId: a.draftTransactionId,
      walletId: a.draftTransaction.walletId,
      status: a.status,
      requiredApprovals: a.requiredApprovals,
      currentApprovals: a.votes.filter(v => v.decision === 'approve').length,
      totalVotes: a.votes.length,
      recipient: a.draftTransaction.recipient,
      amount: a.draftTransaction.amount.toString(),
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
    })),
    total: pending.length,
  });
}));

export default router;
