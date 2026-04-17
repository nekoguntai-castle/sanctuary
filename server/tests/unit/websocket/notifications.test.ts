/**
 * Notification Service Tests
 *
 * Tests for the WebSocket notification service that broadcasts
 * blockchain events to connected clients.
 */

import { vi, Mock } from 'vitest';

// Mock dependencies before imports
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const mockBroadcast = vi.hoisted(() => vi.fn());
const mockGetStats = vi.hoisted(() => vi.fn().mockReturnValue({ clients: 5, channelList: [] }));
const mockGetWebSocketServerIfInitialized = vi.hoisted(() => vi.fn(() => ({
  broadcast: mockBroadcast,
  getStats: mockGetStats,
})));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../src/websocket/server', () => ({
  getWebSocketServer: vi.fn(() => ({
    broadcast: mockBroadcast,
    getStats: mockGetStats,
  })),
  getWebSocketServerIfInitialized: mockGetWebSocketServerIfInitialized,
}));

const mockSubscribeAddress = vi.fn().mockResolvedValue('subscription-id');
const mockGetAddressHistory = vi.fn().mockResolvedValue([]);
const mockGetAddressBalance = vi.fn().mockResolvedValue({ confirmed: 100000, unconfirmed: 0 });

vi.mock('../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn(() => ({
    subscribeAddress: mockSubscribeAddress,
    getAddressHistory: mockGetAddressHistory,
    getAddressBalance: mockGetAddressBalance,
  })),
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    address: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    transaction: {
      findFirst: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/repositories', async () => {
  const prismaModule = await import('../../../src/models/prisma');
  const prisma = prismaModule.default;
  return {
    addressRepository: {
      findAddressStrings: vi.fn().mockResolvedValue([]),
      findByWalletId: vi.fn().mockResolvedValue([]),
      findByAddressWithWallet: (...args: unknown[]) =>
        prisma.address.findFirst({ where: { address: args[0] }, include: { wallet: true } }),
    },
    walletRepository: {
      findById: vi.fn().mockResolvedValue(null),
    },
    transactionRepository: {
      findByTxidGlobal: (txid: string) =>
        prisma.transaction.findFirst({ where: { txid } }),
    },
  };
});

vi.mock('../../../src/services/walletLogBuffer', () => ({
  walletLogBuffer: {
    add: vi.fn(),
  },
}));

import prisma from '../../../src/models/prisma';
import { addressRepository, walletRepository } from '../../../src/repositories';
import {
  NotificationService,
  type TransactionNotification,
  type BalanceUpdate,
  type BlockNotification,
  type MempoolNotification,
  type ModelDownloadProgress,
} from '../../../src/websocket/notifications';
import {
  subscribeToBlocks,
  handleAddressUpdate,
  handleTransaction,
  checkConfirmationUpdate,
  handleBalanceUpdate,
} from '../../../src/websocket/notifications/subscriptions';
import { walletLogBuffer } from '../../../src/services/walletLogBuffer';
import { getWebSocketServerIfInitialized } from '../../../src/websocket/server';
import { registerSingletonAndWalletLogTests } from './notifications.singleton-walletlog.contracts';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWebSocketServerIfInitialized.mockReturnValue({
      broadcast: mockBroadcast,
      getStats: mockGetStats,
    });
    mockLogger.debug.mockImplementation(() => undefined);
    mockLogger.info.mockImplementation(() => undefined);
    mockLogger.warn.mockImplementation(() => undefined);
    mockLogger.error.mockImplementation(() => undefined);
    service = new NotificationService();
  });

  describe('start/stop', () => {
    it('should start the notification service', async () => {
      await service.start();
      // Should complete without error
    });

    it('should not restart if already running', async () => {
      await service.start();
      await service.start(); // Second call should be no-op
    });

    it('should stop the notification service', async () => {
      await service.start();
      service.stop();
      // Should complete without error
    });
  });

  describe('unsubscribeWalletAddresses', () => {
    it('should unsubscribe all addresses for a wallet', async () => {
      (addressRepository.findAddressStrings as Mock).mockResolvedValue([
        'bc1q123',
        'bc1q456',
      ]);

      await service.unsubscribeWalletAddresses('wallet-123');

      expect(addressRepository.findAddressStrings).toHaveBeenCalledWith('wallet-123');
    });

    it('should handle empty address list', async () => {
      (addressRepository.findAddressStrings as Mock).mockResolvedValue([]);

      await service.unsubscribeWalletAddresses('wallet-123');
      // Should complete without error
    });

    it('should remove tracked subscriptions and log count', async () => {
      (addressRepository.findAddressStrings as Mock).mockResolvedValue([
        'bc1q123',
        'bc1q456',
        'bc1q999',
      ]);
      (service as any).subscribedAddresses.add('bc1q123');
      (service as any).subscribedAddresses.add('bc1q456');

      await service.unsubscribeWalletAddresses('wallet-123');

      expect((service as any).subscribedAddresses.has('bc1q123')).toBe(false);
      expect((service as any).subscribedAddresses.has('bc1q456')).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[NOTIFY] Unsubscribed 2 addresses for wallet wallet-123'
      );
    });

    it('should handle database error', async () => {
      (addressRepository.findAddressStrings as Mock).mockRejectedValue(new Error('DB error'));

      await service.unsubscribeWalletAddresses('wallet-123');
      // Should not throw, just log warning
    });
  });

  describe('subscribeToAddress', () => {
    it('should subscribe to address updates', async () => {
      await service.subscribeToAddress('bc1q123', 'wallet-456');

      expect(mockSubscribeAddress).toHaveBeenCalledWith('bc1q123');
    });

    it('should not subscribe again if already subscribed', async () => {
      await service.subscribeToAddress('bc1q123', 'wallet-456');
      await service.subscribeToAddress('bc1q123', 'wallet-456');

      // Should only be called once
      expect(mockSubscribeAddress).toHaveBeenCalledTimes(1);
    });

    it('should handle subscription error', async () => {
      mockSubscribeAddress.mockRejectedValueOnce(new Error('Connection error'));

      await service.subscribeToAddress('bc1q123', 'wallet-456');
      // Should not throw, just log error
    });
  });

  describe('subscribeToBlocks retry behavior', () => {
    it('retries once when initial subscribe attempt fails', async () => {
      mockLogger.debug.mockImplementationOnce(() => {
        throw new Error('temporary subscribe failure');
      });

      await subscribeToBlocks(2, 0);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to subscribe to blocks (attempt 1/2)',
        expect.objectContaining({ error: expect.any(String) })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith('Subscribed to blockchain headers');
    });

    it('logs an error when all subscribe retries fail', async () => {
      mockLogger.debug.mockImplementation(() => {
        throw new Error('persistent subscribe failure');
      });

      await subscribeToBlocks(1, 0);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to subscribe to blocks after all retries',
        expect.objectContaining({ error: expect.any(String) })
      );
    });
  });

  describe('subscribeWallet', () => {
    it('should subscribe to all wallet addresses', async () => {
      (addressRepository.findByWalletId as Mock).mockResolvedValue([
        { address: 'bc1q123' },
        { address: 'bc1q456' },
        { address: 'bc1q789' },
      ]);

      await service.subscribeWallet('wallet-123');

      expect(addressRepository.findByWalletId).toHaveBeenCalledWith('wallet-123');
      expect(mockSubscribeAddress).toHaveBeenCalledTimes(3);
    });

    it('should handle wallet with no addresses', async () => {
      (addressRepository.findByWalletId as Mock).mockResolvedValue([]);

      await service.subscribeWallet('empty-wallet');
      // Should complete without error
    });

    it('should handle database error', async () => {
      (addressRepository.findByWalletId as Mock).mockRejectedValue(new Error('DB error'));

      await service.subscribeWallet('wallet-123');
      // Should not throw, just log error
    });
  });

  describe('internal address/transaction handlers', () => {
    it('should ignore address updates when the address is missing in database', async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(null);

      await handleAddressUpdate('bc1q-missing', 'wallet-123');

      expect(mockGetAddressHistory).not.toHaveBeenCalled();
      expect(mockGetAddressBalance).not.toHaveBeenCalled();
    });

    it('should process address history and broadcast transaction + balance updates', async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue({
        address: 'bc1q123',
        wallet: { id: 'wallet-123' },
      });
      mockGetAddressHistory.mockResolvedValueOnce([
        { tx_hash: 'tx-new-1' },
        { tx_hash: 'tx-new-2' },
      ]);
      (prisma.transaction.findFirst as Mock).mockResolvedValue(null);
      (walletRepository.findById as Mock).mockResolvedValue({ id: 'wallet-123' });
      mockGetAddressBalance.mockResolvedValueOnce({ confirmed: 250000, unconfirmed: 5000 });

      await handleAddressUpdate('bc1q123', 'wallet-ignored');

      const eventTypes = mockBroadcast.mock.calls.map(([event]) => event.type);
      expect(eventTypes.filter(type => type === 'transaction')).toHaveLength(2);
      expect(eventTypes.filter(type => type === 'balance')).toHaveLength(1);
    });

    it('should swallow handleAddressUpdate errors', async () => {
      (prisma.address.findFirst as Mock).mockRejectedValueOnce(new Error('DB failed'));
      await expect(handleAddressUpdate('bc1q-err', 'wallet-123')).resolves.toBeUndefined();
    });

    it('should broadcast confirmation update for existing transactions', async () => {
      (prisma.transaction.findFirst as Mock)
        .mockResolvedValueOnce({ txid: 'tx-existing' })
        .mockResolvedValueOnce({ txid: 'tx-existing', confirmations: 4 });

      await handleTransaction('tx-existing', 'wallet-123', 'bc1q123');

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'confirmation',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            txid: 'tx-existing',
            confirmations: 4,
          }),
        })
      );
    });

    it('should skip confirmation broadcast when existing transaction cannot be loaded', async () => {
      (prisma.transaction.findFirst as Mock)
        .mockResolvedValueOnce({ txid: 'tx-existing' })
        .mockResolvedValueOnce(null);

      await handleTransaction('tx-existing', 'wallet-123', 'bc1q123');

      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('should swallow handleTransaction errors', async () => {
      (prisma.transaction.findFirst as Mock).mockRejectedValueOnce(new Error('tx failed'));
      await expect(
        handleTransaction('tx-fail', 'wallet-123', 'bc1q123')
      ).resolves.toBeUndefined();
    });

    it('should swallow checkConfirmationUpdate errors', async () => {
      (prisma.transaction.findFirst as Mock).mockRejectedValueOnce(new Error('confirm failed'));
      await expect(
        checkConfirmationUpdate('tx-fail', 'wallet-123')
      ).resolves.toBeUndefined();
    });

    it('should skip and error-handle balance updates when wallet lookup fails', async () => {
      (walletRepository.findById as Mock).mockResolvedValueOnce(null);

      await handleBalanceUpdate('wallet-missing', {
        confirmed: 1000,
        unconfirmed: 0,
      });
      expect(mockBroadcast).not.toHaveBeenCalled();

      (walletRepository.findById as Mock).mockRejectedValueOnce(new Error('wallet lookup failed'));
      await expect(
        handleBalanceUpdate('wallet-fail', { confirmed: 1000, unconfirmed: 0 })
      ).resolves.toBeUndefined();
    });
  });

  describe('broadcastTransactionNotification', () => {
    it('skips broadcast helpers when the websocket server is unavailable', () => {
      mockGetWebSocketServerIfInitialized.mockReturnValue(null as any);

      service.broadcastTransactionNotification({
        txid: 'tx-offline',
        walletId: 'wallet-123',
        type: 'received',
        amount: 100000,
        confirmations: 0,
        timestamp: new Date(),
      });
      service.broadcastBalanceUpdate({
        walletId: 'wallet-123',
        balance: 500000,
        unconfirmed: 0,
        change: 0,
      });
      service.broadcastBlockNotification({
        height: 800000,
        hash: 'blockhash123',
        timestamp: new Date(),
        transactionCount: 2500,
      });
      service.broadcastNewBlock({ height: 800001 });
      service.broadcastMempoolNotification({
        txid: 'mempool-tx-123',
        fee: 5000,
        size: 250,
        feeRate: 20,
      });
      service.broadcastModelDownloadProgress({
        model: 'llama2',
        status: 'downloading',
        completed: 10,
        total: 100,
        percent: 10,
      });
      service.broadcastConfirmationUpdate('wallet-123', {
        txid: 'tx-abc',
        confirmations: 6,
      });
      service.broadcastSyncStatus('wallet-123', {
        inProgress: true,
        status: 'started',
      });

      expect(mockBroadcast).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Skipping websocket broadcast; server not initialized',
        expect.objectContaining({ type: 'transaction' })
      );
    });

    it('should broadcast transaction notification', () => {
      const notification: TransactionNotification = {
        txid: 'tx-abc',
        walletId: 'wallet-123',
        type: 'received',
        amount: 100000,
        confirmations: 0,
        timestamp: new Date(),
      };

      service.broadcastTransactionNotification(notification);

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transaction',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            txid: 'tx-abc',
            type: 'received',
            amount: 100000,
          }),
        })
      );
    });

    it('should include block height when provided', () => {
      const notification: TransactionNotification = {
        txid: 'tx-abc',
        walletId: 'wallet-123',
        type: 'received',
        amount: 100000,
        confirmations: 6,
        blockHeight: 800000,
        timestamp: new Date(),
      };

      service.broadcastTransactionNotification(notification);

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            blockHeight: 800000,
          }),
        })
      );
    });
  });

  describe('broadcastBalanceUpdate', () => {
    it('should broadcast balance update', () => {
      const update: BalanceUpdate = {
        walletId: 'wallet-123',
        balance: 500000,
        unconfirmed: 25000,
        previousBalance: 475000,
        change: 25000,
      };

      service.broadcastBalanceUpdate(update);

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'balance',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            balance: 500000,
            unconfirmed: 25000,
            change: 25000,
          }),
        })
      );
    });
  });

  describe('broadcastBlockNotification', () => {
    it('should broadcast block notification', () => {
      const notification: BlockNotification = {
        height: 800000,
        hash: 'blockhash123',
        timestamp: new Date(),
        transactionCount: 2500,
      };

      service.broadcastBlockNotification(notification);

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'block',
          data: expect.objectContaining({
            height: 800000,
            hash: 'blockhash123',
            transactionCount: 2500,
          }),
        })
      );
    });
  });

  describe('broadcastNewBlock', () => {
    it('should broadcast new block with minimal data', () => {
      service.broadcastNewBlock({ height: 800001 });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'newBlock',
          data: expect.objectContaining({
            height: 800001,
            timestamp: expect.any(Date),
          }),
        })
      );
    });
  });

  describe('broadcastMempoolNotification', () => {
    it('should broadcast mempool notification', () => {
      const notification: MempoolNotification = {
        txid: 'mempool-tx-123',
        fee: 5000,
        size: 250,
        feeRate: 20,
      };

      service.broadcastMempoolNotification(notification);

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mempool',
          data: expect.objectContaining({
            txid: 'mempool-tx-123',
            fee: 5000,
            size: 250,
            feeRate: 20,
          }),
        })
      );
    });
  });

  describe('broadcastModelDownloadProgress', () => {
    it('should broadcast model download progress', () => {
      const progress: ModelDownloadProgress = {
        model: 'llama2',
        status: 'downloading',
        completed: 450000000,
        total: 1000000000,
        percent: 45,
      };

      service.broadcastModelDownloadProgress(progress);

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'modelDownload',
          data: expect.objectContaining({
            model: 'llama2',
            status: 'downloading',
            percent: 45,
          }),
        })
      );
    });

    it('should handle error status', () => {
      const progress: ModelDownloadProgress = {
        model: 'llama2',
        status: 'error',
        completed: 0,
        total: 0,
        percent: 0,
        error: 'Download failed',
      };

      service.broadcastModelDownloadProgress(progress);

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'error',
            error: 'Download failed',
          }),
        })
      );
    });
  });

  describe('broadcastConfirmationUpdate', () => {
    it('should broadcast confirmation update', () => {
      service.broadcastConfirmationUpdate('wallet-123', {
        txid: 'tx-abc',
        confirmations: 6,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'confirmation',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            txid: 'tx-abc',
            confirmations: 6,
          }),
        })
      );
    });

    it('should include previous confirmations when provided', () => {
      service.broadcastConfirmationUpdate('wallet-123', {
        txid: 'tx-abc',
        confirmations: 1,
        previousConfirmations: 0,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousConfirmations: 0,
          }),
        })
      );
    });
  });

  describe('broadcastSyncStatus', () => {
    it('should broadcast sync started status', () => {
      service.broadcastSyncStatus('wallet-123', {
        inProgress: true,
        status: 'started',
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sync',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            inProgress: true,
            status: 'started',
            walletId: 'wallet-123',
          }),
        })
      );
    });

    it('should broadcast sync completed status', () => {
      service.broadcastSyncStatus('wallet-123', {
        inProgress: false,
        status: 'completed',
        lastSyncedAt: new Date(),
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            inProgress: false,
            status: 'completed',
          }),
        })
      );
    });

    it('should broadcast retry status with all retry info', () => {
      service.broadcastSyncStatus('wallet-123', {
        inProgress: true,
        status: 'retrying',
        retryCount: 2,
        maxRetries: 5,
        retryingIn: 30000,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            retryCount: 2,
            maxRetries: 5,
            retryingIn: 30000,
          }),
        })
      );
    });

    it('should broadcast error status', () => {
      service.broadcastSyncStatus('wallet-123', {
        inProgress: false,
        error: 'Connection failed',
        retriesExhausted: true,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            error: 'Connection failed',
            retriesExhausted: true,
          }),
        })
      );
    });
  });

  describe('broadcastWalletLog', () => {
    it('should broadcast wallet log entry', () => {
      service.broadcastWalletLog('wallet-123', {
        level: 'info',
        module: 'sync',
        message: 'Syncing started',
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'log',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            id: expect.any(String),
            timestamp: expect.any(String),
            level: 'info',
            module: 'sync',
            message: 'Syncing started',
          }),
        })
      );
    });

    it('should store log in buffer', () => {
      service.broadcastWalletLog('wallet-123', {
        level: 'info',
        module: 'sync',
        message: 'Test message',
      });

      expect(walletLogBuffer.add).toHaveBeenCalledWith(
        'wallet-123',
        expect.objectContaining({
          level: 'info',
          module: 'sync',
          message: 'Test message',
        })
      );
    });

    it('should include details when provided', () => {
      service.broadcastWalletLog('wallet-123', {
        level: 'error',
        module: 'electrum',
        message: 'Connection failed',
        details: { host: 'electrum.example.com', error: 'ECONNREFUSED' },
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: {
              host: 'electrum.example.com',
              error: 'ECONNREFUSED',
            },
          }),
        })
      );
    });

    it('should store log in buffer even when websocket server is unavailable', () => {
      vi.mocked(getWebSocketServerIfInitialized).mockReturnValueOnce(null as any);

      expect(() => service.broadcastWalletLog('wallet-123', {
        level: 'info',
        module: 'sync',
        message: 'Buffered only',
      })).not.toThrow();

      expect(walletLogBuffer.add).toHaveBeenCalledWith(
        'wallet-123',
        expect.objectContaining({
          level: 'info',
          module: 'sync',
          message: 'Buffered only',
        })
      );
      expect(mockBroadcast).not.toHaveBeenCalled();
    });
  });
});

registerSingletonAndWalletLogTests(mockBroadcast);
