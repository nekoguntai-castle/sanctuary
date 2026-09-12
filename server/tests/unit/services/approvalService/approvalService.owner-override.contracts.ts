import { expect, it, vi } from 'vitest';

import { draftId, mockDraftRepo, mockLog, mockNotify, mockPolicyRepo, policyId, userId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerOwnerOverrideContracts() {
  it('force-approves all pending requests and logs events', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId
      // First read: which requests are pending, before overriding.
      .mockResolvedValueOnce([
        { id: 'r1', status: 'pending', policyId },
        { id: 'r2', status: 'pending', policyId },
        { id: 'r3', status: 'approved', policyId }, // already approved, not overridden
      ])
      // Second read: the derive step inside updateDraftApprovalFromRequests,
      // after r1/r2 were resolved to 'approved'.
      .mockResolvedValueOnce([
        { id: 'r1', status: 'approved', policyId },
        { id: 'r2', status: 'approved', policyId },
        { id: 'r3', status: 'approved', policyId },
      ]);

    await approvalService.ownerOverride(draftId, walletId, userId, 'Emergency');

    // Only pending requests get overridden
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledTimes(2);
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith('r1', 'approved');
    expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith('r2', 'approved');

    // Draft status updated to approved
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved');

    // Policy events logged for each pending request
    expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledTimes(2);
    expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId,
        walletId,
        draftTransactionId: draftId,
        userId,
        eventType: 'overridden',
        details: expect.objectContaining({
          requestId: 'r1',
          reason: 'Emergency',
          overriddenBy: userId,
        }),
      })
    );

    // Log warning about override
    expect(mockLog.warn).toHaveBeenCalledWith('Owner override on approval requests', expect.objectContaining({
      draftId,
      walletId,
      ownerId: userId,
      overriddenCount: 2,
      reason: 'Emergency',
    }));

    // Notification sent
    expect(mockNotify.notifyApprovalResolved).toHaveBeenCalledWith(walletId, draftId, 'overridden', userId);
  });

  it('throws ConflictError when no pending requests exist', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: 'r1', status: 'approved', policyId },
    ]);

    await expect(
      approvalService.ownerOverride(draftId, walletId, userId, 'reason')
    ).rejects.toThrow('No pending approval requests to override');
  });

  it('throws ConflictError when requests list is empty', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([]);

    await expect(
      approvalService.ownerOverride(draftId, walletId, userId, 'reason')
    ).rejects.toThrow('No pending approval requests to override');
  });

  it('derives the draft status as approved when every request was still pending', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId
      .mockResolvedValueOnce([
        { id: 'r1', status: 'pending', policyId },
        { id: 'r2', status: 'pending', policyId },
      ])
      .mockResolvedValueOnce([
        { id: 'r1', status: 'approved', policyId },
        { id: 'r2', status: 'approved', policyId },
      ]);

    await approvalService.ownerOverride(draftId, walletId, userId, 'Emergency');

    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'approved');
  });

  it('sends exactly one notification (overridden, never approved) on the all-approved override path', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId
      .mockResolvedValueOnce([
        { id: 'r1', status: 'pending', policyId },
      ])
      .mockResolvedValueOnce([
        { id: 'r1', status: 'approved', policyId },
      ]);

    await approvalService.ownerOverride(draftId, walletId, userId, 'Emergency');

    expect(mockNotify.notifyApprovalResolved).toHaveBeenCalledTimes(1);
    expect(mockNotify.notifyApprovalResolved).toHaveBeenCalledWith(walletId, draftId, 'overridden', userId);
    expect(mockNotify.notifyApprovalResolved).not.toHaveBeenCalledWith(
      walletId,
      draftId,
      'approved',
      expect.anything()
    );
  });

  it('logs warning when override notification fails', async () => {
    mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([
      { id: 'r1', status: 'pending', policyId },
    ]);
    mockNotify.notifyApprovalResolved.mockRejectedValue(new Error('Override notify failed'));

    await approvalService.ownerOverride(draftId, walletId, userId, 'reason');

    await vi.waitFor(() => {
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Failed to send override notification',
        expect.objectContaining({ error: 'Override notify failed' })
      );
    });
  });
}
