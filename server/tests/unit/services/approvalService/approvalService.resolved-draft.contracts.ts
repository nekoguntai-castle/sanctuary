import { expect, it } from 'vitest';

import { draftId, makePendingRequest, mockDraftRepo, mockPolicyRepo, otherUserId, policyId, requestId, userId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

/**
 * A draft resolved as rejected/vetoed/expired stays resolved: neither a later
 * vote on a sibling request nor an owner override may derive it back to
 * approved. Also covers the shared specific-quorum eligibility predicate that
 * the mobile reject picker and castVote both use.
 */
export function registerResolvedDraftContracts() {
  it('isEligibleSpecificApprover is true for a non-specific request without reading the policy', async () => {
    await expect(
      approvalService.isEligibleSpecificApprover({ quorumType: 'any_n', policyId }, otherUserId)
    ).resolves.toBe(true);
    expect(mockPolicyRepo.findPolicyById).not.toHaveBeenCalled();
  });

  it('isEligibleSpecificApprover follows the live specific approver list', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      id: policyId,
      config: { quorumType: 'specific', requiredApprovals: 1, specificApprovers: [otherUserId] },
    });

    await expect(
      approvalService.isEligibleSpecificApprover({ quorumType: 'specific', policyId }, otherUserId)
    ).resolves.toBe(true);
    await expect(
      approvalService.isEligibleSpecificApprover({ quorumType: 'specific', policyId }, userId)
    ).resolves.toBe(false);
    expect(mockPolicyRepo.findPolicyById).toHaveBeenCalledWith(policyId);
  });

  it('isEligibleSpecificApprover is false when the specific policy is missing', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue(null);

    await expect(
      approvalService.isEligibleSpecificApprover({ quorumType: 'specific', policyId }, otherUserId)
    ).resolves.toBe(false);
  });

  it.each(['rejected', 'vetoed', 'expired'])('castVote refuses a vote on a %s draft', async (approvalStatus) => {
    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(makePendingRequest());
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'other-creator', walletId, approvalStatus });

    await expect(
      approvalService.castVote(requestId, otherUserId, 'approve')
    ).rejects.toThrow(`Draft is already ${approvalStatus}`);
    expect(mockPolicyRepo.createVote).not.toHaveBeenCalled();
  });

  it('ownerOverride refuses to approve a rejected draft', async () => {
    mockDraftRepo.findById.mockResolvedValueOnce({ id: draftId, walletId, approvalStatus: 'rejected' });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: 'r1', status: 'rejected', policyId },
      { id: 'r2', status: 'pending', policyId },
    ]);

    await expect(
      approvalService.ownerOverride(draftId, walletId, userId, 'Emergency')
    ).rejects.toThrow('Draft is already rejected');
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalled();
    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
  });

  it('a reject on one request rejects the draft and freezes the pending sibling', async () => {
    const first = makePendingRequest({ id: 'r1', requiredApprovals: 1 });
    const sibling = makePendingRequest({ id: 'r2', requiredApprovals: 1 });
    const rejectVote = { id: 'v1', userId: otherUserId, decision: 'reject' };
    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, votes: [rejectVote] })
      .mockResolvedValueOnce({ ...first, status: 'rejected', votes: [rejectVote] });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValueOnce({ userId: 'other-creator', walletId, approvalStatus: 'pending' });
    mockPolicyRepo.createVote.mockResolvedValue(rejectVote);
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { ...first, status: 'rejected' },
      sibling,
    ]);

    await approvalService.castVote('r1', otherUserId, 'reject', 'Wrong recipient');

    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledTimes(1);
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith('r1', 'rejected');
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'rejected');

    // A later approve vote on the still-pending sibling cannot flip the draft back.
    mockPolicyRepo.findApprovalRequestById.mockResolvedValueOnce(sibling);
    mockDraftRepo.findById.mockResolvedValueOnce({ userId: 'other-creator', walletId, approvalStatus: 'rejected' });

    await expect(
      approvalService.castVote('r2', userId, 'approve')
    ).rejects.toThrow('Draft is already rejected');
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledTimes(1);
  });
}
