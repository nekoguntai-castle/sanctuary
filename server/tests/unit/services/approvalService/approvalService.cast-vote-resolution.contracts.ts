import { faker } from '@faker-js/faker';
import { expect, it } from 'vitest';

import { mockVoteRequestReads, makePendingRequest, mockDraftRepo, mockPolicyRepo, mockNotify, mockWalletSharingRepo, otherUserId, requestId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerCastVoteResolutionContracts() {
  const pendingRequest = makePendingRequest();

  it('records reject vote and triggers rejection resolution', async () => {
    const requestWithReject = {
      ...pendingRequest,
      votes: [{ id: 'v1', userId: otherUserId, decision: 'reject' }],
    };

    mockVoteRequestReads(
      pendingRequest,
      requestWithReject,
      'rejected',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'reject' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { ...requestWithReject, status: 'rejected' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'reject', 'Too risky');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'rejected');
  });

  it('records veto vote and triggers veto resolution', async () => {
    const requestWithVeto = {
      ...pendingRequest,
      votes: [{ id: 'v1', userId: otherUserId, decision: 'veto' }],
    };

    mockVoteRequestReads(
      pendingRequest,
      requestWithVeto,
      'vetoed',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'veto' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { ...requestWithVeto, status: 'vetoed' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'veto', 'Absolutely not');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'vetoed');
  });

  it('resolves request when any_n quorum is met', async () => {
    const requestWith1Approval = {
      ...pendingRequest,
      requiredApprovals: 1,
      quorumType: 'any_n',
      votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
    };

    mockVoteRequestReads(
      { ...pendingRequest, requiredApprovals: 1 },
      requestWith1Approval,
      'approved',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { ...requestWith1Approval, status: 'approved' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
  });

  it('resolves request when all quorum is met', async () => {
    // Pinned-buggy-behavior update: the request used to resolve once
    // `votes.length >= requiredApprovals`, regardless of who was actually on
    // the wallet. It must now resolve only once every currently eligible
    // wallet approver (owner/approver role) has voted approve.
    const secondApproverId = faker.string.uuid();
    const requestWithAllVotes = {
      ...pendingRequest,
      requiredApprovals: 2,
      quorumType: 'all',
      votes: [
        { id: 'v1', userId: otherUserId, decision: 'approve' },
        { id: 'v2', userId: secondApproverId, decision: 'approve' },
      ],
    };

    mockVoteRequestReads(
      { ...pendingRequest, quorumType: 'all' },
      requestWithAllVotes,
      'approved',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockWalletSharingRepo.findEffectiveApproverIds.mockResolvedValue([
      otherUserId,
      secondApproverId,
    ]);
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v2', decision: 'approve' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { ...requestWithAllVotes, status: 'approved' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
  });

  it('resolves request when specific quorum is met', async () => {
    // Pinned-buggy-behavior update: `findPolicyById` must now be mocked
    // because castVote refuses the vote at cast time unless the voter is
    // listed in the policy's `specificApprovers`.
    const requestWithSpecificVotes = {
      ...pendingRequest,
      requiredApprovals: 1,
      quorumType: 'specific',
      votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
    };

    mockVoteRequestReads(
      { ...pendingRequest, requiredApprovals: 1, quorumType: 'specific' },
      requestWithSpecificVotes,
      'approved',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      config: { specificApprovers: [otherUserId] },
    });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { ...requestWithSpecificVotes, status: 'approved' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved');
  });

  it.each([
    ['approve', 'approved'], ['reject', 'rejected'], ['veto', 'vetoed'],
  ] as const)('returns the persisted %s resolution snapshot (%s)', async (decision, status) => {
    const initial = makePendingRequest({ requiredApprovals: 1 });
    const vote = { id: 'new-vote', userId: otherUserId, decision };
    const afterVote = { ...initial, votes: [vote] };
    const persisted = { ...afterVote, status, resolvedAt: new Date() };
    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(afterVote)
      .mockResolvedValueOnce(persisted);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockPolicyRepo.createVote.mockResolvedValue(vote);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([persisted]);

    const result = await approvalService.castVote(requestId, otherUserId, decision);

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, status);
    expect(result.vote).toBe(vote);
    expect(result.request).toEqual(persisted);
    expect(afterVote.status).toBe('pending');
    expect(mockPolicyRepo.findApprovalRequestById).toHaveBeenCalledTimes(3);
  });

  it.each(['pending', 'approved', 'expired'] as const)(
    'rereads below-quorum requests that are now %s, including concurrent votes', async status => {
      const initial = makePendingRequest({ requiredApprovals: 2 });
      const vote = { id: 'new-vote', userId: otherUserId, decision: 'approve' };
      const afterVote = { ...initial, votes: [vote] };
      const persisted = { ...afterVote, status, votes: [vote,
        { id: 'concurrent-vote', userId: 'another-approver', decision: 'approve' },
      ] };
      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(afterVote)
        .mockResolvedValueOnce(persisted);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockPolicyRepo.createVote.mockResolvedValue(vote);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });

      const result = await approvalService.castVote(requestId, otherUserId, 'approve');

      expect(result.request).toEqual(persisted);
      expect(result.vote).toBe(vote);
      expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalled();
      expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
      expect(mockNotify.notifyApprovalResolved).not.toHaveBeenCalled();
      expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(expect.objectContaining({
        details: expect.objectContaining({ currentApprovals: 2 }),
      }));
    },
  );

  it.each([
    ['approve', 'approved', 'rejected'],
    ['approve', 'approved', 'expired'],
    ['reject', 'rejected', 'approved'],
    ['veto', 'vetoed', 'rejected'],
  ] as const)(
    'returns the winner when %s loses its %s resolution to %s', async (decision, attemptedStatus, status) => {
      const initial = makePendingRequest({ requiredApprovals: 1 });
      const vote = { id: 'new-vote', userId: otherUserId, decision };
      const afterVote = { ...initial, votes: [vote] };
      const persisted = { ...afterVote, status };
      mockPolicyRepo.findApprovalRequestById
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(afterVote)
        .mockResolvedValueOnce(persisted);
      mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
      mockPolicyRepo.createVote.mockResolvedValue(vote);
      mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
      mockPolicyRepo.resolveApprovalRequestIfPending.mockResolvedValue(null);

      const result = await approvalService.castVote(requestId, otherUserId, decision);

      expect(result.request).toEqual(persisted);
      expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, attemptedStatus);
      expect(mockPolicyRepo.findApprovalRequestsByDraftId).not.toHaveBeenCalled();
      expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
      expect(mockNotify.notifyApprovalResolved).not.toHaveBeenCalled();
    },
  );

  it('reports a missing final request instead of returning the pre-resolution snapshot', async () => {
    const initial = makePendingRequest();
    const vote = { id: 'new-vote', userId: otherUserId, decision: 'approve' };
    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, votes: [vote] })
      .mockResolvedValueOnce(null);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockPolicyRepo.createVote.mockResolvedValue(vote);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });

    await expect(approvalService.castVote(requestId, otherUserId, 'approve'))
      .rejects.toThrow('Approval request not found after vote');
    expect(mockPolicyRepo.createPolicyEvent).not.toHaveBeenCalled();
  });

  it('propagates a final snapshot read failure without emitting a stale event', async () => {
    const initial = makePendingRequest();
    const vote = { id: 'new-vote', userId: otherUserId, decision: 'approve' };
    const error = new Error('Final snapshot unavailable');
    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ ...initial, votes: [vote] })
      .mockRejectedValueOnce(error);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockPolicyRepo.createVote.mockResolvedValue(vote);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });

    await expect(approvalService.castVote(requestId, otherUserId, 'approve')).rejects.toBe(error);
    expect(mockPolicyRepo.createPolicyEvent).not.toHaveBeenCalled();
  });
}
