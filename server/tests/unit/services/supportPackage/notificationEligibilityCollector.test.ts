import { beforeEach, describe, expect, it, vi } from 'vitest';

const { collectorMap, mockCounts } = vi.hoisted(() => ({
  collectorMap: new Map<string, () => Promise<unknown>>(),
  mockCounts: vi.fn(),
}));

vi.mock('../../../../src/repositories/supportNotificationDiagnosticsRepository', () => ({
  getNotificationEligibilityCounts: (...args: unknown[]) => mockCounts(...args),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerShareableCollector: (
    name: string,
    definition: { collect: () => Promise<unknown> },
  ) => collectorMap.set(name, definition.collect),
}));

import '../../../../src/services/supportPackage/collectors/notificationEligibility';
import {
  notificationEligibilitySchema,
} from '../../../../src/services/supportPackage/collectors/notificationEligibilitySchema';
import {
  toAggregateCountBucket,
} from '../../../../src/services/supportPackage/collectors/notificationEligibility';

describe('notification eligibility collector', () => {
  beforeEach(() => mockCounts.mockReset());

  it.each([
    [-1, 'zero'], [0, 'zero'], [1, 'one'], [2, 'two_to_five'], [5, 'two_to_five'],
    [6, 'six_to_twenty'], [20, 'six_to_twenty'], [21, 'over_twenty'],
  ] as const)('buckets %s without exporting the exact count', (count, bucket) => {
    expect(toAggregateCountBucket(count)).toBe(bucket);
  });

  it('returns only bucketed database-backed eligibility facts', async () => {
    mockCounts.mockResolvedValue({
      configuredTelegramUsers: 3,
      enabledTelegramUsers: 2,
      eligibleReceivedWallets: 1,
      eligibleSentWallets: 4,
      eligibleDraftWallets: 0,
      eligibleConsolidationWallets: 22,
      disabledReceivedWallets: 0,
      disabledSentWallets: 1,
      disabledDraftWallets: 6,
      disabledConsolidationWallets: 21,
      enabledUsersWithoutWalletSettings: 1,
      missingCredentialUsers: 7,
      orphanedWalletSettings: 2,
    });

    const result = await collectorMap.get('notificationEligibility')?.();

    expect(result).toEqual({
      observation: 'observed',
      unit: 'distinct_accessible_wallets_with_eligible_recipient',
      telegramUsers: {
        configured: 'two_to_five',
        enabled: 'two_to_five',
      },
      eligibleWallets: {
        received: 'one',
        sent: 'two_to_five',
        draft: 'zero',
        consolidation: 'over_twenty',
      },
      disabledDirectionWallets: {
        received: 'zero',
        sent: 'one',
        draft: 'six_to_twenty',
        consolidation: 'over_twenty',
      },
      enabledUsersWithoutWalletSettings: 'one',
      missingCredentialUsers: 'six_to_twenty',
      orphanedWalletSettings: 'two_to_five',
    });
    expect(notificationEligibilitySchema.safeParse(result).success).toBe(true);
  });

  it('reports unavailable instead of misleading zeroes on database failure', async () => {
    mockCounts.mockResolvedValue(undefined);
    const collect = collectorMap.get('notificationEligibility');
    if (!collect) throw new Error('notification eligibility collector not registered');
    expect(collect.name).toBe('collectNotificationEligibility');

    expect(await collect()).toEqual({ observation: 'unavailable' });
  });

  it('rejects identifying or unreviewed fields', () => {
    expect(notificationEligibilitySchema.safeParse({
      observation: 'unavailable',
      walletId: 'wallet-poison',
    }).success).toBe(false);

    expect(notificationEligibilitySchema.safeParse({
      observation: 'observed',
      unit: 'distinct_accessible_wallets_with_eligible_recipient',
      telegramUsers: { configured: 'one', enabled: 'one', userId: 'user-poison' },
      eligibleWallets: {
        received: 'zero', sent: 'zero', draft: 'zero', consolidation: 'zero',
      },
      disabledDirectionWallets: {
        received: 'zero', sent: 'zero', draft: 'zero', consolidation: 'zero',
      },
      enabledUsersWithoutWalletSettings: 'zero',
      missingCredentialUsers: 'zero',
      orphanedWalletSettings: 'zero',
    }).success).toBe(false);
  });
});
