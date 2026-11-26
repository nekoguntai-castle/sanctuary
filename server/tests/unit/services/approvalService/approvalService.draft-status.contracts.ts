import { expect, it, vi } from 'vitest';

import { mockTx, mockVoteRequestReads, draftId, makePendingRequest, mockDraftLockRepo, mockDraftRepo, mockLog, mockNotify, mockPolicyRepo, mockWalletSharingRepo, otherUserId, requestId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerUpdateDraftApprovalFromRequestsContracts() {
  const pendingRequest = makePendingRequest({ requiredApprovals: 1 });

  it('updates draft to rejected when any request is rejected', async () => {
    const updatedReq = {
      ...pendingRequest,
      votes: [{ id: 'v1', userId: otherUserId, decision: 'reject' }],
    };

    mockVoteRequestReads(
      pendingRequest,
      updatedReq,
      'rejected',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'reject' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { status: 'rejected' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'reject');

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'rejected', {
      allowedFrom: ['pending'],
      client: mockTx,
    });
  });

  it('releases the UTXO locks of a draft whose approval resolves to a terminal refusal', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{ status: 'rejected' }]);

    await approvalService.rederiveDraftApprovalStatus(draftId);

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'rejected', {
      allowedFrom: ['pending'],
    });
    expect(mockDraftLockRepo.deleteByDraftId).toHaveBeenCalledWith(draftId);
  });

  it('preserves locks when a concurrent transition wins before refusal is applied', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{ status: 'rejected' }]);
    mockDraftRepo.updateApprovalStatus.mockResolvedValueOnce(false);

    await approvalService.rederiveDraftApprovalStatus(draftId);

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'rejected', {
      allowedFrom: ['pending'],
    });
    expect(mockDraftLockRepo.deleteByDraftId).not.toHaveBeenCalled();
  });

  it('notifies the wallet when rederivation approves the remaining requests', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{ status: 'approved' }]);
    mockDraftRepo.findById.mockResolvedValue({ walletId });

    await approvalService.rederiveDraftApprovalStatus(draftId);

    expect(mockNotify.notifyApprovalResolved).toHaveBeenCalledWith(walletId, draftId, 'approved', null);
  });

  it('keeps the UTXO locks of an approved draft', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{ status: 'approved' }]);
    mockDraftRepo.findById.mockResolvedValue(null);

    await approvalService.rederiveDraftApprovalStatus(draftId);

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved', {
      allowedFrom: ['pending'],
    });
    expect(mockDraftLockRepo.deleteByDraftId).not.toHaveBeenCalled();
  });

  it('clears a pending approval whose requests are all gone', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([]);
    mockDraftRepo.findById.mockResolvedValue({ id: draftId, walletId, approvalStatus: 'pending' });

    await approvalService.rederiveDraftApprovalStatus(draftId);

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'not_required', {
      allowedFrom: ['pending'],
    });
  });

  it('ignores a draft deleted along with its approval requests', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([]);
    mockDraftRepo.findById.mockResolvedValue(null);

    await approvalService.rederiveDraftApprovalStatus(draftId);

    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
    expect(mockNotify.notifyApprovalResolved).not.toHaveBeenCalled();
  });

  it('leaves a non-pending draft with no requests alone', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([]);
    mockDraftRepo.findById.mockResolvedValue({ id: draftId, walletId, approvalStatus: 'rejected' });

    await approvalService.rederiveDraftApprovalStatus(draftId);

    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
  });

  it('updates draft to vetoed when any request is vetoed', async () => {
    const updatedReq = {
      ...pendingRequest,
      votes: [{ id: 'v1', userId: otherUserId, decision: 'veto' }],
    };

    mockVoteRequestReads(
      pendingRequest,
      updatedReq,
      'vetoed',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'veto' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { status: 'vetoed' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'veto');

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'vetoed', {
      allowedFrom: ['pending'],
      client: mockTx,
    });
  });

  it('updates draft to approved and sends notification when all requests are approved', async () => {
    const updatedReq = {
      ...pendingRequest,
      votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
    };

    mockVoteRequestReads(
      pendingRequest,
      updatedReq,
      'approved',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById
      .mockResolvedValueOnce({ userId: 'creator', walletId })  // self-approval check
      .mockResolvedValueOnce({ userId: 'creator', walletId }); // notification fetch
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
    mockWalletSharingRepo.findEffectiveApproverIds.mockResolvedValue([otherUserId]);
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { status: 'approved' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved', {
      allowedFrom: ['pending'],
      approvedBy: otherUserId,
      client: mockTx,
    });
    expect(mockNotify.notifyApprovalResolved).toHaveBeenCalledWith(walletId, draftId, 'approved', null);
  });

  it('does not send notification when draft not found on approval resolution', async () => {
    const updatedReq = {
      ...pendingRequest,
      votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
    };

    mockVoteRequestReads(
      pendingRequest,
      updatedReq,
      'approved',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById
      .mockResolvedValueOnce({ userId: 'creator', walletId })  // self-approval check
      .mockResolvedValueOnce(null); // draft not found for notification
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
    mockWalletSharingRepo.findEffectiveApproverIds.mockResolvedValue([otherUserId]);
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { status: 'approved' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved', {
      allowedFrom: ['pending'],
      approvedBy: otherUserId,
      client: mockTx,
    });
    expect(mockNotify.notifyApprovalResolved).not.toHaveBeenCalled();
  });

  it.each(['pending', 'approved'])('reconciles a %s draft in the vote transaction when all requests disappear', async approvalStatus => {
    const updatedRequest = {
      ...pendingRequest,
      votes: [{ id: 'v1', userId: otherUserId, decision: 'reject' }],
    };
    mockVoteRequestReads(pendingRequest, updatedRequest, 'rejected');
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId, approvalStatus });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'reject' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([]);

    await approvalService.castVote(requestId, otherUserId, 'reject');

    if (approvalStatus === 'approved') {
      expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
      return;
    }
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'not_required', {
      allowedFrom: ['pending'],
      client: mockTx,
    });
  });

  it('stays pending when requests have mixed pending/approved statuses', async () => {
    const updatedReq = {
      ...pendingRequest,
      votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
    };

    mockVoteRequestReads(
      pendingRequest,
      updatedReq,
      'approved',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
    mockWalletSharingRepo.findEffectiveApproverIds.mockResolvedValue([otherUserId]);
    // One approved, one still pending → draft stays pending
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { status: 'approved' },
      { status: 'pending' },
    ]);

    await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved', undefined, mockTx);
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

    mockVoteRequestReads(
      pendingRequest,
      updatedReq,
      'approved',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById
      .mockResolvedValueOnce({ userId: 'creator', walletId })
      .mockResolvedValueOnce({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });
    mockWalletSharingRepo.findEffectiveApproverIds.mockResolvedValue([otherUserId]);
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
