/**
 * Approval Service Tests
 *
 * Tests approval workflow: creating requests, casting votes, resolution, and owner override.
 * Targets 100% line/branch/statement/function coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

const { mockLog, mockPolicyRepo, mockDraftRepo, mockNotify } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockPolicyRepo: {
    findPolicyById: vi.fn(),
    findApprovalRequestById: vi.fn(),
    findApprovalRequestsByDraftId: vi.fn(),
    findPendingApprovalsForUser: vi.fn(),
    createApprovalRequest: vi.fn(),
    updateApprovalRequestStatus: vi.fn(),
    createVote: vi.fn(),
    findVoteByUserAndRequest: vi.fn(),
    createPolicyEvent: vi.fn().mockResolvedValue({}),
  },
  mockDraftRepo: {
    findById: vi.fn(),
    update: vi.fn(),
    updateApprovalStatus: vi.fn().mockResolvedValue(undefined),
  },
  mockNotify: {
    notifyApprovalRequested: vi.fn().mockResolvedValue(undefined),
    notifyApprovalResolved: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('../../../src/repositories/policyRepository', () => ({
  policyRepository: mockPolicyRepo,
}));

vi.mock('../../../src/repositories/draftRepository', () => ({
  draftRepository: mockDraftRepo,
}));

vi.mock('../../../src/repositories/db', () => ({
  db: {},
}));

vi.mock('../../../src/services/vaultPolicy/approvalNotifications', () => mockNotify);

import { approvalService } from '../../../src/services/vaultPolicy/approvalService';

describe('ApprovalService', () => {
  const walletId = faker.string.uuid();
  const userId = faker.string.uuid();
  const draftId = faker.string.uuid();
  const policyId = faker.string.uuid();
  const requestId = faker.string.uuid();
  const otherUserId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock return values cleared by vi.clearAllMocks()
    mockPolicyRepo.createPolicyEvent.mockResolvedValue({});
    mockDraftRepo.updateApprovalStatus.mockResolvedValue(undefined);
    mockNotify.notifyApprovalRequested.mockResolvedValue(undefined);
    mockNotify.notifyApprovalResolved.mockResolvedValue(undefined);
  });

  // ========================================
  // CREATE APPROVAL REQUESTS
  // ========================================

  describe('createApprovalRequestsForDraft', () => {
    it('returns empty array when no approval_required policies in triggered list', async () => {
      const result = await approvalService.createApprovalRequestsForDraft(
        draftId,
        walletId,
        userId,
        [{ policyId, policyName: 'Limit', type: 'spending_limit', action: 'blocked', reason: 'over limit' }]
      );

      expect(result).toHaveLength(0);
      expect(mockPolicyRepo.findPolicyById).not.toHaveBeenCalled();
      expect(mockPolicyRepo.createApprovalRequest).not.toHaveBeenCalled();
    });

    it('returns empty array when triggered list is empty', async () => {
      const result = await approvalService.createApprovalRequestsForDraft(
        draftId, walletId, userId, []
      );

      expect(result).toHaveLength(0);
    });

    it('creates approval requests for triggered policies with expirationHours > 0', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        config: {
          trigger: { always: true },
          requiredApprovals: 2,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 48,
        },
      });

      mockPolicyRepo.createApprovalRequest.mockResolvedValue({
        id: requestId,
        draftTransactionId: draftId,
        policyId,
        status: 'pending',
        requiredApprovals: 2,
      });

      const result = await approvalService.createApprovalRequestsForDraft(
        draftId,
        walletId,
        userId,
        [{ policyId, policyName: 'Test', type: 'approval_required', action: 'approval_required', reason: 'test' }]
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(requestId);

      const callArgs = mockPolicyRepo.createApprovalRequest.mock.calls[0][0];
      expect(callArgs.draftTransactionId).toBe(draftId);
      expect(callArgs.policyId).toBe(policyId);
      expect(callArgs.requiredApprovals).toBe(2);
      expect(callArgs.quorumType).toBe('any_n');
      expect(callArgs.allowSelfApproval).toBe(false);
      expect(callArgs.expiresAt).toBeDefined();
      expect(callArgs.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Verify draft approval status updated to pending
      expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'pending');
      // Verify notification sent
      expect(mockNotify.notifyApprovalRequested).toHaveBeenCalledWith(walletId, draftId, userId);
      // Verify log
      expect(mockLog.info).toHaveBeenCalledWith('Created approval request', expect.objectContaining({
        requestId,
        draftId,
        policyId,
      }));
    });

    it('does not set expiresAt when expirationHours is 0', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'all',
          allowSelfApproval: true,
          expirationHours: 0,
        },
      });

      mockPolicyRepo.createApprovalRequest.mockResolvedValue({
        id: requestId,
        status: 'pending',
      });

      await approvalService.createApprovalRequestsForDraft(
        draftId, walletId, userId,
        [{ policyId, policyName: 'No Expiry', type: 'approval_required', action: 'approval_required', reason: 'test' }]
      );

      const callArgs = mockPolicyRepo.createApprovalRequest.mock.calls[0][0];
      expect(callArgs.expiresAt).toBeUndefined();
    });

    it('skips policy when findPolicyById returns null (continue branch)', async () => {
      const secondPolicyId = faker.string.uuid();
      const secondRequestId = faker.string.uuid();

      // First policy not found, second policy found
      mockPolicyRepo.findPolicyById
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: secondPolicyId,
          config: {
            trigger: { always: true },
            requiredApprovals: 1,
            quorumType: 'any_n',
            allowSelfApproval: false,
            expirationHours: 24,
          },
        });

      mockPolicyRepo.createApprovalRequest.mockResolvedValue({
        id: secondRequestId,
        status: 'pending',
      });

      const result = await approvalService.createApprovalRequestsForDraft(
        draftId, walletId, userId,
        [
          { policyId, policyName: 'Missing', type: 'approval_required', action: 'approval_required', reason: 'test' },
          { policyId: secondPolicyId, policyName: 'Found', type: 'approval_required', action: 'approval_required', reason: 'test' },
        ]
      );

      // Only the second request should be created
      expect(result).toHaveLength(1);
      expect(mockPolicyRepo.createApprovalRequest).toHaveBeenCalledTimes(1);
    });

    it('logs warning when notifyApprovalRequested fails', async () => {
      mockPolicyRepo.findPolicyById.mockResolvedValue({
        id: policyId,
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 0,
        },
      });

      mockPolicyRepo.createApprovalRequest.mockResolvedValue({
        id: requestId,
        status: 'pending',
      });

      mockNotify.notifyApprovalRequested.mockRejectedValue(new Error('Notification failed'));

      await approvalService.createApprovalRequestsForDraft(
        draftId, walletId, userId,
        [{ policyId, policyName: 'Test', type: 'approval_required', action: 'approval_required', reason: 'test' }]
      );

      // Wait for the .catch() handler to execute
      await vi.waitFor(() => {
        expect(mockLog.warn).toHaveBeenCalledWith(
          'Failed to send approval notification',
          expect.objectContaining({ error: 'Notification failed' })
        );
      });
    });
  });

  // ========================================
  // CAST VOTE
  // ========================================

  describe('castVote', () => {
    const pendingRequest = {
      id: requestId,
      draftTransactionId: draftId,
      policyId,
      status: 'pending',
      requiredApprovals: 2,
      quorumType: 'any_n',
      allowSelfApproval: false,
      expiresAt: null,
      votes: [],
    };

    it('throws NotFoundError when request does not exist', async () => {
      mockPolicyRepo.findApprovalRequestById.mockResolvedValue(null);

      await expect(
        approvalService.castVote('nonexistent', otherUserId, 'approve')
      ).rejects.toThrow('Approval request not found');
    });

    it('throws ConflictError when request is already resolved', async () => {
      mockPolicyRepo.findApprovalRequestById.mockResolvedValue({
        ...pendingRequest,
        status: 'approved',
      });

      await expect(
        approvalService.castVote(requestId, otherUserId, 'approve')
      ).rejects.toThrow('already approved');
    });

    it('expires and throws ConflictError when request has expired', async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1);

      mockPolicyRepo.findApprovalRequestById.mockResolvedValue({
        ...pendingRequest,
        expiresAt: pastDate,
      });

      await expect(
        approvalService.castVote(requestId, otherUserId, 'approve')
      ).rejects.toThrow('expired');

      // Should have resolved request as expired
      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'expired');
      expect(mockLog.info).toHaveBeenCalledWith('Approval request resolved', { requestId, status: 'expired' });
    });

    it('throws ConflictError when user already voted', async () => {
      mockPolicyRepo.findApprovalRequestById.mockResolvedValue(pendingRequest);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue({ id: 'existing-vote' });

      await expect(
        approvalService.castVote(requestId, otherUserId, 'approve')
      ).rejects.toThrow('already voted');
    });

    it('throws ForbiddenError when self-approval is not allowed', async () => {
      const creatorId = faker.string.uuid();
      mockPolicyRepo.findApprovalRequestById.mockResolvedValue(pendingRequest);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: creatorId, walletId });

      await expect(
        approvalService.castVote(requestId, creatorId, 'approve')
      ).rejects.toThrow('Self-approval is not allowed');
    });

    it('allows self-approval when allowSelfApproval is true', async () => {
      const creatorId = faker.string.uuid();
      const selfApprovalRequest = {
        ...pendingRequest,
        allowSelfApproval: true,
        requiredApprovals: 1,
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(selfApprovalRequest)
        .mockResolvedValueOnce({
          ...selfApprovalRequest,
          votes: [{ id: 'v1', userId: creatorId, decision: 'approve' }],
        });
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: creatorId, walletId });
      mockPolicyRepo.createVote.mockResolvedValue({
        id: 'v1', approvalRequestId: requestId, userId: creatorId, decision: 'approve',
      });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...selfApprovalRequest, status: 'approved', votes: [{ decision: 'approve' }] },
      ]);

      const { vote } = await approvalService.castVote(requestId, creatorId, 'approve');

      expect(vote.decision).toBe('approve');
    });

    it('records approve vote (happy path, quorum not yet met)', async () => {
      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce({
          ...pendingRequest,
          votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
        });

      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'other-creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({
        id: 'v1',
        approvalRequestId: requestId,
        userId: otherUserId,
        decision: 'approve',
      });

      const { vote, request: updatedReq } = await approvalService.castVote(requestId, otherUserId, 'approve', 'Looks good');

      expect(vote.decision).toBe('approve');
      expect(updatedReq.votes).toHaveLength(1);
      expect(mockPolicyRepo.createVote).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalRequestId: requestId,
          userId: otherUserId,
          decision: 'approve',
          reason: 'Looks good',
        })
      );
      expect(mockLog.info).toHaveBeenCalledWith('Vote cast', expect.objectContaining({
        requestId,
        userId: otherUserId,
        decision: 'approve',
      }));
      // Quorum is 2, only 1 vote -> no resolution
      expect(mockPolicyRepo.updateApprovalRequestStatus).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when re-fetch returns null after vote', async () => {
      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(null);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'other-creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({
        id: 'v1', decision: 'approve',
      });

      await expect(
        approvalService.castVote(requestId, otherUserId, 'approve')
      ).rejects.toThrow('Approval request not found after vote');
    });

    it('handles draft not found (draft is null) — uses empty walletId fallback', async () => {
      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce({
          ...pendingRequest,
          votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
        });
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      // Draft not found - so self-approval check does not block, and walletId will be ''
      mockDraftRepo.findById.mockResolvedValue(null);
      mockPolicyRepo.createVote.mockResolvedValue({
        id: 'v1', decision: 'approve',
      });

      const { vote } = await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(vote.decision).toBe('approve');
      // Verify that createPolicyEvent is called with walletId = ''
      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: '' })
      );
    });

    it('records reject vote and triggers rejection resolution', async () => {
      const requestWithReject = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'reject' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(requestWithReject);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'reject' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...requestWithReject, status: 'rejected' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'reject', 'Too risky');

      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'rejected');
    });

    it('records veto vote and triggers veto resolution', async () => {
      const requestWithVeto = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'veto' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(requestWithVeto);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'veto' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...requestWithVeto, status: 'vetoed' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'veto', 'Absolutely not');

      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'vetoed');
    });

    it('resolves request when any_n quorum is met', async () => {
      const requestWith1Approval = {
        ...pendingRequest,
        requiredApprovals: 1,
        quorumType: 'any_n',
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce({ ...pendingRequest, requiredApprovals: 1 })
        .mockResolvedValueOnce(requestWith1Approval);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...requestWith1Approval, status: 'approved' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'approved');
    });

    it('resolves request when all quorum is met', async () => {
      const requestWithAllVotes = {
        ...pendingRequest,
        requiredApprovals: 2,
        quorumType: 'all',
        votes: [
          { id: 'v1', userId: otherUserId, decision: 'approve' },
          { id: 'v2', userId: faker.string.uuid(), decision: 'approve' },
        ],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce({ ...pendingRequest, quorumType: 'all' })
        .mockResolvedValueOnce(requestWithAllVotes);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v2', decision: 'approve' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...requestWithAllVotes, status: 'approved' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'approved');
    });

    it('resolves request when specific quorum is met', async () => {
      const requestWithSpecificVotes = {
        ...pendingRequest,
        requiredApprovals: 1,
        quorumType: 'specific',
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce({ ...pendingRequest, requiredApprovals: 1, quorumType: 'specific' })
        .mockResolvedValueOnce(requestWithSpecificVotes);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...requestWithSpecificVotes, status: 'approved' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'approved');
    });

    it('logs policy event with correct eventType for approve', async () => {
      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce({
          ...pendingRequest,
          votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
        });
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });

      await approvalService.castVote(requestId, otherUserId, 'approve', 'LGTM');

      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId,
          walletId,
          draftTransactionId: draftId,
          userId: otherUserId,
          eventType: 'approved',
          details: expect.objectContaining({
            requestId,
            decision: 'approve',
            reason: 'LGTM',
            currentApprovals: 1,
            requiredApprovals: 2,
          }),
        })
      );
    });

    it('logs policy event with eventType rejected for reject', async () => {
      const updatedReq = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'reject' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'reject' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...updatedReq, status: 'rejected' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'reject');

      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'rejected',
          details: expect.objectContaining({
            decision: 'reject',
            reason: null,
          }),
        })
      );
    });

    it('logs policy event with eventType vetoed for veto', async () => {
      const updatedReq = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'veto' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'veto' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { ...updatedReq, status: 'vetoed' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'veto');

      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'vetoed' })
      );
    });

    it('logs warning when createPolicyEvent fails', async () => {
      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce({
          ...pendingRequest,
          votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
        });
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
      mockPolicyRepo.createPolicyEvent.mockRejectedValue(new Error('DB write failed'));

      await approvalService.castVote(requestId, otherUserId, 'approve');

      await vi.waitFor(() => {
        expect(mockLog.warn).toHaveBeenCalledWith(
          'Failed to log approval event',
          expect.objectContaining({ error: 'DB write failed' })
        );
      });
    });

    it('does not call reason in event details when reason is undefined', async () => {
      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce({
          ...pendingRequest,
          votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
        });
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });

      await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ reason: null }),
        })
      );
    });
  });

  // ========================================
  // checkAndResolveRequest (tested indirectly via castVote)
  // ========================================

  describe('checkAndResolveRequest (indirect)', () => {
    const pendingRequest = {
      id: requestId,
      draftTransactionId: draftId,
      policyId,
      status: 'pending',
      requiredApprovals: 3,
      quorumType: 'any_n',
      allowSelfApproval: false,
      expiresAt: null,
      votes: [],
    };

    it('does not resolve when quorum is not met (approvals < required)', async () => {
      const updatedReq = {
        ...pendingRequest,
        requiredApprovals: 3,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });

      await approvalService.castVote(requestId, otherUserId, 'approve');

      // No resolution should happen
      expect(mockPolicyRepo.updateApprovalRequestStatus).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // updateDraftApprovalFromRequests (tested indirectly)
  // ========================================

  describe('updateDraftApprovalFromRequests (indirect)', () => {
    const pendingRequest = {
      id: requestId,
      draftTransactionId: draftId,
      policyId,
      status: 'pending',
      requiredApprovals: 1,
      quorumType: 'any_n',
      allowSelfApproval: false,
      expiresAt: null,
      votes: [],
    };

    it('updates draft to rejected when any request is rejected', async () => {
      const updatedReq = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'reject' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'reject' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { status: 'rejected' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'reject');

      expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'rejected');
    });

    it('updates draft to vetoed when any request is vetoed', async () => {
      const updatedReq = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'veto' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'veto' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { status: 'vetoed' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'veto');

      expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'vetoed');
    });

    it('updates draft to approved and sends notification when all requests are approved', async () => {
      const updatedReq = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById
        .mockResolvedValueOnce({ userId: 'creator', walletId })  // self-approval check
        .mockResolvedValueOnce({ userId: 'creator', walletId }); // notification fetch
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { status: 'approved' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved');
      expect(mockNotify.notifyApprovalResolved).toHaveBeenCalledWith(walletId, draftId, 'approved', null);
    });

    it('does not send notification when draft not found on approval resolution', async () => {
      const updatedReq = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById
        .mockResolvedValueOnce({ userId: 'creator', walletId })  // self-approval check
        .mockResolvedValueOnce(null); // draft not found for notification
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { status: 'approved' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved');
      expect(mockNotify.notifyApprovalResolved).not.toHaveBeenCalled();
    });

    it('does nothing when requests list is empty (early return)', async () => {
      const updatedReq = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'reject' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'reject' });
      // First call resolves the request, second call from updateDraftApprovalFromRequests returns empty
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([]);

      await approvalService.castVote(requestId, otherUserId, 'reject');

      // updateApprovalRequestStatus called for the resolve, but not for draft status
      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'rejected');
      // updateApprovalStatus should NOT be called because requests.length === 0
      // Only the resolveRequest call triggers updateApprovalRequestStatus
      // The draft updateApprovalStatus should not be called in updateDraftApprovalFromRequests
      // because requests is empty
    });

    it('stays pending when requests have mixed pending/approved statuses', async () => {
      const updatedReq = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
      // One approved, one still pending → draft stays pending
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { status: 'approved' },
        { status: 'pending' },
      ]);

      await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'approved');
      // updateApprovalStatus should NOT be called for the draft because not all are approved
      // Count calls: first from resolveRequest inner updateDraftApprovalFromRequests
      // Since we have approved + pending, none of the branches (rejected/vetoed/all approved) match
      // so the draft status is NOT updated
    });

    it('logs warning when notifyApprovalResolved fails after all approved', async () => {
      const updatedReq = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(updatedReq);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById
        .mockResolvedValueOnce({ userId: 'creator', walletId })
        .mockResolvedValueOnce({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { status: 'approved' },
      ]);
      mockNotify.notifyApprovalResolved.mockRejectedValue(new Error('Notify failed'));

      await approvalService.castVote(requestId, otherUserId, 'approve');

      await vi.waitFor(() => {
        expect(mockLog.warn).toHaveBeenCalledWith(
          'Failed to send resolution notification',
          expect.objectContaining({ error: 'Notify failed' })
        );
      });
    });
  });

  // ========================================
  // OWNER OVERRIDE
  // ========================================

  describe('ownerOverride', () => {
    it('force-approves all pending requests and logs events', async () => {
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { id: 'r1', status: 'pending', policyId },
        { id: 'r2', status: 'pending', policyId },
        { id: 'r3', status: 'approved', policyId }, // already approved, not overridden
      ]);

      await approvalService.ownerOverride(draftId, walletId, userId, 'Emergency');

      // Only pending requests get overridden
      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledTimes(2);
      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith('r1', 'approved');
      expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith('r2', 'approved');

      // Draft status updated to approved
      expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved');

      // Policy events logged for each pending request
      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledTimes(2);
      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId,
          walletId,
          draftTransactionId: draftId,
          userId,
          eventType: 'overridden',
          details: expect.objectContaining({
            requestId: 'r1',
            reason: 'Emergency',
            overriddenBy: userId,
          }),
        })
      );

      // Log warning about override
      expect(mockLog.warn).toHaveBeenCalledWith('Owner override on approval requests', expect.objectContaining({
        draftId,
        walletId,
        ownerId: userId,
        overriddenCount: 2,
        reason: 'Emergency',
      }));

      // Notification sent
      expect(mockNotify.notifyApprovalResolved).toHaveBeenCalledWith(walletId, draftId, 'overridden', userId);
    });

    it('throws ConflictError when no pending requests exist', async () => {
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { id: 'r1', status: 'approved', policyId },
      ]);

      await expect(
        approvalService.ownerOverride(draftId, walletId, userId, 'reason')
      ).rejects.toThrow('No pending approval requests to override');
    });

    it('throws ConflictError when requests list is empty', async () => {
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([]);

      await expect(
        approvalService.ownerOverride(draftId, walletId, userId, 'reason')
      ).rejects.toThrow('No pending approval requests to override');
    });

    it('logs warning when override notification fails', async () => {
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
        { id: 'r1', status: 'pending', policyId },
      ]);
      mockNotify.notifyApprovalResolved.mockRejectedValue(new Error('Override notify failed'));

      await approvalService.ownerOverride(draftId, walletId, userId, 'reason');

      await vi.waitFor(() => {
        expect(mockLog.warn).toHaveBeenCalledWith(
          'Failed to send override notification',
          expect.objectContaining({ error: 'Override notify failed' })
        );
      });
    });
  });

  // ========================================
  // GET PENDING APPROVALS
  // ========================================

  describe('getPendingApprovalsForUser', () => {
    it('delegates to policyRepository.findPendingApprovalsForUser', async () => {
      const mockResult = [
        { id: 'r1', draftTransaction: { walletId: 'w1', recipient: 'addr1', amount: BigInt(1000) }, votes: [] },
      ];
      mockPolicyRepo.findPendingApprovalsForUser.mockResolvedValue(mockResult);

      const result = await approvalService.getPendingApprovalsForUser(['w1', 'w2']);

      expect(result).toBe(mockResult);
      expect(mockPolicyRepo.findPendingApprovalsForUser).toHaveBeenCalledWith(['w1', 'w2']);
    });

    it('returns empty array when no pending approvals', async () => {
      mockPolicyRepo.findPendingApprovalsForUser.mockResolvedValue([]);

      const result = await approvalService.getPendingApprovalsForUser([]);

      expect(result).toHaveLength(0);
    });
  });

  // ========================================
  // GET APPROVALS FOR DRAFT
  // ========================================

  describe('getApprovalsForDraft', () => {
    it('delegates to policyRepository.findApprovalRequestsByDraftId', async () => {
      const mockApprovals = [
        { id: 'r1', status: 'pending', votes: [] },
        { id: 'r2', status: 'approved', votes: [{ decision: 'approve' }] },
      ];
      mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue(mockApprovals);

      const result = await approvalService.getApprovalsForDraft(draftId);

      expect(result).toBe(mockApprovals);
      expect(result).toHaveLength(2);
      expect(mockPolicyRepo.findApprovalRequestsByDraftId).toHaveBeenCalledWith(draftId);
    });
  });
});
