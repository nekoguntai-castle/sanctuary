import { describe, expect, it, vi } from 'vitest';

import {
  mockFetch,
  push,
  setupBackendEventsTestHarness,
  startBackendEvents,
  wsInstances,
} from './backendEventsTestHarness';

describe('Backend Events Service error and token handling', () => {
  setupBackendEventsTestHarness();

  it('should remove invalid tokens from backend', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: 'device-1', platform: 'android', pushToken: 'invalid-token', userId: 'user-123' },
        ]),
    });

    vi.mocked(push.sendToDevices).mockResolvedValueOnce({
      success: 0,
      failed: 1,
      invalidTokens: [{ id: 'device-1', token: 'invalid-token' }],
    });

    mockFetch.mockResolvedValueOnce({ ok: true });

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
        data: { txid: 'abc123', type: 'received', amount: 50000 },
      },
    });

    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/push/device/device-1'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('should include HMAC signature headers when fetching devices', async () => {
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
        data: { txid: 'abc', type: 'received', amount: 1000 },
      },
    });

    await vi.runAllTimersAsync();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Gateway-Signature': expect.any(String),
          'X-Gateway-Timestamp': expect.any(String),
        }),
      })
    );
  });

  it('should handle fetch errors when getting devices', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    startBackendEvents();
    const ws = wsInstances[0];
    ws.simulateOpen();

    ws.simulateMessage({
      type: 'event',
      event: {
        type: 'transaction',
        walletId: 'wallet-1',
        userId: 'user-123',
        data: { txid: 'abc', type: 'received', amount: 1000 },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.sendToDevices).not.toHaveBeenCalled();
  });

  it('should handle non-ok response when fetching devices', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
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
        data: { txid: 'abc', type: 'received', amount: 1000 },
      },
    });

    await vi.runAllTimersAsync();

    expect(push.sendToDevices).not.toHaveBeenCalled();
  });

  it('should handle failed invalid token removal', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: 'device-1', platform: 'android', pushToken: 'token', userId: 'user-123' },
        ]),
    });

    vi.mocked(push.sendToDevices).mockResolvedValueOnce({
      success: 0,
      failed: 1,
      invalidTokens: [{ id: 'device-1', token: 'token' }],
    });

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

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
        data: { txid: 'abc123', type: 'received', amount: 50000 },
      },
    });

    await vi.runAllTimersAsync();
  });
});
