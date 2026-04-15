import { describe, expect, it, type Mock, vi } from 'vitest';

import {
  mockWallet,
  prisma,
  walletRepository,
} from './walletRepositoryTestHarness';

export const registerWalletRepositoryMutationContracts = () => {
  describe('updateSyncState', () => {
    it('should update sync state fields', async () => {
      const updatedWallet = {
        ...mockWallet,
        syncInProgress: true,
        lastSyncStatus: 'syncing',
      };

      (prisma.wallet.update as Mock).mockResolvedValue(updatedWallet);

      const result = await walletRepository.updateSyncState('wallet-123', {
        syncInProgress: true,
        lastSyncStatus: 'syncing',
      });

      expect(result.syncInProgress).toBe(true);
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: {
          syncInProgress: true,
          lastSyncStatus: 'syncing',
        },
      });
    });
  });

  describe('resetSyncState', () => {
    it('should reset all sync fields to default', async () => {
      const resetWallet = {
        ...mockWallet,
        syncInProgress: false,
        lastSyncedAt: null,
        lastSyncStatus: null,
      };

      (prisma.wallet.update as Mock).mockResolvedValue(resetWallet);

      const result = await walletRepository.resetSyncState('wallet-123');

      expect(result.syncInProgress).toBe(false);
      expect(result.lastSyncedAt).toBeNull();
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: {
          syncInProgress: false,
          lastSyncedAt: null,
          lastSyncStatus: null,
        },
      });
    });
  });

  describe('update', () => {
    it('should update wallet with provided data', async () => {
      const updatedWallet = { ...mockWallet, name: 'Updated Name' };
      (prisma.wallet.update as Mock).mockResolvedValue(updatedWallet);

      const result = await walletRepository.update('wallet-123', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: { name: 'Updated Name' },
      });
    });
  });

  describe('linkDevice', () => {
    it('creates a walletDevice record', async () => {
      prisma.walletDevice.create.mockResolvedValueOnce({ walletId: 'w1', deviceId: 'd1', signerIndex: 0 });
      await walletRepository.linkDevice('w1', 'd1', 0);
      expect(prisma.walletDevice.create).toHaveBeenCalledWith({
        data: { walletId: 'w1', deviceId: 'd1', signerIndex: 0 },
      });
    });

    it('allows omitting signerIndex', async () => {
      prisma.walletDevice.create.mockResolvedValueOnce({ walletId: 'w1', deviceId: 'd1' });
      await walletRepository.linkDevice('w1', 'd1');
      expect(prisma.walletDevice.create).toHaveBeenCalledWith({
        data: { walletId: 'w1', deviceId: 'd1', signerIndex: undefined },
      });
    });
  });

  describe('createWithDeviceLinks', () => {
    it('creates wallet and links devices atomically', async () => {
      const created = { id: 'new-wallet', devices: [{ deviceId: 'd1' }], addresses: [] };
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: { create: vi.fn().mockResolvedValue({ id: 'new-wallet' }), findUnique: vi.fn().mockResolvedValue(created) },
          walletDevice: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
        };
        return fn(tx);
      });

      const result = await walletRepository.createWithDeviceLinks(
        { name: 'Test', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet' } as any,
        ['d1'],
      );

      expect(result.id).toBe('new-wallet');
    });

    it('creates wallet without device links when deviceIds omitted', async () => {
      const created = { id: 'new-wallet', devices: [], addresses: [] };
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: { create: vi.fn().mockResolvedValue({ id: 'new-wallet' }), findUnique: vi.fn().mockResolvedValue(created) },
          walletDevice: { createMany: vi.fn() },
        };
        return fn(tx);
      });

      const result = await walletRepository.createWithDeviceLinks(
        { name: 'Test', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet' } as any,
      );

      expect(result.id).toBe('new-wallet');
    });

    it('throws when wallet creation returns null', async () => {
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: { create: vi.fn().mockResolvedValue({ id: 'ghost' }), findUnique: vi.fn().mockResolvedValue(null) },
          walletDevice: { createMany: vi.fn() },
        };
        return fn(tx);
      });

      await expect(
        walletRepository.createWithDeviceLinks({ name: 'Ghost' } as any),
      ).rejects.toThrow('Failed to create wallet');
    });
  });

  describe('resetAllStuckSyncFlags', () => {
    it('should reset all stuck sync flags and return count', async () => {
      (prisma.wallet.updateMany as Mock).mockResolvedValue({ count: 3 });

      const result = await walletRepository.resetAllStuckSyncFlags();

      expect(result).toBe(3);
      expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        data: { syncInProgress: false },
      });
    });

    it('should return 0 when no stuck wallets', async () => {
      (prisma.wallet.updateMany as Mock).mockResolvedValue({ count: 0 });

      const result = await walletRepository.resetAllStuckSyncFlags();

      expect(result).toBe(0);
    });
  });

  describe('findStuckSyncing', () => {
    it('should find wallets with syncInProgress=true', async () => {
      const stuck = [{ id: 'w1', name: 'Wallet 1' }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(stuck);

      const result = await walletRepository.findStuckSyncing();

      expect(result).toEqual(stuck);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        select: { id: true, name: true },
      });
    });

    it('should use custom select when provided', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findStuckSyncing({ id: true, name: true, lastSyncedAt: true });

      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        select: { id: true, name: true, lastSyncedAt: true },
      });
    });
  });

  describe('deleteById', () => {
    it('should delete a wallet by ID', async () => {
      (prisma.wallet.delete as Mock).mockResolvedValue(mockWallet);

      await walletRepository.deleteById('wallet-123');

      expect(prisma.wallet.delete).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
      });
    });
  });
};
