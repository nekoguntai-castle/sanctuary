import { describe, expect, it } from 'vitest';
import {
  makePolicy,
  mockLog,
  mockPolicyRepo,
  mockVaultPolicyService,
  getPolicyEvaluationEngine,
  type PolicyEvaluationEngineTestContext,
} from './policyEvaluationEngineTestHarness';

export function registerReserveEnforcedUsageTests(context: PolicyEvaluationEngineTestContext): void {
  const { walletId, userId } = context;

  describe('reserveEnforcedUsage', () => {
    it('reserves a spending_limit window with a totalSpent-only guard', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 1_000_000, scope: 'wallet' },
        }),
      ]);
      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({ id: 'w1', totalSpent: BigInt(0), txCount: 0 });
      mockPolicyRepo.reserveUsageWindow.mockResolvedValue({ count: 1 });

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(600_000),
      });

      expect(result).toEqual({ ok: true, reservations: [{ windowId: 'w1', amount: BigInt(600_000) }] });
      expect(mockPolicyRepo.reserveUsageWindow).toHaveBeenCalledWith({
        windowId: 'w1',
        amount: BigInt(600_000),
        spendLimit: BigInt(1_000_000),
      });
    });

    it('reserves a velocity window with a txCount-only guard and zero amount', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 10, scope: 'wallet' },
        }),
      ]);
      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({ id: 'w1', totalSpent: BigInt(0), txCount: 3 });
      mockPolicyRepo.reserveUsageWindow.mockResolvedValue({ count: 1 });

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(600_000),
      });

      expect(result).toEqual({ ok: true, reservations: [{ windowId: 'w1', amount: BigInt(0) }] });
      expect(mockPolicyRepo.reserveUsageWindow).toHaveBeenCalledWith({
        windowId: 'w1',
        amount: BigInt(0),
        txLimit: 10,
      });
    });

    it('reserves all spending_limit windows (daily, weekly, monthly)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 1_000_000, weekly: 5_000_000, monthly: 20_000_000, scope: 'wallet' },
        }),
      ]);
      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({ id: 'w1', totalSpent: BigInt(0), txCount: 0 });
      mockPolicyRepo.reserveUsageWindow.mockResolvedValue({ count: 1 });

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(1_000),
      });

      expect(result.ok).toBe(true);
      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      const windowTypes = mockPolicyRepo.findOrCreateUsageWindow.mock.calls.map(
        (c: Array<Record<string, unknown>>) => c[0].windowType,
      );
      expect(windowTypes).toEqual(['daily', 'weekly', 'monthly']);
    });

    it('reserves all velocity windows (hourly, daily, weekly)', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 3, maxPerDay: 10, maxPerWeek: 50, scope: 'wallet' },
        }),
      ]);
      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({ id: 'w1', totalSpent: BigInt(0), txCount: 0 });
      mockPolicyRepo.reserveUsageWindow.mockResolvedValue({ count: 1 });

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(1_000),
      });

      expect(result.ok).toBe(true);
      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledTimes(3);
      const windowTypes = mockPolicyRepo.findOrCreateUsageWindow.mock.calls.map(
        (c: Array<Record<string, unknown>>) => c[0].windowType,
      );
      expect(windowTypes).toEqual(['hourly', 'daily', 'weekly']);
    });

    it('a second reservation that lands after the window is already at 600k of a 1,000,000 daily limit is blocked', async () => {
      // This exercises the caller-facing contract (a lost reservation reports
      // ok: false) by scripting the repository mock's two possible outcomes
      // in sequence; it does not exercise real concurrent execution — that
      // is proven against a real Postgres row lock by
      // tests/integration/repositories/policyRepository.audit.test.ts
      // ("lets exactly one of two concurrent reservations through...").
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 1_000_000, scope: 'wallet' },
        }),
      ]);
      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({ id: 'w1', totalSpent: BigInt(0), txCount: 0 });
      // First reservation lands (600k <= 1,000,000 - 600k is false... simulate DB
      // enforcing the guard: first succeeds, second is rejected because the
      // window is now at 600k and 600k > 1,000,000 - 600k headroom).
      mockPolicyRepo.reserveUsageWindow
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const first = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(600_000),
      });
      const second = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(600_000),
      });

      expect(first.ok).toBe(true);
      expect(first.reservations).toEqual([{ windowId: 'w1', amount: BigInt(600_000) }]);
      expect(second.ok).toBe(false);
      expect(second.reservations).toEqual([]);
    });

    it('releases an already-reserved window in the same call when a later window is lost', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 1_000_000, weekly: 2_000_000, scope: 'wallet' },
        }),
      ]);
      mockPolicyRepo.findOrCreateUsageWindow
        .mockResolvedValueOnce({ id: 'daily-window', totalSpent: BigInt(0), txCount: 0 })
        .mockResolvedValueOnce({ id: 'weekly-window', totalSpent: BigInt(0), txCount: 0 });
      mockPolicyRepo.reserveUsageWindow
        .mockResolvedValueOnce({ count: 1 }) // daily reserved
        .mockResolvedValueOnce({ count: 0 }); // weekly lost

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(600_000),
      });

      expect(result).toEqual({ ok: false, reservations: [] });
      expect(mockPolicyRepo.releaseUsageWindow).toHaveBeenCalledWith({
        windowId: 'daily-window',
        amount: BigInt(600_000),
      });
    });

    it('releases reservations from an earlier policy when a later policy loses its reservation', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 1_000_000, scope: 'wallet' },
        }),
        makePolicy({
          id: 'p2',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerDay: 1, scope: 'wallet' },
        }),
      ]);
      mockPolicyRepo.findOrCreateUsageWindow
        .mockResolvedValueOnce({ id: 'spend-window', totalSpent: BigInt(0), txCount: 0 })
        .mockResolvedValueOnce({ id: 'velocity-window', totalSpent: BigInt(0), txCount: 1 });
      mockPolicyRepo.reserveUsageWindow
        .mockResolvedValueOnce({ count: 1 }) // p1 spending_limit reserved
        .mockResolvedValueOnce({ count: 0 }); // p2 velocity lost

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(600_000),
      });

      expect(result).toEqual({ ok: false, reservations: [] });
      expect(mockPolicyRepo.releaseUsageWindow).toHaveBeenCalledWith({
        windowId: 'spend-window',
        amount: BigInt(600_000),
      });
    });

    it('never reserves for monitor-mode spending_limit/velocity policies', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'spending_limit',
          enforcement: 'monitor',
          config: { daily: 1_000_000, scope: 'wallet' },
        }),
        makePolicy({
          id: 'p2',
          type: 'velocity',
          enforcement: 'monitor',
          config: { maxPerDay: 10, scope: 'wallet' },
        }),
      ]);

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(600_000),
      });

      expect(result).toEqual({ ok: true, reservations: [] });
      expect(mockPolicyRepo.findOrCreateUsageWindow).not.toHaveBeenCalled();
      expect(mockPolicyRepo.reserveUsageWindow).not.toHaveBeenCalled();
    });

    it('skips non-spending/velocity enforce policies', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
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

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(600_000),
      });

      expect(result).toEqual({ ok: true, reservations: [] });
      expect(mockPolicyRepo.reserveUsageWindow).not.toHaveBeenCalled();
    });

    it('reserves per_user scoped windows with the caller userId', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 1_000_000, scope: 'per_user' },
        }),
      ]);
      mockPolicyRepo.findOrCreateUsageWindow.mockResolvedValue({ id: 'w1', totalSpent: BigInt(0), txCount: 0 });
      mockPolicyRepo.reserveUsageWindow.mockResolvedValue({ count: 1 });

      await getPolicyEvaluationEngine().reserveEnforcedUsage({ walletId, userId, amount: BigInt(1) });

      expect(mockPolicyRepo.findOrCreateUsageWindow).toHaveBeenCalledWith(
        expect.objectContaining({ userId }),
      );
    });

    it('skips spending_limit windows with zero limits', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'spending_limit',
          enforcement: 'enforce',
          config: { daily: 0, weekly: 0, monthly: 0, scope: 'wallet' },
        }),
      ]);

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(1),
      });

      expect(result).toEqual({ ok: true, reservations: [] });
      expect(mockPolicyRepo.reserveUsageWindow).not.toHaveBeenCalled();
    });

    it('skips velocity windows with zero limits', async () => {
      mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue([
        makePolicy({
          id: 'p1',
          type: 'velocity',
          enforcement: 'enforce',
          config: { maxPerHour: 0, maxPerDay: 0, maxPerWeek: 0, scope: 'wallet' },
        }),
      ]);

      const result = await getPolicyEvaluationEngine().reserveEnforcedUsage({
        walletId,
        userId,
        amount: BigInt(1),
      });

      expect(result).toEqual({ ok: true, reservations: [] });
      expect(mockPolicyRepo.reserveUsageWindow).not.toHaveBeenCalled();
    });
  });

  describe('releasePolicyUsage', () => {
    it('releases every reservation', async () => {
      mockPolicyRepo.releaseUsageWindow.mockResolvedValue(undefined);

      await getPolicyEvaluationEngine().releasePolicyUsage([
        { windowId: 'w1', amount: BigInt(100) },
        { windowId: 'w2', amount: BigInt(0) },
      ]);

      expect(mockPolicyRepo.releaseUsageWindow).toHaveBeenCalledWith({ windowId: 'w1', amount: BigInt(100) });
      expect(mockPolicyRepo.releaseUsageWindow).toHaveBeenCalledWith({ windowId: 'w2', amount: BigInt(0) });
    });

    it('logs and continues releasing the rest when one release fails', async () => {
      mockPolicyRepo.releaseUsageWindow
        .mockRejectedValueOnce(new Error('DB down'))
        .mockResolvedValueOnce(undefined);

      await expect(
        getPolicyEvaluationEngine().releasePolicyUsage([
          { windowId: 'w1', amount: BigInt(100) },
          { windowId: 'w2', amount: BigInt(0) },
        ]),
      ).resolves.toBeUndefined();

      expect(mockLog.error).toHaveBeenCalledWith(
        'Failed to release policy usage reservation',
        expect.objectContaining({ windowId: 'w1', error: 'DB down' }),
      );
      expect(mockPolicyRepo.releaseUsageWindow).toHaveBeenCalledWith({ windowId: 'w2', amount: BigInt(0) });
    });

    it('is a no-op for an empty reservation list', async () => {
      await getPolicyEvaluationEngine().releasePolicyUsage([]);

      expect(mockPolicyRepo.releaseUsageWindow).not.toHaveBeenCalled();
    });
  });
}
