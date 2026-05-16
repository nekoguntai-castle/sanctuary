import { vi } from 'vitest';
/**
 * Device Access Service Tests
 *
 * Tests for device access control and sharing functions.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import {
  checkDeviceAccess,
  checkDeviceOwnerAccess,
  checkDeviceAccessWithRole,
  getUserDeviceRole,
  getUserAccessibleDevices,
  getDeviceShareInfo,
  getDevicesToShareForWallet,
  shareDeviceWithUser,
  removeUserFromDevice,
  shareDeviceWithGroup,
} from '../../../src/services/deviceAccess';

describe('Device Access Service', () => {
  const deviceId = 'device-123';
  const userId = 'user-123';
  const targetUserId = 'user-456';
  const groupId = 'group-123';

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('checkDeviceAccess', () => {
    it('should return true when user is owner via DeviceUser', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      const result = await checkDeviceAccess(deviceId, userId);

      expect(result).toBe(true);
      expect(mockPrismaClient.deviceUser.findFirst).toHaveBeenCalledWith({
        where: { deviceId, userId },
      });
    });

    it('should return true when user is viewer via DeviceUser', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'viewer',
      });

      const result = await checkDeviceAccess(deviceId, userId);

      expect(result).toBe(true);
    });

    it('should return true when user has access via group', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue({
        id: deviceId,
        groupId,
        groupRole: 'viewer',
        group: {
          members: [{ userId }],
        },
      });

      const result = await checkDeviceAccess(deviceId, userId);

      expect(result).toBe(true);
    });

    it('should return false when user has no access', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue(null);

      const result = await checkDeviceAccess(deviceId, userId);

      expect(result).toBe(false);
    });
  });

  describe('checkDeviceOwnerAccess', () => {
    it('should return true when user is owner', async () => {
      // checkDeviceOwnerAccess calls getUserDeviceRole which checks the role
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      const result = await checkDeviceOwnerAccess(deviceId, userId);

      expect(result).toBe(true);
      // It queries without role filter, then checks role === 'owner' in code
      expect(mockPrismaClient.deviceUser.findFirst).toHaveBeenCalledWith({
        where: { deviceId, userId },
      });
    });

    it('should return false when user is viewer', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'viewer', // Not owner
      });

      const result = await checkDeviceOwnerAccess(deviceId, userId);

      expect(result).toBe(false);
    });

    it('should return false when user has no access', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);

      const result = await checkDeviceOwnerAccess(deviceId, userId);

      expect(result).toBe(false);
    });
  });

  describe('checkDeviceAccessWithRole', () => {
    it('returns access metadata when owner', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      const result = await checkDeviceAccessWithRole(deviceId, userId);
      expect(result).toEqual({
        hasAccess: true,
        isOwner: true,
        role: 'owner',
      });
    });

    it('returns viewer access metadata', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'viewer',
      });

      const result = await checkDeviceAccessWithRole(deviceId, userId);
      expect(result).toEqual({
        hasAccess: true,
        isOwner: false,
        role: 'viewer',
      });
    });

    it('returns group viewer access metadata', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue({
        id: deviceId,
        groupRole: 'viewer',
      });

      const result = await checkDeviceAccessWithRole(deviceId, userId);
      expect(result).toEqual({
        hasAccess: true,
        isOwner: false,
        role: 'viewer',
      });
    });

    it('returns no access metadata when user has no role', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue(null);

      const result = await checkDeviceAccessWithRole(deviceId, userId);
      expect(result).toEqual({
        hasAccess: false,
        isOwner: false,
        role: null,
      });
    });

    it('fails closed when a stored direct role is malformed', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'approver',
      });

      const result = await checkDeviceAccessWithRole(deviceId, userId);
      expect(result).toEqual({
        hasAccess: false,
        isOwner: false,
        role: null,
      });
    });
  });

  describe('getUserDeviceRole', () => {
    it('should return owner when user is owner', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBe('owner');
    });

    it('should return viewer when user is viewer via DeviceUser', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'viewer',
      });

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBe('viewer');
    });

    it('should return viewer when user has group access', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue({
        id: deviceId,
        groupId,
        groupRole: 'viewer',
        group: {
          members: [{ userId }],
        },
      });

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBe('viewer');
    });

    it('should return null when direct role is malformed', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'signer',
      });

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBeNull();
    });

    it('should return null when group role is malformed', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue({
        id: deviceId,
        groupId,
        groupRole: 'ownerish',
        group: {
          members: [{ userId }],
        },
      });

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBeNull();
    });

    it('should return null when user has no access', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);
      mockPrismaClient.device.findFirst.mockResolvedValue(null);

      const result = await getUserDeviceRole(deviceId, userId);

      expect(result).toBeNull();
    });
  });

  describe('getDeviceShareInfo', () => {
    it('should return share info with group and users', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: deviceId,
        groupId,
        group: { id: groupId, name: 'Test Group' },
        users: [
          { userId, role: 'owner', user: { id: userId, username: 'owner' } },
          { userId: targetUserId, role: 'viewer', user: { id: targetUserId, username: 'viewer' } },
        ],
      });

      const result = await getDeviceShareInfo(deviceId);

      expect(result.group).toEqual({ id: groupId, name: 'Test Group' });
      expect(result.users).toHaveLength(2);
    });

    it('should return null group when device is not shared with group', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue({
        id: deviceId,
        groupId: null,
        group: null,
        users: [
          { userId, role: 'owner', user: { id: userId, username: 'owner' } },
        ],
      });

      const result = await getDeviceShareInfo(deviceId);

      expect(result.group).toBeNull();
      expect(result.users).toHaveLength(1);
    });

    it('returns empty share info when device does not exist', async () => {
      mockPrismaClient.device.findUnique.mockResolvedValue(null);

      const result = await getDeviceShareInfo(deviceId);
      expect(result).toEqual({ group: null, users: [] });
    });
  });

  describe('getUserAccessibleDevices', () => {
    it('formats direct and group access devices correctly', async () => {
      const now = new Date();
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'device-owner',
          userId,
          modelId: 'model-1',
          type: 'hardware',
          label: 'Owner Device',
          fingerprint: 'fp-1',
          derivationPath: "m/84'/0'/0'",
          xpub: 'xpub-owner',
          groupId: null,
          groupRole: 'viewer',
          createdAt: now,
          updatedAt: now,
          model: { id: 'model-1', slug: 'ledger-nano', name: 'Ledger Nano' },
          wallets: [{ wallet: { id: 'w1', name: 'Wallet One', type: 'multisig', scriptType: 'p2wsh' } }],
          accounts: [
            {
              id: 'acc-1',
              purpose: '84',
              scriptType: 'p2wpkh',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub-acc-1',
            },
          ],
          users: [{ role: 'owner' }],
          user: { username: 'owner-user' },
        },
        {
          id: 'device-group',
          userId: 'other-owner',
          modelId: null,
          type: 'hardware',
          label: 'Group Device',
          fingerprint: 'fp-2',
          derivationPath: null,
          xpub: 'xpub-group',
          groupId: 'group-1',
          groupRole: 'viewer',
          createdAt: now,
          updatedAt: now,
          model: null,
          wallets: [],
          accounts: [],
          users: [],
          user: { username: 'shared-by-owner' },
        },
      ]);

      const result = await getUserAccessibleDevices(userId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'device-owner',
          isOwner: true,
          userRole: 'owner',
          sharedBy: undefined,
          walletCount: 1,
        })
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          id: 'device-group',
          isOwner: false,
          userRole: 'viewer',
          sharedBy: 'shared-by-owner',
          walletCount: 0,
        })
      );
      expect(mockPrismaClient.device.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('filters malformed stored roles from accessible device results', async () => {
      const now = new Date();
      mockPrismaClient.device.findMany.mockResolvedValue([
        {
          id: 'valid-device',
          userId,
          modelId: null,
          type: 'hardware',
          label: 'Valid Device',
          fingerprint: 'fp-valid',
          derivationPath: null,
          xpub: 'xpub-valid',
          groupId: null,
          groupRole: 'viewer',
          createdAt: now,
          updatedAt: now,
          model: null,
          wallets: [],
          accounts: [],
          users: [{ role: 'viewer' }],
          user: { username: 'owner-user' },
        },
        {
          id: 'malformed-direct',
          userId,
          modelId: null,
          type: 'hardware',
          label: 'Malformed Direct',
          fingerprint: 'fp-bad-direct',
          derivationPath: null,
          xpub: 'xpub-bad-direct',
          groupId: null,
          groupRole: 'viewer',
          createdAt: now,
          updatedAt: now,
          model: null,
          wallets: [],
          accounts: [],
          users: [{ role: 'signer' }],
          user: { username: 'owner-user' },
        },
        {
          id: 'malformed-group',
          userId: 'other-owner',
          modelId: null,
          type: 'hardware',
          label: 'Malformed Group',
          fingerprint: 'fp-bad-group',
          derivationPath: null,
          xpub: 'xpub-bad-group',
          groupId: 'group-1',
          groupRole: 'approver',
          createdAt: now,
          updatedAt: now,
          model: null,
          wallets: [],
          accounts: [],
          users: [],
          user: { username: 'shared-by-owner' },
        },
      ]);

      const result = await getUserAccessibleDevices(userId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        id: 'valid-device',
        userRole: 'viewer',
      }));
    });
  });

  describe('shareDeviceWithUser', () => {
    it('should share device when owner makes the request', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst
        .mockResolvedValueOnce({ id: 'du-1', deviceId, userId, role: 'owner' }) // checkDeviceOwnerAccess
        .mockResolvedValueOnce(null); // Check if already shared

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: targetUserId,
        username: 'target',
      });

      mockPrismaClient.deviceUser.create.mockResolvedValue({
        id: 'du-new',
        deviceId,
        userId: targetUserId,
        role: 'viewer',
      });

      const result = await shareDeviceWithUser(deviceId, targetUserId, userId);

      expect(result.success).toBe(true);
      expect(mockPrismaClient.deviceUser.create).toHaveBeenCalled();
    });

    it('should reject share when non-owner makes the request', async () => {
      // Mock owner check fails
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);

      const result = await shareDeviceWithUser(deviceId, targetUserId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('owner');
    });

    it('should return success when device already shared', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst
        .mockResolvedValueOnce({ id: 'du-1', deviceId, userId, role: 'owner' }) // checkDeviceOwnerAccess
        .mockResolvedValueOnce({ id: 'du-existing', deviceId, userId: targetUserId, role: 'viewer' }); // Already shared

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: targetUserId,
        username: 'target',
      });

      const result = await shareDeviceWithUser(deviceId, targetUserId, userId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('already shared');
    });

    it('returns not found when target user does not exist', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValueOnce({
        id: 'du-owner',
        deviceId,
        userId,
        role: 'owner',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const result = await shareDeviceWithUser(deviceId, targetUserId, userId);

      expect(result).toEqual({
        success: false,
        message: 'User not found',
      });
    });
  });

  describe('removeUserFromDevice', () => {
    it('should remove user access when owner makes the request', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst
        .mockResolvedValueOnce({ id: 'du-1', deviceId, userId, role: 'owner' }) // checkDeviceOwnerAccess
        .mockResolvedValueOnce({ id: 'du-target', deviceId, userId: targetUserId, role: 'viewer' }); // Find access record

      mockPrismaClient.deviceUser.delete.mockResolvedValue({});

      const result = await removeUserFromDevice(deviceId, targetUserId, userId);

      expect(result.success).toBe(true);
      expect(mockPrismaClient.deviceUser.delete).toHaveBeenCalled();
    });

    it('should reject remove when non-owner makes the request', async () => {
      // Mock owner check fails
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);

      const result = await removeUserFromDevice(deviceId, targetUserId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('owner');
    });

    it('should not allow removing owner', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst
        .mockResolvedValueOnce({ id: 'du-1', deviceId, userId, role: 'owner' }) // checkDeviceOwnerAccess
        .mockResolvedValueOnce({ id: 'du-owner', deviceId, userId: targetUserId, role: 'owner' }); // Target is owner

      const result = await removeUserFromDevice(deviceId, targetUserId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Cannot remove device owner');
    });

    it('returns error when target user has no access record', async () => {
      mockPrismaClient.deviceUser.findFirst
        .mockResolvedValueOnce({ id: 'du-owner', deviceId, userId, role: 'owner' })
        .mockResolvedValueOnce(null);

      const result = await removeUserFromDevice(deviceId, targetUserId, userId);
      expect(result).toEqual({
        success: false,
        message: 'User does not have access to this device',
      });
    });
  });

  describe('shareDeviceWithGroup', () => {
    it('should share device with group when owner makes the request', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      mockPrismaClient.group.findUnique.mockResolvedValue({
        id: groupId,
        name: 'Test Group',
      });

      mockPrismaClient.device.update.mockResolvedValue({
        id: deviceId,
        groupId,
        groupRole: 'viewer',
      });

      const result = await shareDeviceWithGroup(deviceId, groupId, userId);

      expect(result.success).toBe(true);
      expect(result.groupName).toBe('Test Group');
      expect(mockPrismaClient.device.update).toHaveBeenCalled();
    });

    it('should reject share when non-owner makes the request', async () => {
      // Mock owner check fails
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue(null);

      const result = await shareDeviceWithGroup(deviceId, groupId, userId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('owner');
    });

    it('should remove group when groupId is null', async () => {
      // Mock owner check passes
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });

      mockPrismaClient.device.update.mockResolvedValue({
        id: deviceId,
        groupId: null,
        groupRole: 'viewer',
      });

      const result = await shareDeviceWithGroup(deviceId, null, userId);

      expect(result.success).toBe(true);
      expect(result.groupName).toBeNull();
    });

    it('returns not found when group does not exist', async () => {
      mockPrismaClient.deviceUser.findFirst.mockResolvedValue({
        id: 'du-1',
        deviceId,
        userId,
        role: 'owner',
      });
      mockPrismaClient.group.findUnique.mockResolvedValue(null);

      const result = await shareDeviceWithGroup(deviceId, groupId, userId);

      expect(result).toEqual({
        success: false,
        message: 'Group not found',
        groupName: null,
      });
    });
  });

  describe('getDevicesToShareForWallet', () => {
    it('returns only devices target user cannot access directly or via group', async () => {
      mockPrismaClient.groupMember.findMany.mockResolvedValue([
        { groupId: 'group-a' },
      ]);
      mockPrismaClient.walletDevice.findMany.mockResolvedValue([
        {
          device: {
            id: 'device-direct',
            label: 'Direct Device',
            fingerprint: 'fp-direct',
            groupId: null,
            users: [{ userId: targetUserId }],
          },
        },
        {
          device: {
            id: 'device-group',
            label: 'Group Device',
            fingerprint: 'fp-group',
            groupId: 'group-a',
            users: [],
          },
        },
        {
          device: {
            id: 'device-share',
            label: 'Needs Share',
            fingerprint: 'fp-share',
            groupId: 'group-b',
            users: [],
          },
        },
      ]);

      const result = await getDevicesToShareForWallet('wallet-1', targetUserId);

      expect(result).toEqual([
        {
          id: 'device-share',
          label: 'Needs Share',
          fingerprint: 'fp-share',
        },
      ]);
      expect(mockPrismaClient.groupMember.findMany).toHaveBeenCalledWith({
        where: { userId: targetUserId },
        select: { groupId: true },
      });
      expect(mockPrismaClient.walletDevice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { walletId: 'wallet-1' },
        })
      );
    });
  });
});
