import { vi } from 'vitest';
/**
 * Sync API Tests
 *
 * Tests for network-based wallet synchronization endpoints.
 */

import express from 'express';
import request from 'supertest';
import { DEFAULT_SYNC_PRIORITY } from '@sanctuary/shared/constants/sync';
import type { WalletLogEntry } from '../../../src/websocket/notifications';

// Hoist mock variables for use in vi.mock() factories
const {
  mockWalletRepository,
  mockTransactionRepository,
  mockAddressRepository,
  mockSyncService,
  mockWalletLogBufferGet,
  mockEnqueueWalletSyncBatch,
  mockEnqueueFullResyncBatch,
} = vi.hoisted(() => ({
  mockWalletRepository: {
    findByIdWithAccess: vi.fn(),
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
    resetUsedFlags: vi.fn(),
  },
  mockSyncService: {
    syncNow: vi.fn(),
    queueSync: vi.fn(),
    getSyncStatus: vi.fn(),
    queueUserWallets: vi.fn(),
  },
  mockWalletLogBufferGet: vi.fn<() => WalletLogEntry[]>(() => []),
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
    it('POST /sync/wallet/:walletId triggers immediate sync', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncService.syncNow.mockResolvedValue({
        success: true,
        addresses: 4,
        transactions: 2,
        utxos: 6,
        error: null,
      });

      const response = await request(app)
        .post('/sync/wallet/wallet-1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        syncedAddresses: 4,
        newTransactions: 2,
        newUtxos: 6,
        error: null,
      });
      expect(mockWalletRepository.findByIdWithAccess).toHaveBeenCalledWith('wallet-1', 'test-user-id');
      expect(mockSyncService.syncNow).toHaveBeenCalledWith('wallet-1');
    });

    it('POST /sync/wallet/:walletId returns 404 when wallet missing', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue(null);

      const response = await request(app)
        .post('/sync/wallet/wallet-missing')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('POST /sync/wallet/:walletId returns 500 on sync errors', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncService.syncNow.mockRejectedValue(new Error('sync exploded'));

      const response = await request(app)
        .post('/sync/wallet/wallet-1')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('POST /sync/queue/:walletId queues sync and returns status', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockSyncService.getSyncStatus.mockResolvedValue({ queuePosition: 3, syncInProgress: true });

      const response = await request(app)
        .post('/sync/queue/wallet-1')
        .send({ priority: 'high' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        queued: true,
        queuePosition: 3,
        syncInProgress: true,
      });
      expect(mockSyncService.queueSync).toHaveBeenCalledWith('wallet-1', 'high');
    });

    it('POST /sync/queue/:walletId defaults omitted bodies to normal priority', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });

      const response = await request(app)
        .post('/sync/queue/wallet-1');

      expect(response.status).toBe(200);
      expect(mockSyncService.queueSync).toHaveBeenCalledWith('wallet-1', DEFAULT_SYNC_PRIORITY);
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
        queuePosition: 0,
        syncInProgress: false,
        lastSyncAt: '2025-01-01T00:00:00.000Z',
      });

      const response = await request(app)
        .get('/sync/status/wallet-1');

      expect(response.status).toBe(200);
      expect(response.body.queuePosition).toBe(0);
      expect(response.body.syncInProgress).toBe(false);
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

    it('POST /sync/user queues all wallets', async () => {
      mockSyncService.queueUserWallets.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/sync/user')
        .send({ priority: 'low' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockSyncService.queueUserWallets).toHaveBeenCalledWith('test-user-id', 'low');
    });

    it('POST /sync/user returns 500 when batch queue fails', async () => {
      mockSyncService.queueUserWallets.mockRejectedValue(new Error('batch failed'));

      const response = await request(app)
        .post('/sync/user')
        .send({ priority: 'normal' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('POST /sync/reset/:walletId resets stuck state', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockWalletRepository.updateSyncState.mockResolvedValue({});

      const response = await request(app)
        .post('/sync/reset/wallet-1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockWalletRepository.updateSyncState).toHaveBeenCalledWith('wallet-1', {
        syncInProgress: false,
        syncExecutionOwner: null,
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: null,
      });
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
      mockWalletRepository.updateSyncState.mockRejectedValue(new Error('reset failed'));

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
      });
      expect(mockEnqueueFullResyncBatch).toHaveBeenCalledWith(
        ['wallet-1'],
        { reason: 'manual-wallet-resync:test-user-id' },
      );
      expect(mockTransactionRepository.deleteByWalletId).not.toHaveBeenCalled();
    });

    it('POST /sync/resync/:walletId returns 404 when wallet missing', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue(null);

      const response = await request(app)
        .post('/sync/resync/wallet-missing')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('POST /sync/resync/:walletId returns 503 when the durable queue rejects it', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1', syncInProgress: false });
      mockEnqueueFullResyncBatch.mockResolvedValue({
        outcomes: [{
          walletId: 'wallet-1',
          status: 'rejected',
          reason: 'queue_unavailable',
        }],
        acceptedWalletIds: [],
        deduplicatedWalletIds: [],
        rejectedWallets: [{
          walletId: 'wallet-1',
          reason: 'queue_unavailable',
        }],
        indeterminateWallets: [],
      });

      const response = await request(app)
        .post('/sync/resync/wallet-1')
        .send({});

      expect(response.status).toBe(503);
      expect(response.body.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.body.details.outcomes).toEqual([{
        walletId: 'wallet-1',
        status: 'rejected',
        reason: 'queue_unavailable',
      }]);
    });

    it('POST /sync/resync/:walletId returns indeterminate state without calling it rejected', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockEnqueueFullResyncBatch.mockResolvedValue({
        outcomes: [{
          walletId: 'wallet-1',
          status: 'indeterminate',
          reason: 'queue_state_unknown',
        }],
        acceptedWalletIds: [],
        deduplicatedWalletIds: [],
        rejectedWallets: [],
        indeterminateWallets: [{
          walletId: 'wallet-1',
          reason: 'queue_state_unknown',
        }],
      });

      const response = await request(app)
        .post('/sync/resync/wallet-1')
        .send({});

      expect(response.status).toBe(503);
      expect(response.body.message).toBe('Full resync queue state could not be confirmed');
      expect(response.body.details.outcomes).toEqual([{
        walletId: 'wallet-1',
        status: 'indeterminate',
        reason: 'queue_state_unknown',
      }]);
      expect(JSON.stringify(response.body)).not.toContain('rejected');
    });

    it('POST /sync/resync/:walletId reports an already retained intention', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
      mockEnqueueFullResyncBatch.mockResolvedValue({
        outcomes: [{ walletId: 'wallet-1', status: 'deduplicated' }],
        acceptedWalletIds: [],
        deduplicatedWalletIds: ['wallet-1'],
        rejectedWallets: [],
        indeterminateWallets: [],
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
  });

  describe('POST /sync/network/:network', () => {
    it('should queue all mainnet wallets for sync', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['wallet-1', 'wallet-2']);

      const response = await request(app)
        .post('/sync/network/mainnet')
        .send({ priority: 'normal' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 2,
        walletIds: ['wallet-1', 'wallet-2'],
      });
      expect(mockEnqueueWalletSyncBatch).toHaveBeenCalledWith(
        ['wallet-1', 'wallet-2'],
        expect.objectContaining({
          priority: 'normal',
          reason: 'manual-network-sync:mainnet',
          staggerDelayMs: 2000,
          jobIdPrefix: 'manual-network-sync:mainnet:test-user-id',
        })
      );
    });

    it('should queue testnet3 wallets for sync', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['testnet3-wallet-1']);

      const response = await request(app)
        .post('/sync/network/testnet3')
        .send({ priority: 'high' });

      expect(response.status).toBe(200);
      expect(response.body.queued).toBe(1);
      expect(mockEnqueueWalletSyncBatch).toHaveBeenCalledWith(
        ['testnet3-wallet-1'],
        expect.objectContaining({
          priority: 'high',
          reason: 'manual-network-sync:testnet3',
        })
      );
    });

    it('should queue signet wallets for sync', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['signet-wallet-1']);

      const response = await request(app)
        .post('/sync/network/signet')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.queued).toBe(1);
    });

    it('should return empty result when no wallets found', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue([]);

      const response = await request(app)
        .post('/sync/network/testnet4')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 0,
        walletIds: [],
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

    it('should default to normal priority', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['wallet-1']);

      await request(app)
        .post('/sync/network/mainnet')
        .send({});

      expect(mockEnqueueWalletSyncBatch).toHaveBeenCalledWith(
        ['wallet-1'],
        expect.objectContaining({ priority: 'normal' })
      );
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
        rejectedWallets: [],
        indeterminateWallets: [],
        excludedWallets: [],
        message: 'Queued 2 wallets; 0 wallets already queued.',
      });
    });

    it('preserves input order across accepted and deduplicated outcomes', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
        { id: 'wallet-2', syncInProgress: false },
        { id: 'wallet-3', syncInProgress: false },
      ]);
      mockEnqueueFullResyncBatch.mockResolvedValue({
        outcomes: [
          { walletId: 'wallet-1', status: 'deduplicated' },
          { walletId: 'wallet-2', status: 'accepted' },
          { walletId: 'wallet-3', status: 'deduplicated' },
        ],
        acceptedWalletIds: ['wallet-2'],
        deduplicatedWalletIds: ['wallet-1', 'wallet-3'],
        rejectedWallets: [],
        indeterminateWallets: [],
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

    it('should report partial full-resync enqueue acceptance', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: true },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockEnqueueFullResyncBatch.mockResolvedValue({
        outcomes: [
          { walletId: 'wallet-1', status: 'accepted' },
          {
            walletId: 'wallet-2',
            status: 'rejected',
            reason: 'queue_error',
          },
        ],
        acceptedWalletIds: ['wallet-1'],
        deduplicatedWalletIds: [],
        rejectedWallets: [{
          walletId: 'wallet-2',
          reason: 'queue_error',
        }],
        indeterminateWallets: [],
      });

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 1,
        walletIds: ['wallet-1'],
        acceptedWalletIds: ['wallet-1'],
        deduplicatedWalletIds: [],
        rejectedWallets: [{
          walletId: 'wallet-2',
          reason: 'queue_error',
        }],
        indeterminateWallets: [],
        excludedWallets: [],
        message: 'Queued 1 wallet; 0 wallets already queued; 1 wallet rejected.',
      });
    });

    it('reports partial indeterminate queue state separately from rejection', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockEnqueueFullResyncBatch.mockResolvedValue({
        outcomes: [
          { walletId: 'wallet-1', status: 'accepted' },
          {
            walletId: 'wallet-2',
            status: 'indeterminate',
            reason: 'queue_state_unknown',
          },
        ],
        acceptedWalletIds: ['wallet-1'],
        deduplicatedWalletIds: [],
        rejectedWallets: [],
        indeterminateWallets: [{
          walletId: 'wallet-2',
          reason: 'queue_state_unknown',
        }],
      });

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 1,
        walletIds: ['wallet-1'],
        acceptedWalletIds: ['wallet-1'],
        deduplicatedWalletIds: [],
        rejectedWallets: [],
        indeterminateWallets: [{
          walletId: 'wallet-2',
          reason: 'queue_state_unknown',
        }],
        excludedWallets: [],
        message: 'Queued 1 wallet; 0 wallets already queued; 1 wallet queue state unknown.',
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
        rejectedWallets: [],
        indeterminateWallets: [],
        excludedWallets: [],
        message: 'No signet wallets found',
      });
    });

    it('should report partial network enqueue outcomes without eager deletion', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
      ]);
      mockEnqueueFullResyncBatch.mockResolvedValue({
        outcomes: [{
          walletId: 'wallet-1',
          status: 'rejected',
          reason: 'queue_unavailable',
        }],
        acceptedWalletIds: [],
        deduplicatedWalletIds: [],
        rejectedWallets: [{
          walletId: 'wallet-1',
          reason: 'queue_unavailable',
        }],
        indeterminateWallets: [],
      });

      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(503);
      expect(response.body.details.outcomes).toEqual([{
        walletId: 'wallet-1',
        status: 'rejected',
        reason: 'queue_unavailable',
      }]);
      expect(mockTransactionRepository.deleteByWalletId).not.toHaveBeenCalled();
      expect(mockEnqueueFullResyncBatch).toHaveBeenCalledWith(['wallet-1'], {
        reason: 'manual-network-resync:mainnet',
        staggerDelayMs: 2000,
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
        { id: 'wallet-1', syncInProgress: false, lastSyncStatus: 'success', lastSyncedAt: new Date('2024-01-01') },
        { id: 'wallet-2', syncInProgress: true, lastSyncStatus: null, lastSyncedAt: null },
        { id: 'wallet-3', syncInProgress: false, lastSyncStatus: 'failed', lastSyncedAt: new Date('2024-01-02') },
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
