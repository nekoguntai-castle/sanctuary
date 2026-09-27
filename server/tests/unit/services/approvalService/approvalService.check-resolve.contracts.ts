import { expect, it } from 'vitest';

import { mockVoteRequestReads, makePendingRequest, mockDraftRepo, mockPolicyRepo, otherUserId, requestId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerCheckAndResolveRequestContracts() {
  const pendingRequest = makePendingRequest({ requiredApprovals: 3 });

  it('does not resolve when quorum is not met (approvals < required)', async () => {
    const updatedReq = {
      ...pendingRequest,
      requiredApprovals: 3,
      votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
    };

    mockVoteRequestReads(
      pendingRequest,
      updatedReq,
      'pending',
    );
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({ id: 'v1', decision: 'approve' });

    await approvalService.castVote(requestId, otherUserId, 'approve');

    // No resolution should happen
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).not.toHaveBeenCalled();
  });
}
