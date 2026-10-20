/**
 * Scenario 7 and the feature flag: a receiver may broadcast the original
 * itself, so payjoin is refused before the original leaves the server when the
 * spend needs approval or any enforce-mode usage window would be reserved
 * (C-D8). The client's fallback broadcast then reserves exactly once. The
 * release path stays open with the payjoin flag off.
 */
import { describe, expect, it } from 'vitest';
import {
  attemptWithOriginal,
  broadcastOriginal,
  createOriginalIntent,
  receiver,
  releaseOriginal,
  seedWallet,
  setPayjoinEnabled,
  usageWindows,
  type PolicySeed,
} from './payjoinTwoRoundTestHarness';

const APPROVAL_ALWAYS: PolicySeed = {
  type: 'approval_required',
  enforcement: 'enforce',
  config: { trigger: { always: true }, requiredApprovals: 1, quorumType: 'any_n' },
};
const DAILY_LIMIT: PolicySeed = {
  type: 'spending_limit', enforcement: 'enforce', config: { daily: 10_000_000, scope: 'wallet' },
};
const VELOCITY_PER_DAY: PolicySeed = {
  type: 'velocity', enforcement: 'enforce', config: { maxPerDay: 10, scope: 'wallet' },
};
const PER_TRANSACTION_ONLY: PolicySeed = {
  type: 'spending_limit', enforcement: 'enforce', config: { perTransaction: 10_000_000, scope: 'wallet' },
};

const expectNoUsage = async (walletId: string) => {
  for (const window of await usageWindows(walletId)) {
    expect(window).toMatchObject({ totalSpent: 0n, txCount: 0 });
  }
};

export const registerPayjoinTwoRoundPolicyContracts = (): void => {
  describe('policy before the original leaves the server', () => {
    it.each([
      ['an enforce-mode approval_required policy', APPROVAL_ALWAYS, 'approval_required'],
      ['an enforce-mode daily spending limit', DAILY_LIMIT, 'payjoin_policy_usage_unsupported'],
      ['an enforce-mode daily velocity limit', VELOCITY_PER_DAY, 'payjoin_policy_usage_unsupported'],
    ] as const)('refuses payjoin under %s without calling the receiver', async (_name, policy, reason) => {
      const seeded = await seedWallet([policy]);
      const original = await createOriginalIntent(seeded);

      const response = await attemptWithOriginal(seeded, original);
      expect(response.status).toBe(403);
      expect(response.body.details).toMatchObject({ reason });
      expect(receiver().requests).toHaveLength(0);
      await expectNoUsage(seeded.walletId);
    });

    it('reserves the spending limit exactly once on the fallback broadcast of the original', async () => {
      const seeded = await seedWallet([DAILY_LIMIT]);
      const original = await createOriginalIntent(seeded);
      expect((await attemptWithOriginal(seeded, original)).status).toBe(403);

      expect((await releaseOriginal(seeded, original)).body).toEqual({ restored: false });
      await expectNoUsage(seeded.walletId);
      expect((await broadcastOriginal(seeded, original)).status).toBe(200);
      expect(await usageWindows(seeded.walletId)).toEqual([
        { windowType: 'daily', totalSpent: BigInt(original.metadata.amount), txCount: 1 },
      ]);
    });

    it('allows payjoin under a per-transaction limit, which reserves no window', async () => {
      const seeded = await seedWallet([PER_TRANSACTION_ONLY]);
      const original = await createOriginalIntent(seeded);

      const response = await attemptWithOriginal(seeded, original);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true, isPayjoin: true });
      expect(await usageWindows(seeded.walletId)).toEqual([]);
    });
  });

  describe('payjoinSupport flag off', () => {
    it('refuses /attempt but still releases a pending original', async () => {
      const seeded = await seedWallet();
      const original = await createOriginalIntent(seeded);
      expect((await attemptWithOriginal(seeded, original)).body).toMatchObject({ success: true });
      setPayjoinEnabled(false);

      const fresh = await createOriginalIntent(seeded);
      expect((await attemptWithOriginal(seeded, fresh)).status).toBe(403);
      expect(receiver().requests).toHaveLength(1);

      const release = await releaseOriginal(seeded, original);
      expect(release.status).toBe(200);
      expect(release.body).toEqual({ restored: true });
    });
  });
};
