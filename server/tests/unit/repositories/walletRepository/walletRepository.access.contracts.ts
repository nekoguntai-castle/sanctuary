import { describe, expect, it, type Mock } from 'vitest';

import {
  mockUserId,
  mockWallet,
  prisma,
  walletRepository,
} from './walletRepositoryTestHarness';

export const registerWalletRepositoryAccessContracts = () => {
  describe('findByIdWithAccess', () => {
    it('should return wallet when user has direct access', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(mockWallet);

      const result = await walletRepository.findByIdWithAccess('wallet-123', mockUserId);

      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'wallet-123',
          OR: [
            { users: { some: { userId: mockUserId } } },
            { group: { members: { some: { userId: mockUserId } } } },
          ],
        },
      });
    });

    it('should return null when user lacks access', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(null);

      const result = await walletRepository.findByIdWithAccess('wallet-123', 'other-user');

      expect(result).toBeNull();
    });

    it('should return null when wallet does not exist', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(null);

      const result = await walletRepository.findByIdWithAccess('non-existent', mockUserId);

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithAddresses', () => {
    it('should return wallet with addresses included', async () => {
      const walletWithAddresses = {
        ...mockWallet,
        addresses: [
          { id: 'addr-1', address: 'bc1q...', index: 0 },
          { id: 'addr-2', address: 'bc1q...', index: 1 },
        ],
      };

      (prisma.wallet.findFirst as Mock).mockResolvedValue(walletWithAddresses);

      const result = await walletRepository.findByIdWithAddresses('wallet-123', mockUserId);

      expect(result).toEqual(walletWithAddresses);
      expect(result?.addresses).toHaveLength(2);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'wallet-123' }),
        include: { addresses: true },
      });
    });
  });

  describe('findByUserId', () => {
    it('should return all wallets for user', async () => {
      const wallets = [mockWallet, { ...mockWallet, id: 'wallet-456', name: 'Second Wallet' }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(wallets);

      const result = await walletRepository.findByUserId(mockUserId);

      expect(result).toHaveLength(2);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { users: { some: { userId: mockUserId } } },
            { group: { members: { some: { userId: mockUserId } } } },
          ],
        },
      });
    });

    it('should return empty array when user has no wallets', async () => {
      (prisma.wallet.findMany as Mock).mockResolvedValue([]);

      const result = await walletRepository.findByUserId(mockUserId);

      expect(result).toEqual([]);
    });
  });

  describe('hasAccess', () => {
    it('should return true when user has access', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue({ id: 'wallet-123' });

      const result = await walletRepository.hasAccess('wallet-123', mockUserId);

      expect(result).toBe(true);
    });

    it('should return false when user lacks access', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(null);

      const result = await walletRepository.hasAccess('wallet-123', 'other-user');

      expect(result).toBe(false);
    });
  });

  describe('findByIdWithAccessAndDevices', () => {
    it('queries with access check and device include', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValueOnce({ ...mockWallet, devices: [] });
      const result = await walletRepository.findByIdWithAccessAndDevices('wallet-123', mockUserId);
      expect(result).toBeTruthy();
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'wallet-123' }),
        include: { devices: { include: { device: true } } },
      }));
    });
  });

  describe('findByIdWithOwnerAndDevices', () => {
    it('queries with owner role check and device include', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValueOnce({ ...mockWallet, devices: [] });
      const result = await walletRepository.findByIdWithOwnerAndDevices('wallet-123', mockUserId);
      expect(result).toBeTruthy();
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: 'wallet-123',
          users: { some: { userId: mockUserId, role: 'owner' } },
        }),
        include: { devices: { include: { device: true } } },
      }));
    });
  });

  describe('findByIdWithEditAccess', () => {
    it('should find wallet where user is owner or signer', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(mockWallet);

      const result = await walletRepository.findByIdWithEditAccess('wallet-123', mockUserId);

      expect(result).toEqual(mockWallet);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'wallet-123',
          users: {
            some: {
              userId: mockUserId,
              role: { in: ['owner', 'signer'] },
            },
          },
        },
      });
    });
  });

  describe('findGroupRoleByMembership', () => {
    it('should return group role when found', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue({ groupRole: 'viewer' });

      const result = await walletRepository.findGroupRoleByMembership('wallet-123', mockUserId);

      expect(result).toBe('viewer');
    });

    it('should return null when no group membership', async () => {
      (prisma.wallet.findFirst as Mock).mockResolvedValue(null);

      const result = await walletRepository.findGroupRoleByMembership('wallet-123', mockUserId);

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithAccessAndInclude', () => {
    it('should find wallet with access check and custom include', async () => {
      const walletWithTx = { ...mockWallet, transactions: [] };
      (prisma.wallet.findFirst as Mock).mockResolvedValue(walletWithTx);

      const result = await walletRepository.findByIdWithAccessAndInclude(
        'wallet-123',
        mockUserId,
        { transactions: true },
      );

      expect(result).toEqual(walletWithTx);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: 'wallet-123' }),
        include: { transactions: true },
      });
    });
  });

  describe('findByIdWithFullAccess', () => {
    it('should find wallet with full access check', async () => {
      const walletWithInclude = { ...mockWallet, users: [] };
      (prisma.wallet.findFirst as Mock).mockResolvedValue(walletWithInclude);

      const result = await walletRepository.findByIdWithFullAccess(
        'wallet-123',
        mockUserId,
        { users: true },
      );

      expect(result).toEqual(walletWithInclude);
      expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'wallet-123',
          OR: [
            { users: { some: { userId: mockUserId } } },
            { group: { members: { some: { userId: mockUserId } } } },
          ],
        },
        include: { users: true },
      });
    });
  });
};
