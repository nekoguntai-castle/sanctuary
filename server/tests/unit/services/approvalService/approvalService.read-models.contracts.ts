import { expect, it } from 'vitest';

import { draftId, mockPolicyRepo } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerGetPendingApprovalsForUserContracts() {
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
}

export function registerGetApprovalsForDraftContracts() {
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
}
