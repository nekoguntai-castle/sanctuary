/**
 * Label Repository Tests
 *
 * Tests for label data access layer operations including
 * label CRUD, transaction labels, and address labels.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    label: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    transactionLabel: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    addressLabel: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from '../../../src/models/prisma';
import { labelRepository } from '../../../src/repositories/labelRepository';

describe('Label Repository', () => {
  const mockLabel = {
    id: 'label-123',
    walletId: 'wallet-456',
    name: 'Personal',
    color: '#ff0000',
    description: 'Personal transactions',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // LABEL CRUD TESTS
  // ========================================

  describe('findByWalletId', () => {
    it('should find all labels with usage counts', async () => {
      const labelsWithCounts = [
        {
          ...mockLabel,
          _count: { transactionLabels: 5, addressLabels: 3 },
        },
        {
          ...mockLabel,
          id: 'label-456',
          name: 'Business',
          _count: { transactionLabels: 10, addressLabels: 2 },
        },
      ];
      (prisma.label.findMany as Mock).mockResolvedValue(labelsWithCounts);

      const result = await labelRepository.findByWalletId('wallet-456');

      expect(result).toHaveLength(2);
      expect(result[0].transactionCount).toBe(5);
      expect(result[0].addressCount).toBe(3);
      expect(result[1].transactionCount).toBe(10);
      expect(prisma.label.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
        include: {
          _count: {
            select: {
              transactionLabels: true,
              addressLabels: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });
    });

    it('should return empty array when no labels', async () => {
      (prisma.label.findMany as Mock).mockResolvedValue([]);

      const result = await labelRepository.findByWalletId('wallet-456');

      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should find label by ID', async () => {
      (prisma.label.findUnique as Mock).mockResolvedValue(mockLabel);

      const result = await labelRepository.findById('label-123');

      expect(result).toEqual(mockLabel);
      expect(prisma.label.findUnique).toHaveBeenCalledWith({
        where: { id: 'label-123' },
      });
    });

    it('should return null when label not found', async () => {
      (prisma.label.findUnique as Mock).mockResolvedValue(null);

      const result = await labelRepository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByIdInWallet', () => {
    it('should find label by ID with wallet ownership check', async () => {
      (prisma.label.findFirst as Mock).mockResolvedValue(mockLabel);

      const result = await labelRepository.findByIdInWallet('label-123', 'wallet-456');

      expect(result).toEqual(mockLabel);
      expect(prisma.label.findFirst).toHaveBeenCalledWith({
        where: { id: 'label-123', walletId: 'wallet-456' },
      });
    });

    it('should return null when label belongs to different wallet', async () => {
      (prisma.label.findFirst as Mock).mockResolvedValue(null);

      const result = await labelRepository.findByIdInWallet('label-123', 'other-wallet');

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithAssociations', () => {
    it('should find label with all associations', async () => {
      const labelWithAssociations = {
        ...mockLabel,
        transactionLabels: [
          {
            transaction: {
              id: 'tx-1',
              txid: 'abc123',
              type: 'receive',
              amount: BigInt(50000),
              confirmations: 6,
              blockTime: new Date(),
            },
          },
        ],
        addressLabels: [
          {
            address: {
              id: 'addr-1',
              address: 'bc1q...',
              derivationPath: "m/84'/0'/0'/0/0",
              index: 0,
              used: true,
            },
          },
        ],
      };
      (prisma.label.findFirst as Mock).mockResolvedValue(labelWithAssociations);

      const result = await labelRepository.findByIdWithAssociations('label-123', 'wallet-456');

      expect(result).not.toBeNull();
      expect(result?.transactions).toHaveLength(1);
      expect(result?.addresses).toHaveLength(1);
      expect(result?.transactions[0].txid).toBe('abc123');
      expect(result?.addresses[0].address).toBe('bc1q...');
    });

    it('should return null when label not found', async () => {
      (prisma.label.findFirst as Mock).mockResolvedValue(null);

      const result = await labelRepository.findByIdWithAssociations('nonexistent', 'wallet-456');

      expect(result).toBeNull();
    });
  });

  describe('findByNameInWallet', () => {
    it('should find label by name in wallet', async () => {
      (prisma.label.findFirst as Mock).mockResolvedValue(mockLabel);

      const result = await labelRepository.findByNameInWallet('wallet-456', 'Personal');

      expect(result).toEqual(mockLabel);
      expect(prisma.label.findFirst).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456', name: 'Personal' },
      });
    });

    it('should return null when name not found', async () => {
      (prisma.label.findFirst as Mock).mockResolvedValue(null);

      const result = await labelRepository.findByNameInWallet('wallet-456', 'Nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('isNameTakenByOther', () => {
    it('should return true when name is taken by another label', async () => {
      (prisma.label.findFirst as Mock).mockResolvedValue({ id: 'other-label' });

      const result = await labelRepository.isNameTakenByOther('wallet-456', 'Personal', 'label-123');

      expect(result).toBe(true);
      expect(prisma.label.findFirst).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          name: 'Personal',
          id: { not: 'label-123' },
        },
        select: { id: true },
      });
    });

    it('should return false when name is not taken', async () => {
      (prisma.label.findFirst as Mock).mockResolvedValue(null);

      const result = await labelRepository.isNameTakenByOther('wallet-456', 'Personal', 'label-123');

      expect(result).toBe(false);
    });
  });

  describe('create', () => {
    it('should create a new label', async () => {
      (prisma.label.create as Mock).mockResolvedValue(mockLabel);

      const result = await labelRepository.create({
        walletId: 'wallet-456',
        name: 'Personal',
        color: '#ff0000',
        description: 'Personal transactions',
      });

      expect(result).toEqual(mockLabel);
      expect(prisma.label.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-456',
          name: 'Personal',
          color: '#ff0000',
          description: 'Personal transactions',
        },
      });
    });

    it('should use default color when not provided', async () => {
      (prisma.label.create as Mock).mockResolvedValue({ ...mockLabel, color: '#6366f1' });

      await labelRepository.create({
        walletId: 'wallet-456',
        name: 'Test Label',
      });

      expect(prisma.label.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-456',
          name: 'Test Label',
          color: '#6366f1',
          description: null,
        },
      });
    });

    it('should trim label name', async () => {
      (prisma.label.create as Mock).mockResolvedValue(mockLabel);

      await labelRepository.create({
        walletId: 'wallet-456',
        name: '  Personal  ',
      });

      expect(prisma.label.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Personal',
        }),
      });
    });
  });

  describe('update', () => {
    it('should update a label', async () => {
      const updatedLabel = { ...mockLabel, name: 'Updated Name' };
      (prisma.label.update as Mock).mockResolvedValue(updatedLabel);

      const result = await labelRepository.update('label-123', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(prisma.label.update).toHaveBeenCalledWith({
        where: { id: 'label-123' },
        data: { name: 'Updated Name' },
      });
    });

    it('should only update provided fields', async () => {
      (prisma.label.update as Mock).mockResolvedValue({ ...mockLabel, color: '#00ff00' });

      await labelRepository.update('label-123', { color: '#00ff00' });

      expect(prisma.label.update).toHaveBeenCalledWith({
        where: { id: 'label-123' },
        data: { color: '#00ff00' },
      });
    });

    it('should trim name when updating', async () => {
      (prisma.label.update as Mock).mockResolvedValue(mockLabel);

      await labelRepository.update('label-123', { name: '  Trimmed  ' });

      expect(prisma.label.update).toHaveBeenCalledWith({
        where: { id: 'label-123' },
        data: { name: 'Trimmed' },
      });
    });

    it('should update description when explicitly provided', async () => {
      (prisma.label.update as Mock).mockResolvedValue({ ...mockLabel, description: null });

      await labelRepository.update('label-123', { description: null });

      expect(prisma.label.update).toHaveBeenCalledWith({
        where: { id: 'label-123' },
        data: { description: null },
      });
    });
  });

  describe('remove', () => {
    it('should delete a label', async () => {
      (prisma.label.delete as Mock).mockResolvedValue(mockLabel);

      await labelRepository.remove('label-123');

      expect(prisma.label.delete).toHaveBeenCalledWith({
        where: { id: 'label-123' },
      });
    });
  });

  describe('findManyByIdsInWallet', () => {
    it('should find multiple labels by IDs in wallet', async () => {
      const labels = [mockLabel, { ...mockLabel, id: 'label-456' }];
      (prisma.label.findMany as Mock).mockResolvedValue(labels);

      const result = await labelRepository.findManyByIdsInWallet(['label-123', 'label-456'], 'wallet-456');

      expect(result).toHaveLength(2);
      expect(prisma.label.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['label-123', 'label-456'] },
          walletId: 'wallet-456',
        },
      });
    });
  });

  // ========================================
  // TRANSACTION LABEL TESTS
  // ========================================

  describe('getLabelsForTransaction', () => {
    it('should get labels for a transaction', async () => {
      const associations = [
        { label: mockLabel },
        { label: { ...mockLabel, id: 'label-456', name: 'Business' } },
      ];
      (prisma.transactionLabel.findMany as Mock).mockResolvedValue(associations);

      const result = await labelRepository.getLabelsForTransaction('tx-123');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Personal');
      expect(prisma.transactionLabel.findMany).toHaveBeenCalledWith({
        where: { transactionId: 'tx-123' },
        include: { label: true },
      });
    });

    it('should return empty array when no labels', async () => {
      (prisma.transactionLabel.findMany as Mock).mockResolvedValue([]);

      const result = await labelRepository.getLabelsForTransaction('tx-123');

      expect(result).toEqual([]);
    });
  });

  describe('addLabelsToTransaction', () => {
    it('should add labels to a transaction', async () => {
      (prisma.transactionLabel.createMany as Mock).mockResolvedValue({ count: 2 });

      await labelRepository.addLabelsToTransaction('tx-123', ['label-1', 'label-2']);

      expect(prisma.transactionLabel.createMany).toHaveBeenCalledWith({
        data: [
          { transactionId: 'tx-123', labelId: 'label-1' },
          { transactionId: 'tx-123', labelId: 'label-2' },
        ],
        skipDuplicates: true,
      });
    });
  });

  describe('replaceTransactionLabels', () => {
    it('should replace all labels on a transaction', async () => {
      (prisma.$transaction as Mock).mockResolvedValue([{ count: 1 }, { count: 2 }]);

      await labelRepository.replaceTransactionLabels('tx-123', ['label-1', 'label-2']);

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('removeLabelFromTransaction', () => {
    it('should remove a label from a transaction', async () => {
      (prisma.transactionLabel.deleteMany as Mock).mockResolvedValue({ count: 1 });

      await labelRepository.removeLabelFromTransaction('tx-123', 'label-123');

      expect(prisma.transactionLabel.deleteMany).toHaveBeenCalledWith({
        where: { transactionId: 'tx-123', labelId: 'label-123' },
      });
    });
  });

  // ========================================
  // ADDRESS LABEL TESTS
  // ========================================

  describe('getLabelsForAddress', () => {
    it('should get labels for an address', async () => {
      const associations = [{ label: mockLabel }];
      (prisma.addressLabel.findMany as Mock).mockResolvedValue(associations);

      const result = await labelRepository.getLabelsForAddress('addr-123');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Personal');
      expect(prisma.addressLabel.findMany).toHaveBeenCalledWith({
        where: { addressId: 'addr-123' },
        include: { label: true },
      });
    });

    it('should return empty array when no labels', async () => {
      (prisma.addressLabel.findMany as Mock).mockResolvedValue([]);

      const result = await labelRepository.getLabelsForAddress('addr-123');

      expect(result).toEqual([]);
    });
  });

  describe('addLabelsToAddress', () => {
    it('should add labels to an address', async () => {
      (prisma.addressLabel.createMany as Mock).mockResolvedValue({ count: 2 });

      await labelRepository.addLabelsToAddress('addr-123', ['label-1', 'label-2']);

      expect(prisma.addressLabel.createMany).toHaveBeenCalledWith({
        data: [
          { addressId: 'addr-123', labelId: 'label-1' },
          { addressId: 'addr-123', labelId: 'label-2' },
        ],
        skipDuplicates: true,
      });
    });
  });

  describe('replaceAddressLabels', () => {
    it('should replace all labels on an address', async () => {
      (prisma.$transaction as Mock).mockResolvedValue([{ count: 1 }, { count: 2 }]);

      await labelRepository.replaceAddressLabels('addr-123', ['label-1', 'label-2']);

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('reuses a supplied transaction client without opening a nested transaction', async () => {
      (prisma.addressLabel.deleteMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.addressLabel.createMany as Mock).mockResolvedValue({ count: 2 });

      await labelRepository.replaceAddressLabels(
        'addr-123',
        ['label-1', 'label-2'],
        prisma as never,
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.addressLabel.deleteMany).toHaveBeenCalledWith({
        where: { addressId: 'addr-123' },
      });
      expect(prisma.addressLabel.createMany).toHaveBeenCalledWith({
        data: [
          { addressId: 'addr-123', labelId: 'label-1' },
          { addressId: 'addr-123', labelId: 'label-2' },
        ],
      });
    });
  });

  describe('removeLabelFromAddress', () => {
    it('should remove a label from an address', async () => {
      (prisma.addressLabel.deleteMany as Mock).mockResolvedValue({ count: 1 });

      await labelRepository.removeLabelFromAddress('addr-123', 'label-123');

      expect(prisma.addressLabel.deleteMany).toHaveBeenCalledWith({
        where: { addressId: 'addr-123', labelId: 'label-123' },
      });
    });
  });
});
