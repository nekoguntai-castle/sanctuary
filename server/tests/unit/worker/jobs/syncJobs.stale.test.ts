/**
 * Stale-wallet worker job contracts.
 *
 * Kept separate from executed-attempt lifecycle tests because stale recovery
 * has its own distributed-lock authority and query semantics.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

const staleJobPrismaMocks = vi.hoisted(() => ({
  walletFindMany: vi.fn<() => Promise<unknown[]>>(),
  walletUpdate: vi.fn<(args?: unknown) => Promise<unknown>>(),
}));

const mockIsLocked = vi.hoisted(() => vi.fn<(key: string) => Promise<boolean>>());
const mockEnqueueFullResync = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/infrastructure/distributedLock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLocked: mockIsLocked,
}));

vi.mock('../../../../src/models/prisma', () => ({
  default: {
    wallet: {
      findMany: staleJobPrismaMocks.walletFindMany,
      update: staleJobPrismaMocks.walletUpdate,
    },
  },
}));

vi.mock('../../../../src/config', () => ({
  getConfig: vi.fn(() => ({
    sync: {
      staleThresholdMs: 600000,
      staleBatchSize: 75,
      maxConcurrentSyncs: 5,
      maxSyncDurationMs: 120000,
      syncStaggerDelayMs: 2000,
    },
    bitcoin: { network: 'mainnet' },
  })),
}));

vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  getCachedBlockHeight: vi.fn().mockReturnValue(100000),
  setCachedBlockHeight: vi.fn(),
  assertChainReachable: vi.fn().mockResolvedValue(100000),
  syncWallet: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/sync/confirmations', () => ({
  updateTransactionConfirmations: vi.fn().mockResolvedValue([]),
  populateMissingTransactionFields: vi.fn().mockResolvedValue(undefined),
}));

import prisma from '../../../../src/models/prisma';
import { createCheckStaleWalletsJob } from '../../../../src/worker/jobs/syncJobs';

const checkStaleWalletsJob = createCheckStaleWalletsJob({
  enqueueFullResyncBatch: mockEnqueueFullResync,
});

describe('checkStaleWalletsJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staleJobPrismaMocks.walletUpdate.mockResolvedValue({});
    mockIsLocked.mockResolvedValue(false);
    mockEnqueueFullResync.mockResolvedValue({
      acceptedWalletIds: [],
      deduplicatedWalletIds: [],
      indeterminateWallets: [],
    });
  });

  it('should have correct configuration', () => {
    expect(checkStaleWalletsJob.name).toBe('check-stale-wallets');
    expect(checkStaleWalletsJob.queue).toBe('sync');
  });

  it('rejects an unsupported live command version', async () => {
    const job = {
      data: { version: 2 },
    } as unknown as Job;

    await expect(checkStaleWalletsJob.handler(job)).rejects.toThrow(
      'Unsupported or invalid check-stale-wallets job payload',
    );
    expect(staleJobPrismaMocks.walletFindMany).not.toHaveBeenCalled();
  });

  it('should find stale wallets', async () => {
    const staleWallets = [
      { id: 'wallet-1', name: 'Wallet 1', lastSyncedAt: null },
      { id: 'wallet-2', name: 'Wallet 2', lastSyncedAt: new Date('2020-01-01') },
    ];

    staleJobPrismaMocks.walletFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(staleWallets);

    const mockJob = {
      id: 'job-1',
      data: { version: 1 },
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job;

    const result = await checkStaleWalletsJob.handler(mockJob);

    expect(result.staleWalletIds).toEqual(['wallet-1', 'wallet-2']);
    expect(result.queued).toBe(2);
    expect(result.version).toBe(1);
  });

  it('should return empty array when no stale wallets', async () => {
    vi.mocked(prisma.wallet.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const mockJob = {
      id: 'job-1',
      data: {},
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job;

    const result = await checkStaleWalletsJob.handler(mockJob);

    expect(result.staleWalletIds).toEqual([]);
    expect(result.queued).toBe(0);
    expect(result.version).toBe(1);
  });

  it('should limit results to configured stale batch size by default', async () => {
    vi.mocked(prisma.wallet.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const mockJob = {
      id: 'job-1',
      data: {},
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job;

    await checkStaleWalletsJob.handler(mockJob);

    expect(prisma.wallet.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ take: 75 }),
    );
  });

  it('should use a per-job maxWallets override when provided', async () => {
    vi.mocked(prisma.wallet.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const mockJob = {
      id: 'job-override',
      data: { maxWallets: 12 },
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job;

    await checkStaleWalletsJob.handler(mockJob);

    expect(prisma.wallet.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ take: 12 }),
    );
  });

  it('should use custom stale threshold if provided', async () => {
    vi.mocked(prisma.wallet.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const mockJob = {
      id: 'job-1',
      data: { staleThresholdMs: 300000 },
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job;

    await checkStaleWalletsJob.handler(mockJob);

    expect(prisma.wallet.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { lastSyncedAt: null },
            { lastSyncedAt: { lt: expect.any(Date) } },
          ]),
        }),
      }),
    );
  });

  it('should reset stuck syncInProgress flags for wallets exceeding maxSyncDurationMs', async () => {
    const stuckWallets = [
      {
        id: 'wallet-stuck-1',
        name: 'Stuck Wallet 1',
        syncStartedAt: new Date('2026-04-08T05:07:00Z'),
      },
      {
        id: 'wallet-stuck-2',
        name: 'Stuck Wallet 2',
        syncStartedAt: new Date('2026-04-08T05:08:00Z'),
      },
    ];

    staleJobPrismaMocks.walletFindMany
      .mockResolvedValueOnce(stuckWallets)
      .mockResolvedValueOnce([]);

    const mockJob = {
      id: 'job-stuck-reset',
      data: {},
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job;

    await checkStaleWalletsJob.handler(mockJob);

    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-stuck-1' },
      data: expect.objectContaining({
        syncInProgress: false,
        syncExecutionOwner: null,
      }),
    });
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-stuck-2' },
      data: expect.objectContaining({
        syncInProgress: false,
        syncExecutionOwner: null,
      }),
    });
  });

  it('should leave the flag set while the wallet sync lock is still held', async () => {
    vi.mocked(prisma.wallet.findMany)
      .mockResolvedValueOnce([
        { id: 'wallet-resyncing', name: 'Resyncing', lastSyncedAt: null },
      ] as never)
      .mockResolvedValueOnce([]);
    mockIsLocked.mockResolvedValue(true);

    const mockJob = {
      id: 'job-live-resync',
      data: {},
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job;

    await checkStaleWalletsJob.handler(mockJob);

    expect(mockIsLocked).toHaveBeenCalledWith('sync:wallet:wallet-resyncing');
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('should leave the flag set when the lock authority cannot be probed', async () => {
    vi.mocked(prisma.wallet.findMany)
      .mockResolvedValueOnce([
        { id: 'wallet-unknown', name: 'Unknown', lastSyncedAt: null },
      ] as never)
      .mockResolvedValueOnce([]);
    mockIsLocked.mockRejectedValue(new Error('redis unavailable'));

    const mockJob = {
      id: 'job-probe-failure',
      data: {},
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job;

    await checkStaleWalletsJob.handler(mockJob);

    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('should query stuck wallets using maxSyncDurationMs cutoff', async () => {
    vi.mocked(prisma.wallet.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const mockJob = {
      id: 'job-cutoff-check',
      data: {},
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job;

    await checkStaleWalletsJob.handler(mockJob);

    expect(prisma.wallet.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          syncInProgress: true,
          OR: [
            { syncStartedAt: { lt: expect.any(Date) } },
            { syncStartedAt: null },
          ],
        },
        select: { id: true, name: true, syncStartedAt: true },
      }),
    );
  });
});
