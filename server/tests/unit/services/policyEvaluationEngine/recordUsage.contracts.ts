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

export function registerPolicyRecordUsageTests(context: PolicyEvaluationEngineTestContext): void {
  const { walletId, userId, groupId, recipient } = context;

  describe('recordUsage', () => {
    it('records spending_limit daily usage', async () => {
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
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(500_000));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'p1',
          walletId,
          windowType: 'daily',
        }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(500_000));
    });

    it('records spending_limit weekly usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Weekly Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { weekly: 20_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(500_000));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'p1',
          windowType: 'weekly',
        }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(500_000));
    });

    it('records spending_limit monthly usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Monthly Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { monthly: 100_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(500_000));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'p1',
          windowType: 'monthly',
        }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(500_000));
    });

    it('records all spending_limit windows (daily, weekly, monthly)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Full Limits',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 5_000_000, weekly: 20_000_000, monthly: 100_000_000, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(500_000));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledTimes(3);

      const windowTypes = mockPolicyRepo.findOrCreateUsageWindow.mock.calls.map(
        (c: Array<Record<string, unknown>>) => c[0].windowType
      );
      expect(windowTypes).toContain('daily');
      expect(windowTypes).toContain('weekly');
      expect(windowTypes).toContain('monthly');
    });

    it('records velocity hourly usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Hourly Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 10, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 3,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'p1',
          windowType: 'hourly',
        }),
      );
      // Velocity increments with BigInt(0) for amount (only counting tx)
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(0));
    });

    it('records velocity daily usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Daily Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 10, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 3,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ windowType: 'daily' }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(0));
    });

    it('records velocity weekly usage', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Weekly Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerWeek: 50, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 3,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ windowType: 'weekly' }),
      );
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(0));
    });

    it('records all velocity windows (hourly, daily, weekly)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Multi Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 5, maxPerDay: 20, maxPerWeek: 100, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledTimes(3);

      const windowTypes = mockPolicyRepo.findOrCreateUsageWindow.mock.calls.map(
        (c: Array<Record<string, unknown>>) => c[0].windowType
      );
      expect(windowTypes).toContain('hourly');
      expect(windowTypes).toContain('daily');
      expect(windowTypes).toContain('weekly');
    });

    it('uses per_user scope when spending_limit configured', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Per-User Cap',
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

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ userId }),
      );
    });

    it('uses per_user scope when velocity configured', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Per-User Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 10, scope: 'per_user' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ userId }),
      );
    });

    it('uses undefined userId for wallet scope on spending_limit', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Wallet Scope',
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

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ userId: undefined }),
      );
    });

    it('uses undefined userId for wallet scope on velocity', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Wallet Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 10, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ userId: undefined }),
      );
    });

    it('skips non-spending/velocity policies', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
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
          id: 'p2',
          name: 'Addr Control',
          type: 'address_control',
          enforcement: 'enforce',
          config: { mode: 'allowlist', allowSelfSend: true, managedBy: 'owner_only' },
        }),
        makePolicy({
          id: 'p3',
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

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).not.toHaveBeenCalled();
      expect(mockPolicyRepo.incrementUsageWindow).not.toHaveBeenCalled();
    });

    it('skips spending_limit with zero limits', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Zero Limits',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 0, weekly: 0, monthly: 0, scope: 'wallet' },
        }),
      ]);

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).not.toHaveBeenCalled();
    });

    it('skips velocity with zero limits', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Zero Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 0, maxPerDay: 0, maxPerWeek: 0, scope: 'wallet' },
        }),
      ]);

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockPolicyRepo.findOrCreateUsageWindow).not.toHaveBeenCalled();
    });

    it('handles errors gracefully without throwing', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Erroring',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 100, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockRejectedValue(new Error('DB down'));

      // Should not throw
      await expect(
        getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100))
      ).resolves.toBeUndefined();

      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to record policy usage',
        expect.objectContaining({
          policyId: 'p1',
          error: 'DB down',
        }),
      );
    });

    it('handles non-Error exceptions gracefully', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Erroring',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 100, scope: 'wallet' },
        }),
      ]);

      mockPolicyRepo.findOrCreateUsageWindow.mockRejectedValue('string error');

      await expect(
        getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100))
      ).resolves.toBeUndefined();

      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to record policy usage',
        expect.objectContaining({
          error: 'string error',
        }),
      );
    });

    it('passes groupId from wallet when recording usage', async () => {
      mockWalletRepo.findById.mockResolvedValue({ id: walletId, groupId });
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, groupId);
    });

    it('passes null groupId when wallet not found during recordUsage', async () => {
      mockWalletRepo.findById.mockResolvedValue(null);
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([]);

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, null);
    });

    it('records both spending_limit and velocity for multiple policies', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Spending Cap',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 5_000_000, scope: 'wallet' },
        }),
        makePolicy({
          id: 'p2',
          name: 'Velocity',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 10, scope: 'wallet' },
        }),
        makePolicy({
          id: 'p3',
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

      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({
        id: 'w1',
        totalSpent: BigInt(0),
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(500_000));

      // spending_limit daily + velocity daily = 2 calls
      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(2);
      // spending_limit gets actual amount, velocity gets BigInt(0)
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(500_000));
      expect(mockPolicyRepo.incrementUsageWindow).toHaveBeenCalledWith('w1', BigInt(0));
    });
  });
}
