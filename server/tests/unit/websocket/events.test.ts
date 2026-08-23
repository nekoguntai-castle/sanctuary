/**
 * WebSocket Events Tests
 *
 * Tests for EventBuilders factory functions that create type-safe WebSocket events.
 */

import { vi } from 'vitest';

import { EventBuilders } from '../../../src/websocket/events';

describe('EventBuilders', () => {
  describe('transaction', () => {
    it('should create a transaction event with all required fields', () => {
      const event = EventBuilders.transaction('wallet-123', {
        txid: 'tx-abc',
        type: 'received',
        amount: 100000,
        confirmations: 0,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(event).toEqual({
        type: 'transaction',
        walletId: 'wallet-123',
        data: {
          txid: 'tx-abc',
          type: 'received',
          amount: 100000,
          confirmations: 0,
          timestamp: expect.any(Date),
        },
      });
    });

    it('should create a sent transaction event', () => {
      const event = EventBuilders.transaction('wallet-456', {
        txid: 'tx-def',
        type: 'sent',
        amount: 50000,
        confirmations: 3,
        blockHeight: 800000,
        timestamp: new Date(),
      });

      expect(event.type).toBe('transaction');
      expect(event.data.type).toBe('sent');
      expect(event.data.blockHeight).toBe(800000);
    });

    it('should create a consolidation transaction event', () => {
      const event = EventBuilders.transaction('wallet-789', {
        txid: 'tx-ghi',
        type: 'consolidation',
        amount: 0,
        confirmations: 6,
        timestamp: new Date(),
      });

      expect(event.data.type).toBe('consolidation');
      expect(event.data.amount).toBe(0);
    });
  });

  describe('balance', () => {
    it('should create a balance event', () => {
      const event = EventBuilders.balance('wallet-123', {
        balance: 500000,
        unconfirmed: 25000,
        change: 10000,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(event).toEqual({
        type: 'balance',
        walletId: 'wallet-123',
        data: {
          balance: 500000,
          unconfirmed: 25000,
          change: 10000,
          timestamp: expect.any(Date),
        },
      });
    });

    it('should handle zero balance', () => {
      const event = EventBuilders.balance('wallet-123', {
        balance: 0,
        unconfirmed: 0,
        change: 0,
        timestamp: new Date(),
      });

      expect(event.data.balance).toBe(0);
      expect(event.data.unconfirmed).toBe(0);
    });

    it('should handle negative change', () => {
      const event = EventBuilders.balance('wallet-123', {
        balance: 400000,
        unconfirmed: 0,
        change: -100000,
        timestamp: new Date(),
      });

      expect(event.data.change).toBe(-100000);
    });
  });

  describe('confirmation', () => {
    it('should create a confirmation event', () => {
      const event = EventBuilders.confirmation('wallet-123', {
        txid: 'tx-abc',
        confirmations: 6,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(event).toEqual({
        type: 'confirmation',
        walletId: 'wallet-123',
        data: {
          txid: 'tx-abc',
          confirmations: 6,
          timestamp: expect.any(Date),
        },
      });
    });

    it('should include previous confirmations when provided', () => {
      const event = EventBuilders.confirmation('wallet-123', {
        txid: 'tx-abc',
        confirmations: 3,
        previousConfirmations: 2,
        timestamp: new Date(),
      });

      expect(event.data.previousConfirmations).toBe(2);
    });

    it('should handle zero confirmations (unconfirmed)', () => {
      const event = EventBuilders.confirmation('wallet-123', {
        txid: 'tx-abc',
        confirmations: 0,
        timestamp: new Date(),
      });

      expect(event.data.confirmations).toBe(0);
    });
  });

  describe('block', () => {
    it('should create a block event', () => {
      const event = EventBuilders.block({
        network: 'signet',
        height: 800000,
        hash: 'blockhash123',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        transactionCount: 2500,
      });

      expect(event).toEqual({
        type: 'block',
        data: {
          network: 'signet',
          height: 800000,
          hash: 'blockhash123',
          timestamp: expect.any(Date),
          transactionCount: 2500,
        },
      });
    });

    it('should handle block with few transactions', () => {
      const event = EventBuilders.block({
        network: 'testnet4',
        height: 800001,
        hash: 'blockhash456',
        timestamp: new Date(),
        transactionCount: 1,
      });

      expect(event.data.transactionCount).toBe(1);
    });
  });

  describe('newBlock', () => {
    it('should create a newBlock event', () => {
      const event = EventBuilders.newBlock({
        network: 'signet',
        height: 800000,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(event).toEqual({
        type: 'newBlock',
        data: {
          network: 'signet',
          height: 800000,
          timestamp: expect.any(Date),
        },
      });
    });

    it('should only include height and timestamp', () => {
      const event = EventBuilders.newBlock({
        network: 'testnet4',
        height: 800001,
        timestamp: new Date(),
      });

      expect(Object.keys(event.data).sort()).toEqual(['height', 'network', 'timestamp']);
    });
  });

  describe('mempool', () => {
    it('should create a mempool event', () => {
      const event = EventBuilders.mempool({
        txid: 'mempool-tx-123',
        fee: 5000,
        size: 250,
        feeRate: 20,
      });

      expect(event).toEqual({
        type: 'mempool',
        data: {
          txid: 'mempool-tx-123',
          fee: 5000,
          size: 250,
          feeRate: 20,
        },
      });
    });

    it('should handle high fee rate transactions', () => {
      const event = EventBuilders.mempool({
        txid: 'high-fee-tx',
        fee: 100000,
        size: 200,
        feeRate: 500,
      });

      expect(event.data.feeRate).toBe(500);
    });
  });

  describe('sync', () => {
    it('should create a sync started event', () => {
      const event = EventBuilders.sync('wallet-123', {
        inProgress: true,
        status: 'started',
        timestamp: new Date('2024-01-01T00:00:00Z'),
      });

      expect(event).toEqual({
        type: 'sync',
        walletId: 'wallet-123',
        data: {
          inProgress: true,
          status: 'started',
          timestamp: expect.any(Date),
        },
      });
    });

    it('should create a sync completed event', () => {
      const event = EventBuilders.sync('wallet-123', {
        inProgress: false,
        status: 'completed',
        lastSyncedAt: new Date(),
        timestamp: new Date(),
      });

      expect(event.data.inProgress).toBe(false);
      expect(event.data.status).toBe('completed');
    });

    it('should include retry information', () => {
      const event = EventBuilders.sync('wallet-123', {
        inProgress: true,
        status: 'retrying',
        retryCount: 2,
        maxRetries: 5,
        retryingIn: 30000,
        timestamp: new Date(),
      });

      expect(event.data.retryCount).toBe(2);
      expect(event.data.maxRetries).toBe(5);
      expect(event.data.retryingIn).toBe(30000);
    });

    it('should include error information', () => {
      const event = EventBuilders.sync('wallet-123', {
        inProgress: false,
        error: 'Connection timeout',
        timestamp: new Date(),
      });

      expect(event.data.error).toBe('Connection timeout');
    });
  });

  describe('log', () => {
    it('should create a log event', () => {
      const event = EventBuilders.log('wallet-123', {
        id: 'log-001',
        level: 'info',
        module: 'sync',
        message: 'Syncing started',
        timestamp: '2024-01-01T00:00:00Z',
      });

      expect(event).toEqual({
        type: 'log',
        walletId: 'wallet-123',
        data: {
          id: 'log-001',
          level: 'info',
          module: 'sync',
          message: 'Syncing started',
          timestamp: '2024-01-01T00:00:00Z',
        },
      });
    });

    it('should handle different log levels', () => {
      const levels = ['debug', 'info', 'warn', 'error'] as const;

      for (const level of levels) {
        const event = EventBuilders.log('wallet-123', {
          id: `log-${level}`,
          level,
          module: 'test',
          message: `${level} message`,
          timestamp: new Date().toISOString(),
        });

        expect(event.data.level).toBe(level);
      }
    });

    it('should include details when provided', () => {
      const event = EventBuilders.log('wallet-123', {
        id: 'log-002',
        level: 'error',
        module: 'electrum',
        message: 'Connection failed',
        timestamp: new Date().toISOString(),
        details: { host: 'electrum.example.com', port: 50002, error: 'ECONNREFUSED' },
      });

      expect(event.data.details).toEqual({
        host: 'electrum.example.com',
        port: 50002,
        error: 'ECONNREFUSED',
      });
    });
  });

  describe('error', () => {
    it('should create an error event with message', () => {
      const event = EventBuilders.error('Something went wrong');

      expect(event).toEqual({
        type: 'error',
        data: {
          message: 'Something went wrong',
          code: undefined,
        },
      });
    });

    it('should create an error event with code', () => {
      const event = EventBuilders.error('Authentication failed', 'AUTH_FAILED');

      expect(event).toEqual({
        type: 'error',
        data: {
          message: 'Authentication failed',
          code: 'AUTH_FAILED',
        },
      });
    });

    it('should handle various error codes', () => {
      const errorCodes = ['RATE_LIMITED', 'SUBSCRIPTION_LIMIT', 'INVALID_TOKEN', 'SERVER_ERROR'];

      for (const code of errorCodes) {
        const event = EventBuilders.error(`Error: ${code}`, code);
        expect(event.data.code).toBe(code);
      }
    });
  });
});
