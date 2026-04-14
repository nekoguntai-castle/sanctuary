import { describe, expect, it, vi } from 'vitest';
import {
  manager,
} from './electrumManagerTestHarness';
import prisma from '../../../../src/models/prisma';

export function registerElectrumManagerReconcileContracts() {
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
}
