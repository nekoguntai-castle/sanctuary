import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  manager,
  mockClient,
} from './electrumManagerTestHarness';
import { walletRepository, addressRepository } from '../../../../src/repositories';
import { getAddressSubscriptionKey } from '../../../../src/worker/electrumManager/types';
import prisma from '../../../../src/models/prisma';
import { getElectrumClientForNetwork } from '../../../../src/services/bitcoin/electrum';
import { mockCallbacks } from './electrumManagerTestHarness';
import { subscribeWalletAddresses as subscribeWalletAddressesDirect } from '../../../../src/worker/electrumManager/addressSubscriptions';

export function registerElectrumManagerWalletSubscriptionContracts() {
  describe('checkpoint subscriptions', () => {
    it('requires active ownership and returns exact forced-resubscription statuses', async () => {
      await expect(manager.subscribeCheckpointAddresses('mainnet', ['addr1']))
        .rejects.toThrow('ownership is not active');

      const state = {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['addr1']),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      };
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
      (manager as any).networks.set('mainnet', state);

      await expect(manager.subscribeCheckpointAddresses('mainnet', ['addr1']))
        .resolves.toEqual(new Map([['addr1', 'status']]));
      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr1']);
      expect(manager.isSubscriptionOwner()).toBe(true);
    });

    it('force-refreshes tracked statuses so transient checkpoint failures self-heal', async () => {
      const onSubscriptionStatuses = vi.fn().mockResolvedValue(undefined);
      mockCallbacks.onSubscriptionStatuses = onSubscriptionStatuses;
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
      (manager as any).networks.set('mainnet', {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(['addr1']),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
        id: 'address-1',
        address: 'addr1',
        walletId: 'wallet-1',
        wallet: { network: 'mainnet' },
      }] as any);

      mockClient.subscribeAddressBatch.mockResolvedValueOnce(
        new Map([['addr1', 'refreshed-status']]),
      );

      try {
        await expect(manager.refreshSubscriptionStatusPage('mainnet', {
          cursor: 'address-0', limit: 1,
        }))
          .resolves.toEqual({ scanned: 1, nextCursor: 'address-1' });

        expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr1']);
        expect(vi.mocked(prisma.address.findMany)).toHaveBeenCalledWith(
          expect.objectContaining({ cursor: { id: 'address-0' }, skip: 1, take: 1 }),
        );
        expect(onSubscriptionStatuses).toHaveBeenCalledOnce();
        expect(onSubscriptionStatuses).toHaveBeenCalledWith(
          'mainnet',
          new Map([['addr1', 'refreshed-status']]),
        );
      } finally {
        delete mockCallbacks.onSubscriptionStatuses;
      }
    });

    it('accepts an empty authoritative refresh batch without publishing it', async () => {
      const onSubscriptionStatuses = vi.fn().mockResolvedValue(undefined);
      mockCallbacks.onSubscriptionStatuses = onSubscriptionStatuses;
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
      (manager as any).networks.set('mainnet', {
        network: 'mainnet', client: mockClient, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
        id: 'address-1', address: 'addr1', walletId: 'wallet-1',
        wallet: { network: 'mainnet' },
      }] as any);
      mockClient.subscribeAddressBatch.mockResolvedValueOnce(new Map());

      try {
        await expect(manager.refreshSubscriptionStatusPage('mainnet', { limit: 200 }))
          .resolves.toEqual({ scanned: 1 });
        expect(onSubscriptionStatuses).not.toHaveBeenCalled();
      } finally {
        delete mockCallbacks.onSubscriptionStatuses;
      }
    });

    it('discards a refresh result when ownership changes during status persistence', async () => {
      const onSubscriptionStatuses = vi.fn().mockImplementation(async () => {
        (manager as any).ownershipEpoch += 1;
        (manager as any).subscriptionLock = { key: 'lock', token: 'new-token' };
      });
      mockCallbacks.onSubscriptionStatuses = onSubscriptionStatuses;
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'old-token' };
      (manager as any).networks.set('mainnet', {
        network: 'mainnet', client: mockClient, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
        id: 'address-1', address: 'addr1', walletId: 'wallet-1',
        wallet: { network: 'mainnet' },
      }] as any);
      mockClient.subscribeAddressBatch.mockResolvedValueOnce(new Map([['addr1', 'status']]));

      try {
        await expect(manager.refreshSubscriptionStatusPage('mainnet', { limit: 200 }))
          .resolves.toEqual({ scanned: 0 });
      } finally {
        delete mockCallbacks.onSubscriptionStatuses;
      }
    });

    it('supports refresh status observation when no callback is configured', async () => {
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
      (manager as any).networks.set('mainnet', {
        network: 'mainnet', client: mockClient, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      });
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
        id: 'address-1', address: 'addr1', walletId: 'wallet-1',
        wallet: { network: 'mainnet' },
      }] as any);

      await expect(manager.refreshSubscriptionStatusPage('mainnet', { limit: 200 }))
        .resolves.toEqual({ scanned: 1 });
    });

    it('bounds status refresh by exact ownership before and after its database page', async () => {
      await expect(manager.refreshSubscriptionStatusPage('mainnet', { limit: 200 }))
        .resolves.toEqual({ scanned: 0 });
      expect(vi.mocked(prisma.address.findMany)).not.toHaveBeenCalled();

      let finishPage!: (rows: unknown[]) => void;
      vi.mocked(prisma.address.findMany).mockReturnValueOnce(new Promise((resolve) => {
        finishPage = resolve;
      }) as any);
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
      const refresh = manager.refreshSubscriptionStatusPage('mainnet', { limit: 200 });
      await vi.waitFor(() => {
        expect(prisma.address.findMany).toHaveBeenCalledOnce();
      });
      (manager as any).subscriptionLock = null;
      (manager as any).ownershipEpoch += 1;
      finishPage([]);

      await expect(refresh).resolves.toEqual({ scanned: 0 });
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('advances a refresh page without network work while the network is disconnected', async () => {
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([{
        id: 'address-1', address: 'addr1', walletId: 'wallet-1',
        wallet: { network: 'mainnet' },
      }] as any);

      await expect(manager.refreshSubscriptionStatusPage('mainnet', { limit: 200 }))
        .resolves.toEqual({ scanned: 1 });
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('connects a supported requested network on demand', async () => {
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };

      await expect(manager.subscribeCheckpointAddresses('testnet3', ['addr1']))
        .resolves.toEqual(new Map([['addr1', 'status']]));
      expect(getElectrumClientForNetwork).toHaveBeenCalledWith('testnet3');
      expect(mockClient.connect).toHaveBeenCalledOnce();
      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr1']);
    });

    it('shares one in-flight connection across concurrent dynamic requests', async () => {
      let finishConnect!: () => void;
      mockClient.connect.mockReturnValueOnce(new Promise<void>((resolve) => {
        finishConnect = resolve;
      }));
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };

      const first = manager.ensureNetworkConnected('signet');
      const second = manager.ensureNetworkConnected('signet');
      await vi.waitFor(() => expect(mockClient.connect).toHaveBeenCalledOnce());
      finishConnect();

      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
      expect(getElectrumClientForNetwork).toHaveBeenCalledOnce();
    });

    it('does not re-enter network readiness while subscribing a checkpoint batch', async () => {
      const onNetworkReady = vi.fn().mockResolvedValue(undefined);
      mockCallbacks.onNetworkReady = onNetworkReady;
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };

      try {
        await manager.subscribeCheckpointAddresses('regtest', ['addr1']);
        expect(onNetworkReady).not.toHaveBeenCalled();
      } finally {
        delete mockCallbacks.onNetworkReady;
      }
    });

    it('fails closed when an on-demand checkpoint network cannot connect', async () => {
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
      mockClient.connect.mockRejectedValueOnce(new Error('network unavailable'));

      await expect(manager.subscribeCheckpointAddresses('testnet3', ['addr1']))
        .rejects.toThrow('is not connected');
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('rejects invalid or unowned dynamic network connection requests', async () => {
      await expect(manager.ensureNetworkConnected('mainnet'))
        .rejects.toThrow('ownership is not active');

      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
      await expect(manager.ensureNetworkConnected('unsupported' as any))
        .rejects.toThrow('Unsupported Electrum wallet network');
    });

    it('rejects a dynamic connection completed after its ownership epoch is replaced', async () => {
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'old-token' };
      mockClient.connect.mockImplementationOnce(async () => {
        (manager as any).ownershipEpoch += 1;
        (manager as any).subscriptionLock = { key: 'lock', token: 'new-token' };
      });

      await expect(manager.ensureNetworkConnected('testnet4'))
        .rejects.toThrow('ownership changed during network work');
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('rejects dynamic readiness completed after its ownership epoch is replaced', async () => {
      const onNetworkReady = vi.fn().mockImplementation(async () => {
        (manager as any).ownershipEpoch += 1;
        (manager as any).subscriptionLock = { key: 'lock', token: 'new-token' };
      });
      mockCallbacks.onNetworkReady = onNetworkReady;
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'old-token' };

      try {
        await expect(manager.ensureNetworkConnected('regtest'))
          .rejects.toThrow('ownership changed during network work');
        expect(onNetworkReady).toHaveBeenCalledWith('regtest');
      } finally {
        delete mockCallbacks.onNetworkReady;
      }
    });

    it('rejects a checkpoint result from an ownership epoch that was replaced', async () => {
      let resolveBatch!: (statuses: Map<string, string | null>) => void;
      mockClient.subscribeAddressBatch.mockReturnValueOnce(
        new Promise<Map<string, string | null>>((resolve) => { resolveBatch = resolve; }),
      );
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'old-token' };
      (manager as any).networks.set('mainnet', {
        network: 'mainnet', client: mockClient, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      });

      const subscription = manager.subscribeCheckpointAddresses('mainnet', ['addr1']);
      (manager as any).ownershipEpoch += 1;
      (manager as any).subscriptionLock = { key: 'lock', token: 'new-token' };
      resolveBatch(new Map([['addr1', null]]));

      await expect(subscription).rejects.toThrow('ownership changed');
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('subscribeWalletAddresses', () => {
    beforeEach(() => {
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
    });

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

      vi.mocked(walletRepository.findNetwork).mockResolvedValue('mainnet');
      vi.mocked(addressRepository.findAddressStrings).mockResolvedValueOnce(['addr1', 'addr2']);

      await manager.subscribeWalletAddresses('wallet1');

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr1', 'addr2']);
      const tracked = (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet;
      expect(tracked.get(getAddressSubscriptionKey('mainnet', 'addr1'))).toEqual({ walletId: 'wallet1', network: 'mainnet' });
      expect(tracked.get(getAddressSubscriptionKey('mainnet', 'addr2'))).toEqual({ walletId: 'wallet1', network: 'mainnet' });
    });

    it('returns when wallet does not exist', async () => {
      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce(null);

      await manager.subscribeWalletAddresses('missing-wallet');

      expect(addressRepository.findAddressStrings).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });

    it('keeps the direct helper null-safe for a wallet removed before its lookup', async () => {
      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce(null);

      await subscribeWalletAddressesDirect('removed-wallet', new Map(), new Map());

      expect(addressRepository.findAddressStrings).not.toHaveBeenCalled();
    });

    it.each([undefined, 'unsupported'])('fails closed when a wallet has a %s persisted network', async (network) => {
      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce(network as string);

      await expect(manager.subscribeWalletAddresses('wallet-invalid'))
        .rejects.toThrow('Invalid persisted Bitcoin network');

      expect(getElectrumClientForNetwork).not.toHaveBeenCalled();
      expect(addressRepository.findAddressStrings).not.toHaveBeenCalled();
    });

    it('connects a supported wallet network on demand before subscribing', async () => {
      vi.mocked(walletRepository.findNetwork).mockResolvedValue('signet');
      vi.mocked(addressRepository.findAddressStrings).mockResolvedValueOnce(['addr-signet']);
      await manager.subscribeWalletAddresses('wallet1');

      expect(getElectrumClientForNetwork).toHaveBeenCalledWith('signet');
      expect(mockClient.connect).toHaveBeenCalledOnce();
      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr-signet']);
    });

    it('does not publish an empty wallet-subscription status batch', async () => {
      const onSubscriptionStatuses = vi.fn().mockResolvedValue(undefined);
      mockCallbacks.onSubscriptionStatuses = onSubscriptionStatuses;
      (manager as any).networks.set('mainnet', {
        network: 'mainnet', client: mockClient, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      });
      vi.mocked(walletRepository.findNetwork).mockResolvedValue('mainnet');
      vi.mocked(addressRepository.findAddressStrings).mockResolvedValueOnce([]);
      mockClient.subscribeAddressBatch.mockResolvedValueOnce(new Map());

      try {
        await manager.subscribeWalletAddresses('wallet-empty');
        expect(onSubscriptionStatuses).not.toHaveBeenCalled();
      } finally {
        delete mockCallbacks.onSubscriptionStatuses;
      }
    });

    it('stops safely when the network disconnects between connection validation and mutation', async () => {
      const state = {
        network: 'mainnet', client: mockClient, connected: true,
        subscribedToHeaders: true, subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0, reconnectTimer: null, reconnectAttempts: 0,
      };
      (manager as any).networks.set('mainnet', state);
      vi.mocked(walletRepository.findNetwork)
        .mockResolvedValueOnce('mainnet')
        .mockImplementationOnce(async () => {
          state.connected = false;
          return 'mainnet';
        });

      await manager.subscribeWalletAddresses('wallet-race');

      expect(addressRepository.findAddressStrings).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });
  });
}
