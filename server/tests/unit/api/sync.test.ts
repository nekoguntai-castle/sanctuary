import { vi } from 'vitest';
/**
 * Sync API Tests
 *
 * Tests for network-based wallet synchronization endpoints.
 */

import express from 'express';
import request from 'supertest';

// Hoist mock variables for use in vi.mock() factories
const {
  mockWalletRepository,
  mockTransactionRepository,
  mockAddressRepository,
  mockSyncService,
  mockWalletLogBufferGet,
  mockEnqueueWalletSyncBatch,
} = vi.hoisted(() => ({
  mockWalletRepository: {
    findByIdWithAccess: vi.fn(),
    updateSyncState: vi.fn(),
    getIdsByNetwork: vi.fn(),
    findByNetworkWithSyncStatus: vi.fn(),
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
  mockWalletLogBufferGet: vi.fn(() => []),
  mockEnqueueWalletSyncBatch: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  walletRepository: mockWalletRepository,
  transactionRepository: mockTransactionRepository,
  addressRepository: mockAddressRepository,
}));

vi.mock('../../../src/services/syncService', () => ({
  getSyncService: () => mockSyncService,
}));

vi.mock('../../../src/services/workerSyncQueue', () => ({
  enqueueWalletSyncBatch: mockEnqueueWalletSyncBatch,
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
        { level: 'info', message: 'sync started' },
      ]);

      const response = await request(app)
        .get('/sync/logs/wallet-1');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        logs: [{ level: 'info', message: 'sync started' }],
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
      expect(mockWalletRepository.updateSyncState).toHaveBeenCalledWith('wallet-1', { syncInProgress: false });
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

    it('POST /sync/resync/:walletId performs full resync and queues high priority', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1', syncInProgress: true });
      mockTransactionRepository.deleteByWalletId.mockResolvedValue(12);
      mockAddressRepository.resetUsedFlags.mockResolvedValue({ count: 8 });
      mockWalletRepository.resetSyncState.mockResolvedValue({});

      const response = await request(app)
        .post('/sync/resync/wallet-1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Cleared 12 transactions. Full resync queued.',
        deletedTransactions: 12,
      });
      expect(mockSyncService.queueSync).toHaveBeenCalledWith('wallet-1', 'high');
    });

    it('POST /sync/resync/:walletId returns 404 when wallet missing', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue(null);

      const response = await request(app)
        .post('/sync/resync/wallet-missing')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('POST /sync/resync/:walletId returns 500 on deletion errors', async () => {
      mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1', syncInProgress: false });
      mockTransactionRepository.deleteByWalletId.mockRejectedValue(new Error('delete failed'));

      const response = await request(app)
        .post('/sync/resync/wallet-1')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
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

    it('should queue testnet wallets for sync', async () => {
      mockWalletRepository.getIdsByNetwork.mockResolvedValue(['testnet-wallet-1']);

      const response = await request(app)
        .post('/sync/network/testnet')
        .send({ priority: 'high' });

      expect(response.status).toBe(200);
      expect(response.body.queued).toBe(1);
      expect(mockEnqueueWalletSyncBatch).toHaveBeenCalledWith(
        ['testnet-wallet-1'],
        expect.objectContaining({
          priority: 'high',
          reason: 'manual-network-sync:testnet',
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
        .post('/sync/network/testnet')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        queued: 0,
        walletIds: [],
        message: 'No testnet wallets found',
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
        deletedTransactions: 100, // 50 per wallet
        clearedStuckFlags: 0,
      });
    });

    it('should require confirmation header', async () => {
      const response = await request(app)
        .post('/sync/network/mainnet/resync')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('X-Confirm-Resync');
    });

    it('should clear stuck sync flags and resync all wallets', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: true },
        { id: 'wallet-2', syncInProgress: false },
      ]);
      mockTransactionRepository.deleteByWalletId.mockResolvedValue(30);
      mockAddressRepository.resetUsedFlags.mockResolvedValue({ count: 5 });
      mockWalletRepository.resetSyncState.mockResolvedValue({});

      const response = await request(app)
        .post('/sync/network/testnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      expect(response.status).toBe(200);
      // Full resync processes ALL wallets, including stuck ones
      expect(response.body.queued).toBe(2);
      expect(response.body.clearedStuckFlags).toBe(1);
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
        message: 'No signet wallets found',
      });
    });

    it('should delete transactions and reset wallet state', async () => {
      mockWalletRepository.findByNetworkWithSyncStatus.mockResolvedValue([
        { id: 'wallet-1', syncInProgress: false },
      ]);
      mockTransactionRepository.deleteByWalletId.mockResolvedValue(75);
      mockAddressRepository.resetUsedFlags.mockResolvedValue({ count: 20 });
      mockWalletRepository.resetSyncState.mockResolvedValue({});

      await request(app)
        .post('/sync/network/mainnet/resync')
        .set('X-Confirm-Resync', 'true')
        .send({});

      // Verify transactions deleted
      expect(mockTransactionRepository.deleteByWalletId).toHaveBeenCalledWith('wallet-1');

      // Verify address flags reset
      expect(mockAddressRepository.resetUsedFlags).toHaveBeenCalledWith('wallet-1');

      // Verify wallet state reset
      expect(mockWalletRepository.resetSyncState).toHaveBeenCalledWith('wallet-1');

      // Verify queued for high priority sync
      expect(mockEnqueueWalletSyncBatch).toHaveBeenCalledWith(
        ['wallet-1'],
        expect.objectContaining({
          priority: 'high',
          reason: 'manual-network-resync:mainnet',
          staggerDelayMs: 2000,
          jobIdPrefix: 'manual-network-resync:mainnet:test-user-id',
        })
      );
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
        .get('/sync/network/testnet/status');

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
