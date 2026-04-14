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

export const registerTransferStateChangeContracts = () => {
  describe('acceptTransfer', () => {
    it('should reject when transfer does not exist', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should accept pending transfer as recipient', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // Mock atomic updateMany to succeed
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      // Mock findUnique for returning the updated transfer
      const updatedTransfer = {
        ...mockTransfer,
        status: 'accepted',
        acceptedAt: new Date(),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(updatedTransfer);

      const result = await acceptTransfer(recipientId, transferId);

      expect(result.status).toBe('accepted');
      expect(mockPrismaClient.ownershipTransfer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: transferId,
            toUserId: recipientId,
            status: 'pending',
          }),
          data: expect.objectContaining({ status: 'accepted' }),
        })
      );
    });

    it('should reject accept from non-recipient', async () => {
      // findUnique for initial validation
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      // Throws before updateMany because toUserId check happens first
      await expect(
        acceptTransfer('wrong-user', transferId)
      ).rejects.toThrow(/only the recipient/i);
    });

    it('should reject accept of non-pending transfer', async () => {
      // updateMany returns 0 because status isn't 'pending'
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      // findUnique shows status is 'accepted'
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'accepted', // Already accepted
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/already been accepted/i);
    });

    it('should reject accept of expired transfer', async () => {
      // findUnique for initial validation returns expired transfer
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000), // Expired
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      // Mock updateMany for the expiration update
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      // The code detects expiration before attempting atomic update
      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/expired/i);
    });

    it('should reject when updated transfer cannot be fetched after accept', async () => {
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should report unknown status when atomic accept update loses race and transfer disappears', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          toUserId: recipientId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        acceptTransfer(recipientId, transferId)
      ).rejects.toThrow(/current status: unknown/i);
    });
  });

  describe('declineTransfer', () => {
    it('should reject decline when transfer does not exist', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(
        declineTransfer(recipientId, transferId, 'nope')
      ).rejects.toThrow(/not found/i);
    });

    it('should reject decline from non-recipient', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await expect(
        declineTransfer('wrong-user', transferId, 'nope')
      ).rejects.toThrow(/only the recipient/i);
    });

    it('should decline pending transfer as recipient', async () => {
      // Mock atomic updateMany to succeed
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      // Mock findUnique for returning the updated transfer
      const mockTransfer = {
        id: transferId,
        toUserId: recipientId,
        status: 'declined',
        declineReason: 'Not interested',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      const result = await declineTransfer(recipientId, transferId, 'Not interested');

      expect(result.status).toBe('declined');
    });

    it('should reject decline when updated transfer cannot be fetched', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          toUserId: recipientId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        declineTransfer(recipientId, transferId, 'no')
      ).rejects.toThrow(/not found/i);
    });

    it('should report unknown status when atomic decline update loses race and transfer disappears', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          toUserId: recipientId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        declineTransfer(recipientId, transferId, 'no')
      ).rejects.toThrow(/current status: unknown/i);
    });
  });

  describe('cancelTransfer', () => {
    it('should reject cancel when transfer does not exist', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(
        cancelTransfer(ownerId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should cancel pending transfer as owner', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // First findUnique for ownership check
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)
        // Second findUnique for returning result
        .mockResolvedValueOnce({
          ...mockTransfer,
          status: 'cancelled',
          cancelledAt: new Date(),
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });

      // Mock atomic updateMany to succeed
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      const result = await cancelTransfer(ownerId, transferId);

      expect(result.status).toBe('cancelled');
    });

    it('should cancel accepted transfer as owner', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'accepted',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // First findUnique for ownership check
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)
        // Second findUnique for returning result
        .mockResolvedValueOnce({
          ...mockTransfer,
          status: 'cancelled',
          cancelledAt: new Date(),
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });

      // Mock atomic updateMany to succeed
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      const result = await cancelTransfer(ownerId, transferId);

      expect(result.status).toBe('cancelled');
    });

    it('should reject cancel from non-owner', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      await expect(
        cancelTransfer('wrong-user', transferId)
      ).rejects.toThrow(/initiator/i);
    });

    it('should reject cancel when updated transfer cannot be fetched', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          fromUserId: ownerId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        cancelTransfer(ownerId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should report unknown status when atomic cancel update loses race and transfer disappears', async () => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce({
          id: transferId,
          fromUserId: ownerId,
          status: 'pending',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        })
        .mockResolvedValueOnce(null);
      mockPrismaClient.ownershipTransfer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        cancelTransfer(ownerId, transferId)
      ).rejects.toThrow(/current status: unknown/i);
    });
  });
};
