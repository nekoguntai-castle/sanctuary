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

export const registerTransferConfirmContracts = () => {
  describe('confirmTransfer', () => {
    it('should confirm accepted wallet transfer and change ownership', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      const confirmedTransfer = {
        ...mockTransfer,
        status: 'confirmed',
        confirmedAt: new Date(),
        fromUser: { id: ownerId, username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      // First findUnique (outside transaction) and final findUnique
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(mockTransfer)      // Initial validation
        .mockResolvedValueOnce(confirmedTransfer); // Final result fetch

      // Mock the transaction callback execution
      // The callback receives a transaction client that has the same shape as prisma
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        // Create a tx mock with findUnique returning accepted status for validation
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(mockTransfer), // In-tx validation
            update: vi.fn().mockResolvedValue(confirmedTransfer),
          },
          walletUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'wu-owner', userId: ownerId, walletId, role: 'owner' })
              .mockResolvedValueOnce(null), // Recipient doesn't have access yet
            create: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          },
        };
        return callback(txMock);
      });

      // Reset and set ownership check mock - owner still owns during confirm
      mockCheckWalletOwnerAccess.mockReset();
      mockCheckWalletOwnerAccess.mockResolvedValue(true);

      const result = await confirmTransfer(ownerId, transferId);

      expect(result.status).toBe('confirmed');
    });

    it('should reject confirm of non-accepted transfer', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'pending', // Not accepted yet
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/cannot be confirmed/i);
    });

    it('should reject confirm from non-owner', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: ownerId,
        status: 'accepted',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(mockTransfer);

      await expect(
        confirmTransfer('wrong-user', transferId)
      ).rejects.toThrow(/initiator/i);
    });

    it('should reject confirm when transfer does not exist', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue(null);

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should reject confirm when transfer was already confirmed in transaction', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue({
              id: transferId,
              status: 'confirmed',
            }),
            update: vi.fn(),
          },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/already been completed/i);
    });

    it('should expire transfer during confirm when it is stale in transaction', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      const updateSpy = vi.fn().mockResolvedValue({});
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue({
              id: transferId,
              status: 'accepted',
              resourceType: 'wallet',
              resourceId: walletId,
              fromUserId: ownerId,
              toUserId: recipientId,
              keepExistingUsers: true,
              expiresAt: new Date(Date.now() - 1000),
            }),
            update: updateSpy,
          },
          walletUser: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/expired/i);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: transferId },
        data: { status: 'expired' },
      });
    });

    it('should reject wallet confirm when current owner record is missing in transaction', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValue({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue({
              id: transferId,
              resourceType: 'wallet',
              resourceId: walletId,
              fromUserId: ownerId,
              toUserId: recipientId,
              status: 'accepted',
              keepExistingUsers: true,
              expiresAt: new Date(Date.now() + 1000 * 60 * 60),
            }),
            update: vi.fn(),
          },
          walletUser: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/owner no longer owns this wallet/i);
    });

    it('should confirm wallet transfer by upgrading existing recipient and removing old owner', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(baseTransfer)
        .mockResolvedValueOnce({
          ...baseTransfer,
          status: 'confirmed',
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, name: 'Wallet X' });

      const walletUpdateSpy = vi.fn().mockResolvedValue({});
      const walletDeleteSpy = vi.fn().mockResolvedValue({});
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          walletUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'wu-owner', userId: ownerId, role: 'owner' })
              .mockResolvedValueOnce({ id: 'wu-recipient', userId: recipientId, role: 'viewer' }),
            create: vi.fn(),
            update: walletUpdateSpy,
            delete: walletDeleteSpy,
          },
        };
        return callback(txMock as any);
      });

      const result = await confirmTransfer(ownerId, transferId);
      expect(result.status).toBe('confirmed');
      expect(walletUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'wu-recipient' },
        data: { role: 'owner' },
      });
      expect(walletDeleteSpy).toHaveBeenCalledWith({
        where: { id: 'wu-owner' },
      });
    });

    it('should confirm device transfer by updating legacy owner field and downgrading old owner', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: deviceId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(baseTransfer)
        .mockResolvedValueOnce({
          ...baseTransfer,
          status: 'confirmed',
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });
      mockPrismaClient.device.findUnique.mockResolvedValue({ id: deviceId, label: 'Ledger' });

      const deviceUpdateSpy = vi.fn().mockResolvedValue({});
      const deviceUserUpdateSpy = vi.fn().mockResolvedValue({});
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          device: {
            update: deviceUpdateSpy,
          },
          deviceUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'du-owner', userId: ownerId, role: 'owner' })
              .mockResolvedValueOnce({ id: 'du-recipient', userId: recipientId, role: 'viewer' }),
            create: vi.fn(),
            update: deviceUserUpdateSpy,
            delete: vi.fn(),
          },
        };
        return callback(txMock as any);
      });

      const result = await confirmTransfer(ownerId, transferId);
      expect(result.resourceType).toBe('device');
      expect(deviceUpdateSpy).toHaveBeenCalledWith({
        where: { id: deviceId },
        data: { userId: recipientId },
      });
      expect(deviceUserUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'du-recipient' },
        data: { role: 'owner' },
      });
      expect(deviceUserUpdateSpy).toHaveBeenCalledWith({
        where: { id: 'du-owner' },
        data: { role: 'viewer' },
      });
    });

    it('should confirm device transfer by creating recipient access and removing old owner', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: deviceId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(baseTransfer)
        .mockResolvedValueOnce({
          ...baseTransfer,
          status: 'confirmed',
          fromUser: { id: ownerId, username: 'owner' },
          toUser: { id: recipientId, username: 'recipient' },
        });
      mockPrismaClient.device.findUnique.mockResolvedValue({ id: deviceId, label: 'Coldcard' });

      const deviceUserCreateSpy = vi.fn().mockResolvedValue({});
      const deviceUserDeleteSpy = vi.fn().mockResolvedValue({});
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          device: {
            update: vi.fn().mockResolvedValue({}),
          },
          deviceUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'du-owner', userId: ownerId, role: 'owner' })
              .mockResolvedValueOnce(null),
            create: deviceUserCreateSpy,
            update: vi.fn(),
            delete: deviceUserDeleteSpy,
          },
        };
        return callback(txMock as any);
      });

      const result = await confirmTransfer(ownerId, transferId);
      expect(result.status).toBe('confirmed');
      expect(deviceUserCreateSpy).toHaveBeenCalledWith({
        data: {
          deviceId,
          userId: recipientId,
          role: 'owner',
        },
      });
      expect(deviceUserDeleteSpy).toHaveBeenCalledWith({
        where: { id: 'du-owner' },
      });
    });

    it('should reject device confirm when owner no longer has device access', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: deviceId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValueOnce(baseTransfer);
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          device: {
            update: vi.fn().mockResolvedValue({}),
          },
          deviceUser: {
            findFirst: vi.fn().mockResolvedValueOnce(null),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/owner no longer owns this device/i);
    });

    it('should reject confirm when final transfer fetch is missing', async () => {
      const baseTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      };

      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(baseTransfer)
        .mockResolvedValueOnce(null);

      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(baseTransfer),
            update: vi.fn().mockResolvedValue({}),
          },
          walletUser: {
            findFirst: vi.fn()
              .mockResolvedValueOnce({ id: 'wu-owner', userId: ownerId, role: 'owner' })
              .mockResolvedValueOnce(null),
            create: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
          },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/not found/i);
    });

    it('should report unknown status when transfer vanishes inside confirm transaction', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValueOnce({
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: ownerId,
        toUserId: recipientId,
        status: 'accepted',
        keepExistingUsers: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          ownershipTransfer: {
            findUnique: vi.fn().mockResolvedValue(null),
            update: vi.fn(),
          },
          walletUser: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        };
        return callback(txMock as any);
      });

      await expect(
        confirmTransfer(ownerId, transferId)
      ).rejects.toThrow(/current status: unknown/i);
    });
  });
};
