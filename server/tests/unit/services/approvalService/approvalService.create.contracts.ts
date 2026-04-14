import { faker } from '@faker-js/faker';
import { expect, it, vi } from 'vitest';

import { draftId, mockDraftRepo, mockLog, mockNotify, mockPolicyRepo, policyId, requestId, userId, walletId } from './approvalServiceTestHarness';
import { approvalService } from '../../../../src/services/vaultPolicy/approvalService';

export function registerCreateApprovalRequestsForDraftContracts() {
  it('returns empty array when no approval_required policies in triggered list', async () => {
    const result = await approvalService.createApprovalRequestsForDraft(
      draftId,
      walletId,
      userId,
      [{ policyId, policyName: 'Limit', type: 'spending_limit', action: 'blocked', reason: 'over limit' }]
    );

    expect(result).toHaveLength(0);
    expect(mockPolicyRepo.findPolicyById).not.toHaveBeenCalled();
    expect(mockPolicyRepo.createApprovalRequest).not.toHaveBeenCalled();
  });

  it('returns empty array when triggered list is empty', async () => {
    const result = await approvalService.createApprovalRequestsForDraft(
      draftId, walletId, userId, []
    );

    expect(result).toHaveLength(0);
  });

  it('creates approval requests for triggered policies with expirationHours > 0', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      id: policyId,
      config: {
        trigger: { always: true },
        requiredApprovals: 2,
        quorumType: 'any_n',
        allowSelfApproval: false,
        expirationHours: 48,
      },
    });

    mockPolicyRepo.createApprovalRequest.mockResolvedValue({
      id: requestId,
      draftTransactionId: draftId,
      policyId,
      status: 'pending',
      requiredApprovals: 2,
    });

    const result = await approvalService.createApprovalRequestsForDraft(
      draftId,
      walletId,
      userId,
      [{ policyId, policyName: 'Test', type: 'approval_required', action: 'approval_required', reason: 'test' }]
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(requestId);

    const callArgs = mockPolicyRepo.createApprovalRequest.mock.calls[0][0];
    expect(callArgs.draftTransactionId).toBe(draftId);
    expect(callArgs.policyId).toBe(policyId);
    expect(callArgs.requiredApprovals).toBe(2);
    expect(callArgs.quorumType).toBe('any_n');
    expect(callArgs.allowSelfApproval).toBe(false);
    expect(callArgs.expiresAt).toBeDefined();
    expect(callArgs.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Verify draft approval status updated to pending
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'pending');
    // Verify notification sent
    expect(mockNotify.notifyApprovalRequested).toHaveBeenCalledWith(walletId, draftId, userId);
    // Verify log
    expect(mockLog.info).toHaveBeenCalledWith('Created approval request', expect.objectContaining({
      requestId,
      draftId,
      policyId,
    }));
  });

  it('does not set expiresAt when expirationHours is 0', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      id: policyId,
      config: {
        trigger: { always: true },
        requiredApprovals: 1,
        quorumType: 'all',
        allowSelfApproval: true,
        expirationHours: 0,
      },
    });

    mockPolicyRepo.createApprovalRequest.mockResolvedValue({
      id: requestId,
      status: 'pending',
    });

    await approvalService.createApprovalRequestsForDraft(
      draftId, walletId, userId,
      [{ policyId, policyName: 'No Expiry', type: 'approval_required', action: 'approval_required', reason: 'test' }]
    );

    const callArgs = mockPolicyRepo.createApprovalRequest.mock.calls[0][0];
    expect(callArgs.expiresAt).toBeUndefined();
  });

  it('skips policy when findPolicyById returns null (continue branch)', async () => {
    const secondPolicyId = faker.string.uuid();
    const secondRequestId = faker.string.uuid();

    // First policy not found, second policy found
    mockPolicyRepo.findPolicyById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: secondPolicyId,
        config: {
          trigger: { always: true },
          requiredApprovals: 1,
          quorumType: 'any_n',
          allowSelfApproval: false,
          expirationHours: 24,
        },
      });

    mockPolicyRepo.createApprovalRequest.mockResolvedValue({
      id: secondRequestId,
      status: 'pending',
    });

    const result = await approvalService.createApprovalRequestsForDraft(
      draftId, walletId, userId,
      [
        { policyId, policyName: 'Missing', type: 'approval_required', action: 'approval_required', reason: 'test' },
        { policyId: secondPolicyId, policyName: 'Found', type: 'approval_required', action: 'approval_required', reason: 'test' },
      ]
    );

    // Only the second request should be created
    expect(result).toHaveLength(1);
    expect(mockPolicyRepo.createApprovalRequest).toHaveBeenCalledTimes(1);
  });

  it('logs warning when notifyApprovalRequested fails', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      id: policyId,
      config: {
        trigger: { always: true },
        requiredApprovals: 1,
        quorumType: 'any_n',
        allowSelfApproval: false,
        expirationHours: 0,
      },
    });

    mockPolicyRepo.createApprovalRequest.mockResolvedValue({
      id: requestId,
      status: 'pending',
    });

    mockNotify.notifyApprovalRequested.mockRejectedValue(new Error('Notification failed'));

    await approvalService.createApprovalRequestsForDraft(
      draftId, walletId, userId,
      [{ policyId, policyName: 'Test', type: 'approval_required', action: 'approval_required', reason: 'test' }]
    );

    // Wait for the .catch() handler to execute
    await vi.waitFor(() => {
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Failed to send approval notification',
        expect.objectContaining({ error: 'Notification failed' })
      );
    });
  });
}
