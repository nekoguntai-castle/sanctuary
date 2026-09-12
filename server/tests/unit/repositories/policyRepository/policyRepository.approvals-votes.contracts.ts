import { prisma, type Mock } from './policyRepositoryTestHarness';
import { describe, expect, it } from 'vitest';
import {
  findApprovalRequestsByDraftId,
  findApprovalRequestById,
  findPendingApprovalsForUser,
  createApprovalRequest,
  resolveApprovalRequestIfPending,
  countPendingApprovalsByDraftId,
  createVote,
  findVoteByUserAndRequest,
} from '../../../../src/repositories/policyRepository';

export const registerPolicyRepositoryApprovalVoteContracts = () => {
  describe('findApprovalRequestsByDraftId', () => {
    it('finds approval requests with votes by draftTransactionId', async () => {
      const requests = [{ id: 'ar1', votes: [{ id: 'v1' }] }];
      (prisma.approvalRequest.findMany as Mock).mockResolvedValue(requests);

      const result = await findApprovalRequestsByDraftId('draft-1');

      expect(result).toEqual(requests);
      expect(prisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: { draftTransactionId: 'draft-1' },
        include: { votes: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('findApprovalRequestById', () => {
    it('finds an approval request with votes by id', async () => {
      const request = { id: 'ar1', votes: [] };
      (prisma.approvalRequest.findUnique as Mock).mockResolvedValue(request);

      const result = await findApprovalRequestById('ar1');

      expect(result).toEqual(request);
      expect(prisma.approvalRequest.findUnique).toHaveBeenCalledWith({
        where: { id: 'ar1' },
        include: { votes: true },
      });
    });

    it('returns null when not found', async () => {
      (prisma.approvalRequest.findUnique as Mock).mockResolvedValue(null);

      const result = await findApprovalRequestById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findPendingApprovalsForUser', () => {
    it('returns empty array when walletIds is empty', async () => {
      const result = await findPendingApprovalsForUser([]);

      expect(result).toEqual([]);
      expect(prisma.approvalRequest.findMany).not.toHaveBeenCalled();
    });

    it('finds pending approvals for given walletIds', async () => {
      const approvals = [
        {
          id: 'ar1',
          votes: [],
          draftTransaction: { walletId: 'w1', recipient: 'addr1', amount: BigInt(1000) },
        },
      ];
      (prisma.approvalRequest.findMany as Mock).mockResolvedValue(approvals);

      const result = await findPendingApprovalsForUser(['w1', 'w2']);

      expect(result).toEqual(approvals);
      expect(prisma.approvalRequest.findMany).toHaveBeenCalledWith({
        where: {
          status: 'pending',
          draftTransaction: {
            walletId: { in: ['w1', 'w2'] },
          },
        },
        include: {
          votes: true,
          draftTransaction: {
            select: { walletId: true, recipient: true, amount: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('createApprovalRequest', () => {
    it('creates an approval request with defaults', async () => {
      const created = { id: 'ar-new' };
      (prisma.approvalRequest.create as Mock).mockResolvedValue(created);

      const result = await createApprovalRequest({
        draftTransactionId: 'draft-1',
        policyId: 'policy-1',
        requiredApprovals: 2,
      });

      expect(result).toEqual(created);
      expect(prisma.approvalRequest.create).toHaveBeenCalledWith({
        data: {
          draftTransactionId: 'draft-1',
          policyId: 'policy-1',
          requiredApprovals: 2,
          quorumType: 'any_n',
          allowSelfApproval: false,
          vetoDeadline: null,
          expiresAt: null,
        },
      });
    });

    it('creates an approval request with all optional fields', async () => {
      const created = { id: 'ar-full' };
      const vetoDeadline = new Date('2026-06-01T00:00:00Z');
      const expiresAt = new Date('2026-07-01T00:00:00Z');
      (prisma.approvalRequest.create as Mock).mockResolvedValue(created);

      const result = await createApprovalRequest({
        draftTransactionId: 'draft-2',
        policyId: 'policy-2',
        requiredApprovals: 3,
        quorumType: 'specific',
        allowSelfApproval: true,
        vetoDeadline,
        expiresAt,
      });

      expect(result).toEqual(created);
      expect(prisma.approvalRequest.create).toHaveBeenCalledWith({
        data: {
          draftTransactionId: 'draft-2',
          policyId: 'policy-2',
          requiredApprovals: 3,
          quorumType: 'specific',
          allowSelfApproval: true,
          vetoDeadline,
          expiresAt,
        },
      });
    });
  });

  describe('resolveApprovalRequestIfPending', () => {
    /**
     * The `status: 'pending'` predicate is the whole point: it makes the write
     * the serialization point between two concurrent resolvers. These contracts
     * previously asserted an unconditional `update({ where: { id } })`, which
     * pinned the defect in place.
     */
    it('resolves to approved with explicit resolvedAt, conditional on still being pending', async () => {
      const resolvedAt = new Date('2026-03-15T12:00:00Z');
      const updated = { id: 'ar1', status: 'approved', resolvedAt };
      (prisma.approvalRequest.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.approvalRequest.findUnique as Mock).mockResolvedValue(updated);

      const result = await resolveApprovalRequestIfPending('ar1', 'approved', resolvedAt);

      expect(result).toEqual(updated);
      expect(prisma.approvalRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'ar1', status: 'pending' },
        data: {
          status: 'approved',
          resolvedAt,
        },
      });
    });

    it('auto-generates resolvedAt when no explicit date is given', async () => {
      const updated = { id: 'ar1', status: 'rejected' };
      (prisma.approvalRequest.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.approvalRequest.findUnique as Mock).mockResolvedValue(updated);

      const result = await resolveApprovalRequestIfPending('ar1', 'rejected');

      expect(result).toEqual(updated);
      expect(prisma.approvalRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'ar1', status: 'pending' },
        data: {
          status: 'rejected',
          resolvedAt: expect.any(Date),
        },
      });
    });

    it('returns null without re-reading when the request was no longer pending', async () => {
      (prisma.approvalRequest.updateMany as Mock).mockResolvedValue({ count: 0 });

      const result = await resolveApprovalRequestIfPending('ar1', 'approved');

      expect(result).toBeNull();
      expect(prisma.approvalRequest.findUnique).not.toHaveBeenCalled();
    });

    it('never issues an unconditional update by id', async () => {
      (prisma.approvalRequest.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.approvalRequest.findUnique as Mock).mockResolvedValue({ id: 'ar1', status: 'vetoed' });

      await resolveApprovalRequestIfPending('ar1', 'vetoed');

      expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
    });
  });

  describe('countPendingApprovalsByDraftId', () => {
    it('counts pending approvals for a draft', async () => {
      (prisma.approvalRequest.count as Mock).mockResolvedValue(3);

      const result = await countPendingApprovalsByDraftId('draft-1');

      expect(result).toBe(3);
      expect(prisma.approvalRequest.count).toHaveBeenCalledWith({
        where: { draftTransactionId: 'draft-1', status: 'pending' },
      });
    });
  });

  // ========================================
  // APPROVAL VOTES
  // ========================================

  describe('createVote', () => {
    it('creates a vote with defaults', async () => {
      const created = { id: 'vote-1' };
      (prisma.approvalVote.create as Mock).mockResolvedValue(created);

      const result = await createVote({
        approvalRequestId: 'ar1',
        userId: 'user-1',
        decision: 'approve',
      });

      expect(result).toEqual(created);
      expect(prisma.approvalVote.create).toHaveBeenCalledWith({
        data: {
          approvalRequestId: 'ar1',
          userId: 'user-1',
          decision: 'approve',
          reason: null,
        },
      });
    });

    it('creates a vote with reason', async () => {
      const created = { id: 'vote-2' };
      (prisma.approvalVote.create as Mock).mockResolvedValue(created);

      const result = await createVote({
        approvalRequestId: 'ar1',
        userId: 'user-2',
        decision: 'reject',
        reason: 'Amount too high',
      });

      expect(result).toEqual(created);
      expect(prisma.approvalVote.create).toHaveBeenCalledWith({
        data: {
          approvalRequestId: 'ar1',
          userId: 'user-2',
          decision: 'reject',
          reason: 'Amount too high',
        },
      });
    });
  });

  describe('findVoteByUserAndRequest', () => {
    it('finds a vote by composite key', async () => {
      const vote = { id: 'vote-1', decision: 'approve' };
      (prisma.approvalVote.findUnique as Mock).mockResolvedValue(vote);

      const result = await findVoteByUserAndRequest('ar1', 'user-1');

      expect(result).toEqual(vote);
      expect(prisma.approvalVote.findUnique).toHaveBeenCalledWith({
        where: {
          approvalRequestId_userId: {
            approvalRequestId: 'ar1',
            userId: 'user-1',
          },
        },
      });
    });

    it('returns null when vote not found', async () => {
      (prisma.approvalVote.findUnique as Mock).mockResolvedValue(null);

      const result = await findVoteByUserAndRequest('ar1', 'user-nonexistent');

      expect(result).toBeNull();
    });
  });
};
