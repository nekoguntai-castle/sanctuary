import { beforeEach, describe, expect, it, vi } from 'vitest';

const { collectorMap, mockAggregates } = vi.hoisted(() => ({
  collectorMap: new Map<string, () => Promise<unknown>>(),
  mockAggregates: vi.fn(),
}));

vi.mock('../../../../src/repositories/supportWalletSyncDiagnosticsRepository', () => ({
  getWalletSyncAggregates: (...args: unknown[]) => mockAggregates(...args),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerShareableCollector: (
    name: string,
    definition: { collect: () => Promise<unknown> },
  ) => collectorMap.set(name, definition.collect),
}));

import '../../../../src/services/supportPackage/collectors/walletSync';
import {
  toFullResyncDriftBucket,
} from '../../../../src/services/supportPackage/collectors/walletSync';
import {
  walletSyncSchema,
} from '../../../../src/services/supportPackage/collectors/walletSyncSchema';
import {
  MAX_COLLECTOR_BYTES,
  serializePrivacySafeArtifact,
} from '../../../../src/services/supportPackage/privacy';

function networkRow(overrides: Record<string, unknown> = {}) {
  return {
    network: 'mainnet',
    total: 0,
    success: 0,
    failed: 0,
    retrying: 0,
    resyncing: 0,
    neverSynced: 0,
    otherStatus: 0,
    syncInProgress: 0,
    stuckCandidates: 0,
    ageNever: 0,
    ageUnderOneHour: 0,
    ageOneToTwentyFourHours: 0,
    ageOneToSevenDays: 0,
    ageOverSevenDays: 0,
    fullResyncPending: 0,
    maxFullResyncDrift: 0,
    withSyncError: 0,
    ...overrides,
  };
}

async function collect(): Promise<Record<string, unknown>> {
  const collector = collectorMap.get('walletSync');
  if (!collector) throw new Error('walletSync collector not registered');
  return await collector() as Record<string, unknown>;
}

describe('wallet sync collector', () => {
  // The arrow body is braced deliberately: returning the mock would register it
  // as a vitest teardown callback and invoke it again after the test.
  beforeEach(() => {
    mockAggregates.mockReset();
  });

  it.each([
    [-3, 'none'], [0, 'none'], [1, 'one'], [2, 'two_to_five'], [5, 'two_to_five'],
    [6, 'six_plus'], [900, 'six_plus'], [Number.NaN, 'none'],
  ] as const)('buckets full resync drift %s as %s', (drift, bucket) => {
    expect(toFullResyncDriftBucket(drift)).toBe(bucket);
  });

  it('emits aggregate-only counts across every network axis', async () => {
    mockAggregates.mockResolvedValue({
      networks: [
        networkRow({
          network: 'mainnet',
          total: 4,
          success: 1,
          failed: 1,
          retrying: 1,
          resyncing: 1,
          syncInProgress: 2,
          stuckCandidates: 1,
          ageNever: 1,
          ageUnderOneHour: 1,
          ageOneToTwentyFourHours: 1,
          ageOverSevenDays: 1,
          fullResyncPending: 2,
          maxFullResyncDrift: 3,
          withSyncError: 2,
        }),
        networkRow({
          network: 'signet',
          total: 2,
          neverSynced: 1,
          otherStatus: 1,
          ageNever: 1,
          ageOneToSevenDays: 1,
          fullResyncPending: 1,
          maxFullResyncDrift: 1,
        }),
      ],
      errorGroups: [
        { failureClass: 'electrum_unavailable', count: 1 },
        { failureClass: 'timeout', count: 1 },
      ],
    });

    const result = await collect();

    expect(result).toMatchObject({
      observation: 'observed',
      unit: 'wallet_rows',
      totalWallets: 6,
      byStatus: {
        success: 1, failed: 1, retrying: 1, resyncing: 1, never_synced: 1, other: 1,
      },
      syncInProgressCount: 2,
      stuckCandidatesCount: 1,
      lastSyncAgeBuckets: {
        never: 2,
        lt_one_hour: 1,
        one_to_twenty_four_hours: 1,
        one_to_seven_days: 1,
        gte_seven_days: 1,
      },
      fullResync: { pendingCount: 3, maxDrift: 'two_to_five' },
      errorClasses: {
        electrum_unavailable: 1,
        node_rpc_unavailable: 0,
        descriptor_policy_missing: 0,
        canonical_evidence_missing: 0,
        lock_contention: 0,
        timeout: 1,
        database_unavailable: 0,
        other: 0,
      },
    });
    const byNetwork = (result as { byNetwork: Record<string, unknown> }).byNetwork;
    expect(Object.keys(byNetwork).sort()).toEqual([
      'mainnet', 'regtest', 'signet', 'testnet3', 'testnet4',
    ]);
    expect(byNetwork.signet).toEqual({
      total: 2,
      byStatus: {
        success: 0, failed: 0, retrying: 0, resyncing: 0, never_synced: 1, other: 1,
      },
      syncInProgressCount: 0,
      stuckCandidatesCount: 0,
      fullResyncPendingCount: 1,
    });
    expect(byNetwork.regtest).toMatchObject({ total: 0 });
    expect(walletSyncSchema.safeParse(result).success).toBe(true);
  });

  it('counts wallets whose error text was truncated by the group bound as unclassified', async () => {
    mockAggregates.mockResolvedValue({
      networks: [networkRow({ network: 'mainnet', total: 9, failed: 9, withSyncError: 9 })],
      errorGroups: [{ failureClass: 'electrum_unavailable', count: 4 }],
    });

    const result = await collect();

    expect(result).toMatchObject({
      errorClasses: expect.objectContaining({ electrum_unavailable: 4, other: 5 }),
    });
  });

  it('folds wallets on an unrecognized network into totals without inventing an axis', async () => {
    mockAggregates.mockResolvedValue({
      networks: [networkRow({ network: 'not-a-network', total: 2, success: 2 })],
      errorGroups: [],
    });

    const result = await collect();

    expect(result).toMatchObject({ totalWallets: 2, byStatus: expect.objectContaining({ success: 2 }) });
    expect((result as { byNetwork: Record<string, { total: number }> }).byNetwork.mainnet.total).toBe(0);
  });

  it('never emits wallet identities, descriptors, addresses or raw error text', async () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    const hash = 'a'.repeat(64);
    mockAggregates.mockResolvedValue({
      networks: [networkRow({
        network: 'mainnet', total: 1, failed: 1, withSyncError: 1,
      })],
      errorGroups: [{ failureClass: 'node_rpc_unavailable', count: 1 }],
    });

    const result = await collect();
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(address);
    expect(serialized).not.toContain(hash);
    expect(serialized).not.toMatch(/(?:walletId|userId|txid|jobId|payload|rawError)/i);
    expect(() => serializePrivacySafeArtifact(result)).not.toThrow();
  });

  it('stays inside the collector size cap at the maximum bounded wallet count', async () => {
    mockAggregates.mockResolvedValue({
      networks: ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'].map((network) =>
        networkRow({
          network,
          total: 5_000_000,
          success: 5_000_000,
          syncInProgress: 5_000_000,
          stuckCandidates: 5_000_000,
          ageOverSevenDays: 5_000_000,
          fullResyncPending: 5_000_000,
          maxFullResyncDrift: 4_000,
          withSyncError: 5_000_000,
        })),
      errorGroups: Array.from({ length: 200 }, () => ({
        failureClass: 'electrum_unavailable',
        count: 12_345,
      })),
    });

    const result = await collect();

    expect(walletSyncSchema.safeParse(result).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(MAX_COLLECTOR_BYTES);
  });

  it('folds an invalid persisted failure class into the bounded other bucket', async () => {
    mockAggregates.mockResolvedValue({
      networks: [networkRow({ withSyncError: 2 })],
      errorGroups: [{ failureClass: 'unexpected_future_value', count: 2 }],
    });

    const result = await collect();

    expect(result).toMatchObject({
      errorClasses: { other: 2 },
    });
  });

  it('reports unavailable instead of misleading zeroes on database failure', async () => {
    mockAggregates.mockImplementation(async () => {
      throw new Error('database unreachable');
    });

    expect(await collect()).toEqual({ observation: 'unavailable' });
  });

  it('reports unavailable when the aggregate shape is not what the schema admits', async () => {
    mockAggregates.mockResolvedValue({ networks: undefined, errorGroups: [] });

    expect(await collect()).toEqual({ observation: 'unavailable' });
  });

  it('rejects identifying or unreviewed fields', () => {
    expect(walletSyncSchema.safeParse({
      observation: 'unavailable',
      walletId: 'wallet-poison',
    }).success).toBe(false);
  });
});
