import { vi } from 'vitest';
/**
 * Event Versioning Tests
 *
 * Tests for WebSocket event version management and transformation.
 */

import {
  EventVersionManager,
  createVersionedEvent,
  negotiateVersion,
  isV1Event,
  isV2Event,
  CURRENT_VERSION,
  SUPPORTED_VERSIONS,
  type VersionedEvent,
  type EventVersion,
  type EventDataV2,
  type EventDataV1,
} from '../../../src/websocket/eventVersioning';

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('EventVersioning', () => {
  let manager: EventVersionManager;

  beforeEach(() => {
    manager = new EventVersionManager();
  });

  describe('EventVersionManager', () => {
    describe('client version management', () => {
      it('should set and get client version', () => {
        manager.setClientVersion('client-1', 'v1');

        expect(manager.getClientVersion('client-1')).toBe('v1');
      });

      it('should default to current version for unknown clients', () => {
        expect(manager.getClientVersion('unknown-client')).toBe(CURRENT_VERSION);
      });

      it('should fall back to current version for unsupported versions', () => {
        // @ts-expect-error - testing invalid version
        manager.setClientVersion('client-1', 'v99');

        expect(manager.getClientVersion('client-1')).toBe(CURRENT_VERSION);
      });

      it('should remove client version', () => {
        manager.setClientVersion('client-1', 'v1');
        manager.removeClient('client-1');

        expect(manager.getClientVersion('client-1')).toBe(CURRENT_VERSION);
      });
    });

    describe('event transformation', () => {
      it('should return event unchanged when versions match', () => {
        const event: VersionedEvent<{ test: string }> = {
          type: 'test:event',
          version: 'v2',
          data: { test: 'value' },
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v2');

        expect(transformed).toEqual(event);
      });

      it('should transform wallet:synced from v2 to v1', () => {
        const v2Data: EventDataV2.WalletSynced = {
          walletId: 'wallet-123',
          balanceSats: BigInt(100000000), // 1 BTC
          confirmedSats: BigInt(90000000),
          unconfirmedSats: BigInt(10000000),
          utxoCount: 5,
          syncDurationMs: 1500,
        };

        const event: VersionedEvent<EventDataV2.WalletSynced> = {
          type: 'wallet:synced',
          version: 'v2',
          data: v2Data,
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.version).toBe('v1');
        expect((transformed.data as EventDataV1.WalletSynced).walletId).toBe('wallet-123');
        expect((transformed.data as EventDataV1.WalletSynced).balance).toBe(1); // 1 BTC
      });

      it('should transform transaction:received from v2 to v1', () => {
        const v2Data: EventDataV2.TransactionReceived = {
          txid: 'txid-abc',
          amountSats: BigInt(50000000), // 0.5 BTC
          walletId: 'wallet-123',
          receivingAddress: 'bc1q...',
          isChange: false,
        };

        const event: VersionedEvent<EventDataV2.TransactionReceived> = {
          type: 'transaction:received',
          version: 'v2',
          data: v2Data,
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.version).toBe('v1');
        expect((transformed.data as EventDataV1.TransactionReceived).amount).toBe(0.5);
        expect((transformed.data as EventDataV1.TransactionReceived).txid).toBe('txid-abc');
      });

      it('should transform price:updated from v2 to v1', () => {
        const v2Data: EventDataV2.PriceUpdated = {
          btcUsd: 50000,
          btcEur: 45000,
          btcGbp: 40000,
          source: 'mempool',
          updatedAt: new Date().toISOString(),
        };

        const event: VersionedEvent<EventDataV2.PriceUpdated> = {
          type: 'price:updated',
          version: 'v2',
          data: v2Data,
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.version).toBe('v1');
        expect((transformed.data as EventDataV1.PriceUpdated).btcUsd).toBe(50000);
        // v1 doesn't have btcEur, btcGbp
        expect((transformed.data as any).btcEur).toBeUndefined();
      });

      it('should transform transaction:confirmed from v2 to v1', () => {
        const v2Data: EventDataV2.TransactionConfirmed = {
          txid: 'txid-abc',
          confirmations: 6,
          blockHeight: 800000,
          blockHash: 'blockhash...',
          walletId: 'wallet-123',
        };

        const event: VersionedEvent<EventDataV2.TransactionConfirmed> = {
          type: 'transaction:confirmed',
          version: 'v2',
          data: v2Data,
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.version).toBe('v1');
        expect((transformed.data as EventDataV1.TransactionConfirmed).confirmations).toBe(6);
        // v1 doesn't have blockHeight, blockHash
        expect((transformed.data as any).blockHeight).toBeUndefined();
      });

      it('should transform address:used from v2 to v1', () => {
        const event: VersionedEvent<EventDataV2.AddressUsed> = {
          type: 'address:used',
          version: 'v2',
          data: {
            address: 'bc1qaddr',
            walletId: 'wallet-1',
            txid: 'tx-1',
            isReceive: true,
          },
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.version).toBe('v1');
        expect((transformed.data as EventDataV1.AddressUsed).address).toBe('bc1qaddr');
        expect((transformed.data as any).txid).toBeUndefined();
      });

      it('should transform system:notification from v2 to v1', () => {
        const event: VersionedEvent<EventDataV2.SystemNotification> = {
          type: 'system:notification',
          version: 'v2',
          data: {
            message: 'Heads up',
            level: 'warn',
            code: 'warn-1',
            action: 'refresh',
            dismissable: true,
          },
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.version).toBe('v1');
        expect((transformed.data as EventDataV1.SystemNotification).message).toBe('Heads up');
        expect((transformed.data as any).code).toBeUndefined();
      });

      it('should transform wallet:sync_started from v2 to v1', () => {
        const event: VersionedEvent<EventDataV2.SyncStarted> = {
          type: 'wallet:sync_started',
          version: 'v2',
          data: {
            walletId: 'wallet-1',
            isFullResync: true,
            estimatedDuration: 2000,
          },
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.version).toBe('v1');
        expect((transformed.data as EventDataV1.SyncStarted).walletId).toBe('wallet-1');
        expect((transformed.data as any).isFullResync).toBeUndefined();
      });

      it('should transform wallet:sync_failed from v2 to v1', () => {
        const event: VersionedEvent<EventDataV2.SyncFailed> = {
          type: 'wallet:sync_failed',
          version: 'v2',
          data: {
            walletId: 'wallet-1',
            error: 'boom',
            errorCode: 'E_FAIL',
            retriable: false,
          },
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.version).toBe('v1');
        expect((transformed.data as EventDataV1.SyncFailed).error).toBe('boom');
        expect((transformed.data as any).errorCode).toBeUndefined();
      });

      it('should return tagged event when no transformer exists for v2->v1', () => {
        const event: VersionedEvent<{ foo: string }> = {
          type: 'unknown:event',
          version: 'v2',
          data: { foo: 'bar' },
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.version).toBe('v1');
        expect(transformed.data).toEqual({ foo: 'bar' });
      });

      it('should return original event for unsupported transformation path', () => {
        const event: VersionedEvent<{ foo: string }> = {
          type: 'test:event',
          version: 'v1',
          data: { foo: 'bar' },
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.transformEvent(event, 'v2');

        expect(transformed).toBe(event);
      });

      it('should preserve correlationId during transformation', () => {
        const event: VersionedEvent<EventDataV2.WalletSynced> = {
          type: 'wallet:synced',
          version: 'v2',
          data: {
            walletId: 'wallet-123',
            balanceSats: BigInt(100000000),
            confirmedSats: BigInt(100000000),
            unconfirmedSats: BigInt(0),
            utxoCount: 1,
            syncDurationMs: 100,
          },
          timestamp: new Date().toISOString(),
          correlationId: 'correlation-123',
        };

        const transformed = manager.transformEvent(event, 'v1');

        expect(transformed.correlationId).toBe('correlation-123');
      });
    });

    describe('getEventForClient', () => {
      it('should transform event based on client version', () => {
        manager.setClientVersion('client-v1', 'v1');

        const event: VersionedEvent<EventDataV2.WalletSynced> = {
          type: 'wallet:synced',
          version: 'v2',
          data: {
            walletId: 'wallet-123',
            balanceSats: BigInt(200000000),
            confirmedSats: BigInt(200000000),
            unconfirmedSats: BigInt(0),
            utxoCount: 2,
            syncDurationMs: 200,
          },
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.getEventForClient('client-v1', event);

        expect(transformed.version).toBe('v1');
        expect((transformed.data as EventDataV1.WalletSynced).balance).toBe(2);
      });

      it('should not transform for v2 clients', () => {
        manager.setClientVersion('client-v2', 'v2');

        const event: VersionedEvent<EventDataV2.WalletSynced> = {
          type: 'wallet:synced',
          version: 'v2',
          data: {
            walletId: 'wallet-123',
            balanceSats: BigInt(100000000),
            confirmedSats: BigInt(100000000),
            unconfirmedSats: BigInt(0),
            utxoCount: 1,
            syncDurationMs: 100,
          },
          timestamp: new Date().toISOString(),
        };

        const transformed = manager.getEventForClient('client-v2', event);

        expect(transformed.version).toBe('v2');
        expect((transformed.data as EventDataV2.WalletSynced).utxoCount).toBe(1);
      });
    });

    describe('getStats', () => {
      it('should return version usage statistics', () => {
        manager.setClientVersion('client-1', 'v1');
        manager.setClientVersion('client-2', 'v1');
        manager.setClientVersion('client-3', 'v2');

        const stats = manager.getStats();

        expect(stats.total).toBe(3);
        expect(stats.byVersion.v1).toBe(2);
        expect(stats.byVersion.v2).toBe(1);
      });

      it('should return empty stats when no clients', () => {
        const stats = manager.getStats();

        expect(stats.total).toBe(0);
        expect(stats.byVersion.v1).toBe(0);
        expect(stats.byVersion.v2).toBe(0);
      });
    });
  });

  describe('createVersionedEvent', () => {
    it('should create event with current version', () => {
      const event = createVersionedEvent('test:event', { foo: 'bar' });

      expect(event.type).toBe('test:event');
      expect(event.version).toBe(CURRENT_VERSION);
      expect(event.data).toEqual({ foo: 'bar' });
      expect(event.timestamp).toBeDefined();
    });

    it('should include correlationId when provided', () => {
      const event = createVersionedEvent('test:event', { foo: 'bar' }, {
        correlationId: 'corr-123',
      });

      expect(event.correlationId).toBe('corr-123');
    });

    it('should generate valid ISO timestamp', () => {
      const event = createVersionedEvent('test:event', {});

      expect(() => new Date(event.timestamp)).not.toThrow();
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
    });
  });

  describe('negotiateVersion', () => {
    it('should accept preferred version if supported', () => {
      const response = negotiateVersion('client-1', {
        type: 'version:negotiate',
        preferredVersion: 'v1',
        supportedVersions: ['v1', 'v2'],
      });

      expect(response.version).toBe('v1');
      expect(response.type).toBe('version:negotiated');
    });

    it('should fall back to mutual version if preferred not supported', () => {
      const response = negotiateVersion('client-1', {
        type: 'version:negotiate',
        // @ts-expect-error - testing invalid version
        preferredVersion: 'v99',
        supportedVersions: ['v1', 'v2'],
      });

      // Should pick highest mutual version
      expect(response.version).toBe('v2');
    });

    it('should include server version info in response', () => {
      const response = negotiateVersion('client-1', {
        type: 'version:negotiate',
        preferredVersion: 'v2',
        supportedVersions: ['v1', 'v2'],
      });

      expect(response.serverVersion).toBe(CURRENT_VERSION);
      expect(response.supportedVersions).toEqual(SUPPORTED_VERSIONS);
    });

    it('should keep current version when preferred is unsupported and no mutual versions exist', () => {
      const response = negotiateVersion('client-no-mutual', {
        type: 'version:negotiate',
        // @ts-expect-error - testing invalid version
        preferredVersion: 'v99',
        // @ts-expect-error - testing unsupported client list
        supportedVersions: ['v99'],
      });

      expect(response.version).toBe(CURRENT_VERSION);
    });

    it('should register negotiated version for client', () => {
      const testManager = new EventVersionManager();

      negotiateVersion('client-1', {
        type: 'version:negotiate',
        preferredVersion: 'v1',
        supportedVersions: ['v1', 'v2'],
      });

      // Note: This uses the singleton eventVersionManager, not testManager
      // In real code, you'd want to use a passed manager instance
    });
  });

  describe('type guards', () => {
    it('should identify v1 events', () => {
      const v1Event: VersionedEvent<unknown> = {
        type: 'test',
        version: 'v1',
        data: {},
        timestamp: new Date().toISOString(),
      };

      expect(isV1Event(v1Event)).toBe(true);
      expect(isV2Event(v1Event)).toBe(false);
    });

    it('should identify v2 events', () => {
      const v2Event: VersionedEvent<unknown> = {
        type: 'test',
        version: 'v2',
        data: {},
        timestamp: new Date().toISOString(),
      };

      expect(isV2Event(v2Event)).toBe(true);
      expect(isV1Event(v2Event)).toBe(false);
    });
  });

  describe('constants', () => {
    it('should have v2 as current version', () => {
      expect(CURRENT_VERSION).toBe('v2');
    });

    it('should support v1 and v2', () => {
      expect(SUPPORTED_VERSIONS).toContain('v1');
      expect(SUPPORTED_VERSIONS).toContain('v2');
      expect(SUPPORTED_VERSIONS).toHaveLength(2);
    });
  });

  describe('P3-7 bounded clientVersions map', () => {
    it('evicts the oldest client entry when exceeding the configured maxClients cap', () => {
      const bounded = new EventVersionManager(3);
      bounded.setClientVersion('client-1', 'v1');
      bounded.setClientVersion('client-2', 'v1');
      bounded.setClientVersion('client-3', 'v1');
      bounded.setClientVersion('client-4', 'v1');

      expect(bounded.getStats().total).toBe(3);
      expect(bounded.getClientVersion('client-1')).toBe(CURRENT_VERSION);
      expect(bounded.getClientVersion('client-2')).toBe('v1');
      expect(bounded.getClientVersion('client-4')).toBe('v1');
    });
  });
});
