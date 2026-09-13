import { vi } from 'vitest';
/**
 * Sync API - Destructive Route Access Control Tests
 *
 * Regression coverage for `sync-routes-view-role-triggers-destructive-resync`:
 * the full-resync routes previously relied on any-access (`findByIdWithAccess`
 * / `findByNetworkWithSyncStatus`, both role-blind), so a viewer on a shared
 * wallet could trigger a destructive resync. Split out of sync.test.ts to
 * keep both files under the large-files line cap.
 */

import express from 'express';
import request from 'supertest';
import type { WalletLogEntry } from '../../../src/websocket/notifications';

const {
  mockWalletRepository,
  mockTransactionRepository,
  mockAddressRepository,
  mockSyncService,
  mockWalletLogBufferGet,
  mockSyncIntentAdmission,
  mockEnqueueWalletSyncBatch,
  mockEnqueueFullResyncBatch,
  mockGetUserWalletRole,
} = vi.hoisted(() => ({
  mockWalletRepository: {
    findByIdWithAccess: vi.fn(),
    findByUserId: vi.fn(),
    updateSyncState: vi.fn(),
    getIdsByNetwork: vi.fn(),
    findByNetworkWithSyncStatus: vi.fn(),
    findNetworkWalletIdsWithEditAccess: vi.fn(),
    findAccessibleWithSelect: vi.fn().mockResolvedValue([]),
    resetSyncState: vi.fn(),
  },
  mockTransactionRepository: {
    deleteByWalletId: vi.fn(),
  },
  mockAddressRepository: {
    findByIdWithAccess: vi.fn(),
    resetUsedFlags: vi.fn(),
  },
  mockSyncService: {
    syncNow: vi.fn(),
    queueSync: vi.fn(),
    getSyncStatus: vi.fn(),
    queueUserWallets: vi.fn(),
  },
  mockWalletLogBufferGet: vi.fn<() => WalletLogEntry[]>(() => []),
  mockSyncIntentAdmission: {
    request: vi.fn(),
    requestFullResync: vi.fn(),
    reset: vi.fn(),
  },
  mockEnqueueWalletSyncBatch: vi.fn(),
  mockEnqueueFullResyncBatch: vi.fn(),
  mockGetUserWalletRole: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  walletRepository: mockWalletRepository,
  transactionRepository: mockTransactionRepository,
  addressRepository: mockAddressRepository,
}));

// Mock the wallet-role lookup used by the requireWalletAccess('edit') route
// middleware on the destructive reset/resync routes.
vi.mock('../../../src/services/wallet', () => ({
  getUserWalletRole: mockGetUserWalletRole,
}));

vi.mock('../../../src/services/syncService', () => ({
  getSyncService: () => mockSyncService,
}));

vi.mock('../../../src/services/sync/syncService', () => ({
  getSyncService: () => mockSyncService,
}));

vi.mock('../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: mockSyncIntentAdmission,
}));

vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  syncWallet: vi.fn(),
  updateTransactionConfirmations: vi.fn(),
}));

vi.mock('../../../src/services/workerSyncQueue', () => ({
  enqueueWalletSyncBatch: mockEnqueueWalletSyncBatch,
  enqueueFullResyncBatch: mockEnqueueFullResyncBatch,
}));

vi.mock('../../../src/config', () => ({
  getConfig: () => ({
    sync: {
      syncStaggerDelayMs: 2000,
    },
  }),
}));

// Mock authentication middleware
vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as any).user = { userId: 'test-user-id', isAdmin: false };
    next();
  },
}));

// Mock rate limit middleware - pass through all requests
vi.mock('../../../src/middleware/rateLimit', () => ({
  rateLimitByUser: () => (req: express.Request, res: express.Response, next: express.NextFunction) => next(),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock wallet log buffer
vi.mock('../../../src/services/walletLogBuffer', () => ({
  walletLogBuffer: {
    get: mockWalletLogBufferGet,
  },
}));

// Mock requestContext (needed by errorHandler and auth middleware)
vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: () => 'test-request-id',
    setUser: vi.fn(),
    get: () => undefined,
    run: (_ctx: unknown, fn: () => unknown) => fn(),
    getUserId: () => undefined,
    getTraceId: () => undefined,
    setTraceId: vi.fn(),
    getDuration: () => 0,
    generateRequestId: () => 'test-request-id',
  },
}));

// Import after mocks
import syncRouter from '../../../src/api/sync';
import { errorHandler } from '../../../src/errors/errorHandler';

describe('Sync API - Destructive Route Access Control', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/sync', syncRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUserWalletRole.mockResolvedValue('owner');
    mockWalletRepository.findNetworkWalletIdsWithEditAccess.mockResolvedValue([
      'wallet-1', 'wallet-2', 'wallet-3',
    ]);
    mockSyncIntentAdmission.request.mockResolvedValue({
      status: 'requested',
      generation: 7,
      wakeup: 'enqueued',
    });
    mockSyncIntentAdmission.requestFullResync.mockResolvedValue({
      status: 'requested',
      generation: 8,
      incrementalGeneration: 8,
      wakeup: 'enqueued',
    });
    mockSyncIntentAdmission.reset.mockResolvedValue({
      id: 'wallet-1',
      syncInProgress: false,
      lastSyncedAt: null,
      lastSyncedBlockHeight: null,
      lastSyncStatus: null,
      lastSyncError: null,
      lastSyncFailureClass: null,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncActionRequiredAt: null,
      syncStartedAt: null,
      syncStateVersion: 2,
    });
  });

  it('POST /sync/reset/:walletId returns 403 for a viewer-role user', async () => {
    mockGetUserWalletRole.mockResolvedValue('viewer');

    const response = await request(app)
      .post('/sync/reset/wallet-1')
      .send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'Forbidden',
      message: 'You do not have permission to access this wallet',
    });
    expect(mockSyncIntentAdmission.reset).not.toHaveBeenCalled();
  });

  it('POST /sync/reset/:walletId returns 403 for a non-member user (no role)', async () => {
    // getUserWalletRole resolves null for a user with no share and no group
    // membership - same "no access" outcome the middleware gives a viewer,
    // per requireWalletAccess('edit')'s existing role-blind-to-403 contract.
    mockGetUserWalletRole.mockResolvedValue(null);

    const response = await request(app)
      .post('/sync/reset/wallet-1')
      .send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'Forbidden',
      message: 'You do not have permission to access this wallet',
    });
    expect(mockSyncIntentAdmission.reset).not.toHaveBeenCalled();
  });

  it.each(['signer', 'owner'])('POST /sync/reset/:walletId succeeds for %s role', async role => {
    mockGetUserWalletRole.mockResolvedValue(role);
    mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });

    const response = await request(app)
      .post('/sync/reset/wallet-1')
      .send({});

    expect(response.status).toBe(200);
  });

  it('POST /sync/resync/:walletId returns 403 for a viewer-role user', async () => {
    mockGetUserWalletRole.mockResolvedValue('viewer');

    const response = await request(app)
      .post('/sync/resync/wallet-1')
      .send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'Forbidden',
      message: 'You do not have permission to access this wallet',
    });
    expect(mockSyncIntentAdmission.requestFullResync).not.toHaveBeenCalled();
  });

  it('POST /sync/resync/:walletId returns 403 for a non-member user (no role)', async () => {
    mockGetUserWalletRole.mockResolvedValue(null);

    const response = await request(app)
      .post('/sync/resync/wallet-1')
      .send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'Forbidden',
      message: 'You do not have permission to access this wallet',
    });
    expect(mockSyncIntentAdmission.requestFullResync).not.toHaveBeenCalled();
  });

  it.each(['signer', 'owner'])('POST /sync/resync/:walletId succeeds for %s role', async role => {
    mockGetUserWalletRole.mockResolvedValue(role);
    mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });

    const response = await request(app)
      .post('/sync/resync/wallet-1')
      .send({});

    expect(response.status).toBe(200);
  });

  it('POST /sync/wallet/:walletId succeeds for a viewer-role user (non-destructive trigger)', async () => {
    mockGetUserWalletRole.mockResolvedValue('viewer');
    mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });

    const response = await request(app)
      .post('/sync/wallet/wallet-1')
      .send({});

    expect(response.status).toBe(200);
  });

  it('POST /sync/queue/:walletId succeeds for a viewer-role user (non-destructive trigger)', async () => {
    mockGetUserWalletRole.mockResolvedValue('viewer');
    mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });

    const response = await request(app)
      .post('/sync/queue/wallet-1')
      .send({});

    expect(response.status).toBe(200);
  });

  it('excludes a viewer-only wallet from a network resync while admitting an edit-or-above wallet', async () => {
    mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
      { id: 'wallet-1', syncInProgress: false },
      { id: 'wallet-2', syncInProgress: false },
    ]);
    // Only wallet-1 grants the requesting user edit-or-above access;
    // wallet-2 is view-only for this user.
    mockWalletRepository.findNetworkWalletIdsWithEditAccess.mockResolvedValue(['wallet-1']);

    const response = await request(app)
      .post('/sync/network/mainnet/resync')
      .set('X-Confirm-Resync', 'true')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.walletIds).toEqual(['wallet-1']);
    expect(response.body.excludedWallets).toEqual([
      { walletId: 'wallet-2', reason: 'edit_access_required' },
    ]);
    expect(mockSyncIntentAdmission.requestFullResync).toHaveBeenCalledTimes(1);
    expect(mockSyncIntentAdmission.requestFullResync).toHaveBeenCalledWith('wallet-1', {
      reason: 'manual-network-resync:mainnet',
    });
  });
});
