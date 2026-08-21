/**
 * Co-located with the collector that is its only consumer: the repository exists
 * purely to keep wallet rows out of the support package.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecuteRaw, mockQueryRaw, mockTransaction } = vi.hoisted(() => ({
  mockExecuteRaw: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('../../../../src/models/prisma', () => ({
  default: { $transaction: (...args: unknown[]) => mockTransaction(...args) },
}));

import {
  getWalletSyncAggregates,
} from '../../../../src/repositories/supportWalletSyncDiagnosticsRepository';

/** Reassemble the literal SQL of a tagged-template call, parameters excluded. */
function sqlOf(call: number): string {
  return (mockQueryRaw.mock.calls[call]?.[0] as { strings: string[] }).strings.join('?');
}

describe('support wallet sync diagnostics repository', () => {
  beforeEach(() => {
    mockExecuteRaw.mockReset();
    mockQueryRaw.mockReset();
    mockTransaction.mockReset();
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      $executeRaw: mockExecuteRaw,
      $queryRaw: mockQueryRaw,
    }));
  });

  it('groups wallet sync state in SQL and never selects a wallet row', async () => {
    const networks = [{ network: 'mainnet', total: 3 }];
    const errorGroups = [{ failureClass: 'electrum_unavailable', count: 2 }];
    mockQueryRaw.mockResolvedValueOnce(networks).mockResolvedValueOnce(errorGroups);

    await expect(getWalletSyncAggregates({ staleThresholdMs: 600_000 })).resolves.toEqual({
      networks,
      errorGroups,
    });
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 2_000 });

    const aggregate = sqlOf(0);
    expect(aggregate).toContain('GROUP BY "network"');
    expect(aggregate).toContain('"lastSyncStatus"');
    expect(aggregate).toContain('make_interval');
    expect(aggregate).toContain('"syncStartedAt" IS NULL');
    expect(aggregate).toContain('"syncStartedAt" < NOW()');
    expect(aggregate).toContain('"requestedFullResyncGeneration"');
    expect(aggregate).not.toContain('"descriptor"');
    expect(aggregate).not.toContain('"name"');
    expect(aggregate).not.toContain('SELECT *');

    const errors = sqlOf(1);
    expect(errors).toContain('GROUP BY COALESCE("lastSyncFailureClass", \'other\')');
    expect(errors).not.toContain('GROUP BY "lastSyncError"');
    expect(errors).toContain('LIMIT');
  });

  it('converts the stale threshold to whole seconds for the stuck-candidate cutoff', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await getWalletSyncAggregates({ staleThresholdMs: 90_500 });

    expect(mockQueryRaw.mock.calls[0]?.[0]?.values).toContain(90);
  });

  it('never sends a negative interval when the configured threshold is nonsensical', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await getWalletSyncAggregates({ staleThresholdMs: -1 });

    expect(mockQueryRaw.mock.calls[0]?.[0]?.values).toContain(0);
  });
});
