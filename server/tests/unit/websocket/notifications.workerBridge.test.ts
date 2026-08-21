/**
 * Worker → UI Bridge Tests
 *
 * The worker process never initializes a WebSocket server, so every broadcast
 * it makes used to be dropped on the floor. These tests pin the fallback:
 * without a local server the same legacy envelope is published onto the Redis
 * bridge channel so the API process can fan it out to its clients unchanged.
 */

import { vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const mockPublishBroadcast = vi.hoisted(() => vi.fn());
const mockBridgeIsActive = vi.hoisted(() => vi.fn(() => true));
const mockLocalBroadcast = vi.hoisted(() => vi.fn());

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../src/websocket/redisBridge', () => ({
  redisBridge: {
    publishBroadcast: mockPublishBroadcast,
    isActive: mockBridgeIsActive,
  },
}));

vi.mock('../../../src/websocket/server', () => ({
  getWebSocketServer: vi.fn(() => {
    throw new Error('WebSocket server not initialized');
  }),
  getWebSocketServerIfInitialized: vi.fn(() => null),
  getGatewayWebSocketServer: vi.fn(() => null),
}));

import {
  broadcastSyncStatus,
  broadcastWalletLog,
  broadcastTransactionNotification,
} from '../../../src/websocket/notifications/broadcasts';
import { walletLogBuffer } from '../../../src/services/walletLogBuffer';

describe('worker broadcasts without a local WebSocket server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBridgeIsActive.mockReturnValue(true);
    mockLocalBroadcast.mockReset();
  });

  it('publishes sync status onto the Redis bridge', () => {
    broadcastSyncStatus('wallet-1', { inProgress: true });

    expect(mockPublishBroadcast).toHaveBeenCalledTimes(1);
    expect(mockPublishBroadcast).toHaveBeenCalledWith({
      type: 'sync',
      walletId: 'wallet-1',
      data: expect.objectContaining({
        inProgress: true,
        walletId: 'wallet-1',
        timestamp: expect.any(String),
      }),
    });
  });

  it('publishes terminal sync failures with the error attached', () => {
    broadcastSyncStatus('wallet-1', {
      inProgress: false,
      status: 'failed',
      error: 'Electrum unreachable',
    });

    expect(mockPublishBroadcast).toHaveBeenCalledWith({
      type: 'sync',
      walletId: 'wallet-1',
      data: expect.objectContaining({
        inProgress: false,
        status: 'failed',
        error: 'Electrum unreachable',
      }),
    });
  });

  it('preserves the complete authoritative sync snapshot across the worker bridge', () => {
    const lastSyncedAt = new Date('2026-08-20T12:00:00.000Z');
    const nextRetryAt = new Date('2026-08-20T12:05:00.000Z');

    broadcastSyncStatus('wallet-1', {
      inProgress: false,
      transition: 'retrying',
      status: 'retrying',
      syncStatus: 'retrying',
      error: 'Electrum unavailable',
      failureClass: 'electrum_unavailable',
      lastSyncedAt,
      executionOwner: 'worker',
      retryCount: 2,
      nextRetryAt,
      startedAt: null,
      stateVersion: 7,
      retriesExhausted: false,
    });

    expect(mockPublishBroadcast).toHaveBeenCalledWith({
      type: 'sync',
      walletId: 'wallet-1',
      data: {
        inProgress: false,
        transition: 'retrying',
        status: 'retrying',
        syncStatus: 'retrying',
        error: 'Electrum unavailable',
        failureClass: 'electrum_unavailable',
        lastSyncedAt,
        executionOwner: 'worker',
        retryCount: 2,
        nextRetryAt,
        startedAt: null,
        stateVersion: 7,
        retriesExhausted: false,
        walletId: 'wallet-1',
        timestamp: expect.any(String),
      },
    });
  });

  it('publishes wallet log entries onto the Redis bridge', () => {
    broadcastWalletLog('wallet-2', {
      level: 'info',
      module: 'SYNC',
      message: 'Sync started',
    });

    expect(mockPublishBroadcast).toHaveBeenCalledTimes(1);
    const published = mockPublishBroadcast.mock.calls[0][0];
    expect(published.type).toBe('log');
    expect(published.walletId).toBe('wallet-2');
    expect(published.data).toEqual(expect.objectContaining({
      level: 'info',
      module: 'SYNC',
      message: 'Sync started',
      id: expect.any(String),
      timestamp: expect.any(String),
    }));
    // The log envelope must not carry walletId inside data - the API side
    // relies on the exact shape clientServer.broadcast already publishes.
    expect(published.data.walletId).toBeUndefined();
  });

  it('still records worker log entries in the local buffer', () => {
    walletLogBuffer.clear('wallet-3');
    broadcastWalletLog('wallet-3', {
      level: 'error',
      module: 'SYNC',
      message: 'Sync failed',
    });

    expect(walletLogBuffer.get('wallet-3')).toHaveLength(1);
  });

  it('publishes transaction notifications so the UI still learns about them', () => {
    broadcastTransactionNotification({
      walletId: 'wallet-4',
      txid: 'tx-1',
      type: 'received',
      amount: 1000,
      confirmations: 0,
      timestamp: new Date('2026-08-19T00:00:00.000Z'),
    });

    expect(mockPublishBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'transaction',
      walletId: 'wallet-4',
    }));
  });

  it('drops the broadcast when the bridge is not active either', () => {
    mockBridgeIsActive.mockReturnValue(false);

    broadcastSyncStatus('wallet-5', { inProgress: true });

    expect(mockPublishBroadcast).not.toHaveBeenCalled();
  });
});
