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

export function registerPolicyEvaluateSpendingApprovalTests(context: PolicyEvaluationEngineTestContext): void {
  const { walletId, userId, groupId, recipient } = context;

    describe('no policies', () => {
      it('returns allowed when no policies exist', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId,
          userId,
          recipient,
          amount: BigInt(100_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
        expect(result.limits).toBeUndefined();
      });
    });

    describe('wallet with groupId', () => {
      it('passes groupId from wallet to getActivePoliciesForWallet', async () => {
        mockWalletRepo.findById.mockResolvedValue({ id: walletId, groupId });
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId,
          userId,
          recipient,
          amount: BigInt(100),
        });

        expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, groupId);
      });

      it('passes null groupId when wallet has no group', async () => {
        mockWalletRepo.findById.mockResolvedValue({ id: walletId, groupId: null });
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId,
          userId,
          recipient,
          amount: BigInt(100),
        });

        expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, null);
      });

      it('passes null groupId when wallet is not found', async () => {
        mockWalletRepo.findById.mockResolvedValue(null);
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId,
          userId,
          recipient,
          amount: BigInt(100),
        });

        expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, null);
      });
    });

    // ========================================
    // spending_limit
    // ========================================

    describe('spending_limit', () => {
      it('blocks when per-transaction limit exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Tx Limit',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 1_000_000, scope: 'wallet' },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(2_000_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('blocked');
        expect(result.triggered[0].type).toBe('spending_limit');
        expect(result.triggered[0].reason).toContain('per-transaction limit');
        expect(result.limits?.perTransaction).toEqual({ limit: 1_000_000 });
      });

      it('allows when under per-transaction limit and populates limit info', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Tx Limit',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { perTransaction: 1_000_000, scope: 'wallet' },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(0);
        expect(result.limits?.perTransaction).toEqual({ limit: 1_000_000 });
      });

      it('blocks when daily limit exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Daily Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 5_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(4_500_000),
          txCount: 3,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('daily');
        expect(result.limits?.daily).toBeDefined();
      });

      it('allows when daily limit has room and populates limit info', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Daily Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 5_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(1_000_000),
          txCount: 1,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.limits?.daily).toEqual({
          used: 1_000_000,
          limit: 5_000_000,
          remaining: 4_000_000,
        });
      });

      it('blocks when weekly limit exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Weekly Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { weekly: 10_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(9_500_000),
          txCount: 5,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('weekly');
        expect(result.limits?.weekly).toBeDefined();
        expect(result.limits?.weekly?.remaining).toBe(500_000);
      });

      it('allows when weekly limit has room', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Weekly Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { weekly: 10_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(2_000_000),
          txCount: 2,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.limits?.weekly).toEqual({
          used: 2_000_000,
          limit: 10_000_000,
          remaining: 8_000_000,
        });
      });

      it('blocks when monthly limit exceeded', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monthly Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { monthly: 50_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(49_500_000),
          txCount: 10,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(false);
        expect(result.triggered[0].reason).toContain('monthly');
        expect(result.limits?.monthly).toBeDefined();
      });

      it('allows when monthly limit has room', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monthly Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { monthly: 50_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(5_000_000),
          txCount: 2,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(600_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.limits?.monthly).toEqual({
          used: 5_000_000,
          limit: 50_000_000,
          remaining: 45_000_000,
        });
      });

      it('checks all window types (daily, weekly, monthly) and returns combined limits', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Full Limits',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: {
              perTransaction: 5_000_000,
              daily: 10_000_000,
              weekly: 50_000_000,
              monthly: 100_000_000,
              scope: 'wallet',
            },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(1_000_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.limits?.perTransaction).toEqual({ limit: 5_000_000 });
        expect(result.limits?.daily).toBeDefined();
        expect(result.limits?.weekly).toBeDefined();
        expect(result.limits?.monthly).toBeDefined();
        // findOrCreateUsageWindow called 3 times (daily, weekly, monthly)
        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      });

      it('uses per_user scope when configured for spending_limit evaluation', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Per-User Daily',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 1_000_000, scope: 'per_user' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
          expect.objectContaining({ userId }),
        );
      });

      it('uses undefined userId for wallet scope', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Wallet Scope Daily',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 1_000_000, scope: 'wallet' },
          }),
        ]);

        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(0),
          txCount: 0,
        });

        await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
          expect.objectContaining({ userId: undefined }),
        );
      });

      it('returns limits with remaining clamped to 0 when overspent', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Daily Cap',
            type: 'spending_limit',
            enforcement: 'enforce',
            config: { daily: 1_000_000, scope: 'wallet' },
          }),
        ]);

        // totalSpent already exceeds limit
        mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
          id: 'w1',
          totalSpent: BigInt(1_500_000),
          txCount: 3,
        });

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(false);
        expect(result.limits?.daily?.remaining).toBe(0);
      });

      it('monitors but does not block in monitor mode', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Monitored Limit',
            type: 'spending_limit',
            enforcement: 'monitor',
            config: { perTransaction: 100, scope: 'wallet' },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500_000),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
      });

      it('returns limits undefined when no limit info is populated', async () => {
        // A policy that produces no limits (e.g., address_control) should not
        // have limits in the result. But spending_limit always populates limits.
        // Let's test the case where limits object has zero keys.
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Addr Control',
            type: 'address_control',
            enforcement: 'enforce',
            config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
          }),
        ]);

        mockPolicyRepo.findPolicyAddresses.mockResolvedValue([]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.limits).toBeUndefined();
      });
    });

    // ========================================
    // approval_required
    // ========================================

    describe('approval_required', () => {
      it('triggers when always is set', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Always Approve',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { always: true },
              requiredApprovals: 2,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 48,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true); // approval_required doesn't block
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('approval_required');
        expect(result.triggered[0].type).toBe('approval_required');
        expect(result.triggered[0].reason).toContain('2 approval(s)');
      });

      it('triggers when amount exceeds threshold', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Large Tx',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 1_000_000 },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(2_000_000),
        });

        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('approval_required');
        expect(result.triggered[0].reason).toContain('approval threshold');
      });

      it('does not trigger when amount is under threshold', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Large Tx',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { amountAbove: 1_000_000 },
              requiredApprovals: 1,
              quorumType: 'any_n',
              allowSelfApproval: false,
              expirationHours: 24,
            },
          }),
        ]);

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(500_000),
        });

        expect(result.triggered).toHaveLength(0);
        expect(result.allowed).toBe(true);
      });

      it('does not trigger when neither always nor amountAbove triggers', async () => {
        mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
          makePolicy({
            id: 'p1',
            name: 'Unknown Only',
            type: 'approval_required',
            enforcement: 'enforce',
            config: {
              trigger: { unknownAddressesOnly: true },
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

        expect(result.triggered).toHaveLength(0);
      });

      it('sets action to monitored in monitor mode', async () => {
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

        const result = await getPolicyEvaluationEngine().evaluatePolicies({
          walletId, userId, recipient,
          amount: BigInt(100),
        });

        expect(result.allowed).toBe(true);
        expect(result.triggered).toHaveLength(1);
        expect(result.triggered[0].action).toBe('monitored');
      });
    });
}
