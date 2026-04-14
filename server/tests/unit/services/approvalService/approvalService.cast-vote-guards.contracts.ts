import { faker } from '@faker-js/faker';
import { expect, it } from 'vitest';

import { draftId, makePendingRequest, mockDraftRepo, mockLog, mockPolicyRepo, otherUserId, requestId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerCastVoteGuardContracts() {
  const pendingRequest = makePendingRequest();

  it('throws NotFoundError when request does not exist', async () => {
    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(null);

    await expect(
      approvalService.castVote('nonexistent', otherUserId, 'approve')
    ).rejects.toThrow('Approval request not found');
  });

  it('throws ConflictError when request is already resolved', async () => {
    mockPolicyRepo.findApprovalRequestById.mockResolvedValue({
      ...pendingRequest,
      status: 'approved',
    });

    await expect(
      approvalService.castVote(requestId, otherUserId, 'approve')
    ).rejects.toThrow('already approved');
  });

  it('expires and throws ConflictError when request has expired', async () => {
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 1);

    mockPolicyRepo.findApprovalRequestById.mockResolvedValue({
      ...pendingRequest,
      expiresAt: pastDate,
    });

    await expect(
      approvalService.castVote(requestId, otherUserId, 'approve')
    ).rejects.toThrow('expired');

    // Should have resolved request as expired
    expect(mockPolicyRepo.updateApprovalRequestStatus).toHaveBeenCalledWith(requestId, 'expired');
    expect(mockLog.info).toHaveBeenCalledWith('Approval request resolved', { requestId, status: 'expired' });
  });

  it('throws ConflictError when user already voted', async () => {
    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(pendingRequest);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue({ id: 'existing-vote' });

    await expect(
      approvalService.castVote(requestId, otherUserId, 'approve')
    ).rejects.toThrow('already voted');
  });

  it('throws ForbiddenError when self-approval is not allowed', async () => {
    const creatorId = faker.string.uuid();
    mockPolicyRepo.findApprovalRequestById.mockResolvedValue(pendingRequest);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: creatorId, walletId });

    await expect(
      approvalService.castVote(requestId, creatorId, 'approve')
    ).rejects.toThrow('Self-approval is not allowed');
  });

  it('allows self-approval when allowSelfApproval is true', async () => {
    const creatorId = faker.string.uuid();
    const selfApprovalRequest = {
      ...pendingRequest,
      allowSelfApproval: true,
      requiredApprovals: 1,
    };

    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(selfApprovalRequest)
      .mockResolvedValueOnce({
        ...selfApprovalRequest,
        votes: [{ id: 'v1', userId: creatorId, decision: 'approve' }],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: creatorId, walletId });
    mockPolicyRepo.createVote.mockResolvedValue({
      id: 'v1', approvalRequestId: requestId, userId: creatorId, decision: 'approve',
    });
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { ...selfApprovalRequest, status: 'approved', votes: [{ decision: 'approve' }] },
    ]);

    const { vote } = await approvalService.castVote(requestId, creatorId, 'approve');

    expect(vote.decision).toBe('approve');
  });

  it('records approve vote (happy path, quorum not yet met)', async () => {
    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce({
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      });

    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'other-creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({
      id: 'v1',
      approvalRequestId: requestId,
      userId: otherUserId,
      decision: 'approve',
    });

    const { vote, request: updatedReq } = await approvalService.castVote(requestId, otherUserId, 'approve', 'Looks good');

    expect(vote.decision).toBe('approve');
    expect(updatedReq.votes).toHaveLength(1);
    expect(mockPolicyRepo.createVote).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalRequestId: requestId,
        userId: otherUserId,
        decision: 'approve',
        reason: 'Looks good',
      })
    );
    expect(mockLog.info).toHaveBeenCalledWith('Vote cast', expect.objectContaining({
      requestId,
      userId: otherUserId,
      decision: 'approve',
    }));
    // Quorum is 2, only 1 vote -> no resolution
    expect(mockPolicyRepo.updateApprovalRequestStatus).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when re-fetch returns null after vote', async () => {
    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce(null);
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    mockDraftRepo.findById.mockResolvedValue({ userId: 'other-creator', walletId });
    mockPolicyRepo.createVote.mockResolvedValue({
      id: 'v1', decision: 'approve',
    });

    await expect(
      approvalService.castVote(requestId, otherUserId, 'approve')
    ).rejects.toThrow('Approval request not found after vote');
  });

  it('handles draft not found (draft is null) — uses empty walletId fallback', async () => {
    mockPolicyRepo.findApprovalRequestById
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce({
        ...pendingRequest,
        votes: [{ id: 'v1', userId: otherUserId, decision: 'approve' }],
      });
    mockPolicyRepo.findVoteByUserAndRequest.mockResolvedValue(null);
    // Draft not found - so self-approval check does not block, and walletId will be ''
    mockDraftRepo.findById.mockResolvedValue(null);
    mockPolicyRepo.createVote.mockResolvedValue({
      id: 'v1', decision: 'approve',
    });

    const { vote } = await approvalService.castVote(requestId, otherUserId, 'approve');

    expect(vote.decision).toBe('approve');
    // Verify that createPolicyEvent is called with walletId = ''
    expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: '' })
    );
  });
}
