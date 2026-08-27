/**
 * Notification Service Tests
 *
 * Tests for the WebSocket notification service that broadcasts
 * blockchain events to connected clients.
 */

import { vi } from 'vitest';

// Mock dependencies before imports
const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const mockBroadcast = vi.hoisted(() => vi.fn());
const mockGetStats = vi.hoisted(() => vi.fn().mockReturnValue({ clients: 5, channelList: [] }));
const mockIsGatewayConnected = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockSendEvent = vi.hoisted(() => vi.fn());
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
  getGatewayWebSocketServer: vi.fn(() => ({
    isGatewayConnected: mockIsGatewayConnected,
    sendEvent: mockSendEvent,
  })),
}));

vi.mock('../../../src/services/walletLogBuffer', () => ({
  walletLogBuffer: {
    add: vi.fn(),
    nextSequence: vi.fn(),
  },
}));

import {
  NotificationService,
  type TransactionNotification,
  type BalanceUpdate,
  type BlockNotification,
  type MempoolNotification,
} from '../../../src/websocket/notifications';
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
    let walletLogSequence = 0;
    vi.mocked(walletLogBuffer.nextSequence).mockImplementation(() => {
      walletLogSequence += 1;
      return walletLogSequence;
    });
    mockIsGatewayConnected.mockReturnValue(false);
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
        previousBalance: 500000,
        change: 0,
      });
      service.broadcastBlockNotification({
        network: 'mainnet',
        height: 800000,
        hash: 'blockhash123',
        timestamp: new Date(),
        transactionCount: 2500,
      });
      service.broadcastNewBlock({ network: 'mainnet', height: 800001 });
      service.broadcastMempoolNotification({
        txid: 'mempool-tx-123',
        fee: 5000,
        size: 250,
        feeRate: 20,
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

    it('routes notification broadcasts through the gateway-forwarding broadcast path', () => {
      mockIsGatewayConnected.mockReturnValue(true);

      service.broadcastTransactionNotification({
        txid: 'tx-gateway',
        walletId: 'wallet-123',
        type: 'received',
        amount: 100000,
        confirmations: 0,
        timestamp: new Date(),
      });

      expect(mockSendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transaction',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            txid: 'tx-gateway',
            walletId: 'wallet-123',
          }),
        })
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
            walletId: 'wallet-123',
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
            walletId: 'wallet-123',
          }),
        })
      );
    });
  });

  describe('broadcastBlockNotification', () => {
    it('should broadcast block notification', () => {
      const notification: BlockNotification = {
        network: 'testnet4',
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
            network: 'testnet4',
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
      service.broadcastNewBlock({ network: 'signet', height: 800001 });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'newBlock',
          data: expect.objectContaining({
            network: 'signet',
            height: 800001,
            timestamp: expect.any(String),
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

    it('assigns a causal sequence across equal-millisecond log entries', () => {
      service.broadcastWalletLog('wallet-123', {
        level: 'info',
        module: 'sync',
        message: 'First',
      });
      service.broadcastWalletLog('wallet-123', {
        level: 'info',
        module: 'sync',
        message: 'Second',
      });

      const first = vi.mocked(walletLogBuffer.add).mock.calls[0]?.[1];
      const second = vi.mocked(walletLogBuffer.add).mock.calls[1]?.[1];
      expect(first?.sequence).toEqual(expect.any(Number));
      expect(second?.sequence).toBe((first?.sequence ?? 0) + 1);
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
