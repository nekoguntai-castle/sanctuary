import { describe, expect, it, vi } from 'vitest';
import { connectNetwork, setupEventHandlers, subscribeHeaders } from '../../../../src/worker/electrumManager/networkConnection';
import { scheduleReconnect } from '../../../../src/worker/electrumManager/reconnection';
import { subscribeAddressBatch, subscribeAllAddresses, subscribeNetworkAddresses } from '../../../../src/worker/electrumManager/addressSubscriptions';
import { checkHealth, reconcileSubscriptions } from '../../../../src/worker/electrumManager/healthMonitoring';
import {
  getAddressSubscriptionKey,
  type AddressWalletInfo,
  type BitcoinNetwork,
  type NetworkState,
} from '../../../../src/worker/electrumManager/types';
import {
  manager,
  mockClient,
  mockCallbacks,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';
import { acquireLock, extendLock, releaseLock } from '../../../../src/infrastructure';
import { closeAllElectrumClients } from '../../../../src/services/bitcoin/electrum';

const createTimeoutHandle = () => ({}) as NodeJS.Timeout;

export function registerElectrumManagerStandaloneContracts() {
  describe('standalone function behavior', () => {
    // Helper to get internal state
    const getNetworks = () => (manager as any).networks as Map<BitcoinNetwork, NetworkState>;
    const getAddressToWallet = () => (manager as any).addressToWallet as Map<string, AddressWalletInfo>;

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

    it('disconnects when ownership is lost after successful version negotiation', async () => {
      let active = true;
      mockClient.getServerVersion.mockImplementationOnce(async () => {
        active = false;
        return { server: 'stale', protocol: '1.4' };
      });

      await connectNetwork(
        'mainnet', getNetworks(), getAddressToWallet(), mockCallbacks, () => active, vi.fn(),
      );

      expect(mockClient.subscribeHeaders).not.toHaveBeenCalled();
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('stops before header subscription when ownership is lost during version negotiation', async () => {
      const networks = getNetworks();
      let active = true;
      mockClient.getServerVersion.mockImplementationOnce(async () => {
        active = false;
        throw new Error('closed during version negotiation');
      });

      await connectNetwork(
        'mainnet', networks, getAddressToWallet(), mockCallbacks, () => active, vi.fn(),
      );

      expect(mockClient.subscribeHeaders).not.toHaveBeenCalled();
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(networks.size).toBe(0);
    });

    it('disconnects a network when ownership is lost during header subscription', async () => {
      const networks = getNetworks();
      let active = true;
      mockClient.subscribeHeaders.mockImplementationOnce(async () => {
        active = false;
        return { height: 100000, hex: '00'.repeat(80) };
      });
      const schedule = vi.fn();

      await connectNetwork(
        'mainnet',
        networks,
        getAddressToWallet(),
        mockCallbacks,
        () => active,
        schedule,
      );

      expect(networks.size).toBe(0);
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
    });

    it('does not delete a replacement owner state when an old header subscription returns', async () => {
      const networks = getNetworks();
      let active = true;
      const replacement = {
        network: 'mainnet' as const,
        client: { replacement: true } as any,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 200000,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      mockClient.subscribeHeaders.mockImplementationOnce(async () => {
        networks.set('mainnet', replacement);
        active = false;
        return { height: 100000, hex: '00'.repeat(80) };
      });

      await connectNetwork(
        'mainnet',
        networks,
        getAddressToWallet(),
        mockCallbacks,
        () => active,
        vi.fn(),
      );

      expect(networks.get('mainnet')).toBe(replacement);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('does not schedule reconnect after a failed connect when ownership is gone', async () => {
      mockClient.connect.mockRejectedValueOnce(new Error('connect failed'));
      const schedule = vi.fn();

      await connectNetwork(
        'mainnet',
        getNetworks(),
        getAddressToWallet(),
        mockCallbacks,
        () => false,
        schedule,
      );

      expect(schedule).not.toHaveBeenCalled();
    });

    it('handles additional event paths for untracked addresses, missing address, close, and error', async () => {
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);
      await manager.start();

      const state = getNetworks().get('mainnet')!;
      state.subscribedAddresses.add('tracked-address');

      mockClient.emit('addressActivity', { scriptHash: 'x', status: 'changed' });
      mockClient.emit('addressActivity', { scriptHash: 'x', address: 'unknown', status: 'changed' });
      expect(mockCallbacks.onAddressActivity).toHaveBeenNthCalledWith(1, 'mainnet', 'x', 'changed');
      expect(mockCallbacks.onAddressActivity).toHaveBeenNthCalledWith(2, 'mainnet', 'x', 'changed');

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

    it('does not enter individual fallback after ownership loss rejects a batch', async () => {
      const state: NetworkState = {
        network: 'mainnet', client: mockClient as any, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      };
      let active = true;
      mockClient.subscribeAddressBatch.mockImplementationOnce(async () => {
        active = false;
        throw new Error('closed during batch');
      });

      await expect(subscribeAddressBatch(
        state,
        [{ address: 'former-owner', walletId: 'wallet' }],
        { isActive: () => active },
      )).rejects.toThrow('Electrum subscription ownership changed');

      expect(mockClient.subscribeAddress).not.toHaveBeenCalled();
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(state.connected).toBe(false);
    });

    it('rejects an old-epoch batch result after ownership is reacquired', async () => {
      const state: NetworkState = {
        network: 'mainnet', client: mockClient as any, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      };
      let resolveBatch!: (value: Map<string, string | null>) => void;
      mockClient.subscribeAddressBatch.mockReturnValueOnce(
        new Promise<Map<string, string | null>>((resolve) => { resolveBatch = resolve; }),
      );
      let ownershipEpoch = 1;
      const initiatingEpoch = ownershipEpoch;
      const subscription = subscribeAddressBatch(
        state,
        [{ address: 'old-epoch', walletId: 'wallet' }],
        { isActive: () => ownershipEpoch === initiatingEpoch },
      );
      ownershipEpoch = 2;
      resolveBatch(new Map([['old-epoch', null]]));

      await expect(subscription).rejects.toThrow('Electrum subscription ownership changed');
      expect(state.subscribedAddresses).not.toContain('old-epoch');
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('stops individual fallback when ownership changes during the request', async () => {
      const state: NetworkState = {
        network: 'mainnet', client: mockClient as any, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      };
      let active = true;
      mockClient.subscribeAddressBatch.mockRejectedValueOnce(new Error('batch failed'));
      mockClient.subscribeAddress.mockImplementationOnce(async () => {
        active = false;
        return null;
      });

      await expect(subscribeAddressBatch(
        state,
        [{ address: 'former-owner-single', walletId: 'wallet' }],
        { isActive: () => active },
      )).rejects.toThrow('Electrum subscription ownership changed');

      expect(state.subscribedAddresses).not.toContain('former-owner-single');
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('tracks only addresses acknowledged by a successful batch response', async () => {
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
      mockClient.subscribeAddressBatch.mockResolvedValueOnce(
        new Map([['acknowledged', null]]),
      );

      const statuses = await subscribeAddressBatch(state, [
        { address: 'acknowledged', walletId: 'w1' },
        { address: 'omitted', walletId: 'w1' },
      ]);

      expect(statuses).toEqual(new Map([['acknowledged', null]]));
      expect(state.subscribedAddresses).toEqual(new Set(['acknowledged']));
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

    it('does not publish empty status results from initial or network resubscription', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();
      const observeStatuses = vi.fn().mockResolvedValue(undefined);
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
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
        id: 'empty-result', address: 'addr-empty', walletId: 'wallet-empty',
        wallet: { network: 'mainnet' },
      }] as any);
      mockClient.subscribeAddressBatch.mockResolvedValue(new Map());

      await subscribeAllAddresses(networks, addressToWallet, observeStatuses);
      await subscribeNetworkAddresses('mainnet', networks, addressToWallet, observeStatuses);

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledTimes(2);
      expect(observeStatuses).not.toHaveBeenCalled();
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
        network: 'testnet3',
        client: mockClient as any,
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      networks.set('mainnet', state);
      networks.set('testnet3', disconnected);
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr-main'), { walletId: 'w-main', network: 'mainnet' });

      const observeStatuses = vi.fn().mockResolvedValue(undefined);
      await subscribeNetworkAddresses('mainnet', networks, addressToWallet, observeStatuses);
      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-main']);
      expect(observeStatuses).toHaveBeenCalledWith(
        'mainnet',
        new Map([['addr-main', 'status']]),
      );

      mockClient.getServerVersion.mockRejectedValueOnce(new Error('health failed'));
      const scheduleReconnectSpy = vi.fn();
      await checkHealth(networks, scheduleReconnectSpy);

      expect(disconnected.connected).toBe(false);
      expect(state.connected).toBe(false);
      expect(scheduleReconnectSpy).toHaveBeenCalledWith('mainnet');
    });

    it.each(['before', 'after-success', 'after-failure'] as const)(
      'disconnects health work when ownership is lost %s',
      async (timing) => {
        const state: NetworkState = {
          network: 'mainnet', client: mockClient as any, connected: true,
          subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
          lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
        };
        const networks = new Map<BitcoinNetwork, NetworkState>([['mainnet', state]]);
        let active = timing !== 'before';
        if (timing === 'after-success') {
          mockClient.getServerVersion.mockImplementationOnce(async () => {
            active = false;
            return { server: 'stale', protocol: '1.4' };
          });
        } else if (timing === 'after-failure') {
          mockClient.getServerVersion.mockImplementationOnce(async () => {
            active = false;
            throw new Error('closed');
          });
        }

        const schedule = vi.fn();
        await checkHealth(networks, schedule, () => active);

        expect(state.connected).toBe(false);
        expect(mockClient.disconnect).toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
      },
    );

    it('stops reconciliation when ownership changes across its database page', async () => {
      let active = true;
      vi.mocked(prisma.address.findMany).mockImplementationOnce((async () => {
        active = false;
        return [];
      }) as any);
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
      const epoch = (manager as any).ownershipEpoch;
      const result = await reconcileSubscriptions(
        getNetworks(), getAddressToWallet(), undefined,
        () => active && (manager as any).ownershipEpoch === epoch,
      );

      expect(result).toEqual({ removed: 0, added: 0 });
    });

    it('covers default-active and inactive-entry reconciliation boundaries', async () => {
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);
      await expect(reconcileSubscriptions(new Map(), new Map()))
        .resolves.toEqual({ removed: 0, added: 0 });
      await expect(reconcileSubscriptions(new Map(), new Map(), undefined, () => false))
        .resolves.toEqual({ removed: 0, added: 0 });
    });

    it('rejects subscription work that starts without active ownership', async () => {
      await expect(subscribeNetworkAddresses(
        'mainnet', getNetworks(), getAddressToWallet(), undefined,
        { isActive: () => false },
      )).rejects.toThrow('ownership changed');
    });

    it('stops reconciliation when ownership changes in the status observer', async () => {
      const networks = getNetworks();
      networks.set('mainnet', {
        network: 'mainnet', client: mockClient as any, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
        id: 'observer-loss', address: 'addr-observer-loss', walletId: 'wallet',
        wallet: { network: 'mainnet' },
      }] as any);
      let active = true;
      const result = await reconcileSubscriptions(
        networks,
        getAddressToWallet(),
        vi.fn(async () => { active = false; }),
        () => active,
      );

      expect(result).toEqual({ removed: 0, added: 1 });
      expect(mockClient.disconnect).toHaveBeenCalled();
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
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr1'), { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr2'), { walletId: 'wallet2', network: 'mainnet' });

      manager.unsubscribeWalletAddresses('wallet1');

      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'addr1'))).toBe(false);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'addr2'))).toBe(true);
      expect(state.subscribedAddresses.has('addr1')).toBe(false);
      expect(state.subscribedAddresses.has('addr2')).toBe(true);
    });

    it('removes wallet addresses even when network state no longer exists', () => {
      const addressToWallet = getAddressToWallet();
      addressToWallet.set(getAddressSubscriptionKey('signet', 'orphan-addr'), { walletId: 'wallet-orphan', network: 'signet' });

      manager.unsubscribeWalletAddresses('wallet-orphan');

      expect(addressToWallet.has(getAddressSubscriptionKey('signet', 'orphan-addr'))).toBe(false);
    });

    it('reconciles with connected network subscriptions and subscribed-address cleanup', async () => {
      const networks = getNetworks();
      const addressToWallet = getAddressToWallet();
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };

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
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'old-address'), { walletId: 'wallet-old', network: 'mainnet' });

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

      const reconnectTimer = createTimeoutHandle();
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
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr1'), { walletId: 'wallet1', network: 'mainnet' });
      (manager as any).subscriptionLock = { key: 'k', token: 't' };
      vi.mocked(releaseLock).mockResolvedValue('deleted');

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
      vi.mocked(releaseLock).mockResolvedValue('deleted');

      await manager.start();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(vi.mocked(extendLock)).toHaveBeenCalledTimes(1);
      expect(manager.getHealthMetrics().isRunning).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);

      vi.useRealTimers();
    });

    it('stops ownership when subscription lock refresh rejects', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);
      vi.mocked(extendLock).mockRejectedValueOnce(new Error('Redis unavailable'));

      await manager.start();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);
      expect(vi.mocked(closeAllElectrumClients)).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('stops ownership when lock refresh rejects with a non-Error reason', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);
      vi.mocked(extendLock).mockRejectedValueOnce('Redis unavailable');

      await manager.start();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(vi.mocked(closeAllElectrumClients)).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('discards a late startup connection after lock loss', async () => {
      vi.useFakeTimers();
      let finishConnect!: () => void;
      mockClient.connect.mockReturnValueOnce(new Promise<void>((resolve) => {
        finishConnect = resolve;
      }));
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      vi.mocked(extendLock).mockRejectedValueOnce(new Error('Redis unavailable'));

      const startup = manager.start();
      await vi.waitFor(() => {
        expect(mockClient.connect).toHaveBeenCalledOnce();
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);

      finishConnect();
      await startup;

      expect(mockClient.subscribeHeaders).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
      expect(mockClient.disconnect).toHaveBeenCalled();
      expect(getNetworks().size).toBe(0);
      expect(vi.mocked(closeAllElectrumClients)).toHaveBeenCalled();
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

    it('covers direct header subscription and inactive entry/failure guards', async () => {
      const state: NetworkState = {
        network: 'mainnet', client: mockClient as any, connected: true,
        subscribedToHeaders: false, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      };
      await subscribeHeaders(state);
      expect(state.subscribedToHeaders).toBe(true);

      state.subscribedToHeaders = false;
      await subscribeHeaders(state, () => false);
      expect(mockClient.disconnect).toHaveBeenCalled();

      let active = true;
      mockClient.subscribeHeaders.mockImplementationOnce(async () => {
        active = false;
        throw new Error('closed during headers');
      });
      await subscribeHeaders(state, () => active);
      expect(state.subscribedToHeaders).toBe(false);
    });

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
        );
        expect(networks.get('mainnet')?.reconnectAttempts).toBe(0);
      } finally {
        delete mockCallbacks.onNetworkReady;
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

      const observeStatuses = vi.fn().mockResolvedValue(undefined);
      await subscribeAllAddresses(networks, addressToWallet, observeStatuses);

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-connected']);
      expect(observeStatuses).toHaveBeenCalledWith(
        'mainnet',
        new Map([['addr-connected', 'status']]),
      );
    });

    it.each([undefined, 'unsupported'])('fails closed in subscribeAllAddresses for a %s persisted network', async (network) => {
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
        { id: '1', address: 'addr-invalid-sub', walletId: 'wallet1', wallet: { network } },
      ] as any);

      await expect(subscribeAllAddresses(networks, addressToWallet))
        .rejects.toThrow('Invalid persisted Bitcoin network');

      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
      expect(addressToWallet.size).toBe(0);
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
      addressToWallet.set(getAddressSubscriptionKey('testnet3', 'addr-test-only'), { walletId: 'w-test', network: 'testnet3' });

      await subscribeNetworkAddresses('mainnet', networks, addressToWallet);
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });
  });
}
