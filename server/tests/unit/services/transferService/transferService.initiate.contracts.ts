import { describe, expect, it } from 'vitest';
import { Prisma } from '../../../../src/generated/prisma/client';
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
      mockPrismaClient.walletUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

      await expect(
        initiateTransfer(ownerId, {
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        })
      ).rejects.toThrow(/not the owner/i);
    });

    it('rejects a wallet transfer initiated by a group-only owner', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });
      mockPrismaClient.walletUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.wallet.findFirst.mockResolvedValue({ groupRole: 'owner' });

      await expect(initiateTransfer(ownerId, {
        resourceType: 'wallet',
        resourceId: walletId,
        toUserId: recipientId,
      })).rejects.toThrow(/not the owner/i);
      expect(mockPrismaClient.ownershipTransfer.create).not.toHaveBeenCalled();
    });

    it('rejects a device transfer initiated by a group-only owner', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue({ groupRole: 'owner' });

      await expect(initiateTransfer(ownerId, {
        resourceType: 'device',
        resourceId: deviceId,
        toUserId: recipientId,
      })).rejects.toThrow(/not the owner/i);
      expect(mockPrismaClient.ownershipTransfer.create).not.toHaveBeenCalled();
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
      mockPrismaClient.walletUser.findFirst.mockResolvedValue({ role: 'owner' });

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

    it('retries the entire serializable initiation after one adapter write conflict', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, name: 'Test Wallet' });
      mockPrismaClient.ownershipTransfer.create.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'pending',
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      });
      const transactionWriteConflict = new Prisma.PrismaClientKnownRequestError('write conflict', {
        code: 'P2010',
        clientVersion: 'test',
        meta: {
          driverAdapterError: {
            cause: { kind: 'TransactionWriteConflict' },
          },
        },
      });
      let attempts = 0;
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const result = await callback(mockPrismaClient);
        attempts += 1;
        if (attempts === 1) throw transactionWriteConflict;
        return result;
      });

      await expect(initiateTransfer(ownerId, {
        resourceType: 'wallet',
        resourceId: walletId,
        toUserId: recipientId,
      })).resolves.toMatchObject({ id: transferId });

      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.walletUser.findFirst).toHaveBeenCalledTimes(4);
      expect(mockPrismaClient.ownershipTransfer.count).toHaveBeenCalledTimes(2);
    });

    it('maps three P2034 conflicts to the existing conflict envelope', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });
      const p2034 = new Prisma.PrismaClientKnownRequestError('write conflict', {
        code: 'P2034',
        clientVersion: 'test',
      });
      mockPrismaClient.$transaction.mockRejectedValue(p2034);

      await expect(initiateTransfer(ownerId, {
        resourceType: 'wallet',
        resourceId: walletId,
        toUserId: recipientId,
      })).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(3);
    });

    it('does not retry non-P2034 transaction failures', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });
      mockPrismaClient.$transaction.mockRejectedValue(new Error('database unavailable'));

      await expect(initiateTransfer(ownerId, {
        resourceType: 'wallet',
        resourceId: walletId,
        toUserId: recipientId,
      })).rejects.toThrow('database unavailable');
      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(1);
    });

    it.each([
      new Prisma.PrismaClientKnownRequestError('unique conflict', {
        code: 'P2002',
        clientVersion: 'test',
      }),
      new Prisma.PrismaClientKnownRequestError('raw query failed', {
        code: 'P2010',
        clientVersion: 'test',
      }),
    ])('does not retry unrelated Prisma failures', async prismaError => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: recipientId,
        username: 'recipient',
      });
      mockPrismaClient.$transaction.mockRejectedValue(prismaError);

      await expect(initiateTransfer(ownerId, {
        resourceType: 'wallet',
        resourceId: walletId,
        toUserId: recipientId,
      })).rejects.toBe(prismaError);
      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(1);
    });
  });
};
