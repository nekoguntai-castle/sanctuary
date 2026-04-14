import { expect, it, vi } from 'vitest';

import { draftId, makePendingRequest, mockDraftRepo, mockLog, mockPolicyRepo, otherUserId, policyId, requestId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerCastVoteEventContracts() {
  const pendingRequest = makePendingRequest();

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
}
