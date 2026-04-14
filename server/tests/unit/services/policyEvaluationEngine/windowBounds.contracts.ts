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

export function registerPolicyWindowBoundsTests(context: PolicyEvaluationEngineTestContext): void {
  const { walletId, userId, groupId, recipient } = context;

  describe('getWindowBounds (via evaluateVelocity and evaluateSpendingLimit)', () => {
    it('exercises hourly window bounds via velocity evaluation', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Hourly Check',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 10, scope: 'wallet' },
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

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('hourly');
      // Verify window bounds are Date objects
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      // End should be after start
      expect(call.windowEnd.getTime()).toBeGreaterThan(call.windowStart.getTime());
      // Hourly: end - start should be exactly 1 hour (3600000 ms)
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(3_600_000);
    });

    it('exercises daily window bounds via spending_limit evaluation', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Daily Check',
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

      await getPolicyEvaluationEngine().evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('daily');
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      // Daily: end - start should be exactly 1 day (86400000 ms)
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(86_400_000);
    });

    it('exercises weekly window bounds via spending_limit evaluation', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Weekly Check',
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

      await getPolicyEvaluationEngine().evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('weekly');
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      // Weekly: end - start should be exactly 7 days (604800000 ms)
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(604_800_000);
    });

    it('exercises monthly window bounds via spending_limit evaluation', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          name: 'Monthly Check',
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

      await getPolicyEvaluationEngine().evaluatePolicies({
        walletId, userId, recipient,
        amount: BigInt(100),
      });

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('monthly');
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      // Monthly window: start should be first of month
      expect(call.windowStart.getDate()).toBe(1);
      // End should be first of next month
      expect(call.windowEnd.getDate()).toBe(1);
      expect(call.windowEnd.getMonth()).toBe((call.windowStart.getMonth() + 1) % 12);
    });

    it('exercises hourly window bounds via recordUsage', async () => {
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
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('hourly');
      expect(call.windowStart).toBeInstanceOf(Date);
      expect(call.windowEnd).toBeInstanceOf(Date);
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(3_600_000);
    });

    it('exercises weekly window bounds via recordUsage (velocity)', async () => {
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
        txCount: 0,
      });

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('weekly');
      expect(call.windowEnd.getTime() - call.windowStart.getTime()).toBe(604_800_000);
    });

    it('exercises monthly window bounds via recordUsage (spending_limit)', async () => {
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

      await getPolicyEvaluationEngine().recordUsage(walletId, userId, BigInt(100));

      const call = mockPolicyRepo.findOrCreateUsageWindow.mock.calls[0][0];
      expect(call.windowType).toBe('monthly');
      expect(call.windowStart.getDate()).toBe(1);
    });
  });
}
