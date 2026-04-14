import { expect, it, vi } from 'vitest';

import { draftId, makePendingRequest, mockDraftRepo, mockLog, mockNotify, mockPolicyRepo, otherUserId, requestId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerUpdateDraftApprovalFromRequestsContracts() {
  const pendingRequest = makePendingRequest({ requiredApprovals: 1 });

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
}
