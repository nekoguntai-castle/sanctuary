import { describe, expect, it } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import { deviceId, mockCheckDeviceOwnerAccess, mockCheckWalletOwnerAccess, ownerId, recipientId, transferId, walletId } from './transferServiceTestHarness';
import {
  initiateTransfer,
  acceptTransfer,
  declineTransfer,
  cancelTransfer,
  confirmTransfer,
  getUserTransfers,
  getTransfer,
  hasActiveTransfer,
  getPendingIncomingCount,
  getAwaitingConfirmationCount,
  expireOldTransfers,
} from '../../../../src/services/transferService';

export const registerTransferQueriesExpiryContracts = () => {
  describe('getUserTransfers', () => {
    it('should return transfers for user', async () => {
      const mockTransfers = [
        {
          id: 'transfer-1',
          resourceType: 'wallet',
          resourceId: walletId,
          fromUserId: ownerId,
          toUserId: recipientId,
          status: 'pending',
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        },
      ];

      mockPrismaClient.ownershipTransfer.findMany.mockResolvedValue(mockTransfers);
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(1);

      const result = await getUserTransfers(ownerId);

      expect(result.transfers).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by role', async () => {
      mockPrismaClient.ownershipTransfer.findMany.mockResolvedValue([]);
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);

      await getUserTransfers(ownerId, { role: 'initiator' });

      expect(mockPrismaClient.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            fromUserId: ownerId,
          }),
        })
      );
    });

    it('should filter by status', async () => {
      mockPrismaClient.ownershipTransfer.findMany.mockResolvedValue([]);
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);

      await getUserTransfers(ownerId, { status: 'pending' });

      expect(mockPrismaClient.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'pending',
          }),
        })
      );
    });

    it('should filter by recipient role, active status, and resource type', async () => {
      mockPrismaClient.ownershipTransfer.findMany.mockResolvedValue([]);
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);

      await getUserTransfers(ownerId, {
        role: 'recipient',
        status: 'active',
        resourceType: 'device',
      });

      expect(mockPrismaClient.ownershipTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            toUserId: ownerId,
            status: { in: ['pending', 'accepted'] },
            resourceType: 'device',
          }),
        })
      );
    });
  });

  describe('getTransfer and counters', () => {
    it('should return null when transfer is missing', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(getTransfer('missing-transfer')).resolves.toBeNull();
    });

    it('should return formatted transfer when transfer exists', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Ops Wallet',
      });

      const transfer = await getTransfer(transferId);
      expect(transfer?.resourceName).toBe('Ops Wallet');
    });

    it('should format transfer with undefined user fields when related users are missing', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        fromUser: null,
        toUser: null,
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Ops Wallet',
      });

      const transfer = await getTransfer(transferId);
      expect(transfer?.fromUser).toBeUndefined();
      expect(transfer?.toUser).toBeUndefined();
    });

    it('should return pending incoming and awaiting confirmation counts', async () => {
      mockPrismaClient.ownershipTransfer.count
        .mockResolvedValueOnce(7)
        .mockResolvedValueOnce(3);

      await expect(getPendingIncomingCount(recipientId)).resolves.toBe(7);
      await expect(getAwaitingConfirmationCount(ownerId)).resolves.toBe(3);
    });
  });

  describe('hasActiveTransfer', () => {
    it('should return true when active transfer exists', async () => {
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(1);

      const result = await hasActiveTransfer('wallet', walletId);

      expect(result).toBe(true);
    });

    it('should return false when no active transfer', async () => {
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);

      const result = await hasActiveTransfer('wallet', walletId);

      expect(result).toBe(false);
    });
  });

  describe('expireOldTransfers', () => {
    it('should expire old pending and accepted transfers', async () => {
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 5 });

      const result = await expireOldTransfers();

      expect(result).toBe(5);
      expect(mockPrismaClient.ownershipTransfer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['pending', 'accepted'] },
            expiresAt: { lt: expect.any(Date) },
          }),
          data: { status: 'expired' },
        })
      );
    });

    it('should return zero when no transfers are expired', async () => {
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(expireOldTransfers()).resolves.toBe(0);
    });
  });

  describe('Race Condition Protection', () => {
    it('should use atomic update for acceptTransfer', async () => {
      // Mock updateMany returning 0 (simulating concurrent update race condition)
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      // When updateMany returns 0, code fetches current status for error message
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending', // Still shows pending because of race condition
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      // Should throw because atomic update failed (updateMany matched 0 records)
      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/cannot be accepted/i);
    });

    it('should use atomic update for declineTransfer', async () => {
      // Mock updateMany returning 0 (simulating concurrent update race condition)
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      // When updateMany returns 0, code fetches current status for error message
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      // Should throw because atomic update failed
      await expect(
        declineTransfer(recipientId, transferId)
      ).rejects.toThrow(/cannot be declined/i);
    });

    it('should use atomic update for cancelTransfer', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // First findUnique for ownership validation, then for error message
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)  // Ownership check
        .mockResolvedValueOnce(mockTransfer); // Error message fetch

      // Mock updateMany returning 0 (simulating concurrent update)
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      // Should throw because atomic update failed
      await expect(
        cancelTransfer(ownerId, transferId)
      ).rejects.toThrow(/cannot be cancelled/i);
    });

    it('should succeed when atomic update modifies exactly one row', async () => {
      // Mock updateMany returning 1 (successful atomic update)
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      // Mock the findUnique for refetch after update
      const acceptedTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(acceptedTransfer);

      const result = await acceptTransfer(recipientId, transferId);

      expect(result.status).toBe('accepted');
    });
  });
};
