/**
 * ElectrumSubscriptionManager Tests
 *
 * Tests for the Electrum subscription manager, particularly
 * the reconcileSubscriptions method that handles memory cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock prisma before importing the module
vi.mock('../../../src/models/prisma', () => ({
  default: {
    address: {
      findMany: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../../src/repositories', async () => {
  const prismaModule = await import('../../../src/models/prisma');
  const prisma = prismaModule.default;
  return {
    walletRepository: {
      findNetwork: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
    },
    addressRepository: {
      findAddressStrings: vi.fn().mockResolvedValue([]),
      findByWalletId: vi.fn().mockResolvedValue([]),
      findAllWithWalletNetworkPaginated: (opts: { take: number; cursor?: string }) =>
        prisma.address.findMany({
          select: { id: true, address: true, walletId: true, wallet: { select: { network: true } } },
          take: opts.take,
          skip: opts.cursor ? 1 : 0,
          cursor: opts.cursor ? { id: opts.cursor } : undefined,
          orderBy: { id: 'asc' },
        }),
      findAllWithWalletNetwork: () => prisma.address.findMany({ select: { address: true, walletId: true } }),
    },
  };
});

// Mock the electrum client
vi.mock('../../../src/services/bitcoin/electrum', () => ({
  getElectrumClientForNetwork: vi.fn(),
  closeAllElectrumClients: vi.fn(),
}));

// Mock config
vi.mock('../../../src/config', () => ({
  getConfig: vi.fn(() => ({
    bitcoin: { network: 'mainnet' },
  })),
}));

// Mock blockchain
vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  setCachedBlockHeight: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/infrastructure', () => ({
  acquireLock: vi.fn(),
  extendLock: vi.fn(),
  releaseLock: vi.fn(),
}));

import prisma from '../../../src/models/prisma';
import { walletRepository, addressRepository } from '../../../src/repositories';
import { acquireLock, extendLock, releaseLock } from '../../../src/infrastructure';
import { closeAllElectrumClients, getElectrumClientForNetwork } from '../../../src/services/bitcoin/electrum';
import { setCachedBlockHeight } from '../../../src/services/bitcoin/blockchain';
import { ElectrumSubscriptionManager } from '../../../src/worker/electrumManager';
import { connectNetwork, subscribeHeaders, setupEventHandlers } from '../../../src/worker/electrumManager/networkConnection';
import { scheduleReconnect } from '../../../src/worker/electrumManager/reconnection';
import {
  subscribeAllAddresses,
  subscribeNetworkAddresses,
  subscribeAddressBatch,
} from '../../../src/worker/electrumManager/addressSubscriptions';
import { checkHealth } from '../../../src/worker/electrumManager/healthMonitoring';
import type { BitcoinNetwork, NetworkState, ElectrumManagerCallbacks } from '../../../src/worker/electrumManager/types';

class MockElectrumClient extends EventEmitter {
  connect = vi.fn().mockResolvedValue(undefined);
  getServerVersion = vi.fn().mockResolvedValue({ server: 'test', protocol: '1.4' });
  subscribeHeaders = vi.fn().mockResolvedValue({ height: 100000, hex: '00'.repeat(80) });
  subscribeAddress = vi.fn().mockResolvedValue('status');
  subscribeAddressBatch = vi.fn().mockResolvedValue([]);
}

describe('ElectrumSubscriptionManager', () => {
  let manager: ElectrumSubscriptionManager;
  let mockClient: MockElectrumClient;
  const mockCallbacks: ElectrumManagerCallbacks = {
    onNewBlock: vi.fn(),
    onAddressActivity: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = new MockElectrumClient();
    vi.mocked(getElectrumClientForNetwork).mockReturnValue(mockClient as unknown as any);
    manager = new ElectrumSubscriptionManager(mockCallbacks);
  });

  afterEach(async () => {
    await manager.stop();
  });

  describe('reconcileSubscriptions', () => {
    it('should remove addresses that no longer exist in database', async () => {
      // Setup: Manager has addresses tracked
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('addr2', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('addr3', { walletId: 'wallet2', network: 'mainnet' });

      // Database only has addr1 (addr2 and addr3 were deleted)
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'addr1', walletId: 'wallet1', wallet: { network: 'mainnet' } },
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(2);
      expect(result.added).toBe(0);
      expect(addressToWallet.size).toBe(1);
      expect(addressToWallet.has('addr1')).toBe(true);
      expect(addressToWallet.has('addr2')).toBe(false);
      expect(addressToWallet.has('addr3')).toBe(false);
    });

    it('should add new addresses from database', async () => {
      // Setup: Manager has no addresses tracked
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      expect(addressToWallet.size).toBe(0);

      // Database has new addresses
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'addr1', walletId: 'wallet1', wallet: { network: 'mainnet' } },
        { id: '2', address: 'addr2', walletId: 'wallet1', wallet: { network: 'mainnet' } },
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(0);
      expect(result.added).toBe(2);
      expect(addressToWallet.size).toBe(2);
      expect(addressToWallet.has('addr1')).toBe(true);
      expect(addressToWallet.has('addr2')).toBe(true);
    });

    it('should default to mainnet when reconciling addresses with missing wallet network', async () => {
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet;

      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'addr-fallback', walletId: 'wallet-fallback', wallet: {} },
      ] as any);

      const result = await manager.reconcileSubscriptions();

      expect(result.added).toBe(1);
      expect(result.removed).toBe(0);
      expect(addressToWallet.get('addr-fallback')).toEqual({
        walletId: 'wallet-fallback',
        network: 'mainnet',
      });
    });

    it('should handle mixed add and remove operations', async () => {
      // Setup: Manager has some addresses
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set('old1', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('keep', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('old2', { walletId: 'wallet2', network: 'mainnet' });

      // Database has one existing and one new
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'keep', walletId: 'wallet1', wallet: { network: 'mainnet' } },
        { id: '2', address: 'new1', walletId: 'wallet1', wallet: { network: 'mainnet' } },
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(2); // old1, old2 removed
      expect(result.added).toBe(1); // new1 added
      expect(addressToWallet.size).toBe(2);
      expect(addressToWallet.has('keep')).toBe(true);
      expect(addressToWallet.has('new1')).toBe(true);
      expect(addressToWallet.has('old1')).toBe(false);
      expect(addressToWallet.has('old2')).toBe(false);
    });

    it('should handle empty database', async () => {
      // Setup: Manager has addresses
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });

      // Database is empty
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(1);
      expect(result.added).toBe(0);
      expect(addressToWallet.size).toBe(0);
    });

    it('should handle pagination correctly', async () => {
      // Setup: Manager is empty
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;

      // First page returns 2000 addresses (full page)
      const firstPage = Array.from({ length: 2000 }, (_, i) => ({
        id: `id-${i}`,
        address: `addr-${i}`,
        walletId: 'wallet1',
        wallet: { network: 'mainnet' },
      }));

      // Second page returns 500 addresses (partial page, ends pagination)
      const secondPage = Array.from({ length: 500 }, (_, i) => ({
        id: `id-${2000 + i}`,
        address: `addr-${2000 + i}`,
        walletId: 'wallet1',
        wallet: { network: 'mainnet' },
      }));

      vi.mocked(prisma.address.findMany)
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      const result = await manager.reconcileSubscriptions();

      expect(result.added).toBe(2500);
      expect(result.removed).toBe(0);
      expect(addressToWallet.size).toBe(2500);
      expect(prisma.address.findMany).toHaveBeenCalledTimes(2);
    });

    it('should not count existing addresses as added', async () => {
      // Setup: Manager already has some addresses
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set('addr1', { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set('addr2', { walletId: 'wallet1', network: 'mainnet' });

      // Database has the same addresses
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        { id: '1', address: 'addr1', walletId: 'wallet1', wallet: { network: 'mainnet' } },
        { id: '2', address: 'addr2', walletId: 'wallet1', wallet: { network: 'mainnet' } },
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(0);
      expect(result.added).toBe(0);
      expect(addressToWallet.size).toBe(2);
    });
  });

  describe('start', () => {
    it('returns early when subscription lock is not acquired', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce(null);

      await manager.start();

      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);
    });

    it('retries subscription ownership after an initial lock miss', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);

      await manager.start();

      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);

      await vi.advanceTimersByTimeAsync(15_000);

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.subscribeHeaders).toHaveBeenCalled();
      expect(manager.getHealthMetrics().isRunning).toBe(true);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(false);

      vi.useRealTimers();
    });

    it('does not retry ownership after explicit stop clears a pending retry', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValueOnce(null);

      await manager.start();
      await manager.stop();
      await vi.advanceTimersByTimeAsync(15_000);

      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(vi.mocked(acquireLock)).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('releases a retry-acquired lock when explicit stop wins the race', async () => {
      const lock = { key: 'lock', token: 'token' } as any;
      vi.mocked(acquireLock).mockImplementationOnce(async () => {
        (manager as any).explicitlyStopped = true;
        return lock;
      });

      await (manager as any).tryAcquireSubscriptionOwnership();

      expect(vi.mocked(releaseLock)).toHaveBeenCalledWith(lock);
      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
    });

    it('rearms ownership retry when retry-acquired startup fails', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockRejectedValueOnce(new Error('address query failed'));

      await (manager as any).tryAcquireSubscriptionOwnership();

      expect(manager.getHealthMetrics().isRunning).toBe(false);
      expect(manager.getHealthMetrics().ownershipRetryActive).toBe(true);
      expect(vi.mocked(releaseLock)).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('connects to primary network and subscribes to headers', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();

      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.subscribeHeaders).toHaveBeenCalled();
      expect(setCachedBlockHeight).toHaveBeenCalledWith(100000, 'mainnet');
      expect(manager.isConnected()).toBe(true);
    });

    it('returns early when start is called while manager is already running', async () => {
      vi.mocked(acquireLock).mockResolvedValue({ key: 'lock', token: 'token' } as any);
      vi.mocked(prisma.address.findMany).mockResolvedValue([]);

      await manager.start();
      await manager.start();

      expect(getElectrumClientForNetwork).toHaveBeenCalledTimes(1);
    });
  });

  describe('event handling', () => {
    it('invokes callbacks for new blocks and address activity', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({ key: 'lock', token: 'token' });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([]);

      await manager.start();

      (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet
        .set('addr1', { walletId: 'wallet1', network: 'mainnet' });

      mockClient.emit('newBlock', { height: 123, hex: 'a'.repeat(80) });
      mockClient.emit('addressActivity', { scriptHash: 'hash', address: 'addr1', status: 'updated' });

      expect(mockCallbacks.onNewBlock).toHaveBeenCalledWith('mainnet', 123, 'a'.repeat(64));
      expect(mockCallbacks.onAddressActivity).toHaveBeenCalledWith('mainnet', 'wallet1', 'addr1');
    });
  });

  describe('subscribeWalletAddresses', () => {
    it('subscribes and tracks addresses for a wallet', async () => {
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      (manager as unknown as { networks: Map<string, unknown> }).networks.set('mainnet', state);

      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce('mainnet');
      vi.mocked(addressRepository.findAddressStrings).mockResolvedValueOnce(['addr1', 'addr2']);

      await manager.subscribeWalletAddresses('wallet1');

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr1', 'addr2']);
      const tracked = (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet;
      expect(tracked.get('addr1')).toEqual({ walletId: 'wallet1', network: 'mainnet' });
      expect(tracked.get('addr2')).toEqual({ walletId: 'wallet1', network: 'mainnet' });
    });

    it('returns when wallet does not exist', async () => {
      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce(null);

      await manager.subscribeWalletAddresses('missing-wallet');

      expect(addressRepository.findAddressStrings).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('defaults to mainnet when wallet network is missing', async () => {
      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };

      (manager as unknown as { networks: Map<string, unknown> }).networks.set('mainnet', state);

      // findNetwork returns 'mainnet' explicitly (the repository resolves the network)
      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce('mainnet');
      vi.mocked(addressRepository.findAddressStrings).mockResolvedValueOnce(['addr-default']);

      await manager.subscribeWalletAddresses('wallet-default');

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-default']);
      const tracked = (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet;
      expect(tracked.get('addr-default')).toEqual({ walletId: 'wallet-default', network: 'mainnet' });
    });

    it('returns when network is not connected', async () => {
      (manager as unknown as { networks: Map<string, unknown> }).networks.set('testnet', {
        network: 'testnet',
        client: mockClient,
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      });

      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce('testnet');
      await manager.subscribeWalletAddresses('wallet1');

      expect(addressRepository.findAddressStrings).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });
  });

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

  describe('getHealthMetrics', () => {
    it('should return correct metrics', () => {
      const metrics = manager.getHealthMetrics();

      expect(metrics).toHaveProperty('isRunning');
      expect(metrics).toHaveProperty('networks');
      expect(metrics).toHaveProperty('totalSubscribedAddresses');
      expect(typeof metrics.totalSubscribedAddresses).toBe('number');
    });
  });

  describe('isConnected', () => {
    it('should return false when no networks are connected', () => {
      expect(manager.isConnected()).toBe(false);
    });

    it('should return false when all tracked networks are disconnected', () => {
      (manager as any).networks.set('mainnet', {
        network: 'mainnet',
        client: mockClient,
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      });

      expect(manager.isConnected()).toBe(false);
    });
  });
});
