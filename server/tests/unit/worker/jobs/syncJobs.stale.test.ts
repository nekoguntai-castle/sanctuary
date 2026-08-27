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
  publishLifecycle: vi.fn<(...args: unknown[]) => Promise<void>>(),
  resetIntent: vi.fn(),
}));

vi.mock('../../../../src/services/sync/syncLifecyclePublisher', () => ({
  syncLifecyclePublisher: { publish: staleJobPrismaMocks.publishLifecycle },
}));
vi.mock('../../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: { reset: staleJobPrismaMocks.resetIntent },
}));

const mockIsLocked = vi.hoisted(() => vi.fn<(key: string) => Promise<boolean>>());
const mockReadStaleWalletSchedulePolicy = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/repositories/walletSyncSchedulePolicyRepository', () => ({
  readStaleWalletSchedulePolicy: mockReadStaleWalletSchedulePolicy,
}));

vi.mock('../../../../src/infrastructure/distributedLock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLocked: mockIsLocked,
  withLock: vi.fn(async (key: string, _ttl: number, callback: () => Promise<unknown>) => (
    await mockIsLocked(key)
      ? { success: false }
      : { success: true, result: await callback() }
  )),
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
import { metricsService } from '../../../../src/observability/metrics';

const checkStaleWalletsJob = createCheckStaleWalletsJob();

describe('checkStaleWalletsJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricsService.reset();
    mockReadStaleWalletSchedulePolicy.mockResolvedValue({ mode: 'legacy_enabled' });
    let stateVersion = 0;
    staleJobPrismaMocks.walletUpdate.mockImplementation(async (args: any) => ({
      syncInProgress: false,
      lastSyncedAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      lastSyncFailureClass: null,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
      ...args?.data,
      syncStateVersion: ++stateVersion,
    }));
    staleJobPrismaMocks.resetIntent.mockImplementation(async (walletId: string) => (
      staleJobPrismaMocks.walletUpdate({
        where: { id: walletId },
        data: { syncInProgress: false, syncExecutionOwner: null },
      })
    ));
    mockIsLocked.mockResolvedValue(false);
  });

  it('should have correct configuration', () => {
    expect(checkStaleWalletsJob.name).toBe('check-stale-wallets');
    expect(checkStaleWalletsJob.queue).toBe('sync');
  });

  it('returns no work without touching age-based state after durable retirement', async () => {
    mockReadStaleWalletSchedulePolicy.mockResolvedValue({
      mode: 'forbidden',
      tombstone: {
        version: 1,
        forbiddenAt: '2026-08-22T00:00:00.000Z',
        compatibilityFloor: 2,
      },
    });

    await expect(checkStaleWalletsJob.handler({
      id: 'retained-stale-parent',
      data: { version: 1 },
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as Job<any>)).resolves.toEqual(expect.objectContaining({
      version: 1,
      staleWalletIds: [],
      queued: 0,
    }));
    expect(staleJobPrismaMocks.walletFindMany).not.toHaveBeenCalled();
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
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date('2026-04-08T05:07:00Z'),
        syncStateVersion: 4,
      },
      {
        id: 'wallet-stuck-2',
        name: 'Stuck Wallet 2',
        syncExecutionOwner: 'inline',
        syncStartedAt: new Date('2026-04-08T05:08:00Z'),
        syncStateVersion: 9,
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

    expect(staleJobPrismaMocks.resetIntent).toHaveBeenNthCalledWith(1, 'wallet-stuck-1', {
      syncStateVersion: 4,
      syncExecutionOwner: 'worker',
      syncStartedAt: stuckWallets[0].syncStartedAt,
    });
    expect(staleJobPrismaMocks.resetIntent).toHaveBeenNthCalledWith(2, 'wallet-stuck-2', {
      syncStateVersion: 9,
      syncExecutionOwner: 'inline',
      syncStartedAt: stuckWallets[1].syncStartedAt,
    });

    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-stuck-1' },
      data: expect.objectContaining({
        syncInProgress: false,
        syncExecutionOwner: null,
      }),
    });
    expect(staleJobPrismaMocks.publishLifecycle).toHaveBeenCalledTimes(2);
    expect(staleJobPrismaMocks.publishLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'wallet-stuck-1',
        transition: 'cleared',
        state: expect.objectContaining({ syncStateVersion: 1 }),
      }),
    );
    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-stuck-2' },
      data: expect.objectContaining({
        syncInProgress: false,
        syncExecutionOwner: null,
      }),
    });
    await expect(metricsService.getMetrics()).resolves.toContain(
      'sanctuary_wallet_sync_cleanup_total{outcome="flag_cleared"} 2',
    );
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
    await expect(metricsService.getMetrics()).resolves.toContain(
      'sanctuary_wallet_sync_cleanup_total{outcome="lock_present_deferred"} 1',
    );
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
    await expect(metricsService.getMetrics()).resolves.toContain(
      'sanctuary_wallet_sync_cleanup_total{outcome="error"} 1',
    );
  });

  it('records a fenced no-change decision without reporting a clear', async () => {
    staleJobPrismaMocks.walletFindMany
      .mockResolvedValueOnce([{
        id: 'wallet-fence-moved',
        name: 'Moved',
        syncExecutionOwner: 'worker',
        syncStartedAt: new Date('2026-04-08T05:07:00Z'),
        syncStateVersion: 4,
      }])
      .mockResolvedValueOnce([]);
    staleJobPrismaMocks.resetIntent.mockResolvedValueOnce(null);

    await checkStaleWalletsJob.handler({
      id: 'job-fence-moved',
      data: {},
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job);

    expect(staleJobPrismaMocks.publishLifecycle).not.toHaveBeenCalled();
    await expect(metricsService.getMetrics()).resolves.toContain(
      'sanctuary_wallet_sync_cleanup_total{outcome="no_change"} 1',
    );
  });

  it('does not count an empty reconciliation scan as a cleanup decision', async () => {
    staleJobPrismaMocks.walletFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await checkStaleWalletsJob.handler({
      id: 'job-empty-reconciliation',
      data: {},
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as unknown as Job);

    expect(await metricsService.getMetrics()).not.toContain('sanctuary_wallet_sync_cleanup_total{');
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
        select: {
          id: true,
          name: true,
          syncExecutionOwner: true,
          syncStartedAt: true,
          syncStateVersion: true,
        },
      }),
    );
  });
});
