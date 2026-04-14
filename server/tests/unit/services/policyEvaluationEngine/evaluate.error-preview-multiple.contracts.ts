import { describe, expect, it } from 'vitest';
import {
  makePolicy,
  mockLog,
  mockPolicyRepo,
  mockWalletRepo,
  mockVaultPolicyService,
  getPolicyEvaluationEngine,
  type PolicyEvaluationEngineTestContext,
} from './policyEvaluationEngineTestHarness';

export function registerPolicyEvaluateErrorPreviewMultipleTests(context: PolicyEvaluationEngineTestContext): void {
  const { walletId, userId, groupId, recipient } = context;

    describe('error handling', () => {
      it('enforce-mode policy error blocks transaction (fail-closed)', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Bad Policy',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: null, // Will cause evaluation error
          }),
          makePolicy({
            id: 'p2',
            name: 'Good Policy',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        // First policy errored → blocked (fail-closed), second still evaluated
        expect(result.allowed).toBe(false);
        expect(result.triggered.some(t => t.reason.includes('precaution'))).toBe(true);
        expect(result.triggered.some(t => t.action === 'blocked')).toBe(true);
        expect(mockLog.error).toHaveBeenCalled();
      });

      it('monitor-mode policy error does not block (fail-open)', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Bad',
            type: 'spending_limit',
            enforcement: 'monitor',
            config: null, // Will cause evaluation error
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        // Monitor mode → fail-open
        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
        expect(mockLog.error).toHaveBeenCalled();
      });

      it('logs error message from Error instances', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Error Policy',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: null,
          }),
        ]);

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockLog.error).toHaveBeenCalledWith(
          'Policy evaluation error',
          expect.objectContaining({
            policyId: 'p1',
            policyType: 'spending_limit',
          }),
        );
      });

      it('logs non-Error exception as string in evaluation catch block', async () => {
        // Use a spending_limit policy with a valid config but make
        // findOrCreateUsageWindow reject with a non-Error value to hit the
        // String(error) branch in the catch block at line 167.
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'String Throw',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 1_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockRejectedValue('non-error string thrown');

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(mockLog.error).toHaveBeenCalledWith(
          'Policy evaluation error',
          expect.objectContaining({
            policyId: 'p1',
            error: 'non-error string thrown',
          }),
        );
      });
    });

    // ========================================
    // Preview mode
    // ========================================

    describe('preview mode', () => {
      it('skips event logging in preview mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
          preview: true,
        });

        expect(mockPolicyRepo.createPolicyEvent).not.toHaveBeenCalled();
      });

      it('logs events when not in preview mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            policyId: 'p1',
            walletId,
            userId,
            eventType: 'triggered',
            details: expect.objectContaining({
              action: 'approval_required',
              amount: '100',
              recipient,
            }),
          }),
        );
      });

      it('uses evaluated event type for monitored actions', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Approval',
            type: 'approval_required',
            enforcement: 'monitor',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.createPolicyEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            eventType: 'evaluated', // monitored → 'evaluated'
          }),
        );
      });

      it('handles createPolicyEvent failure gracefully', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        mockPolicyRepo.createPolicyEvent.mockRejectedValue(new Error('DB event write failed'));

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        // The evaluation result should still be correct despite event logging failure
        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);

        // Wait for the catch handler to fire
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockLog.warn).toHaveBeenCalledWith(
          'Failed to log policy event',
          expect.objectContaining({ error: 'DB event write failed' }),
        );
      });

      it('handles createPolicyEvent failure with non-Error value', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        mockPolicyRepo.createPolicyEvent.mockRejectedValue('string error');

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockLog.warn).toHaveBeenCalledWith(
          'Failed to log policy event',
          expect.objectContaining({ error: 'string error' }),
        );
      });
    });

    // ========================================
    // Multiple policies
    // ========================================

    describe('multiple policies', () => {
      it('evaluates all policies and combines results', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Spending Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 10_000_000, scope: 'wallet' },
          }),
          makePolicy({
            id: 'p2',
            name: 'Approval',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 5_000_000 },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(7_000_000),
        });

        // Under spending limit but above approval threshold
        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].type).toBe('approval_required');
      });

      it('blocks when any enforce-mode policy blocks', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Low Limit',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 100, scope: 'wallet' },
          }),
          makePolicy({
            id: 'p2',
            name: 'Approval',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered).toHaveLength(2);
      });

      it('evaluates all policy types together', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Spending',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 10_000_000, scope: 'wallet' },
          }),
          makePolicy({
            id: 'p2',
            name: 'Approval',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
          makePolicy({
            id: 'p3',
            name: 'Allowlist',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
          makePolicy({
            id: 'p4',
            name: 'Velocity',
            type: 'velocity',
            enforcement: 'enforce',
            config: { maxPerDay: 100, scope: 'wallet' },
          }),
          makePolicy({
            id: 'p5',
            name: 'Delay',
            type: 'time_delay',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              delayHours: 12,
              vetoEligible: 'any_approver',
              notifyOnStart: true,
              notifyOnVeto: true,
              notifyOnClear: true,
            },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([]);
        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        // approval_required + time_delay triggered (empty allowlist doesn't block)
        expect(result.triggered).toHaveLength(2);
        expect(result.triggered.map(t => t.type)).toContain('approval_required');
        expect(result.triggered.map(t => t.type)).toContain('time_delay');
      });
    });
}
