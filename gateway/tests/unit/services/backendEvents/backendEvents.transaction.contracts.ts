import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockDeviceFetchResponse,
  mockFetch,
  push,
  setupBackendEventsTestHarness,
  startBackendEvents,
  wsInstances,
} from './backendEventsTestHarness';

describe('Backend Events Service transaction notifications', () => {
  setupBackendEventsTestHarness();

  beforeEach(() => {
    mockDeviceFetchResponse();
  });

  it('should handle transaction event and send push notification', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'transaction',
        walletId: 'wallet-1',
        walletName: 'Main Wallet',
        userId: 'user-123',
        data: {
          txid: 'abc123',
          type: 'received',
          amount: 50000,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/push/by-user/user-123'),
      expect.any(Object)
    );
    expect(push.sendToDevices).toHaveBeenCalled();
  });

  it('should handle confirmation event on first confirmation', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'confirmation',
        walletId: 'wallet-1',
        walletName: 'Main Wallet',
        userId: 'user-123',
        data: {
          txid: 'abc123',
          confirmations: 1,
          amount: 50000,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.sendToDevices).toHaveBeenCalled();
  });

  it('should not send notification for subsequent confirmations', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'confirmation',
        walletId: 'wallet-1',
        userId: 'user-123',
        data: {
          txid: 'abc123',
          confirmations: 2,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.sendToDevices).not.toHaveBeenCalled();
  });

  it('should not send notification for events without userId', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'transaction',
        walletId: 'wallet-1',
        data: {
          txid: 'abc123',
          type: 'received',
          amount: 50000,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(push.sendToDevices).not.toHaveBeenCalled();
  });

  it('should ignore balance and sync events', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'balance',
        walletId: 'wallet-1',
        userId: 'user-123',
        data: {},
      },
    });

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'sync',
        walletId: 'wallet-1',
        userId: 'user-123',
        data: {},
      },
    });

    await vi.runAllTimersAsync();

    expect(push.sendToDevices).not.toHaveBeenCalled();
  });

  it('should not send notification when user has no devices', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'transaction',
        walletId: 'wallet-1',
        userId: 'user-123',
        data: {
          txid: 'abc123',
          type: 'received',
          amount: 50000,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.sendToDevices).not.toHaveBeenCalled();
  });

  it('should handle consolidation transactions as sent', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'transaction',
        walletId: 'wallet-1',
        walletName: 'Test',
        userId: 'user-123',
        data: {
          txid: 'abc123',
          type: 'consolidation',
          amount: 50000,
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatTransactionNotification).toHaveBeenCalledWith(
      'sent',
      'Test',
      50000,
      'abc123'
    );
  });

  it('should handle broadcast_success event', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'broadcast_success',
        walletId: 'wallet-1',
        walletName: 'Main Wallet',
        userId: 'user-123',
        data: {
          txid: 'tx123',
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatBroadcastNotification).toHaveBeenCalledWith(
      true,
      'Main Wallet',
      'tx123'
    );
    expect(push.sendToDevices).toHaveBeenCalled();
  });

  it('should handle broadcast_failed event', async () => {
    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'broadcast_failed',
        walletId: 'wallet-1',
        walletName: 'Main Wallet',
        userId: 'user-123',
        data: {
          txid: 'tx456',
          error: 'Insufficient funds',
        },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.formatBroadcastNotification).toHaveBeenCalledWith(
      false,
      'Main Wallet',
      'tx456',
      'Insufficient funds'
    );
    expect(push.sendToDevices).toHaveBeenCalled();
  });
});
