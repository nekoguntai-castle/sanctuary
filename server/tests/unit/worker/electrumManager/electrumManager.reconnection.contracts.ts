import { expect, it, vi } from 'vitest';
import prisma from '../../../../src/models/prisma';
import { scheduleReconnect } from '../../../../src/worker/electrumManager/reconnection';
import { getAddressSubscriptionKey, RECONNECT_BASE_DELAY_MS, type NetworkState } from '../../../../src/worker/electrumManager/types';
import {
  createTimeoutHandle, getAddressToWallet, getNetworks, manager, mockCallbacks, mockClient,
} from './electrumManagerTestHarness';

export function registerReconnectionContracts() {
  it('clears existing reconnect timer and logs when attempts exceed max', () => {
    const networks = getNetworks();
    const addressToWallet = getAddressToWallet();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const reconnectTimer = createTimeoutHandle();

    networks.set('mainnet', {
      network: 'mainnet',
      client: mockClient as any,
      connected: false,
      subscribedToHeaders: false,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer,
      reconnectAttempts: 10,
    });

    scheduleReconnect('mainnet', networks, addressToWallet, mockCallbacks, () => true, vi.fn());
    expect(clearTimeoutSpy).toHaveBeenCalledWith(reconnectTimer);

    clearTimeoutSpy.mockRestore();
  });

  it('returns early from reconnect timer callback when manager is not running', async () => {
    vi.useFakeTimers();
    const networks = getNetworks();
    const addressToWallet = getAddressToWallet();

    const state: NetworkState = {
      network: 'mainnet',
      client: mockClient as any,
      connected: false,
      subscribedToHeaders: false,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    };
    networks.set('mainnet', state);

    scheduleReconnect('mainnet', networks, addressToWallet, mockCallbacks, () => false, vi.fn());
    await vi.advanceTimersByTimeAsync(5_000);

    // connectNetwork should not have been called since isRunning returns false
    expect(mockClient.connect).not.toHaveBeenCalled();
    expect(state.reconnectAttempts).toBe(0);

    vi.useRealTimers();
  });

  it('handles reconnect timer callback when original state is missing and skips resubscribe', async () => {
    vi.useFakeTimers();
    const networks = getNetworks();
    const addressToWallet = getAddressToWallet();
    const resubscribeSpy = vi.fn();

    networks.clear();

    // Mock connect to fail silently (so network stays disconnected)
    mockClient.connect.mockRejectedValueOnce(new Error('still down'));

    scheduleReconnect('mainnet', networks, addressToWallet, mockCallbacks, () => true, resubscribeSpy);
    await vi.advanceTimersByTimeAsync(5_000);

    // State was created but not connected, so resubscribe should not be called
    expect(resubscribeSpy).not.toHaveBeenCalled();

    const state = networks.get('mainnet');
    expect(state).toBeDefined();
    expect(state!.connected).toBe(false);

    vi.useRealTimers();
  });

  it('updates reconnect state and resubscribes network addresses on reconnect success', async () => {
    vi.useFakeTimers();
    const networks = getNetworks();
    const addressToWallet = getAddressToWallet();
    const resubscribeSpy = vi.fn();

    const state: NetworkState = {
      network: 'mainnet',
      client: mockClient as any,
      connected: true, // Will be found connected after connectNetwork succeeds
      subscribedToHeaders: false,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    };
    networks.set('mainnet', state);

    scheduleReconnect('mainnet', networks, addressToWallet, mockCallbacks, () => true, resubscribeSpy);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(resubscribeSpy).toHaveBeenCalledWith('mainnet');
    expect(state.reconnectTimer).toBeNull();
    expect(state.reconnectAttempts).toBe(0);

    vi.useRealTimers();
  });

  it('contains reconnect restoration failures inside the timer callback', async () => {
    vi.useFakeTimers();
    const networks = getNetworks();
    const addressToWallet = getAddressToWallet();
    const state: NetworkState = {
      network: 'mainnet',
      client: mockClient as any,
      connected: true,
      subscribedToHeaders: false,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    };
    networks.set('mainnet', state);
    const resubscribeSpy = vi.fn().mockRejectedValue(new Error('checkpoint unavailable'));

    try {
      scheduleReconnect(
        'mainnet',
        networks,
        addressToWallet,
        mockCallbacks,
        () => true,
        resubscribeSpy,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect(resubscribeSpy).toHaveBeenCalledWith('mainnet');
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms scheduleReconnect when resubscribe fails after a successful reconnect', async () => {
    vi.useFakeTimers();
    const networks = getNetworks();
    const addressToWallet = getAddressToWallet();
    const state: NetworkState = {
      network: 'mainnet',
      client: mockClient as any,
      connected: true,
      subscribedToHeaders: false,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    };
    networks.set('mainnet', state);
    const resubscribeSpy = vi.fn().mockRejectedValueOnce(new Error('subscribe failed'));

    try {
      scheduleReconnect('mainnet', networks, addressToWallet, mockCallbacks, () => true, resubscribeSpy);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(resubscribeSpy).toHaveBeenCalledWith('mainnet');
      const afterFailure = networks.get('mainnet')!;
      // The network must not be left silently unsubscribed: either a fresh
      // reconnect timer is armed, or the subscription was retried.
      const stuck = afterFailure.connected
        && afterFailure.subscribedAddresses.size === 0
        && afterFailure.reconnectTimer === null;
      expect(stuck).toBe(false);
      expect(afterFailure.reconnectTimer).not.toBeNull();
      // reconnectAttempts is left incremented (not reset) by the failed
      // resubscribe, which is what makes the re-armed backoff below grow
      // instead of retrying at a flat RECONNECT_BASE_DELAY_MS forever.
      expect(afterFailure.reconnectAttempts).toBe(1);

      resubscribeSpy.mockResolvedValueOnce(undefined);
      // A flat retry (the reset-before-subscribe bug) would fire the second
      // attempt at RECONNECT_BASE_DELAY_MS after the first failure; prove
      // the backoff actually doubled by checking the spy is still at one
      // call right up to that boundary...
      await vi.advanceTimersByTimeAsync(RECONNECT_BASE_DELAY_MS);
      expect(resubscribeSpy).toHaveBeenCalledTimes(1);
      // ...and only fires the second attempt one further base-delay tick
      // later, at the doubled (2x) backoff.
      await vi.advanceTimersByTimeAsync(RECONNECT_BASE_DELAY_MS);
      expect(resubscribeSpy).toHaveBeenCalledTimes(2);
      expect(networks.get('mainnet')!.reconnectAttempts).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-arm reconnect when ownership is lost before the resubscribe failure is handled', async () => {
    vi.useFakeTimers();
    const networks = getNetworks();
    const addressToWallet = getAddressToWallet();
    const state: NetworkState = {
      network: 'mainnet',
      client: mockClient as any,
      connected: true,
      subscribedToHeaders: false,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    };
    networks.set('mainnet', state);
    let active = true;
    const resubscribeSpy = vi.fn().mockImplementationOnce(async () => {
      active = false;
      throw new Error('subscribe failed');
    });

    try {
      scheduleReconnect('mainnet', networks, addressToWallet, mockCallbacks, () => active, resubscribeSpy);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(resubscribeSpy).toHaveBeenCalledWith('mainnet');
      expect(networks.get('mainnet')!.reconnectTimer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resubscribes through the manager reconnect callback after a reconnect succeeds', async () => {
    vi.useFakeTimers();
    const networks = getNetworks();
    const addressToWallet = getAddressToWallet();
    const onNetworkReady = vi.fn().mockResolvedValue(undefined);
    const onSubscriptionStatuses = vi.fn().mockResolvedValue(undefined);
    mockCallbacks.onNetworkReady = onNetworkReady;
    mockCallbacks.onSubscriptionStatuses = onSubscriptionStatuses;

    networks.set('mainnet', {
      network: 'mainnet',
      client: mockClient as any,
      connected: true,
      subscribedToHeaders: true,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    });
    addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr-manager-reconnect'), { walletId: 'wallet-reconnect', network: 'mainnet' });
    (manager as any).isRunningFlag = true;
    (manager as any).subscriptionLock = { key: 'lock', token: 'token' };

    try {
      (manager as any).doScheduleReconnect('mainnet');
      await vi.advanceTimersByTimeAsync(5_000);

      expect(onNetworkReady).toHaveBeenCalledOnce();
      expect(onNetworkReady).toHaveBeenCalledWith('mainnet');
      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-manager-reconnect']);
      expect(onSubscriptionStatuses).toHaveBeenCalledOnce();
      expect(onSubscriptionStatuses).toHaveBeenCalledWith(
        'mainnet',
        new Map([['addr-manager-reconnect', 'status']]),
        'reconnect',
      );
      expect(networks.get('mainnet')?.reconnectAttempts).toBe(0);
    } finally {
      delete mockCallbacks.onNetworkReady;
      delete mockCallbacks.onSubscriptionStatuses;
      vi.useRealTimers();
    }
  });

  it('covers a status refresh skipped while disconnected with the reconnect resubscribe', async () => {
    // Item 4 of the subscription-status-refresh plan: a refresh page that runs
    // while a network is down advances its cursor without reading any status.
    // The status that changed in that window must still reach the checkpoint
    // comparison (which raises intent on a mismatch) when the network returns.
    vi.useFakeTimers();
    const networks = getNetworks();
    const addressToWallet = getAddressToWallet();
    const onSubscriptionStatuses = vi.fn().mockResolvedValue(undefined);
    mockCallbacks.onSubscriptionStatuses = onSubscriptionStatuses;
    networks.set('mainnet', {
      network: 'mainnet',
      client: mockClient as any,
      connected: false,
      subscribedToHeaders: false,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    });
    addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr-gap'), {
      walletId: 'wallet-gap', network: 'mainnet',
    });
    (manager as any).isRunningFlag = true;
    (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
    vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
      id: 'address-1', address: 'addr-gap', walletId: 'wallet-gap',
      wallet: { network: 'mainnet' },
    }] as any);

    try {
      await expect(manager.refreshSubscriptionStatusPage('mainnet', { limit: 1 }))
        .resolves.toEqual({
          scanned: 1, nextCursor: 'address-1', outcome: 'skipped_disconnected',
        });
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
      expect(onSubscriptionStatuses).not.toHaveBeenCalled();

      mockClient.subscribeAddressBatch.mockResolvedValueOnce(
        new Map([['addr-gap', 'status-changed-while-down']]),
      );
      (manager as any).doScheduleReconnect('mainnet');
      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-gap']);
      expect(onSubscriptionStatuses).toHaveBeenCalledExactlyOnceWith(
        'mainnet',
        new Map([['addr-gap', 'status-changed-while-down']]),
        'reconnect',
      );
    } finally {
      delete mockCallbacks.onSubscriptionStatuses;
      vi.useRealTimers();
    }
  });

  it('discards a late reconnect after exact ownership is lost', async () => {
    vi.useFakeTimers();
    const networks = getNetworks();
    let finishConnect!: () => void;
    mockClient.connect.mockReturnValueOnce(new Promise<void>((resolve) => {
      finishConnect = resolve;
    }));
    networks.set('mainnet', {
      network: 'mainnet',
      client: mockClient as any,
      connected: false,
      subscribedToHeaders: false,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    });
    (manager as any).isRunningFlag = true;
    (manager as any).subscriptionLock = { key: 'lock', token: 'token' };

    (manager as any).doScheduleReconnect('mainnet');
    vi.advanceTimersByTime(5_000);
    await vi.waitFor(() => {
      expect(mockClient.connect).toHaveBeenCalledOnce();
    });
    await (manager as any).stopRunningManager();
    finishConnect();
    await vi.waitFor(() => {
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    expect(mockClient.subscribeHeaders).not.toHaveBeenCalled();
    expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    expect(networks.size).toBe(0);
    vi.useRealTimers();
  });

  it('stops reconnect resubscription when ownership is lost during readiness', async () => {
    vi.useFakeTimers();
    const networks = getNetworks();
    let finishReady!: () => void;
    mockCallbacks.onNetworkReady = vi.fn(() => new Promise<void>((resolve) => {
      finishReady = resolve;
    }));
    networks.set('mainnet', {
      network: 'mainnet',
      client: mockClient as any,
      connected: true,
      subscribedToHeaders: true,
      subscribedAddresses: new Set<string>(),
      lastBlockHeight: 0,
      reconnectTimer: null,
      reconnectAttempts: 0,
    });
    getAddressToWallet().set(
      getAddressSubscriptionKey('mainnet', 'addr-reconnect'),
      { walletId: 'wallet-1', network: 'mainnet' },
    );
    (manager as any).isRunningFlag = true;
    (manager as any).subscriptionLock = { key: 'lock', token: 'token' };

    (manager as any).doScheduleReconnect('mainnet');
    vi.advanceTimersByTime(5_000);
    await vi.waitFor(() => {
      expect(mockCallbacks.onNetworkReady).toHaveBeenCalledOnce();
    });
    await (manager as any).stopRunningManager();
    finishReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    delete mockCallbacks.onNetworkReady;
    vi.useRealTimers();
  });
}
