/**
 * Address Repository Tests
 *
 * Tests for address data access layer operations including
 * address management, usage tracking, and label export.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    address: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { addressRepository } from '../../../src/repositories/addressRepository';

describe('Address Repository', () => {
  const mockAddress = {
    id: 'addr-123',
    walletId: 'wallet-456',
    address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    index: 0,
    derivationPath: "m/84'/0'/0'/0/0",
    used: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resetUsedFlags', () => {
    it('should reset used flags for all addresses in wallet', async () => {
      (prisma.address.updateMany as Mock).mockResolvedValue({ count: 100 });

      const count = await addressRepository.resetUsedFlags('wallet-456');

      expect(count).toBe(100);
      expect(prisma.address.updateMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
        data: { used: false },
      });
    });

    it('should return 0 when no addresses to reset', async () => {
      (prisma.address.updateMany as Mock).mockResolvedValue({ count: 0 });

      const count = await addressRepository.resetUsedFlags('empty-wallet');

      expect(count).toBe(0);
    });
  });

  describe('resetUsedFlagsForWallets', () => {
    it('should reset used flags for multiple wallets', async () => {
      (prisma.address.updateMany as Mock).mockResolvedValue({ count: 500 });

      const count = await addressRepository.resetUsedFlagsForWallets(['wallet-1', 'wallet-2', 'wallet-3']);

      expect(count).toBe(500);
      expect(prisma.address.updateMany).toHaveBeenCalledWith({
        where: { walletId: { in: ['wallet-1', 'wallet-2', 'wallet-3'] } },
        data: { used: false },
      });
    });
  });

  describe('findByWalletId', () => {
    it('should find all addresses for wallet', async () => {
      const addresses = [
        mockAddress,
        { ...mockAddress, id: 'addr-456', index: 1 },
      ];
      (prisma.address.findMany as Mock).mockResolvedValue(addresses);

      const result = await addressRepository.findByWalletId('wallet-456');

      expect(result).toHaveLength(2);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
        skip: undefined,
        take: undefined,
        orderBy: { index: 'asc' },
      });
    });

    it('should filter by used flag', async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([mockAddress]);

      await addressRepository.findByWalletId('wallet-456', { used: false });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', used: false },
        skip: undefined,
        take: undefined,
        orderBy: { index: 'asc' },
      });
    });

    it('should support pagination', async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([mockAddress]);

      await addressRepository.findByWalletId('wallet-456', { skip: 10, take: 20 });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
        skip: 10,
        take: 20,
        orderBy: { index: 'asc' },
      });
    });

    it('should filter used addresses', async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([{ ...mockAddress, used: true }]);

      await addressRepository.findByWalletId('wallet-456', { used: true });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', used: true },
        skip: undefined,
        take: undefined,
        orderBy: { index: 'asc' },
      });
    });
  });

  describe('findWalletSummariesByAddresses', () => {
    it('returns early for empty address lists', async () => {
      const result = await addressRepository.findWalletSummariesByAddresses(['']);

      expect(result).toEqual([]);
      expect(prisma.address.findMany).not.toHaveBeenCalled();
    });

    it('deduplicates address strings before querying wallet summaries', async () => {
      const rows = [{
        address: 'bc1qknown',
        wallet: { id: 'wallet-1', name: 'Known Wallet' },
      }];
      (prisma.address.findMany as Mock).mockResolvedValue(rows);

      const result = await addressRepository.findWalletSummariesByAddresses([
        'bc1qknown',
        'bc1qknown',
        '',
      ]);

      expect(result).toEqual(rows);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: {
          address: { in: ['bc1qknown'] },
        },
        select: {
          address: true,
          wallet: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });
  });

  describe('markAsUsed', () => {
    it('should mark address as used', async () => {
      const usedAddress = { ...mockAddress, used: true };
      (prisma.address.update as Mock).mockResolvedValue(usedAddress);

      const result = await addressRepository.markAsUsed('addr-123');

      expect(result.used).toBe(true);
      expect(prisma.address.update).toHaveBeenCalledWith({
        where: { id: 'addr-123' },
        data: { used: true },
      });
    });
  });

  describe('findNextUnused', () => {
    it('should find next unused address', async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(mockAddress);

      const result = await addressRepository.findNextUnused('wallet-456');

      expect(result).toEqual(mockAddress);
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          used: false,
        },
        orderBy: { index: 'asc' },
      });
    });

    it('should return null when no unused addresses', async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(null);

      const result = await addressRepository.findNextUnused('wallet-456');

      expect(result).toBeNull();
    });
  });

  describe('findNextUnusedReceive', () => {
    it('should find next unused receive address', async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(mockAddress);

      const result = await addressRepository.findNextUnusedReceive('wallet-456');

      expect(result).toEqual(mockAddress);
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          used: false,
          derivationPath: { contains: '/0/' },
        },
        orderBy: { index: 'asc' },
      });
    });

    it('should return null when no unused receive address exists', async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(null);

      const result = await addressRepository.findNextUnusedReceive('wallet-456');

      expect(result).toBeNull();
    });
  });

  describe('countByWalletId', () => {
    it('should count all addresses', async () => {
      (prisma.address.count as Mock).mockResolvedValue(200);

      const count = await addressRepository.countByWalletId('wallet-456');

      expect(count).toBe(200);
      expect(prisma.address.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
      });
    });

    it('should count used addresses', async () => {
      (prisma.address.count as Mock).mockResolvedValue(50);

      const count = await addressRepository.countByWalletId('wallet-456', { used: true });

      expect(count).toBe(50);
      expect(prisma.address.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', used: true },
      });
    });

    it('should count unused addresses', async () => {
      (prisma.address.count as Mock).mockResolvedValue(150);

      const count = await addressRepository.countByWalletId('wallet-456', { used: false });

      expect(count).toBe(150);
      expect(prisma.address.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', used: false },
      });
    });
  });

  describe('findWithLabels', () => {
    it('should find addresses with labels for export', async () => {
      const addressesWithLabels = [
        {
          ...mockAddress,
          addressLabels: [
            { label: { id: 'label-1', name: 'Personal', color: '#ff0000' } },
          ],
        },
      ];
      (prisma.address.findMany as Mock).mockResolvedValue(addressesWithLabels);

      const result = await addressRepository.findWithLabels('wallet-456');

      expect(result[0].addressLabels).toHaveLength(1);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          addressLabels: { some: {} },
        },
        include: {
          addressLabels: {
            include: {
              label: true,
            },
          },
        },
      });
    });

    it('should return empty array when no addresses have labels', async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([]);

      const result = await addressRepository.findWithLabels('wallet-456');

      expect(result).toEqual([]);
    });
  });

  describe('findAllWithWalletNetwork', () => {
    it('should return all addresses with wallet network info', async () => {
      const addresses = [
        { id: 'a1', address: 'bc1q...', walletId: 'w1', wallet: { network: 'mainnet' } },
      ];
      (prisma.address.findMany as Mock).mockResolvedValue(addresses);

      const result = await addressRepository.findAllWithWalletNetwork();

      expect(result).toEqual(addresses);
      expect(prisma.address.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          address: true,
          walletId: true,
          wallet: { select: { network: true } },
        },
        orderBy: { id: 'asc' },
      });
    });
  });

  describe('findAllWithWalletNetworkPaginated', () => {
    it('should paginate without cursor', async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([]);

      await addressRepository.findAllWithWalletNetworkPaginated({ take: 100 });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          address: true,
          walletId: true,
          wallet: { select: { network: true } },
        },
        take: 100,
        skip: 0,
        cursor: undefined,
        orderBy: { id: 'asc' },
      });
    });

    it('should paginate with cursor', async () => {
      (prisma.address.findMany as Mock).mockResolvedValue([]);

      await addressRepository.findAllWithWalletNetworkPaginated({ take: 100, cursor: 'addr-50' });

      expect(prisma.address.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          address: true,
          walletId: true,
          wallet: { select: { network: true } },
        },
        take: 100,
        skip: 1,
        cursor: { id: 'addr-50' },
        orderBy: { id: 'asc' },
      });
    });
  });

  describe('findByAddress', () => {
    it('should find address by address string with default select', async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue({ walletId: 'w1' });

      const result = await addressRepository.findByAddress('bc1q...');

      expect(result).toEqual({ walletId: 'w1' });
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { address: 'bc1q...' },
        select: { walletId: true },
      });
    });

    it('should use custom select when provided', async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue({ walletId: 'w1' });

      await addressRepository.findByAddress('bc1q...', { walletId: true });

      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { address: 'bc1q...' },
        select: { walletId: true },
      });
    });

    it('should return null when address not found', async () => {
      (prisma.address.findFirst as Mock).mockResolvedValue(null);

      const result = await addressRepository.findByAddress('unknown');

      expect(result).toBeNull();
    });
  });

  describe('findByAddressWithWallet', () => {
    it('should find address with wallet included', async () => {
      const addressWithWallet = {
        ...mockAddress,
        wallet: { id: 'w1', name: 'Test', network: 'mainnet' },
      };
      (prisma.address.findFirst as Mock).mockResolvedValue(addressWithWallet);

      const result = await addressRepository.findByAddressWithWallet('bc1q...');

      expect(result).toEqual(addressWithWallet);
      expect(prisma.address.findFirst).toHaveBeenCalledWith({
        where: { address: 'bc1q...' },
        include: { wallet: true },
      });
    });
  });

  describe('create', () => {
    it('should create a single address', async () => {
      const newAddr = {
        walletId: 'w1',
        address: 'bc1qnew...',
        derivationPath: "m/84'/0'/0'/0/5",
        index: 5,
        used: false,
      };
      (prisma.address.create as Mock).mockResolvedValue({ id: 'new-id', ...newAddr });

      const result = await addressRepository.create(newAddr);

      expect(result.id).toBe('new-id');
      expect(prisma.address.create).toHaveBeenCalledWith({ data: newAddr });
    });
  });
});
