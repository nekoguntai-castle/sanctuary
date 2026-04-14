import { faker } from '@faker-js/faker';
import { expect, it } from 'vitest';

import { makePendingRequest, mockDraftRepo, mockPolicyRepo, otherUserId, requestId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerCastVoteResolutionContracts() {
  const pendingRequest = makePendingRequest();

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
}
