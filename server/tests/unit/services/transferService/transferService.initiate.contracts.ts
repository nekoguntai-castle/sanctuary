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

export const registerTransferInitiateContracts = () => {
  describe('initiateTransfer', () => {
    it('should create a wallet transfer when user is owner', async () => {
      // Owner check: first call (owner) returns true, second call (recipient) returns false
      mockCheckWalletOwnerAccess
        .mockResolvedValueOnce(true)   // Owner is owner
        .mockResolvedValueOnce(false); // Recipient is not owner

      // Mock wallet exists
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      // Mock recipient exists
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });

      // Mock no active transfer
      mockPrismaClient.ownershipTransfer.findFirst.mockResolvedValue(null);

      // Mock transfer creation
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.create.mockResolvedValue(mockTransfer);

      const result = await initiateTransfer(ownerId, {
        resourceType: 'wallet',
        resourceId: walletId,
        toUserId: recipientId,
      });

      expect(result.id).toBe(transferId);
      expect(result.status).toBe('pending');
      expect(mockPrismaClient.ownershipTransfer.create).toHaveBeenCalled();
    });

    it('should reject transfer when user is not owner', async () => {
      // Mock target user exists
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });

      // Mock non-owner check
      mockCheckWalletOwnerAccess.mockResolvedValue(false);

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        })
      ).rejects.toThrow(/not the owner/i);
    });

    it('should reject self-transfer', async () => {
      // Mock owner check
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({
        id: 'wu-1',
        walletId,
        userId: ownerId,
        role: 'owner',
      });

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: ownerId, // Same as owner
        })
      ).rejects.toThrow(/yourself/i);
    });

    it('should reject when active transfer exists', async () => {
      // Owner check: first call (owner) returns true, second call (recipient) returns false
      mockCheckWalletOwnerAccess
        .mockResolvedValueOnce(true)   // Owner is owner
        .mockResolvedValueOnce(false); // Recipient is not owner

      // Mock wallet exists
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        name: 'Test Wallet',
      });

      // Mock recipient exists
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });

      // Mock active transfer exists (count > 0)
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(1);

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        })
      ).rejects.toThrow(/pending transfer/i);
    });

    it('should reject when target user does not exist', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        })
      ).rejects.toThrow(/not found/i);
    });

    it('should reject when target user already owns the resource', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });
      mockPrismaClient.ownershipTransfer.count.mockResolvedValue(0);
      mockCheckWalletOwnerAccess.mockReset();
      mockCheckWalletOwnerAccess
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        })
      ).rejects.toThrow(/already an owner/i);
    });

    it('should create a device transfer when user is owner', async () => {
      // Owner check: first call (owner) returns true, second call (recipient) returns false
      mockCheckDeviceOwnerAccess
        .mockResolvedValueOnce(true)   // Owner is owner
        .mockResolvedValueOnce(false); // Recipient is not owner

      // Mock device exists
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: deviceId,
        label: 'Test Device',
      });

      // Mock recipient exists
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });

      // Mock no active transfer
      mockPrismaClient.ownershipTransfer.findFirst.mockResolvedValue(null);

      // Mock transfer creation
      const mockTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: deviceId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };
      mockPrismaClient.ownershipTransfer.create.mockResolvedValue(mockTransfer);

      const result = await initiateTransfer(ownerId, {
        resourceType: 'device',
        resourceId: deviceId,
        toUserId: recipientId,
      });

      expect(result.resourceType).toBe('device');
      expect(result.status).toBe('pending');
    });
  });
};
