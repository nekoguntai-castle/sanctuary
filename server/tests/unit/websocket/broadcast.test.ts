import { vi } from 'vitest';
/**
 * Broadcast Helpers Tests
 *
 * Tests for type-safe WebSocket broadcast functions.
 */

import {
  broadcastTransaction,
  broadcastBalance,
  broadcastConfirmation,
  broadcastSync,
  broadcastLog,
  broadcastBlock,
  broadcastNewBlock,
  broadcastMempool,
  broadcast,
  hasWalletSubscribers,
  getBroadcastStats,
} from '../../../src/websocket/broadcast';
import { getWebSocketServer, getGatewayWebSocketServer } from '../../../src/websocket/server';

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the WebSocket server
const mockBroadcast = vi.fn();
const mockGetStats = vi.fn().mockReturnValue({
  clients: 5,
  maxClients: 10000,
  subscriptions: 15,
  channels: 3,
  channelList: ['wallet:123', 'wallet:456', 'blocks'],
  uniqueUsers: 2,
  maxPerUser: 10,
  rateLimits: {
    maxMessagesPerSecond: 10,
    gracePeriodMs: 5000,
    gracePeriodMessageLimit: 500,
    maxSubscriptionsPerConnection: 500,
  },
});
const mockIsGatewayConnected = vi.fn().mockReturnValue(false);
const mockSendEvent = vi.fn();

vi.mock('../../../src/websocket/server', () => ({
  getWebSocketServer: vi.fn(() => ({
    broadcast: mockBroadcast,
    getStats: mockGetStats,
  })),
  getGatewayWebSocketServer: vi.fn(() => ({
    isGatewayConnected: mockIsGatewayConnected,
    sendEvent: mockSendEvent,
  })),
}));

describe('Broadcast Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('broadcastTransaction', () => {
    it('should broadcast transaction event', () => {
      broadcastTransaction('wallet-123', {
        txid: 'tx-abc',
        type: 'received',
        amount: 100000,
        confirmations: 0,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transaction',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            txid: 'tx-abc',
            type: 'received',
            amount: 100000,
            confirmations: 0,
          }),
        })
      );
    });

    it('should handle string timestamp', () => {
      broadcastTransaction('wallet-123', {
        txid: 'tx-abc',
        type: 'sent',
        amount: 100000,
        confirmations: 3,
        timestamp: '2024-01-01T00:00:00Z',
      });

      expect(mockBroadcast).toHaveBeenCalled();
    });

    it('should handle consolidation type', () => {
      broadcastTransaction('wallet-123', {
        txid: 'tx-abc',
        type: 'consolidation',
        amount: 0,
        confirmations: 1,
        timestamp: new Date(),
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'consolidation',
          }),
        })
      );
    });
  });

  describe('broadcastBalance', () => {
    it('should broadcast balance event', () => {
      broadcastBalance('wallet-123', {
        balance: 500000,
        unconfirmed: 50000,
        change: 25000,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'balance',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            balance: 500000,
            unconfirmed: 50000,
            change: 25000,
          }),
        })
      );
    });

    it('should add timestamp if not provided', () => {
      broadcastBalance('wallet-123', {
        balance: 100000,
        unconfirmed: 0,
        change: 0,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timestamp: expect.any(String),
          }),
        })
      );
    });

    it('should serialize Date timestamp for balance events', () => {
      const ts = new Date('2024-01-02T03:04:05.000Z');
      broadcastBalance('wallet-123', {
        balance: 100000,
        unconfirmed: 0,
        change: 0,
        timestamp: ts,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timestamp: '2024-01-02T03:04:05.000Z',
          }),
        })
      );
    });
  });

  describe('broadcastConfirmation', () => {
    it('should broadcast confirmation event', () => {
      broadcastConfirmation('wallet-123', {
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
      broadcastConfirmation('wallet-123', {
        txid: 'tx-abc',
        confirmations: 6,
        previousConfirmations: 5,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousConfirmations: 5,
          }),
        })
      );
    });

    it('should serialize Date timestamp for confirmation events', () => {
      const ts = new Date('2024-01-02T03:04:05.000Z');
      broadcastConfirmation('wallet-123', {
        txid: 'tx-abc',
        confirmations: 6,
        timestamp: ts,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timestamp: '2024-01-02T03:04:05.000Z',
          }),
        })
      );
    });
  });

  describe('broadcastSync', () => {
    it('should broadcast sync started event', () => {
      broadcastSync('wallet-123', {
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
          }),
        })
      );
    });

    it('should broadcast sync completed event', () => {
      broadcastSync('wallet-123', {
        inProgress: false,
        status: 'completed',
        lastSyncedAt: new Date().toISOString(),
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

    it('should include retry information', () => {
      broadcastSync('wallet-123', {
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

    it('should serialize Date timestamp for sync events', () => {
      const ts = new Date('2024-01-02T03:04:05.000Z');
      broadcastSync('wallet-123', {
        inProgress: true,
        status: 'started',
        timestamp: ts,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timestamp: '2024-01-02T03:04:05.000Z',
          }),
        })
      );
    });
  });

  describe('broadcastLog', () => {
    it('should broadcast log event', () => {
      broadcastLog('wallet-123', {
        id: 'log-001',
        level: 'info',
        module: 'sync',
        message: 'Test log message',
        timestamp: '2024-01-01T00:00:00Z',
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'log',
          walletId: 'wallet-123',
          data: expect.objectContaining({
            id: 'log-001',
            level: 'info',
            module: 'sync',
            message: 'Test log message',
          }),
        })
      );
    });

    it('should include details when provided', () => {
      broadcastLog('wallet-123', {
        id: 'log-002',
        level: 'error',
        module: 'electrum',
        message: 'Connection failed',
        timestamp: new Date().toISOString(),
        details: { host: 'electrum.example.com', port: 50002 },
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            details: { host: 'electrum.example.com', port: 50002 },
          }),
        })
      );
    });
  });

  describe('broadcastBlock', () => {
    it('should broadcast block event', () => {
      broadcastBlock({
        height: 800000,
        hash: 'blockhash123',
        transactionCount: 2500,
      });

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

    it('should serialize Date timestamp for block events', () => {
      const ts = new Date('2024-01-02T03:04:05.000Z');
      broadcastBlock({
        height: 800010,
        hash: 'blockhash-with-date',
        timestamp: ts,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timestamp: '2024-01-02T03:04:05.000Z',
          }),
        })
      );
    });
  });

  describe('broadcastNewBlock', () => {
    it('should broadcast new block event', () => {
      broadcastNewBlock({
        height: 800001,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'newBlock',
          data: expect.objectContaining({
            height: 800001,
          }),
        })
      );
    });

    it('should serialize Date timestamp for new block events', () => {
      const ts = new Date('2024-01-02T03:04:05.000Z');
      broadcastNewBlock({
        height: 800002,
        timestamp: ts,
      });

      expect(mockBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timestamp: '2024-01-02T03:04:05.000Z',
          }),
        })
      );
    });
  });

  describe('broadcastMempool', () => {
    it('should broadcast mempool event', () => {
      broadcastMempool({
        txid: 'mempool-tx-123',
        fee: 5000,
        size: 250,
        feeRate: 20,
      });

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

  describe('broadcast (generic)', () => {
    it('should broadcast any typed event', () => {
      broadcast({
        type: 'balance',
        walletId: 'wallet-123',
        data: {
          balance: 100000,
          unconfirmed: 0,
          change: 0,
          timestamp: '2024-01-01T00:00:00Z',
        },
      });

      expect(mockBroadcast).toHaveBeenCalled();
    });

    it('should skip broadcast when websocket server is unavailable', () => {
      vi.mocked(getWebSocketServer).mockImplementationOnce(() => {
        throw new Error('server not initialized');
      });

      expect(() =>
        broadcast({
          type: 'mempool',
          data: {
            txid: 'tx-unavailable',
            fee: 1,
            size: 100,
            feeRate: 1,
          },
        })
      ).not.toThrow();
    });
  });

  describe('hasWalletSubscribers', () => {
    it('should return true when wallet has subscribers', () => {
      const result = hasWalletSubscribers('123');

      expect(result).toBe(true);
    });

    it('should return false for wallet without subscribers', () => {
      const result = hasWalletSubscribers('999');

      expect(result).toBe(false);
    });

    it('should return false when stats lookup throws', () => {
      vi.mocked(getWebSocketServer).mockImplementationOnce(() => {
        throw new Error('stats unavailable');
      });

      expect(hasWalletSubscribers('123')).toBe(false);
    });
  });

  describe('getBroadcastStats', () => {
    it('should return current stats', () => {
      const stats = getBroadcastStats();

      expect(stats).toEqual({
        connected: true,
        clients: 5,
        channels: ['wallet:123', 'wallet:456', 'blocks'],
        gatewayConnected: false,
      });
    });

    it('should include gateway status', () => {
      mockIsGatewayConnected.mockReturnValueOnce(true);

      const stats = getBroadcastStats();

      expect(stats.gatewayConnected).toBe(true);
    });

    it('should return disconnected defaults when websocket server is unavailable', () => {
      vi.mocked(getWebSocketServer).mockImplementationOnce(() => {
        throw new Error('server unavailable');
      });

      expect(getBroadcastStats()).toEqual({
        connected: false,
        clients: 0,
        channels: [],
        gatewayConnected: false,
      });
    });

    it('should default gatewayConnected to false when gateway server is unavailable', () => {
      vi.mocked(getGatewayWebSocketServer).mockImplementationOnce(() => undefined as any);

      const stats = getBroadcastStats();

      expect(stats).toEqual({
        connected: true,
        clients: 5,
        channels: ['wallet:123', 'wallet:456', 'blocks'],
        gatewayConnected: false,
      });
    });
  });

  describe('gateway forwarding', () => {
    it('should send to gateway when connected', () => {
      mockIsGatewayConnected.mockReturnValue(true);

      broadcastBalance('wallet-123', {
        balance: 100000,
        unconfirmed: 0,
        change: 0,
      });

      expect(mockSendEvent).toHaveBeenCalled();
    });

    it('should not send to gateway when disconnected', () => {
      mockIsGatewayConnected.mockReturnValue(false);

      broadcastBalance('wallet-123', {
        balance: 100000,
        unconfirmed: 0,
        change: 0,
      });

      expect(mockSendEvent).not.toHaveBeenCalled();
    });
  });
});
