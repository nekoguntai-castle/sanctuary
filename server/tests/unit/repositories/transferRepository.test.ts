/**
 * Transfer Repository Tests
 *
 * Tests for ownership transfer data access operations.
 */

import { vi, Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    ownershipTransfer: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import prisma from '../../../src/models/prisma';
import { transferRepository } from '../../../src/repositories/transferRepository';

describe('Transfer Repository', () => {
  const mockTransfer = {
    id: 'transfer-1',
    fromUserId: 'user-1',
    toUserId: 'user-2',
    resourceType: 'wallet',
    resourceId: 'wallet-1',
    status: 'pending',
    expiresAt: new Date('2025-12-31'),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTransferWithUsers = {
    ...mockTransfer,
    fromUser: { id: 'user-1', username: 'alice' },
    toUser: { id: 'user-2', username: 'bob' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findById', () => {
    it('should find transfer by id', async () => {
      (prisma.ownershipTransfer.findUnique as Mock).mockResolvedValue(mockTransfer);

      const result = await transferRepository.findById('transfer-1');

      expect(result).toEqual(mockTransfer);
      expect(prisma.ownershipTransfer.findUnique).toHaveBeenCalledWith({
        where: { id: 'transfer-1' },
      });
    });

    it('should return null when not found', async () => {
      (prisma.ownershipTransfer.findUnique as Mock).mockResolvedValue(null);

      const result = await transferRepository.findById('missing');

      expect(result).toBeNull();
    });

    it('should use transaction client when provided', async () => {
      const mockTx = {
        ownershipTransfer: {
          findUnique: vi.fn().mockResolvedValue(mockTransfer),
        },
      };

      const result = await transferRepository.findById('transfer-1', mockTx as any);

      expect(result).toEqual(mockTransfer);
      expect(mockTx.ownershipTransfer.findUnique).toHaveBeenCalled();
      expect(prisma.ownershipTransfer.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findByIdWithUsers', () => {
    it('should find transfer with user relations', async () => {
      (prisma.ownershipTransfer.findUnique as Mock).mockResolvedValue(mockTransferWithUsers);

      const result = await transferRepository.findByIdWithUsers('transfer-1');

      expect(result).toEqual(mockTransferWithUsers);
      expect(prisma.ownershipTransfer.findUnique).toHaveBeenCalledWith({
        where: { id: 'transfer-1' },
        include: {
          fromUser: { select: { id: true, username: true } },
          toUser: { select: { id: true, username: true } },
        },
      });
    });

    it('should use transaction client when provided', async () => {
      const mockTx = {
        ownershipTransfer: {
          findUnique: vi.fn().mockResolvedValue(mockTransferWithUsers),
        },
      };

      const result = await transferRepository.findByIdWithUsers('transfer-1', mockTx as any);

      expect(result).toEqual(mockTransferWithUsers);
      expect(mockTx.ownershipTransfer.findUnique).toHaveBeenCalled();
    });
  });

  describe('findByUser', () => {
    it('should find all transfers for user (default: all roles)', async () => {
      (prisma.ownershipTransfer.findMany as Mock).mockResolvedValue([mockTransferWithUsers]);

      const result = await transferRepository.findByUser('user-1');

      expect(result).toEqual([mockTransferWithUsers]);
      expect(prisma.ownershipTransfer.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ fromUserId: 'user-1' }, { toUserId: 'user-1' }],
        },
        include: {
          fromUser: { select: { id: true, username: true } },
          toUser: { select: { id: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by initiator role', async () => {
      (prisma.ownershipTransfer.findMany as Mock).mockResolvedValue([]);

      await transferRepository.findByUser('user-1', { role: 'initiator' });

      expect(prisma.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fromUserId: 'user-1' },
        })
      );
    });

    it('should filter by recipient role', async () => {
      (prisma.ownershipTransfer.findMany as Mock).mockResolvedValue([]);

      await transferRepository.findByUser('user-1', { role: 'recipient' });

      expect(prisma.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { toUserId: 'user-1' },
        })
      );
    });

    it('should filter by active status', async () => {
      (prisma.ownershipTransfer.findMany as Mock).mockResolvedValue([]);

      await transferRepository.findByUser('user-1', { status: 'active' });

      expect(prisma.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['pending', 'accepted'] },
          }),
        })
      );
    });

    it('should filter by specific status', async () => {
      (prisma.ownershipTransfer.findMany as Mock).mockResolvedValue([]);

      await transferRepository.findByUser('user-1', { status: 'completed' });

      expect(prisma.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'completed' }),
        })
      );
    });

    it('should filter by resource type', async () => {
      (prisma.ownershipTransfer.findMany as Mock).mockResolvedValue([]);

      await transferRepository.findByUser('user-1', { resourceType: 'wallet' });

      expect(prisma.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceType: 'wallet' }),
        })
      );
    });

    it('should apply all filters simultaneously', async () => {
      (prisma.ownershipTransfer.findMany as Mock).mockResolvedValue([]);

      await transferRepository.findByUser('user-1', {
        role: 'initiator',
        status: 'pending',
        resourceType: 'wallet',
      });

      expect(prisma.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            fromUserId: 'user-1',
            status: 'pending',
            resourceType: 'wallet',
          },
        })
      );
    });
  });

  describe('countByUser', () => {
    it('should count transfers for user', async () => {
      (prisma.ownershipTransfer.count as Mock).mockResolvedValue(5);

      const result = await transferRepository.countByUser('user-1');

      expect(result).toBe(5);
    });

    it('should count with filters', async () => {
      (prisma.ownershipTransfer.count as Mock).mockResolvedValue(2);

      const result = await transferRepository.countByUser('user-1', {
        role: 'recipient',
        status: 'active',
      });

      expect(result).toBe(2);
      expect(prisma.ownershipTransfer.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          toUserId: 'user-1',
          status: { in: ['pending', 'accepted'] },
        }),
      });
    });
  });

  describe('hasActiveTransfer', () => {
    it('should return true when active transfer exists', async () => {
      (prisma.ownershipTransfer.count as Mock).mockResolvedValue(1);

      const result = await transferRepository.hasActiveTransfer('wallet', 'wallet-1');

      expect(result).toBe(true);
      expect(prisma.ownershipTransfer.count).toHaveBeenCalledWith({
        where: {
          resourceType: 'wallet',
          resourceId: 'wallet-1',
          status: { in: ['pending', 'accepted'] },
        },
      });
    });

    it('should return false when no active transfer exists', async () => {
      (prisma.ownershipTransfer.count as Mock).mockResolvedValue(0);

      const result = await transferRepository.hasActiveTransfer('wallet', 'wallet-1');

      expect(result).toBe(false);
    });

    it('should use transaction client when provided', async () => {
      const mockTx = {
        ownershipTransfer: {
          count: vi.fn().mockResolvedValue(1),
        },
      };

      const result = await transferRepository.hasActiveTransfer(
        'wallet',
        'wallet-1',
        mockTx as any
      );

      expect(result).toBe(true);
      expect(mockTx.ownershipTransfer.count).toHaveBeenCalled();
    });
  });

  describe('getPendingIncomingCount', () => {
    it('should count pending incoming transfers', async () => {
      (prisma.ownershipTransfer.count as Mock).mockResolvedValue(3);

      const result = await transferRepository.getPendingIncomingCount('user-2');

      expect(result).toBe(3);
      expect(prisma.ownershipTransfer.count).toHaveBeenCalledWith({
        where: {
          toUserId: 'user-2',
          status: 'pending',
        },
      });
    });
  });

  describe('getAwaitingConfirmationCount', () => {
    it('should count transfers awaiting owner confirmation', async () => {
      (prisma.ownershipTransfer.count as Mock).mockResolvedValue(2);

      const result = await transferRepository.getAwaitingConfirmationCount('user-1');

      expect(result).toBe(2);
      expect(prisma.ownershipTransfer.count).toHaveBeenCalledWith({
        where: {
          fromUserId: 'user-1',
          status: 'accepted',
        },
      });
    });
  });

  describe('atomicStatusUpdate', () => {
    it('should update status with conditions and return count', async () => {
      (prisma.ownershipTransfer.updateMany as Mock).mockResolvedValue({ count: 1 });

      const result = await transferRepository.atomicStatusUpdate(
        'transfer-1',
        { status: 'pending', fromUserId: 'user-1' },
        { status: 'cancelled' }
      );

      expect(result).toBe(1);
      expect(prisma.ownershipTransfer.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'transfer-1',
          status: 'pending',
          fromUserId: 'user-1',
        },
        data: { status: 'cancelled' },
      });
    });

    it('should return 0 when conditions not met (race lost)', async () => {
      (prisma.ownershipTransfer.updateMany as Mock).mockResolvedValue({ count: 0 });

      const result = await transferRepository.atomicStatusUpdate(
        'transfer-1',
        { status: 'completed' },
        { status: 'cancelled' }
      );

      expect(result).toBe(0);
    });
  });

  describe('create', () => {
    it('should create a transfer with user includes', async () => {
      (prisma.ownershipTransfer.create as Mock).mockResolvedValue(mockTransferWithUsers);

      const result = await transferRepository.create({
        fromUserId: 'user-1',
        toUserId: 'user-2',
        resourceType: 'wallet',
        resourceId: 'wallet-1',
        status: 'pending',
      });

      expect(result).toEqual(mockTransferWithUsers);
      expect(prisma.ownershipTransfer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromUserId: 'user-1',
          toUserId: 'user-2',
        }),
        include: {
          fromUser: { select: { id: true, username: true } },
          toUser: { select: { id: true, username: true } },
        },
      });
    });

    it('should use transaction client when provided', async () => {
      const mockTx = {
        ownershipTransfer: {
          create: vi.fn().mockResolvedValue(mockTransferWithUsers),
        },
      };

      await transferRepository.create(
        {
          fromUserId: 'user-1',
          toUserId: 'user-2',
          resourceType: 'wallet',
          resourceId: 'wallet-1',
          status: 'pending',
        },
        mockTx as any
      );

      expect(mockTx.ownershipTransfer.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update a transfer by id', async () => {
      const updated = { ...mockTransfer, status: 'accepted' };
      (prisma.ownershipTransfer.update as Mock).mockResolvedValue(updated);

      const result = await transferRepository.update('transfer-1', {
        status: 'accepted',
      });

      expect(result).toEqual(updated);
      expect(prisma.ownershipTransfer.update).toHaveBeenCalledWith({
        where: { id: 'transfer-1' },
        data: { status: 'accepted' },
      });
    });

    it('should use transaction client when provided', async () => {
      const mockTx = {
        ownershipTransfer: {
          update: vi.fn().mockResolvedValue(mockTransfer),
        },
      };

      await transferRepository.update(
        'transfer-1',
        { status: 'completed' },
        mockTx as any
      );

      expect(mockTx.ownershipTransfer.update).toHaveBeenCalled();
    });
  });

  describe('expireOverdue', () => {
    it('should expire overdue transfers and return count', async () => {
      (prisma.ownershipTransfer.updateMany as Mock).mockResolvedValue({ count: 3 });

      const result = await transferRepository.expireOverdue();

      expect(result).toBe(3);
      expect(prisma.ownershipTransfer.updateMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['pending', 'accepted'] },
          expiresAt: { lt: expect.any(Date) },
        },
        data: { status: 'expired' },
      });
    });

    it('should return 0 when no overdue transfers', async () => {
      (prisma.ownershipTransfer.updateMany as Mock).mockResolvedValue({ count: 0 });

      const result = await transferRepository.expireOverdue();

      expect(result).toBe(0);
    });
  });
});
