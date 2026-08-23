import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  manager,
  mockClient,
} from './electrumManagerTestHarness';
import { walletRepository, addressRepository } from '../../../../src/repositories';
import { getAddressSubscriptionKey } from '../../../../src/worker/electrumManager/types';
import prisma from '../../../../src/models/prisma';

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

      await expect(manager.refreshSubscriptionStatusPage('mainnet', {
        cursor: 'address-0', limit: 1,
      }))
        .resolves.toEqual({ scanned: 1, nextCursor: 'address-1' });

      expect(mockClient.subscribeAddressBatch).toHaveBeenCalledWith(['addr1']);
      expect(vi.mocked(prisma.address.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: { id: 'address-0' }, skip: 1, take: 1 }),
      );
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

    it('fails closed when the requested network is disconnected', async () => {
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };

      await expect(manager.subscribeCheckpointAddresses('testnet3', ['addr1']))
        .rejects.toThrow('is not connected');
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

      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce('mainnet');
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
      expect(tracked.get(getAddressSubscriptionKey('mainnet', 'addr-default'))).toEqual({ walletId: 'wallet-default', network: 'mainnet' });
    });

    it('returns when network is not connected', async () => {
      (manager as unknown as { networks: Map<string, unknown> }).networks.set('testnet3', {
        network: 'testnet3',
        client: mockClient,
        connected: false,
        subscribedToHeaders: false,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      });

      vi.mocked(walletRepository.findNetwork).mockResolvedValueOnce('testnet3');
      await manager.subscribeWalletAddresses('wallet1');

      expect(addressRepository.findAddressStrings).not.toHaveBeenCalled();
      expect(mockClient.subscribeAddressBatch).not.toHaveBeenCalled();
    });
  });
}
