/**
 * UTXO Repository Tests
 *
 * Tests for UTXO data access layer operations including
 * balance calculations, UTXO queries, and marking spent.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    uTXO: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { utxoRepository } from '../../../src/repositories/utxoRepository';

describe('UTXO Repository', () => {
  const mockUtxo = {
    id: 'utxo-123',
    walletId: 'wallet-456',
    txid: 'abc123def456',
    vout: 0,
    amount: BigInt(100000),
    spent: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUnspentBalance', () => {
    it('should return total unspent balance for wallet', async () => {
      (prisma.uTXO.aggregate as Mock).mockResolvedValue({
        _sum: { amount: BigInt(500000) },
      });

      const balance = await utxoRepository.getUnspentBalance('wallet-456');

      expect(balance).toBe(BigInt(500000));
      expect(prisma.uTXO.aggregate).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', spent: false },
        _sum: { amount: true },
      });
    });

    it('should return 0 when no unspent UTXOs', async () => {
      (prisma.uTXO.aggregate as Mock).mockResolvedValue({
        _sum: { amount: null },
      });

      const balance = await utxoRepository.getUnspentBalance('empty-wallet');

      expect(balance).toBe(BigInt(0));
    });
  });

  describe('getUnspentBalanceForWallets', () => {
    it('should return balance map for multiple wallets', async () => {
      (prisma.uTXO.groupBy as Mock).mockResolvedValue([
        { walletId: 'wallet-1', _sum: { amount: BigInt(100000) } },
        { walletId: 'wallet-2', _sum: { amount: BigInt(200000) } },
      ]);

      const balances = await utxoRepository.getUnspentBalanceForWallets(['wallet-1', 'wallet-2', 'wallet-3']);

      expect(balances.get('wallet-1')).toBe(BigInt(100000));
      expect(balances.get('wallet-2')).toBe(BigInt(200000));
      expect(balances.has('wallet-3')).toBe(false);
      expect(prisma.uTXO.groupBy).toHaveBeenCalledWith({
        by: ['walletId'],
        where: { walletId: { in: ['wallet-1', 'wallet-2', 'wallet-3'] }, spent: false },
        _sum: { amount: true },
      });
    });

    it('should return empty map when no wallets have UTXOs', async () => {
      (prisma.uTXO.groupBy as Mock).mockResolvedValue([]);

      const balances = await utxoRepository.getUnspentBalanceForWallets(['wallet-1']);

      expect(balances.size).toBe(0);
    });

    it('should handle null amounts in group results', async () => {
      (prisma.uTXO.groupBy as Mock).mockResolvedValue([
        { walletId: 'wallet-1', _sum: { amount: null } },
      ]);

      const balances = await utxoRepository.getUnspentBalanceForWallets(['wallet-1']);

      expect(balances.get('wallet-1')).toBe(BigInt(0));
    });
  });

  describe('findByWalletId', () => {
    it('should find all UTXOs for wallet', async () => {
      const utxos = [mockUtxo, { ...mockUtxo, id: 'utxo-456', vout: 1 }];
      (prisma.uTXO.findMany as Mock).mockResolvedValue(utxos);

      const result = await utxoRepository.findByWalletId('wallet-456');

      expect(result).toHaveLength(2);
      expect(prisma.uTXO.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
        skip: undefined,
        take: undefined,
        orderBy: { amount: 'desc' },
      });
    });

    it('should filter by spent flag', async () => {
      (prisma.uTXO.findMany as Mock).mockResolvedValue([mockUtxo]);

      await utxoRepository.findByWalletId('wallet-456', { spent: false });

      expect(prisma.uTXO.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', spent: false },
        skip: undefined,
        take: undefined,
        orderBy: { amount: 'desc' },
      });
    });

    it('should support pagination', async () => {
      (prisma.uTXO.findMany as Mock).mockResolvedValue([mockUtxo]);

      await utxoRepository.findByWalletId('wallet-456', { skip: 10, take: 20 });

      expect(prisma.uTXO.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
        skip: 10,
        take: 20,
        orderBy: { amount: 'desc' },
      });
    });

    it('should filter spent UTXOs', async () => {
      (prisma.uTXO.findMany as Mock).mockResolvedValue([{ ...mockUtxo, spent: true }]);

      await utxoRepository.findByWalletId('wallet-456', { spent: true });

      expect(prisma.uTXO.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', spent: true },
        skip: undefined,
        take: undefined,
        orderBy: { amount: 'desc' },
      });
    });
  });

  describe('findUnspent', () => {
    it('should find all unspent UTXOs for wallet', async () => {
      const utxos = [mockUtxo, { ...mockUtxo, id: 'utxo-456' }];
      (prisma.uTXO.findMany as Mock).mockResolvedValue(utxos);

      const result = await utxoRepository.findUnspent('wallet-456');

      expect(result).toHaveLength(2);
      expect(prisma.uTXO.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', spent: false },
        orderBy: { amount: 'desc' },
      });
    });

    it('should return empty array when no unspent UTXOs', async () => {
      (prisma.uTXO.findMany as Mock).mockResolvedValue([]);

      const result = await utxoRepository.findUnspent('wallet-456');

      expect(result).toEqual([]);
    });

    it('should exclude frozen UTXOs when excludeFrozen is true', async () => {
      (prisma.uTXO.findMany as Mock).mockResolvedValue([mockUtxo]);

      await utxoRepository.findUnspent('wallet-456', { excludeFrozen: true });

      expect(prisma.uTXO.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', spent: false, frozen: false },
        orderBy: { amount: 'desc' },
      });
    });
  });

  describe('markAsSpent', () => {
    it('should mark UTXO as spent', async () => {
      const spentUtxo = { ...mockUtxo, spent: true };
      (prisma.uTXO.update as Mock).mockResolvedValue(spentUtxo);

      const result = await utxoRepository.markAsSpent('abc123def456', 0);

      expect(result?.spent).toBe(true);
      expect(prisma.uTXO.update).toHaveBeenCalledWith({
        where: { txid_vout: { txid: 'abc123def456', vout: 0 } },
        data: { spent: true },
      });
    });

    it('should return null when UTXO not found', async () => {
      (prisma.uTXO.update as Mock).mockRejectedValue(new Error('Record not found'));

      const result = await utxoRepository.markAsSpent('nonexistent', 0);

      expect(result).toBeNull();
    });
  });

  describe('deleteByWalletId', () => {
    it('should delete all UTXOs for wallet', async () => {
      (prisma.uTXO.deleteMany as Mock).mockResolvedValue({ count: 50 });

      const count = await utxoRepository.deleteByWalletId('wallet-456');

      expect(count).toBe(50);
      expect(prisma.uTXO.deleteMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
      });
    });

    it('should return 0 when no UTXOs to delete', async () => {
      (prisma.uTXO.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const count = await utxoRepository.deleteByWalletId('empty-wallet');

      expect(count).toBe(0);
    });
  });

  describe('deleteByWalletIds', () => {
    it('should delete UTXOs for multiple wallets', async () => {
      (prisma.uTXO.deleteMany as Mock).mockResolvedValue({ count: 150 });

      const count = await utxoRepository.deleteByWalletIds(['wallet-1', 'wallet-2', 'wallet-3']);

      expect(count).toBe(150);
      expect(prisma.uTXO.deleteMany).toHaveBeenCalledWith({
        where: { walletId: { in: ['wallet-1', 'wallet-2', 'wallet-3'] } },
      });
    });
  });

  describe('countByWalletId', () => {
    it('should count all UTXOs', async () => {
      (prisma.uTXO.count as Mock).mockResolvedValue(100);

      const count = await utxoRepository.countByWalletId('wallet-456');

      expect(count).toBe(100);
      expect(prisma.uTXO.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
      });
    });

    it('should count spent UTXOs', async () => {
      (prisma.uTXO.count as Mock).mockResolvedValue(25);

      const count = await utxoRepository.countByWalletId('wallet-456', { spent: true });

      expect(count).toBe(25);
      expect(prisma.uTXO.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', spent: true },
      });
    });

    it('should count unspent UTXOs', async () => {
      (prisma.uTXO.count as Mock).mockResolvedValue(75);

      const count = await utxoRepository.countByWalletId('wallet-456', { spent: false });

      expect(count).toBe(75);
      expect(prisma.uTXO.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', spent: false },
      });
    });
  });

  describe('findByIdWithAccess', () => {
    it('should return UTXO when user has wallet access', async () => {
      (prisma.uTXO.findFirst as Mock).mockResolvedValue(mockUtxo);

      const result = await utxoRepository.findByIdWithAccess('utxo-123', 'user-456');

      expect(result).toEqual(mockUtxo);
      expect(prisma.uTXO.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'utxo-123',
          wallet: {
            OR: [
              { users: { some: { userId: 'user-456' } } },
              { group: { members: { some: { userId: 'user-456' } } } },
            ],
          },
        },
      });
    });

    it('should return null when user lacks access', async () => {
      (prisma.uTXO.findFirst as Mock).mockResolvedValue(null);

      const result = await utxoRepository.findByIdWithAccess('utxo-123', 'other-user');

      expect(result).toBeNull();
    });
  });

  describe('findByOutpointsForWallet', () => {
    it('should find exact wallet UTXOs with draft lock state', async () => {
      (prisma.uTXO.findMany as Mock).mockResolvedValue([
        {
          id: 'utxo-1',
          txid: 'txid-1',
          vout: 0,
          address: 'tb1qfunding',
          amount: BigInt(100000),
          spent: false,
          frozen: false,
          draftLock: null,
        },
      ]);

      const result = await utxoRepository.findByOutpointsForWallet('wallet-456', [
        { txid: 'txid-1', vout: 0 },
        { txid: 'txid-2', vout: 1 },
      ]);

      expect(result).toHaveLength(1);
      expect(prisma.uTXO.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          OR: [
            { txid: 'txid-1', vout: 0 },
            { txid: 'txid-2', vout: 1 },
          ],
        },
        select: {
          id: true,
          txid: true,
          vout: true,
          address: true,
          amount: true,
          spent: true,
          frozen: true,
          draftLock: {
            select: {
              draftId: true,
            },
          },
        },
      });
    });

    it('should not query Prisma for an empty outpoint list', async () => {
      const result = await utxoRepository.findByOutpointsForWallet('wallet-456', []);

      expect(result).toEqual([]);
      expect(prisma.uTXO.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getConfirmedUnconfirmedBalance', () => {
    it('should return confirmed and unconfirmed balances separately', async () => {
      (prisma.uTXO.aggregate as Mock)
        .mockResolvedValueOnce({ _sum: { amount: BigInt(300000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(50000) } });

      const result = await utxoRepository.getConfirmedUnconfirmedBalance('wallet-456');

      expect(result).toEqual({ confirmed: 300000, unconfirmed: 50000 });
      expect(prisma.uTXO.aggregate).toHaveBeenNthCalledWith(1, {
        where: { walletId: 'wallet-456', spent: false, blockHeight: { not: null } },
        _sum: { amount: true },
      });
      expect(prisma.uTXO.aggregate).toHaveBeenNthCalledWith(2, {
        where: { walletId: 'wallet-456', spent: false, blockHeight: null },
        _sum: { amount: true },
      });
    });

    it('should return zeros when no UTXOs exist', async () => {
      (prisma.uTXO.aggregate as Mock)
        .mockResolvedValueOnce({ _sum: { amount: null } })
        .mockResolvedValueOnce({ _sum: { amount: null } });

      const result = await utxoRepository.getConfirmedUnconfirmedBalance('empty-wallet');

      expect(result).toEqual({ confirmed: 0, unconfirmed: 0 });
    });
  });
});
