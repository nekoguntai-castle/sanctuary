import { faker } from '@faker-js/faker';
import { expect, it, vi } from 'vitest';

import { draftId, mockDraftRepo, mockLog, mockNotify, mockPolicyRepo, mockWalletSharingRepo, policyId, requestId, userId, walletId } from './approvalServiceTestHarness';
import { approvalService, type ApprovalDbClient } from '../../../../src/services/vaultPolicy/approvalService';

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

  it('creates no approval request for a triggered time_delay policy even if mislabeled with action approval_required', async () => {
    const result = await approvalService.createApprovalRequestsForDraft(
      draftId,
      walletId,
      userId,
      [{ policyId, policyName: 'Cooling Period', type: 'time_delay', action: 'approval_required', reason: 'cooling period' }]
    );

    expect(result).toHaveLength(0);
    expect(mockPolicyRepo.findPolicyById).not.toHaveBeenCalled();
    expect(mockPolicyRepo.createApprovalRequest).not.toHaveBeenCalled();
  });

  it('creates an approval request for a genuine approval_required policy alongside a non-triggering time_delay policy', async () => {
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
      draftTransactionId: draftId,
      policyId,
      status: 'pending',
      requiredApprovals: 1,
    });

    const result = await approvalService.createApprovalRequestsForDraft(
      draftId,
      walletId,
      userId,
      [
        { policyId, policyName: 'Real Approval', type: 'approval_required', action: 'approval_required', reason: 'test' },
        { policyId: 'p-delay', policyName: 'Cooling Period', type: 'time_delay', action: 'time_delay', reason: 'cooling period' },
      ]
    );

    expect(result).toHaveLength(1);
    expect(mockPolicyRepo.findPolicyById).toHaveBeenCalledTimes(1);
    expect(mockPolicyRepo.findPolicyById).toHaveBeenCalledWith(policyId);
  });

  it('fails closed with InvalidInputError and creates nothing when an approval_required policy config is missing requiredApprovals', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      id: policyId,
      config: {
        trigger: { always: true },
        // requiredApprovals intentionally omitted — the malformed shape a
        // time-delay TimeDelayConfig would have if it were ever mislabeled.
        quorumType: 'any_n',
        allowSelfApproval: false,
        expirationHours: 0,
      },
    });

    await expect(
      approvalService.createApprovalRequestsForDraft(
        draftId,
        walletId,
        userId,
        [{ policyId, policyName: 'Broken Config', type: 'approval_required', action: 'approval_required', reason: 'test' }]
      )
    ).rejects.toMatchObject({ statusCode: 400, details: { policyId } });

    expect(mockPolicyRepo.createApprovalRequest).not.toHaveBeenCalled();
    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
  });

  it('fails closed with InvalidInputError and creates nothing when the policy config is null', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({ id: policyId, config: null });

    await expect(
      approvalService.createApprovalRequestsForDraft(
        draftId,
        walletId,
        userId,
        [{ policyId, policyName: 'Null Config', type: 'approval_required', action: 'approval_required', reason: 'test' }]
      )
    ).rejects.toMatchObject({ statusCode: 400, details: { policyId } });

    expect(mockPolicyRepo.createApprovalRequest).not.toHaveBeenCalled();
    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
  });

  it('fails closed with InvalidInputError and creates nothing when the policy config is a non-object JSON value', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({ id: policyId, config: 'not-an-object' });

    await expect(
      approvalService.createApprovalRequestsForDraft(
        draftId,
        walletId,
        userId,
        [{ policyId, policyName: 'String Config', type: 'approval_required', action: 'approval_required', reason: 'test' }]
      )
    ).rejects.toMatchObject({ statusCode: 400, details: { policyId } });

    expect(mockPolicyRepo.createApprovalRequest).not.toHaveBeenCalled();
    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
  });

  it('fails closed with InvalidInputError and creates nothing when quorumType is wrong-typed', async () => {
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      id: policyId,
      config: {
        trigger: { always: true },
        requiredApprovals: 2,
        quorumType: 3, // should be a string
        allowSelfApproval: false,
        expirationHours: 0,
      },
    });

    await expect(
      approvalService.createApprovalRequestsForDraft(
        draftId,
        walletId,
        userId,
        [{ policyId, policyName: 'Wrong-typed quorumType', type: 'approval_required', action: 'approval_required', reason: 'test' }]
      )
    ).rejects.toMatchObject({ statusCode: 400, details: { policyId } });

    expect(mockPolicyRepo.createApprovalRequest).not.toHaveBeenCalled();
    expect(mockDraftRepo.updateApprovalStatus).not.toHaveBeenCalled();
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

  it('propagates composite client to effective membership, policy writes, and draft approval status', async () => {
    const mockClient = { vaultPolicy: {}, approvalRequest: {}, draftTransaction: {}, user: {} } as unknown as ApprovalDbClient;
    mockPolicyRepo.findPolicyById.mockResolvedValue({
      id: policyId,
      config: {
        trigger: { always: true },
        requiredApprovals: 1,
        quorumType: 'all',
        allowSelfApproval: false,
        expirationHours: 0,
      },
    });

    mockWalletSharingRepo.findEffectiveApproverIds.mockResolvedValue([userId, 'group-approver']);
    mockPolicyRepo.createApprovalRequest.mockResolvedValue({ id: requestId, status: 'pending' });

    const result = await approvalService.createApprovalRequestsForDraft(
      draftId, walletId, userId,
      [{ policyId, policyName: 'Test', type: 'approval_required', action: 'approval_required', reason: 'test' }],
      mockClient
    );

    expect(result).toHaveLength(1);
    expect(mockWalletSharingRepo.findEffectiveApproverIds).toHaveBeenCalledWith(walletId, mockClient);
    expect(mockPolicyRepo.findPolicyById).toHaveBeenCalledWith(policyId, mockClient);
    expect(mockPolicyRepo.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ draftTransactionId: draftId, policyId, requiredApprovals: 1 }),
      mockClient
    );
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'pending', mockClient);
  });

  it('passes original repository arity by default when no client is supplied', async () => {
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

    mockPolicyRepo.createApprovalRequest.mockResolvedValue({ id: requestId, status: 'pending' });

    await approvalService.createApprovalRequestsForDraft(
      draftId, walletId, userId,
      [{ policyId, policyName: 'Test', type: 'approval_required', action: 'approval_required', reason: 'test' }]
    );

    expect(mockPolicyRepo.findPolicyById).toHaveBeenCalledTimes(1);
    expect(mockPolicyRepo.findPolicyById).toHaveBeenCalledWith(policyId);
    expect(mockPolicyRepo.createApprovalRequest).toHaveBeenCalledTimes(1);
    expect(mockPolicyRepo.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ draftTransactionId: draftId, policyId })
    );
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledTimes(1);
    expect(mockDraftRepo.updateApprovalStatus).toHaveBeenCalledWith(draftId, 'pending');
  });
}
