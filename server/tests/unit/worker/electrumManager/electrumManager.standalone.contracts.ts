import { describe, expect, it, vi } from 'vitest';
import { connectNetwork, setupEventHandlers, subscribeHeaders } from '../../../../src/worker/electrumManager/networkConnection';
import { scheduleReconnect } from '../../../../src/worker/electrumManager/reconnection';
import { subscribeAddressBatch, subscribeAllAddresses, subscribeNetworkAddresses } from '../../../../src/worker/electrumManager/addressSubscriptions';
import { checkHealth } from '../../../../src/worker/electrumManager/healthMonitoring';
import type { BitcoinNetwork, NetworkState } from '../../../../src/worker/electrumManager/types';
import {
  manager,
  mockClient,
  mockCallbacks,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';
import { acquireLock, extendLock, releaseLock } from '../../../../src/infrastructure';
import { closeAllElectrumClients } from '../../../../src/services/bitcoin/electrum';

export function registerElectrumManagerStandaloneContracts() {
  describe('standalone function behavior', () => {
    // Helper to get internal state
    const getNetworks = () => (manager as any).networks as Map<BitcoinNetwork, NetworkState>;
    const getAddressToWallet = () => (manager as any).addressToWallet as Map<string, { walletId: string; network: BitcoinNetwork }>;

    it('handles connectNetwork fast-path and connection failure reconnect scheduling', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

      // Already connected branch
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

      const noopSchedule = vi.fn();
      await connectNetwork('mainnet', networks, addressToWallet, mockCallbacks, () => true, noopSchedule);
      expect(mockClient.connect).not.toHaveBeenCalled();

      // Connection failure branch creates/updates reconnect state
      networks.clear();
      mockClient.connect.mockRejectedValueOnce(new Error('connect failed'));
      await connectNetwork('mainnet', networks, addressToWallet, mockCallbacks, () => true, noopSchedule);
      expect(noopSchedule).toHaveBeenCalledWith('mainnet');
    });

    it('reconnects when network state exists but is marked disconnected', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

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

      await connectNetwork('mainnet', networks, addressToWallet, mockCallbacks, () => true, vi.fn());

      expect(mockClient.connect).toHaveBeenCalled();
      const state = networks.get('mainnet')!;
      expect(state.connected).toBe(true);
    });

    it('continues when server version lookup fails and when header subscription fails', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

      mockClient.getServerVersion.mockRejectedValueOnce(new Error('version failed'));
      mockClient.subscribeHeaders.mockRejectedValueOnce(new Error('headers failed'));

      await connectNetwork('mainnet', networks, addressToWallet, mockCallbacks, () => true, vi.fn());

      const state = networks.get('mainnet');
      expect(state).toBeDefined();
      expect(state!.subscribedToHeaders).toBe(false);
    });

    it('handles additional event paths for untracked addresses, missing address, close, and error', async () => {
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);
      await manager.start();

      const state = getNetworks().get('mainnet')!;
      state.subscribedAddresses.add('tracked-address');

      mockClient.emit('addressActivity', { scriptHash: 'x', status: 'changed' });
      mockClient.emit('addressActivity', { scriptHash: 'x', address: 'unknown', status: 'changed' });
      expect(mockCallbacks.onAddressActivity).not.toHaveBeenCalled();

      mockClient.emit('error', new Error('socket exploded'));
      mockClient.emit('close');

      expect(state.connected).toBe(false);
      expect(state.subscribedToHeaders).toBe(false);
      expect(state.subscribedAddresses.size).toBe(0);
      expect(state.reconnectTimer).not.toBeNull();
    });

    it('does not schedule reconnect on close when manager is not running', () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();
      const scheduleReconnectSpy = vi.fn();

      const state: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      setupEventHandlers(state, addressToWallet, mockCallbacks, () => false, scheduleReconnectSpy);
      mockClient.emit('close');

      expect(scheduleReconnectSpy).not.toHaveBeenCalled();
      expect(state.connected).toBe(false);
      expect(state.subscribedToHeaders).toBe(false);
    });

    it('covers subscribeAddressBatch no-op and fallback individual subscription mode', async () => {
      const state: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['already']),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      await subscribeAddressBatch(state, [{ address: 'already', walletId: 'w1' }]);
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();

      mockClient.subscribeAddressBatch.mockRejectedValueOnce(new Error('batch failed'));
      mockClient.subscribeAddress
        .mockResolvedValueOnce('ok')
        .mockRejectedValueOnce(new Error('single failed'));

      await subscribeAddressBatch(state, [
        { address: 'new-a', walletId: 'w1' },
        { address: 'new-b', walletId: 'w1' },
      ]);

      expect(state.subscribedAddresses.has('new-a')).toBe(true);
      expect(state.subscribedAddresses.has('new-b')).toBe(false);
    });

    it('covers subscribeAllAddresses pagination progress and disconnected-network warning', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

      const disconnectedState: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: false,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      networks.set('mainnet', disconnectedState);

      const makePage = (offset: number) =>
        Array.from({ length: 1000 }, (_, i) => ({
          id: `id-${offset + i}`,
          address: `addr-${offset + i}`,
          walletId: `wallet-${offset + i}`,
          wallet: { network: 'mainnet' },
        }));

      vi.mocked(prisma.address.findMany)
        .mockResolvedValueOnce(makePage(0) as any)
        .mockResolvedValueOnce(makePage(1000) as any)
        .mockResolvedValueOnce(makePage(2000) as any)
        .mockResolvedValueOnce(makePage(3000) as any)
        .mockResolvedValueOnce(makePage(4000) as any)
        .mockResolvedValueOnce([]);

      await subscribeAllAddresses(networks, addressToWallet);

      expect(addressToWallet.size).toBe(5000);
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('covers subscribeNetworkAddresses and checkHealth reconnect behavior', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

      const state: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      const disconnected: NetworkState = {
        network: 'testnet',
        client: mockClient as any,
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      networks.set('mainnet', state);
      networks.set('testnet', disconnected);
      addressToWallet.set('addr-main', { walletId: 'w-main', network: 'mainnet' });

      await subscribeNetworkAddresses('mainnet', networks, addressToWallet);
      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-main']);

      mockClient.getServerVersion.mockRejectedValueOnce(new Error('health failed'));
      const scheduleReconnectSpy = vi.fn();
      await checkHealth(networks, scheduleReconnectSpy);

      expect(disconnected.connected).toBe(false);
      expect(state.connected).toBe(false);
      expect(scheduleReconnectSpy).toHaveBeenCalledWith('mainnet');
    });

    it('removes wallet addresses from tracking and subscribed sets', () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

      const state: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['addr1', 'addr2']),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      networks.set('mainnet', state);
      addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('addr2', { walletId: 'wallet2', network: 'mainnet' });

      manager.unsubscribeWalletAddresses('wallet1');

      expect(addressToWallet.has('addr1')).toBe(false);
      expect(addressToWallet.has('addr2')).toBe(true);
      expect(state.subscribedAddresses.has('addr1')).toBe(false);
      expect(state.subscribedAddresses.has('addr2')).toBe(true);
    });

    it('removes wallet addresses even when network state no longer exists', () => {
      const addressToWallet = getAddressToWallet();
      addressToWallet.set('orphan-addr', { walletId: 'wallet-orphan', network: 'signet' });

      manager.unsubscribeWalletAddresses('wallet-orphan');

      expect(addressToWallet.has('orphan-addr')).toBe(false);
    });

    it('reconciles with connected network subscriptions and subscribed-address cleanup', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

      const state: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['old-address']),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      networks.set('mainnet', state);
      addressToWallet.set('old-address', { walletId: 'wallet-old', network: 'mainnet' });

      vi.mocked(prisma.address.findMany)
        .mockResolvedValueOnce([
          { id: '1', address: 'new-address', walletId: 'wallet-new', wallet: { network: 'mainnet' } },
        ] as any)
        .mockResolvedValueOnce([]);

      const result = await manager.reconcileSubscriptions();
      expect(result).toEqual({ removed: 1, added: 1 });
      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['new-address']);
      expect(state.subscribedAddresses.has('old-address')).toBe(false);
    });

    it('populates network metrics and clears reconnect timers during stop', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

      const reconnectTimer = setTimeout(() => undefined, 10_000);
      const state: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['addr1']),
        lastBlockHeight: 777,
        reconnectTimer,
        reconnectAttempts: 3,
      };

      (manager as any).isRunningFlag = true;
      networks.set('mainnet', state);
      addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });
      (manager as any).subscriptionLock = { key: 'k', token: 't' };
      vi.mocked(releaseLock).mockResolvedValue(true);

      const metrics = manager.getHealthMetrics();
      expect(metrics.networks.mainnet).toEqual({
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: 1,
        lastBlockHeight: 777,
        reconnectAttempts: 3,
      });

      await manager.stop();

      expect(vi.mocked(releaseLock)).toHaveBeenCalled();
      expect(vi.mocked(closeAllElectrumClients)).toHaveBeenCalled();
      expect(state.reconnectTimer).toBeNull();
      expect(networks.size).toBe(0);
      expect(addressToWallet.size).toBe(0);
    });

    it('refreshes and then loses subscription lock via timer callback', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);
      vi.mocked(extendLock)
        .mockResolvedValueOnce({ key: 'lock', token: 'token-2' } as any)
        .mockResolvedValueOnce(null);
      vi.mocked(releaseLock).mockResolvedValue(true);

      await manager.start();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(vi.mocked(extendLock)).toHaveBeenCalledTimes(1);
      expect(manager.getHealthMetrics().isRunning).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);

      vi.useRealTimers();
    });

    it('skips subscribeHeaders when already subscribed', async () => {
      const state: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      await subscribeHeaders(state);
      expect(mockClient.subscribeHeaders).not.toHaveBeenCalled();
    });

    it('clears existing reconnect timer and logs when attempts exceed max', () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const reconnectTimer = setTimeout(() => undefined, 10_000);

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

    it('subscribes connected network batches during subscribeAllAddresses pagination', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

      const connectedState: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      networks.set('mainnet', connectedState);

      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'addr-connected', walletId: 'wallet1', wallet: { network: 'mainnet' } },
      ] as any);

      await subscribeAllAddresses(networks, addressToWallet);

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-connected']);
    });

    it('defaults to mainnet in subscribeAllAddresses when wallet network is missing', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

      const connectedState: NetworkState = {
        network: 'mainnet',
        client: mockClient as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      networks.set('mainnet', connectedState);

      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'addr-fallback-sub', walletId: 'wallet1', wallet: {} },
      ] as any);

      await subscribeAllAddresses(networks, addressToWallet);

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-fallback-sub']);
    });

    it('returns early in subscribeNetworkAddresses when state is disconnected', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

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

      await subscribeNetworkAddresses('mainnet', networks, addressToWallet);
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('skips subscribeNetworkAddresses when tracked addresses are for other networks', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();

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
      addressToWallet.set('addr-test-only', { walletId: 'w-test', network: 'testnet' });

      await subscribeNetworkAddresses('mainnet', networks, addressToWallet);
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });
  });
}
