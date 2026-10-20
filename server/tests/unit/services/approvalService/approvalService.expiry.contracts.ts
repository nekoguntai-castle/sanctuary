import { expect, it } from 'vitest';

import { draftId, makePendingRequest, mockDraftRepo, mockPolicyRepo, otherUserId, policyId, requestId, userId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

/**
 * An expired approval request releases its draft
 * (approval-expiry--draft-stuck-pending-forever): the draft's approvalStatus
 * becomes 'expired' instead of staying 'pending' with its UTXO locks held.
 */
export function registerApprovalExpiryContracts() {
  const past = () => new Date(Date.now() - 60 * 60 * 1000);
  const future = () => new Date(Date.now() + 60 * 60 * 1000);

  it('castVote after expiry resolves the request and marks the draft expired', async () => {
    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(makePendingRequest({ expiresAt: past() }));
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{ id: requestId, status: 'expired' }]);

    await expect(approvalService.castVote(requestId, otherUserId, 'approve')).rejects.toThrow('expired');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'expired');
    expect(mockPolicyRepo.findApprovalRequestsByDraftId).toHaveBeenCalledWith(draftId);
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'expired');
    expect(mockPolicyRepo.createVote).not.toHaveBeenCalled();
  });

  it('castVote leaves the draft to the concurrent resolver that expired the request first', async () => {
    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(makePendingRequest({ expiresAt: past() }));
    mockPolicyRepo.resolveApprovalRequestIfPending.mockResolvedValue(null);

    await expect(approvalService.castVote(requestId, otherUserId, 'approve')).rejects.toThrow('expired');

    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
  });

  it('sweep resolves overdue pending requests and marks their drafts expired', async () => {
    const now = new Date('2030-01-01T00:00:00Z');
    mockPolicyRepo.findOverduePendingApprovalRequests.mockResolvedValue([
      { id: 'r1', draftTransactionId: draftId },
      { id: 'r2', draftTransactionId: draftId },
    ]);
    mockPolicyRepo.findPendingDraftIdsWithExpiredRequests.mockResolvedValue([]);
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: 'r1', status: 'expired' },
      { id: 'r2', status: 'expired' },
    ]);

    await expect(approvalService.expireOverdueApprovals(now))
      .resolves.toEqual({ expiredRequests: 2, updatedDrafts: 1 });

    expect(mockPolicyRepo.findOverduePendingApprovalRequests).toHaveBeenCalledWith(now);
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith('r1', 'expired');
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith('r2', 'expired');
    expect(mockPolicyRepo.findApprovalRequestsByDraftId).toHaveBeenCalledTimes(1);
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'expired');
  });

  it('sweep repairs a draft left pending with an already-expired request', async () => {
    mockPolicyRepo.findOverduePendingApprovalRequests.mockResolvedValue([]);
    mockPolicyRepo.findPendingDraftIdsWithExpiredRequests.mockResolvedValue([draftId]);
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{ id: requestId, status: 'expired' }]);

    await expect(approvalService.expireOverdueApprovals())
      .resolves.toEqual({ expiredRequests: 0, updatedDrafts: 1 });

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalled();
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'expired');
  });

  it('sweep does not re-evaluate a draft the overdue pass already updated', async () => {
    mockPolicyRepo.findOverduePendingApprovalRequests.mockResolvedValue([{ id: 'r1', draftTransactionId: draftId }]);
    mockPolicyRepo.findPendingDraftIdsWithExpiredRequests.mockResolvedValue([draftId]);
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{ id: 'r1', status: 'expired' }]);

    await expect(approvalService.expireOverdueApprovals())
      .resolves.toEqual({ expiredRequests: 1, updatedDrafts: 1 });

    expect(mockPolicyRepo.findApprovalRequestsByDraftId).toHaveBeenCalledTimes(1);
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledTimes(1);
  });

  it('sweep skips a request another resolver settled first', async () => {
    mockPolicyRepo.findOverduePendingApprovalRequests.mockResolvedValue([{ id: 'r1', draftTransactionId: draftId }]);
    mockPolicyRepo.findPendingDraftIdsWithExpiredRequests.mockResolvedValue([]);
    mockPolicyRepo.resolveApprovalRequestIfPending.mockResolvedValue(null);

    await expect(approvalService.expireOverdueApprovals())
      .resolves.toEqual({ expiredRequests: 0, updatedDrafts: 0 });

    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
  });

  it.each(['rejected', 'vetoed'])('a %s request takes precedence over an expired one', async status => {
    mockPolicyRepo.findOverduePendingApprovalRequests.mockResolvedValue([]);
    mockPolicyRepo.findPendingDraftIdsWithExpiredRequests.mockResolvedValue([draftId]);
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: 'r1', status: 'expired' },
      { id: 'r2', status },
    ]);

    await approvalService.expireOverdueApprovals();

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledTimes(1);
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, status);
  });

  it('owner override on a past-expiry request expires it and refuses without approving', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId
      .mockResolvedValueOnce([{ id: 'r1', status: 'pending', policyId, expiresAt: past() }])
      .mockResolvedValueOnce([{ id: 'r1', status: 'expired', policyId }]);

    await expect(approvalService.ownerOverride(draftId, walletId, userId, 'Emergency'))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('expired') });

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledTimes(1);
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith('r1', 'expired');
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'expired');
    expect(mockPolicyRepo.createPolicyEvent).not.toHaveBeenCalled();
  });

  it('owner override with one expired and one live request leaves the live one pending', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId
      .mockResolvedValueOnce([
        { id: 'r1', status: 'pending', policyId, expiresAt: past() },
        { id: 'r2', status: 'pending', policyId, expiresAt: future() },
      ])
      .mockResolvedValueOnce([
        { id: 'r1', status: 'expired', policyId },
        { id: 'r2', status: 'pending', policyId },
      ]);

    await expect(approvalService.ownerOverride(draftId, walletId, userId, 'Emergency'))
      .rejects.toMatchObject({ statusCode: 409 });

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledTimes(1);
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalledWith('r2', expect.anything());
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'expired');
    expect(mockPolicyRepo.createPolicyEvent).not.toHaveBeenCalled();
  });
}
