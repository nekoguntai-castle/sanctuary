import { vi } from 'vitest';
/**
 * Sync API Tests
 *
 * Tests for network-based wallet synchronization endpoints.
 */

import express from 'express';
import request from 'supertest';
import type { WalletLogEntry } from '../../../src/websocket/notifications';

// Hoist mock variables for use in vi.mock() factories
const {
  mockWalletRepository,
  mockTransactionRepository,
  mockAddressRepository,
  mockSyncService,
  mockWalletLogBufferGet,
  mockSyncIntentAdmission,
  mockEnqueueWalletSyncBatch,
  mockEnqueueFullResyncBatch,
} = vi.hoisted(() => ({
  mockWalletRepository: {
    findByIdWithAccess: vi.fn(),
    findByUserId: vi.fn(),
    updateSyncState: vi.fn(),
    getIdsByNetwork: vi.fn(),
    findByNetworkWithSyncStatus: vi.fn(),
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
}));

vi.mock('../../../src/repositories', () => ({
  walletRepository: mockWalletRepository,
  transactionRepository: mockTransactionRepository,
  addressRepository: mockAddressRepository,
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

describe('Sync API - Network Endpoints', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/sync', syncRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncService.getSyncStatus.mockResolvedValue({ queuePosition: 1, syncInProgress: false });
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
    mockEnqueueWalletSyncBatch.mockImplementation(async (walletIds: string[]) => walletIds.length);
    mockEnqueueFullResyncBatch.mockImplementation(async (walletIds: string[]) => ({
      outcomes: walletIds.map(walletId => ({ walletId, status: 'accepted' })),
      acceptedWalletIds: walletIds,
      deduplicatedWalletIds: [],
      rejectedWallets: [],
      indeterminateWallets: [],
    }));
  });

  describe('wallet-level endpoints', () => {
    it('POST /sync/wallet/:walletId durably requests asynchronous sync', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });

      const response = await request(app)
        .post('/sync/wallet/wallet-1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        status: 'requested',
        generation: 7,
        wakeup: 'enqueued',
        message: 'Wallet sync requested',
      });
      expect(mockWalletRepository.findByIdWithAccess).toHaveBeenCalledWith('wallet-1', 'test-user-id');
      expect(mockSyncIntentAdmission.request).toHaveBeenCalledWith('wallet-1', { mode: 'explicit_reopen' });
      expect(mockSyncService.syncNow).not.toHaveBeenCalled();
      expect(mockEnqueueWalletSyncBatch).not.toHaveBeenCalled();
    });

    it('POST /sync/wallet/:walletId returns 404 when wallet missing', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue(null);

      const response = await request(app)
        .post('/sync/wallet/wallet-missing')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it.each([
      ['blocked', 'Wallet sync is temporarily unavailable'],
      ['generation_exhausted', 'Wallet sync generation limit reached'],
    ])('POST /sync/wallet/:walletId maps %s admission to 503', async (status, message) => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncIntentAdmission.request.mockResolvedValue({ status });

      const response = await request(app)
        .post('/sync/wallet/wallet-1')
        .send({});

      expect(response.status).toBe(503);
      expect(response.body.message).toBe(message);
    });

    it('POST /sync/queue/:walletId merges through canonical admission', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncIntentAdmission.request.mockResolvedValue({
        status: 'merged',
        generation: 12,
        wakeup: 'already_present',
      });

      const response = await request(app)
        .post('/sync/queue/wallet-1')
        .send({ priority: 'high' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        status: 'merged',
        generation: 12,
        wakeup: 'already_present',
        message: 'Wallet sync merged with existing work',
      });
      expect(mockSyncIntentAdmission.request).toHaveBeenCalledWith('wallet-1', { mode: 'explicit_reopen' });
      expect(mockSyncService.queueSync).not.toHaveBeenCalled();
      expect(mockEnqueueWalletSyncBatch).not.toHaveBeenCalled();
    });

    it('POST /sync/queue/:walletId defaults omitted bodies to normal priority', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });

      const response = await request(app)
        .post('/sync/queue/wallet-1');

      expect(response.status).toBe(200);
      expect(mockSyncIntentAdmission.request).toHaveBeenCalledWith('wallet-1', { mode: 'explicit_reopen' });
      expect(mockSyncService.queueSync).not.toHaveBeenCalled();
    });

    it.each([
      ['invalid priority', { priority: 'urgent' }],
      ['null priority', { priority: null }],
      ['extra fields', { priority: 'normal', unexpected: true }],
    ])('POST /sync/queue/:walletId rejects %s', async (_case, body) => {
      const response = await request(app)
        .post('/sync/queue/wallet-1')
        .send(body);

      expect(response.status).toBe(400);
      expect(mockSyncService.queueSync).not.toHaveBeenCalled();
    });

    it('POST /sync/queue/:walletId rejects non-object JSON bodies', async () => {
      const response = await request(app)
        .post('/sync/queue/wallet-1')
        .send([]);

      expect(response.status).toBe(400);
      expect(mockSyncService.queueSync).not.toHaveBeenCalled();
    });

    it('POST /sync/queue/:walletId returns 404 when wallet missing', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue(null);

      const response = await request(app)
        .post('/sync/queue/wallet-missing')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('POST /sync/queue/:walletId returns 500 on queue failures', async () => {
      mockWalletRepository.findByIdWithAccess.mockRejectedValue(new Error('queue exploded'));

      const response = await request(app)
        .post('/sync/queue/wallet-1')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('GET /sync/status/:walletId returns wallet sync state', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncService.getSyncStatus.mockResolvedValue({
        queuePosition: null,
        syncInProgress: false,
        requestedIncrementalSyncGeneration: 3,
        processedIncrementalSyncGeneration: 2,
      });

      const response = await request(app)
        .get('/sync/status/wallet-1');

      expect(response.status).toBe(200);
      expect(response.body.queuePosition).toBeNull();
      expect(response.body.syncInProgress).toBe(false);
      expect(response.body.requestedIncrementalSyncGeneration).toBe(3);
      expect(response.body.processedIncrementalSyncGeneration).toBe(2);
    });

    it('GET /sync/status/:walletId returns 404 when wallet missing', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue(null);

      const response = await request(app)
        .get('/sync/status/wallet-missing');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('GET /sync/status/:walletId returns 500 on status errors', async () => {
      mockWalletRepository.findByIdWithAccess.mockRejectedValue(new Error('status failed'));

      const response = await request(app)
        .get('/sync/status/wallet-1');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('GET /sync/logs/:walletId returns buffered logs', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockWalletLogBufferGet.mockReturnValueOnce([
        {
          id: 'log-1',
          timestamp: '2024-01-01T00:00:00.000Z',
          level: 'info',
          module: 'sync',
          message: 'sync started',
        },
      ]);

      const response = await request(app)
        .get('/sync/logs/wallet-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        logs: [{
          id: 'log-1',
          timestamp: '2024-01-01T00:00:00.000Z',
          level: 'info',
          module: 'sync',
          message: 'sync started',
        }],
      });
      expect(mockWalletLogBufferGet).toHaveBeenCalledWith('wallet-1');
    });

    it('GET /sync/logs/:walletId returns 404 when wallet missing', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue(null);

      const response = await request(app)
        .get('/sync/logs/wallet-missing');

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('GET /sync/logs/:walletId returns 500 on log retrieval errors', async () => {
      mockWalletRepository.findByIdWithAccess.mockRejectedValue(new Error('logs failed'));

      const response = await request(app)
        .get('/sync/logs/wallet-1');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('POST /sync/user requests and merges every wallet through admission', async () => {
      mockWalletRepository.findByUserId.mockResolvedValue([
        { id: 'wallet-1' },
        { id: 'wallet-2' },
      ]);
      mockSyncIntentAdmission.request
        .mockResolvedValueOnce({ status: 'requested', generation: 3, wakeup: 'enqueued' })
        .mockResolvedValueOnce({ status: 'merged', generation: 4, wakeup: 'already_present' });

      const response = await request(app)
        .post('/sync/user')
        .send({ priority: 'low' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        requested: 1,
        merged: 1,
        rejected: 0,
        indeterminate: 0,
        outcomes: [
          { walletId: 'wallet-1', status: 'requested', generation: 3, wakeup: 'enqueued' },
          { walletId: 'wallet-2', status: 'merged', generation: 4, wakeup: 'already_present' },
        ],
      });
      expect(mockWalletRepository.findByUserId).toHaveBeenCalledWith('test-user-id');
      expect(mockSyncService.queueUserWallets).not.toHaveBeenCalled();
      expect(mockEnqueueWalletSyncBatch).not.toHaveBeenCalled();
    });

    it('POST /sync/user reports a blocked wallet without hiding batch outcomes', async () => {
      mockWalletRepository.findByUserId.mockResolvedValue([{ id: 'wallet-1' }]);
      mockSyncIntentAdmission.request.mockResolvedValue({ status: 'blocked' });

      const response = await request(app)
        .post('/sync/user')
        .send({ priority: 'normal' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        requested: 0,
        merged: 0,
        rejected: 1,
        indeterminate: 0,
        outcomes: [{ walletId: 'wallet-1', status: 'rejected', reason: 'blocked' }],
      });
    });

    it('POST /sync/user preserves an unknown admission result as indeterminate', async () => {
      mockWalletRepository.findByUserId.mockResolvedValue([{ id: 'wallet-1' }]);
      mockSyncIntentAdmission.request.mockRejectedValue(new Error('commit acknowledgement lost'));

      const response = await request(app).post('/sync/user').send({ priority: 'normal' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        requested: 0,
        merged: 0,
        rejected: 0,
        indeterminate: 1,
        outcomes: [{
          walletId: 'wallet-1', status: 'indeterminate', reason: 'admission_error',
        }],
      });
    });

    it('POST /sync/reset/:walletId resets stuck state', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });

      const response = await request(app)
        .post('/sync/reset/wallet-1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockSyncIntentAdmission.reset).toHaveBeenCalledWith('wallet-1');
    });

    it('POST /sync/reset/:walletId returns 404 when wallet missing', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue(null);

      const response = await request(app)
        .post('/sync/reset/wallet-missing')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('POST /sync/reset/:walletId returns 500 on reset errors', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncIntentAdmission.reset.mockRejectedValue(new Error('reset failed'));

      const response = await request(app)
        .post('/sync/reset/wallet-1')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('POST /sync/resync/:walletId defers reset to an exclusively owned worker job', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1', syncInProgress: true });

      const response = await request(app)
        .post('/sync/resync/wallet-1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Full resync queued. Wallet data will be reset after exclusive sync ownership is acquired.',
        status: 'accepted',
        walletId: 'wallet-1',
        generation: 8,
        incrementalGeneration: 8,
        wakeup: 'enqueued',
      });
      expect(mockSyncIntentAdmission.requestFullResync).toHaveBeenCalledWith('wallet-1', {
        reason: 'manual-wallet-resync:test-user-id',
      });
      expect(mockEnqueueFullResyncBatch).not.toHaveBeenCalled();
      expect(mockTransactionRepository.deleteByWalletId).not.toHaveBeenCalled();
    });

    it('POST /sync/resync/:walletId reports durable intent when queue wakeup is unavailable', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncIntentAdmission.requestFullResync.mockResolvedValue({
        status: 'requested',
        generation: 9,
        incrementalGeneration: 12,
        wakeup: 'unavailable',
      });

      const response = await request(app).post('/sync/resync/wallet-1').send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'accepted',
        generation: 9,
        incrementalGeneration: 12,
        wakeup: 'unavailable',
        message: 'Full resync requested durably; recovery will enqueue it when queue authority is available.',
      });
    });

    it('POST /sync/resync/:walletId returns 404 when wallet missing', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue(null);

      const response = await request(app)
        .post('/sync/resync/wallet-missing')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('POST /sync/resync/:walletId returns 404 when admission loses the wallet', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncIntentAdmission.requestFullResync.mockResolvedValue({ status: 'not_found' });

      const response = await request(app).post('/sync/resync/wallet-1').send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it.each([
      ['blocked', 'Wallet sync is temporarily unavailable'],
      ['generation_exhausted', 'Wallet full-resync generation limit reached'],
    ])('POST /sync/resync/:walletId maps %s admission to 503', async (status, message) => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1', syncInProgress: false });
      mockSyncIntentAdmission.requestFullResync.mockResolvedValue({ status });

      const response = await request(app)
        .post('/sync/resync/wallet-1')
        .send({});

      expect(response.status).toBe(503);
      expect(response.body.message).toBe(message);
    });

    it('POST /sync/resync/:walletId reports an already retained intention', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncIntentAdmission.requestFullResync.mockResolvedValue({
        status: 'merged',
        generation: 8,
        incrementalGeneration: 8,
        wakeup: 'enqueued',
      });

      const response = await request(app)
        .post('/sync/resync/wallet-1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'deduplicated',
        message: 'A full resync is already queued for this wallet.',
      });
    });

    it('reports unknown network full-resync admission without calling it rejected', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
      ]);
      mockSyncIntentAdmission.requestFullResync
        .mockRejectedValue(new Error('commit acknowledgement lost'));

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        queued: 0,
        rejectedWallets: [],
        indeterminateWallets: [{ walletId: 'wallet-1', reason: 'queue_state_unknown' }],
      });
    });
  });

  describe('POST /sync/network/:network', () => {
    it('should request and merge all mainnet wallets through admission', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['wallet-1', 'wallet-2']);
      mockSyncIntentAdmission.request
        .mockResolvedValueOnce({ status: 'requested', generation: 2, wakeup: 'enqueued' })
        .mockResolvedValueOnce({ status: 'merged', generation: 3, wakeup: 'already_present' });

      const response = await request(app)
        .post('/sync/network/mainnet')
        .send({ priority: 'normal' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        requested: 1,
        merged: 1,
        rejected: 0,
        indeterminate: 0,
        walletIds: ['wallet-1', 'wallet-2'],
        outcomes: [
          { walletId: 'wallet-1', status: 'requested', generation: 2, wakeup: 'enqueued' },
          { walletId: 'wallet-2', status: 'merged', generation: 3, wakeup: 'already_present' },
        ],
      });
      expect(mockEnqueueWalletSyncBatch).not.toHaveBeenCalled();
    });

    it('should queue testnet3 wallets for sync', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['testnet3-wallet-1']);

      const response = await request(app)
        .post('/sync/network/testnet3')
        .send({ priority: 'high' });

      expect(response.status).toBe(200);
      expect(response.body.requested).toBe(1);
      expect(mockSyncIntentAdmission.request).toHaveBeenCalledWith(
        'testnet3-wallet-1',
        { mode: 'explicit_reopen' },
      );
    });

    it('should queue signet wallets for sync', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['signet-wallet-1']);

      const response = await request(app)
        .post('/sync/network/signet')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.requested).toBe(1);
    });

    it('should return empty result when no wallets found', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue([]);

      const response = await request(app)
        .post('/sync/network/testnet4')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        requested: 0,
        merged: 0,
        rejected: 0,
        indeterminate: 0,
        walletIds: [],
        outcomes: [],
        message: 'No testnet4 wallets found',
      });
      expect(mockEnqueueWalletSyncBatch).not.toHaveBeenCalled();
    });

    it('should reject invalid network', async () => {
      const response = await request(app)
        .post('/sync/network/regtest')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid network');
    });

    it('ignores legacy priority without bypassing canonical admission', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['wallet-1']);

      await request(app)
        .post('/sync/network/mainnet')
        .send({});

      expect(mockSyncIntentAdmission.request).toHaveBeenCalledWith('wallet-1', { mode: 'explicit_reopen' });
      expect(mockEnqueueWalletSyncBatch).not.toHaveBeenCalled();
    });

    it('should return 500 when network queue lookup fails', async () => {
      mockWalletRepository.getIdsByNetwork.mockRejectedValue(new Error('network lookup failed'));

      const response = await request(app)
        .post('/sync/network/mainnet')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /sync/network/:network/resync', () => {
    it('should resync all wallets for a network with confirmation header', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockTransactionRepository.deleteByWalletId.mockResolvedValue(50);
      mockAddressRepository.resetUsedFlags.mockResolvedValue({ count: 10 });
      mockWalletRepository.resetSyncState.mockResolvedValue({});

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 2,
        walletIds: ['wallet-1', 'wallet-2'],
        acceptedWalletIds: ['wallet-1', 'wallet-2'],
        deduplicatedWalletIds: [],
        deferredWalletIds: [],
        rejectedWallets: [],
        indeterminateWallets: [],
        excludedWallets: [],
        message: 'Queued 2 wallets; 0 wallets already requested.',
      });
      expect(mockSyncIntentAdmission.requestFullResync).toHaveBeenNthCalledWith(1, 'wallet-1', {
        reason: 'manual-network-resync:mainnet',
      });
      expect(mockEnqueueFullResyncBatch).not.toHaveBeenCalled();
    });

    it('preserves input order across accepted and deduplicated outcomes', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
        { id: 'wallet-2', syncInProgress: false },
        { id: 'wallet-3', syncInProgress: false },
      ]);
      mockSyncIntentAdmission.requestFullResync
        .mockResolvedValueOnce({
          status: 'merged', generation: 1, incrementalGeneration: 1, wakeup: 'enqueued',
        })
        .mockResolvedValueOnce({
          status: 'requested', generation: 2, incrementalGeneration: 2, wakeup: 'enqueued',
        })
        .mockResolvedValueOnce({
          status: 'merged', generation: 3, incrementalGeneration: 3, wakeup: 'enqueued',
        });

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      // walletIds now reports only what was actually queued - deduplicated
      // wallets are no longer folded in and claimed as queued.
      expect(response.body.walletIds).toEqual(['wallet-2']);
      expect(response.body.deduplicatedWalletIds).toEqual(['wallet-1', 'wallet-3']);
      expect(response.body.queued).toBe(1);
    });

    it('does not count durable requests as queued when their wakeup is unavailable', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockSyncIntentAdmission.requestFullResync
        .mockResolvedValueOnce({
          status: 'requested', generation: 2, incrementalGeneration: 3, wakeup: 'unavailable',
        })
        .mockResolvedValueOnce({
          status: 'merged', generation: 4, incrementalGeneration: 5, wakeup: 'unavailable',
        });

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        queued: 0,
        walletIds: [],
        acceptedWalletIds: ['wallet-1'],
        deduplicatedWalletIds: ['wallet-2'],
        deferredWalletIds: ['wallet-1', 'wallet-2'],
      });
      expect(response.body.message).toContain('2 wallets awaiting queue recovery');
    });

    it('should require confirmation header', async () => {
      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('X-Confirm-Resync');
    });

    it('should defer active and idle wallets through the same full-resync queue', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: true },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockTransactionRepository.deleteByWalletId.mockResolvedValue(30);
      mockAddressRepository.resetUsedFlags.mockResolvedValue({ count: 5 });
      mockWalletRepository.resetSyncState.mockResolvedValue({});

      const response = await request(app)
        .post('/sync/network/testnet3/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.queued).toBe(2);
      expect(mockTransactionRepository.deleteByWalletId).not.toHaveBeenCalled();
    });

    it.each([
      ['blocked', 'queue_unavailable'],
      ['generation_exhausted', 'queue_error'],
    ])('reports network full-resync %s admission per wallet', async (status, reason) => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
      ]);
      mockSyncIntentAdmission.requestFullResync.mockResolvedValue({ status });

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        queued: 0,
        rejectedWallets: [{ walletId: 'wallet-1', reason }],
        indeterminateWallets: [],
      });
    });

    it('should reject invalid network', async () => {
      const response = await request(app)
        .post('/sync/network/invalid/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid network');
    });

    it('should return empty result when no wallets found for resync', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([]);

      const response = await request(app)
        .post('/sync/network/signet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 0,
        walletIds: [],
        acceptedWalletIds: [],
        deduplicatedWalletIds: [],
        deferredWalletIds: [],
        rejectedWallets: [],
        indeterminateWallets: [],
        excludedWallets: [],
        message: 'No signet wallets found',
      });
    });

    it('should return 500 when network resync fails', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockRejectedValue(new Error('resync failed'));

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /sync/network/:network/status', () => {
    it('should return aggregate sync status for network', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        {
          id: 'wallet-1', syncInProgress: false, lastSyncStatus: 'success',
          lastSyncedAt: new Date('2024-01-01'),
          requestedIncrementalSyncGeneration: 1, processedIncrementalSyncGeneration: 1,
          requestedFullResyncGeneration: 0, processedFullResyncGeneration: 0,
          syncActionRequiredAt: null,
        },
        {
          id: 'wallet-2', syncInProgress: true, lastSyncStatus: null, lastSyncedAt: null,
          requestedIncrementalSyncGeneration: 1, processedIncrementalSyncGeneration: 0,
          requestedFullResyncGeneration: 0, processedFullResyncGeneration: 0,
          syncActionRequiredAt: null,
        },
        {
          id: 'wallet-3', syncInProgress: false, lastSyncStatus: 'failed',
          lastSyncedAt: new Date('2024-01-02'),
          requestedIncrementalSyncGeneration: 1, processedIncrementalSyncGeneration: 1,
          requestedFullResyncGeneration: 0, processedFullResyncGeneration: 0,
          syncActionRequiredAt: null,
        },
      ]);

      const response = await request(app)
        .get('/sync/network/mainnet/status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        network: 'mainnet',
        total: 3,
        syncing: 1,
        synced: 1,
        failed: 1,
        pending: 0,
        lastSyncAt: expect.any(String),
      });
    });

    it('should return empty status when no wallets', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([]);

      const response = await request(app)
        .get('/sync/network/testnet4/status');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(0);
    });

    it('should reject invalid network', async () => {
      const response = await request(app)
        .get('/sync/network/bitcoin/status');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid network');
    });

    it('should return 500 when aggregate status lookup fails', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockRejectedValue(new Error('status lookup failed'));

      const response = await request(app)
        .get('/sync/network/mainnet/status');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
