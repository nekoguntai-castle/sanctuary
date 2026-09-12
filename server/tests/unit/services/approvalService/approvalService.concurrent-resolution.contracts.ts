import { expect, it } from 'vitest';

import { makePendingRequest, mockDraftRepo, mockPolicyRepo, otherUserId, requestId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

/**
 * Non-regression contracts for the concurrent-vote race.
 *
 * Two voters can reach resolution from disjoint vote snapshots: each re-reads
 * the request after its own vote commits, and neither necessarily sees the
 * other. Resolution therefore has to be conditional on the row still being
 * pending, and the loser has to stay out of the draft-status write — otherwise
 * a recorded rejection is silently converted into an approved draft, and the
 * draft is what gates broadcast.
 */
export function registerConcurrentResolutionContracts() {
  const pendingRequest = makePendingRequest();

  it('does not overwrite a concurrently committed rejection with an approval', async () => {
    // This voter approves and, from its own stale snapshot, believes quorum is met.
    const requestWithApprove = {
      ...pendingRequest,
      requiredApprovals: 1,
      quorumType: 'any_n',
      votes: [{ id: 'v-approve', userId: otherUserId, decision: 'approve' }],
    };

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce(requestWithApprove);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v-approve', decision: 'approve' });

    // Meanwhile another resolver already settled the row as rejected, so the
    // conditional update matches nothing.
    mockPolicyRepo.resolveApprovalRequestIfPending.mockResolvedValue(null);

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
    // The loser must not re-derive the draft status off a resolution it did not perform.
    expect(mockPolicyRepo.findApprovalRequestsByDraftId).not.toHaveBeenCalled();
    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
  });

  it('writes the derived draft status only when it actually won the resolution', async () => {
    const requestWithReject = {
      ...pendingRequest,
      votes: [{ id: 'v-reject', userId: otherUserId, decision: 'reject' }],
    };

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce(requestWithReject);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v-reject', decision: 'reject' });
    mockPolicyRepo.resolveApprovalRequestIfPending.mockResolvedValue({
      ...requestWithReject,
      status: 'rejected',
    });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { ...requestWithReject, status: 'rejected' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'reject', 'Too risky');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'rejected');
    expect(mockPolicyRepo.findApprovalRequestsByDraftId).toHaveBeenCalled();
  });

  it.each([
    { decision: 'reject' as const, status: 'rejected' },
    { decision: 'veto' as const, status: 'vetoed' },
  ])(
    'skips the draft-status write when the $status resolution loses the race',
    async ({ decision, status }) => {
      const requestWithVote = {
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision }],
      };

      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(pendingRequest)
        .mockResolvedValueOnce(requestWithVote);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision });
      mockPolicyRepo.resolveApprovalRequestIfPending.mockResolvedValue(null);

      await approvalService.castVote(requestId, otherUserId, decision);

      expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, status);
      expect(mockPolicyRepo.findApprovalRequestsByDraftId).not.toHaveBeenCalled();
      expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
    }
  );

  it('leaves an already-resolved request alone when the expiry sweep loses the race', async () => {
    const expiredRequest = {
      ...pendingRequest,
      expiresAt: new Date(Date.now() - 60_000),
    };

    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(expiredRequest);
    mockPolicyRepo.resolveApprovalRequestIfPending.mockResolvedValue(null);

    await expect(approvalService.castVote(requestId, otherUserId, 'approve')).rejects.toThrow(
      'Approval request has expired'
    );

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'expired');
    expect(mockPolicyRepo.createVote).not.toHaveBeenCalled();
  });

  it('owner override skips requests another resolver already settled', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: 'r1', status: 'pending', policyId: 'p1' },
      { id: 'r2', status: 'pending', policyId: 'p2' },
    ]);
    // r1 is still pending and is overridden; r2 was rejected in the meantime.
    mockPolicyRepo.resolveApprovalRequestIfPending
      .mockResolvedValueOnce({ id: 'r1', status: 'approved' })
      .mockResolvedValueOnce(null);

    await approvalService.ownerOverride('draft-1', walletId, 'owner-1', 'operational override');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith('r1', 'approved');
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith('r2', 'approved');
    // Only the request this override actually settled gets an override audit event.
    const overrideEvents = mockPolicyRepo.createPolicyEvent.mock.calls.filter(
      ([event]) => event.eventType === 'overridden'
    );
    expect(overrideEvents).toHaveLength(1);
    expect(overrideEvents[0][0].details.requestId).toBe('r1');
  });

  it('owner override reports a conflict when every request was settled concurrently', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: 'r1', status: 'pending', policyId: 'p1' },
    ]);
    mockPolicyRepo.resolveApprovalRequestIfPending.mockResolvedValue(null);

    await expect(
      approvalService.ownerOverride('draft-1', walletId, 'owner-1', 'operational override')
    ).rejects.toThrow('No pending approval requests to override');

    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
  });
}
