import { describe, expect, it } from 'vitest';
import {
  makePolicy,
  mockPolicyRepo,
  mockVaultPolicyService,
  mockWalletRepo,
  getPolicyEvaluationEngine,
  type PolicyEvaluationEngineTestContext,
} from './policyEvaluationEngineTestHarness';

export function registerWalletHasEnforcedUsageWindowsTests(context: PolicyEvaluationEngineTestContext): void {
  const { walletId, groupId } = context;

  const hasWindows = (policies: Array<Record<string, unknown>>) => {
    mockVaultPolicyService.getActivePoliciesForWallet.mockResolvedValue(policies.map(makePolicy));
    return getPolicyEvaluationEngine().walletHasEnforcedUsageWindows(walletId);
  };

  describe('walletHasEnforcedUsageWindows', () => {
    it.each([
      ['an enforce-mode daily spending limit', { type: 'spending_limit', config: { daily: 1_000 } }],
      ['an enforce-mode weekly spending limit', { type: 'spending_limit', config: { weekly: 1_000 } }],
      ['an enforce-mode monthly spending limit', { type: 'spending_limit', config: { monthly: 1_000 } }],
      ['an enforce-mode hourly velocity limit', { type: 'velocity', config: { maxPerHour: 2 } }],
      ['an enforce-mode daily velocity limit', { type: 'velocity', config: { maxPerDay: 5 } }],
      ['an enforce-mode weekly velocity limit', { type: 'velocity', config: { maxPerWeek: 9 } }],
    ])('is true for %s', async (_name, policy) => {
      await expect(hasWindows([{ ...policy, enforcement: 'enforce' }])).resolves.toBe(true);
    });

    it.each([
      ['a per-transaction-only spending limit', { type: 'spending_limit', config: { perTransaction: 1_000 } }],
      ['a spending limit whose windows are all 0', { type: 'spending_limit', config: { daily: 0, weekly: 0, monthly: 0 } }],
      ['a velocity limit whose windows are all 0', { type: 'velocity', config: { maxPerHour: 0, maxPerDay: 0, maxPerWeek: 0 } }],
      ['an approval policy', { type: 'approval_required', config: { requiredApprovals: 1 } }],
      ['an address control', { type: 'address_control', config: { mode: 'allowlist' } }],
    ])('is false for %s', async (_name, policy) => {
      await expect(hasWindows([{ ...policy, enforcement: 'enforce' }])).resolves.toBe(false);
    });

    it('is false for a monitor-mode spending limit', async () => {
      await expect(hasWindows([
        { type: 'spending_limit', enforcement: 'monitor', config: { daily: 1_000 } },
      ])).resolves.toBe(false);
    });

    it('is false for a wallet with no active policies', async () => {
      await expect(hasWindows([])).resolves.toBe(false);
    });

    it('reads wallet, group and system policies without touching any usage window', async () => {
      mockWalletRepo.findById.mockResolvedValueOnce({ id: walletId, groupId });

      await expect(hasWindows([
        { type: 'velocity', enforcement: 'monitor', config: { maxPerDay: 3 } },
        { type: 'spending_limit', enforcement: 'enforce', config: { weekly: 5_000 } },
      ])).resolves.toBe(true);
      expect(mockVaultPolicyService.getActivePoliciesForWallet).toHaveBeenCalledWith(walletId, groupId);
      expect(mockPolicyRepo.findOrCreateUsageWindow).not.toHaveBeenCalled();
      expect(mockPolicyRepo.reserveUsageWindow).not.toHaveBeenCalled();
    });
  });
}
