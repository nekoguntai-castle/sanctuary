import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  manager,
  mockClient,
  mockCallbacks,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';
import { getAddressSubscriptionKey } from '../../../../src/worker/electrumManager/types';

function addressRecord(id: string, address: string, walletId: string, network?: string) {
  return {
    id,
    address,
    walletId,
    derivationPath: "m/84'/0'/0'/0/0",
    index: 0,
    branch: 0,
    coordinateVersion: 1,
    canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
    scriptPubKey: null,
    used: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    wallet: network === undefined ? {} : { network },
  };
}

export function registerElectrumManagerReconcileContracts() {
  describe('reconcileSubscriptions', () => {
    beforeEach(() => {
      (manager as any).isRunningFlag = true;
      (manager as any).subscriptionLock = { key: 'lock', token: 'token' };
    });

    it('should remove addresses that no longer exist in database', async () => {
      // Setup: Manager has addresses tracked
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr1'), { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr2'), { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr3'), { walletId: 'wallet2', network: 'mainnet' });

      // Database only has addr1 (addr2 and addr3 were deleted)
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        addressRecord('1', 'addr1', 'wallet1', 'mainnet'),
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(2);
      expect(result.added).toBe(0);
      expect(addressToWallet.size).toBe(1);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'addr1'))).toBe(true);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'addr2'))).toBe(false);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'addr3'))).toBe(false);
    });

    it('should add new addresses from database', async () => {
      // Setup: Manager has no addresses tracked
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      expect(addressToWallet.size).toBe(0);

      // Database has new addresses
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        addressRecord('1', 'addr1', 'wallet1', 'mainnet'),
        addressRecord('2', 'addr2', 'wallet1', 'mainnet'),
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(0);
      expect(result.added).toBe(2);
      expect(addressToWallet.size).toBe(2);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'addr1'))).toBe(true);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'addr2'))).toBe(true);
    });

    it('does not publish an empty authoritative status batch', async () => {
      const onSubscriptionStatuses = vi.fn().mockResolvedValue(undefined);
      mockCallbacks.onSubscriptionStatuses = onSubscriptionStatuses;
      (manager as any).networks.set('mainnet', {
        network: 'mainnet',
        client: mockClient,
        connected: true,
        subscribedToHeaders: true,
        subscribedAddresses: new Set<string>(),
        lastBlockHeight: 0,
        reconnectTimer: null,
        reconnectAttempts: 0,
      });
      mockClient.subscribeAddressBatch.mockResolvedValueOnce(new Map());
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        addressRecord('empty-status', 'addr-empty-status', 'wallet1', 'mainnet'),
      ]);

      try {
        await manager.reconcileSubscriptions();
        expect(onSubscriptionStatuses).not.toHaveBeenCalled();
      } finally {
        delete mockCallbacks.onSubscriptionStatuses;
      }
    });

    it('should track the same address string separately per network', async () => {
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;

      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        addressRecord('1', 'tb1qshared', 'wallet-testnet3', 'testnet3'),
        addressRecord('2', 'tb1qshared', 'wallet-testnet4', 'testnet4'),
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(0);
      expect(result.added).toBe(2);
      expect(addressToWallet.size).toBe(2);
      expect(addressToWallet.get(getAddressSubscriptionKey('testnet3', 'tb1qshared'))).toEqual({
        walletId: 'wallet-testnet3',
        network: 'testnet3',
      });
      expect(addressToWallet.get(getAddressSubscriptionKey('testnet4', 'tb1qshared'))).toEqual({
        walletId: 'wallet-testnet4',
        network: 'testnet4',
      });
    });

    it('should default to mainnet when reconciling addresses with missing wallet network', async () => {
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, { walletId: string; network: string }> })
        .addressToWallet;

      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        addressRecord('1', 'addr-fallback', 'wallet-fallback'),
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.added).toBe(1);
      expect(result.removed).toBe(0);
      expect(addressToWallet.get(getAddressSubscriptionKey('mainnet', 'addr-fallback'))).toEqual({
        walletId: 'wallet-fallback',
        network: 'mainnet',
      });
    });

    it('should handle mixed add and remove operations', async () => {
      // Setup: Manager has some addresses
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'old1'), { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'keep'), { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'old2'), { walletId: 'wallet2', network: 'mainnet' });

      // Database has one existing and one new
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        addressRecord('1', 'keep', 'wallet1', 'mainnet'),
        addressRecord('2', 'new1', 'wallet1', 'mainnet'),
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(2); // old1, old2 removed
      expect(result.added).toBe(1); // new1 added
      expect(addressToWallet.size).toBe(2);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'keep'))).toBe(true);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'new1'))).toBe(true);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'old1'))).toBe(false);
      expect(addressToWallet.has(getAddressSubscriptionKey('mainnet', 'old2'))).toBe(false);
    });

    it('should handle empty database', async () => {
      // Setup: Manager has addresses
      const addressToWallet = (manager as unknown as { addressToWallet: Map<string, unknown> }).addressToWallet;
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr1'), { walletId: 'wallet1', network: 'mainnet' });

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
      const firstPage = Array.from({ length: 2000 }, (_, i) =>
        addressRecord(`id-${i}`, `addr-${i}`, 'wallet1', 'mainnet'));

      // Second page returns 500 addresses (partial page, ends pagination)
      const secondPage = Array.from({ length: 500 }, (_, i) =>
        addressRecord(`id-${2000 + i}`, `addr-${2000 + i}`, 'wallet1', 'mainnet'));

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
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr1'), { walletId: 'wallet1', network: 'mainnet' });
      addressToWallet.set(getAddressSubscriptionKey('mainnet', 'addr2'), { walletId: 'wallet1', network: 'mainnet' });

      // Database has the same addresses
      vi.mocked(prisma.address.findMany).mockResolvedValueOnce([
        addressRecord('1', 'addr1', 'wallet1', 'mainnet'),
        addressRecord('2', 'addr2', 'wallet1', 'mainnet'),
      ]);

      const result = await manager.reconcileSubscriptions();

      expect(result.removed).toBe(0);
      expect(result.added).toBe(0);
      expect(addressToWallet.size).toBe(2);
    });
  });
}
