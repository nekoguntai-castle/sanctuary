import { describe, expect, it, type Mock } from 'vitest';

import {
  mockUserId,
  mockWallet,
  prisma,
  walletRepository,
} from './walletRepositoryTestHarness';

export const registerWalletRepositoryQueryContracts = () => {
  describe('findByUserIdPaginated', () => {
    it('should return paginated results with default options', async () => {
      const wallets = Array.from({ length: 51 }, (_, i) => ({
        ...mockWallet,
        id: `wallet-${i}`,
      }));

      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserIdPaginated(mockUserId);

      expect(result.items).toHaveLength(50);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('wallet-49');
    });

    it('should handle cursor-based pagination', async () => {
      const wallets = [
        { ...mockWallet, id: 'wallet-51' },
        { ...mockWallet, id: 'wallet-52' },
      ];

      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      await walletRepository.findByUserIdPaginated(mockUserId, {
        cursor: 'wallet-50',
        limit: 10,
      });

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { gt: 'wallet-50' },
          }),
        }),
      );
    });

    it('should handle backward pagination', async () => {
      const wallets = [
        { ...mockWallet, id: 'wallet-48' },
        { ...mockWallet, id: 'wallet-49' },
      ];

      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserIdPaginated(mockUserId, {
        cursor: 'wallet-50',
        direction: 'backward',
        limit: 10,
      });

      expect(result.items[0].id).toBe('wallet-49');
      expect(result.items[1].id).toBe('wallet-48');
    });

    it('should indicate no more results when at end', async () => {
      const wallets = [{ ...mockWallet, id: 'wallet-last' }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserIdPaginated(mockUserId, { limit: 10 });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should cap limit at 200', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findByUserIdPaginated(mockUserId, { limit: 500 });

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 201,
        }),
      );
    });

    it('should return null nextCursor when hasMore is true but sliced items are empty', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([{ ...mockWallet, id: 'wallet-1' }]);

      const result = await walletRepository.findByUserIdPaginated(mockUserId, { limit: 0 });

      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('findByNetwork', () => {
    it('should return wallets for specific network', async () => {
      const mainnetWallets = [mockWallet];
      (prisma.wallet.findMany as Mock).mockResolvedValue(mainnetWallets);

      const result = await walletRepository.findByNetwork(mockUserId, 'mainnet');

      expect(result).toEqual(mainnetWallets);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          network: 'mainnet',
        }),
      });
    });

    it('should return empty array for network with no wallets', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      const result = await walletRepository.findByNetwork(mockUserId, 'testnet');

      expect(result).toEqual([]);
    });
  });

  describe('findByNetworkWithSyncStatus', () => {
    it('should return sync status fields only', async () => {
      const syncStatuses = [
        { id: 'wallet-1', syncInProgress: false, lastSyncStatus: 'success', lastSyncedAt: new Date() },
        { id: 'wallet-2', syncInProgress: true, lastSyncStatus: null, lastSyncedAt: null },
      ];

      (prisma.wallet.findMany as Mock).mockResolvedValue(syncStatuses);

      const result = await walletRepository.findByNetworkWithSyncStatus(mockUserId, 'mainnet');

      expect(result).toEqual(syncStatuses);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ network: 'mainnet' }),
        select: {
          id: true,
          syncInProgress: true,
          lastSyncStatus: true,
          lastSyncedAt: true,
        },
      });
    });
  });

  describe('getIdsByNetwork', () => {
    it('should return only wallet IDs', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([
        { id: 'wallet-1' },
        { id: 'wallet-2' },
        { id: 'wallet-3' },
      ]);

      const result = await walletRepository.getIdsByNetwork(mockUserId, 'mainnet');

      expect(result).toEqual(['wallet-1', 'wallet-2', 'wallet-3']);
    });
  });

  describe('findById', () => {
    it('should find wallet by ID without access check', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue(mockWallet);

      const result = await walletRepository.findById('wallet-123');

      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
      });
    });
  });

  describe('getName', () => {
    it('should return wallet name', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue({ name: 'My Wallet' });

      const result = await walletRepository.getName('wallet-123');

      expect(result).toBe('My Wallet');
    });

    it('should return null when wallet not found', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue(null);

      const result = await walletRepository.getName('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithGroup', () => {
    it('should return wallet with group info', async () => {
      const walletWithGroup = {
        ...mockWallet,
        group: { name: 'Family Wallet Group' },
      };

      (prisma.wallet.findUnique as Mock).mockResolvedValue(walletWithGroup);

      const result = await walletRepository.findByIdWithGroup('wallet-123');

      expect(result?.group?.name).toBe('Family Wallet Group');
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        include: { group: true },
      });
    });

    it('should return wallet with null group', async () => {
      const walletWithoutGroup = { ...mockWallet, group: null };
      (prisma.wallet.findUnique as Mock).mockResolvedValue(walletWithoutGroup);

      const result = await walletRepository.findByIdWithGroup('wallet-123');

      expect(result?.group).toBeNull();
    });
  });

  describe('findByIdWithDevices', () => {
    it('should return wallet with devices and accounts', async () => {
      const walletWithDevices = {
        ...mockWallet,
        devices: [
          {
            signerIndex: 0,
            device: {
              id: 'device-1',
              label: 'Ledger',
              accounts: [{ derivationPath: "m/84'/0'/0'" }],
            },
          },
          {
            signerIndex: 1,
            device: {
              id: 'device-2',
              label: 'Trezor',
              accounts: [{ derivationPath: "m/84'/0'/0'" }],
            },
          },
        ],
      };

      (prisma.wallet.findUnique as Mock).mockResolvedValue(walletWithDevices);

      const result = await walletRepository.findByIdWithDevices('wallet-123');

      expect(result?.devices).toHaveLength(2);
      expect(result?.devices[0].signerIndex).toBe(0);
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        include: {
          devices: {
            include: {
              device: {
                include: {
                  accounts: true,
                },
              },
            },
            orderBy: { signerIndex: 'asc' },
          },
        },
      });
    });
  });

  describe('findAllWithSelect', () => {
    it('should find all wallets with custom select', async () => {
      const wallets = [{ id: 'w1', name: 'Test' }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findAllWithSelect({ id: true, name: true });

      expect(result).toEqual(wallets);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: undefined,
        select: { id: true, name: true },
      });
    });

    it('should apply where filter when provided', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findAllWithSelect(
        { id: true },
        { network: 'mainnet' },
      );

      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: { network: 'mainnet' },
        select: { id: true },
      });
    });
  });

  describe('findByIdWithSelect', () => {
    it('should find wallet by ID with custom select', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue({ id: 'wallet-123', name: 'Test' });

      const result = await walletRepository.findByIdWithSelect('wallet-123', { id: true, name: true });

      expect(result).toEqual({ id: 'wallet-123', name: 'Test' });
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        select: { id: true, name: true },
      });
    });
  });

  describe('findAccessibleWithSelect', () => {
    it('should find accessible wallets with custom select', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([{ id: 'w1' }]);

      const result = await walletRepository.findAccessibleWithSelect(mockUserId, { id: true });

      expect(result).toEqual([{ id: 'w1' }]);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
        select: { id: true },
      });
    });

    it('should merge additionalWhere when provided', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findAccessibleWithSelect(
        mockUserId,
        { id: true },
        { network: 'testnet' },
      );

      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ network: 'testnet' }),
        select: { id: true },
      });
    });
  });

  describe('findNameById', () => {
    it('should return id and name', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue({ id: 'w1', name: 'Test' });

      const result = await walletRepository.findNameById('w1');

      expect(result).toEqual({ id: 'w1', name: 'Test' });
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'w1' },
        select: { id: true, name: true },
      });
    });
  });

  describe('findNetwork', () => {
    it('should return network string', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue({ network: 'mainnet' });

      const result = await walletRepository.findNetwork('w1');

      expect(result).toBe('mainnet');
    });

    it('should return null when wallet not found', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue(null);

      const result = await walletRepository.findNetwork('unknown');

      expect(result).toBeNull();
    });
  });

  describe('findByUserIdWithInclude', () => {
    it('should find user wallets with include', async () => {
      const wallets = [{ ...mockWallet, addresses: [] }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserIdWithInclude(
        mockUserId,
        { addresses: true },
      );

      expect(result).toEqual(wallets);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { users: { some: { userId: mockUserId } } },
            { group: { members: { some: { userId: mockUserId } } } },
          ],
        },
        include: { addresses: true },
        orderBy: undefined,
      });
    });

    it('should pass orderBy when provided', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      await walletRepository.findByUserIdWithInclude(
        mockUserId,
        { addresses: true },
        { name: 'asc' },
      );

      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });
  });
};
