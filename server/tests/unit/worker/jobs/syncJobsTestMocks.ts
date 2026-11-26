import { vi } from 'vitest';

const syncJobPrismaMocks = vi.hoisted(() => ({
  walletFindUnique: vi.fn<(args?: unknown) => Promise<unknown>>(),
  walletFindMany: vi.fn<() => Promise<unknown[]>>(),
  walletUpdate: vi.fn<(args?: unknown) => Promise<unknown>>(),
  publishLifecycle: vi.fn<(...args: unknown[]) => Promise<void>>(),
  broadcastWalletLog: vi.fn(),
}));
const syncIntentMocks = vi.hoisted(() => ({
  bridgeRetained: vi.fn(),
  claimFresh: vi.fn(),
  reclaimExpired: vi.fn(),
  complete: vi.fn(),
  releaseForRetry: vi.fn(),
  releaseAsActionRequired: vi.fn(),
  wake: vi.fn(),
  reset: vi.fn(),
}));
const mockEnrollWalletSubscriptions = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/services/sync/syncLifecyclePublisher', () => ({
  syncLifecyclePublisher: { publish: syncJobPrismaMocks.publishLifecycle },
}));

vi.mock('../../../../src/websocket/notifications/broadcasts', () => ({
  broadcastWalletLog: syncJobPrismaMocks.broadcastWalletLog,
}));

vi.mock('../../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: syncIntentMocks,
}));

// The stale reaper probes each wallet's sync lock before force-clearing its
// flag, so the lock authority has to answer in unit tests.
const mockIsLocked = vi.hoisted(() => vi.fn<(key: string) => Promise<boolean>>());


vi.mock('../../../../src/infrastructure/distributedLock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLocked: mockIsLocked,
}));

// Mock prisma
vi.mock('../../../../src/models/prisma', () => ({
  default: (() => {
    const client: any = {
    wallet: {
      findMany: syncJobPrismaMocks.walletFindMany,
      findUnique: syncJobPrismaMocks.walletFindUnique,
      update: syncJobPrismaMocks.walletUpdate,
    },
    address: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    transaction: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{
      requestedFullResyncGeneration: 1,
      preparedFullResyncGeneration: 1,
      processedFullResyncGeneration: 0,
      lastSyncedAt: null,
      lastSyncStatus: 'resyncing',
      syncInProgress: true,
    }]),
    };
    client.$transaction = vi.fn(async (callback: any) => callback(client));
    return client;
  })(),
}));

// Mock config
vi.mock('../../../../src/config', () => ({
  getConfig: vi.fn(() => ({
    sync: {
      staleThresholdMs: 600000, // 10 minutes
      maxConcurrentSyncs: 5,
      maxSyncDurationMs: 120000,
    },
    bitcoin: {
      network: 'mainnet',
    },
  })),
}));

// Mock blockchain (includes syncWallet)
vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  getCachedBlockHeight: vi.fn().mockReturnValue(100000),
  setCachedBlockHeight: vi.fn(),
  assertChainReachable: vi.fn().mockResolvedValue(100000),
  syncWallet: vi.fn(),
}));

// Mock confirmations
vi.mock('../../../../src/services/bitcoin/sync/confirmations', () => ({
  updateTransactionConfirmations: vi.fn().mockResolvedValue([]),
  populateMissingTransactionFields: vi.fn().mockResolvedValue(undefined),
}));


export { syncJobPrismaMocks, syncIntentMocks, mockEnrollWalletSubscriptions, mockIsLocked };
