/**
 * Device Repository Tests
 *
 * Tests for device data access layer operations including
 * device management, user sharing, and wallet associations.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    device: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    deviceUser: {
      count: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { deviceRepository } from '../../../src/repositories/deviceRepository';

describe('Device Repository', () => {
  const mockDevice = {
    id: 'device-123',
    userId: 'user-456',
    label: 'My Ledger',
    type: 'ledger',
    fingerprint: 'abc123def',
    xpub: 'xpub661MyMwAqRbcF...',
    derivationPath: "m/84'/0'/0'",
    modelId: 'ledger-nano-s',
    groupId: null,
    groupRole: 'viewer',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findById', () => {
    it('should return device when found', async () => {
      (prisma.device.findUnique as Mock).mockResolvedValue(mockDevice);

      const result = await deviceRepository.findById('device-123');

      expect(result).toEqual(mockDevice);
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'device-123' },
      });
    });

    it('should return null when device not found', async () => {
      (prisma.device.findUnique as Mock).mockResolvedValue(null);

      const result = await deviceRepository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByIdWithUsers', () => {
    it('should return device with user associations', async () => {
      const deviceWithUsers = {
        ...mockDevice,
        users: [
          { id: 'du-1', deviceId: 'device-123', userId: 'user-789' },
          { id: 'du-2', deviceId: 'device-123', userId: 'user-abc' },
        ],
      };

      (prisma.device.findUnique as Mock).mockResolvedValue(deviceWithUsers);

      const result = await deviceRepository.findByIdWithUsers('device-123');

      expect(result?.users).toHaveLength(2);
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'device-123' },
        include: { users: true },
      });
    });
  });

  describe('findByIdWithAssociations', () => {
    it('should return device with users and wallets', async () => {
      const deviceWithAssociations = {
        ...mockDevice,
        users: [{ id: 'du-1', deviceId: 'device-123', userId: 'user-789' }],
        wallets: [{ id: 'wd-1', walletId: 'wallet-1', deviceId: 'device-123' }],
      };

      (prisma.device.findUnique as Mock).mockResolvedValue(deviceWithAssociations);

      const result = await deviceRepository.findByIdWithAssociations('device-123');

      expect(result?.users).toHaveLength(1);
      expect(result?.wallets).toHaveLength(1);
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { id: 'device-123' },
        include: { users: true, wallets: true },
      });
    });
  });

  describe('findByFingerprint', () => {
    it('should return device when fingerprint matches', async () => {
      (prisma.device.findUnique as Mock).mockResolvedValue(mockDevice);

      const result = await deviceRepository.findByFingerprint('abc123def');

      expect(result).toEqual(mockDevice);
      expect(prisma.device.findUnique).toHaveBeenCalledWith({
        where: { fingerprint: 'abc123def' },
      });
    });

    it('should return null when fingerprint not found', async () => {
      (prisma.device.findUnique as Mock).mockResolvedValue(null);

      const result = await deviceRepository.findByFingerprint('unknown-fingerprint');

      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should return devices owned by or shared with user', async () => {
      const devices = [
        mockDevice,
        { ...mockDevice, id: 'device-456', label: 'Shared Trezor' },
      ];

      (prisma.device.findMany as Mock).mockResolvedValue(devices);

      const result = await deviceRepository.findByUserId('user-456');

      expect(result).toHaveLength(2);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { userId: 'user-456' },
            { users: { some: { userId: 'user-456' } } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when user has no devices', async () => {
      (prisma.device.findMany as Mock).mockResolvedValue([]);

      const result = await deviceRepository.findByUserId('new-user');

      expect(result).toEqual([]);
    });
  });

  describe('findByUserIdWithModel', () => {
    it('loads canonical model identity for import safety checks', async () => {
      const devices = [{ ...mockDevice, model: { slug: 'coldcard-q' } }];
      (prisma.device.findMany as Mock).mockResolvedValue(devices);

      await expect(deviceRepository.findByUserIdWithModel('user-456')).resolves.toEqual(devices);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { userId: 'user-456' },
            { users: { some: { userId: 'user-456' } } },
          ],
        },
        include: { model: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findByUserIdWithAssociations', () => {
    it('should return devices with full associations', async () => {
      const devicesWithAssociations = [
        {
          ...mockDevice,
          users: [],
          wallets: [{ walletId: 'wallet-1' }],
        },
      ];

      (prisma.device.findMany as Mock).mockResolvedValue(devicesWithAssociations);

      const result = await deviceRepository.findByUserIdWithAssociations('user-456');

      expect(result[0].wallets).toHaveLength(1);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: expect.any(Object),
        include: { users: true, wallets: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findByWalletId', () => {
    it('should return devices associated with wallet', async () => {
      const devices = [mockDevice, { ...mockDevice, id: 'device-789' }];
      (prisma.device.findMany as Mock).mockResolvedValue(devices);

      const result = await deviceRepository.findByWalletId('wallet-123');

      expect(result).toHaveLength(2);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: { wallets: { some: { walletId: 'wallet-123' } } },
      });
    });
  });

  describe('hasUserAccess', () => {
    it('should return true when user owns device', async () => {
      (prisma.device.findFirst as Mock).mockResolvedValue(mockDevice);

      const result = await deviceRepository.hasUserAccess('device-123', 'user-456');

      expect(result).toBe(true);
      expect(prisma.device.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'device-123',
          OR: [
            { userId: 'user-456' },
            { users: { some: { userId: 'user-456' } } },
          ],
        },
      });
    });

    it('should return true when device is shared with user', async () => {
      (prisma.device.findFirst as Mock).mockResolvedValue(mockDevice);

      const result = await deviceRepository.hasUserAccess('device-123', 'shared-user');

      expect(result).toBe(true);
    });

    it('should return false when user has no access', async () => {
      (prisma.device.findFirst as Mock).mockResolvedValue(null);

      const result = await deviceRepository.hasUserAccess('device-123', 'other-user');

      expect(result).toBe(false);
    });
  });

  describe('isShared', () => {
    it('should return true when device has shared users', async () => {
      (prisma.deviceUser.count as Mock).mockResolvedValue(2);

      const result = await deviceRepository.isShared('device-123');

      expect(result).toBe(true);
      expect(prisma.deviceUser.count).toHaveBeenCalledWith({
        where: { deviceId: 'device-123' },
      });
    });

    it('should return false when device has no shared users', async () => {
      (prisma.deviceUser.count as Mock).mockResolvedValue(0);

      const result = await deviceRepository.isShared('device-123');

      expect(result).toBe(false);
    });
  });

  describe('create', () => {
    it('should create device with all fields', async () => {
      const input = {
        userId: 'user-456',
        label: 'New Device',
        type: 'trezor',
        fingerprint: 'xyz789',
        xpub: 'xpub...',
        derivationPath: "m/84'/0'/0'",
        modelId: 'trezor-model-t',
        groupId: 'group-1',
        groupRole: 'signer',
      };

      (prisma.device.create as Mock).mockResolvedValue({ ...mockDevice, ...input });

      const result = await deviceRepository.create(input);

      expect(result.label).toBe('New Device');
      expect(prisma.device.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-456',
          label: 'New Device',
          type: 'trezor',
          fingerprint: 'xyz789',
          xpub: 'xpub...',
          derivationPath: "m/84'/0'/0'",
          modelId: 'trezor-model-t',
          groupId: 'group-1',
          groupRole: 'signer',
        },
      });
    });

    it('should create device with default groupRole', async () => {
      const input = {
        userId: 'user-456',
        label: 'Minimal Device',
        type: 'coldcard',
        fingerprint: 'min123',
        xpub: 'xpub...',
      };

      (prisma.device.create as Mock).mockResolvedValue({ ...mockDevice, ...input });

      await deviceRepository.create(input);

      expect(prisma.device.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          groupRole: 'viewer',
        }),
      });
    });
  });

  describe('update', () => {
    it('should update device fields', async () => {
      const updatedDevice = { ...mockDevice, label: 'Updated Label' };
      (prisma.device.update as Mock).mockResolvedValue(updatedDevice);

      const result = await deviceRepository.update('device-123', { label: 'Updated Label' });

      expect(result.label).toBe('Updated Label');
      expect(prisma.device.update).toHaveBeenCalledWith({
        where: { id: 'device-123' },
        data: { label: 'Updated Label' },
      });
    });

    it('should update multiple fields at once', async () => {
      (prisma.device.update as Mock).mockResolvedValue(mockDevice);

      await deviceRepository.update('device-123', {
        label: 'New Label',
        groupId: 'group-2',
        groupRole: 'signer',
      });

      expect(prisma.device.update).toHaveBeenCalledWith({
        where: { id: 'device-123' },
        data: {
          label: 'New Label',
          groupId: 'group-2',
          groupRole: 'signer',
        },
      });
    });
  });

  describe('delete', () => {
    it('should delete device', async () => {
      (prisma.device.delete as Mock).mockResolvedValue(mockDevice);

      await deviceRepository.delete('device-123');

      expect(prisma.device.delete).toHaveBeenCalledWith({
        where: { id: 'device-123' },
      });
    });

    it('should propagate errors on delete failure', async () => {
      (prisma.device.delete as Mock).mockRejectedValue(new Error('Foreign key constraint'));

      await expect(deviceRepository.delete('device-123')).rejects.toThrow('Foreign key constraint');
    });
  });

  describe('addUser', () => {
    it('should create device user association', async () => {
      const deviceUser = { id: 'du-1', deviceId: 'device-123', userId: 'user-789' };
      (prisma.deviceUser.create as Mock).mockResolvedValue(deviceUser);

      const result = await deviceRepository.addUser('device-123', 'user-789');

      expect(result).toEqual(deviceUser);
      expect(prisma.deviceUser.create).toHaveBeenCalledWith({
        data: { deviceId: 'device-123', userId: 'user-789' },
      });
    });
  });

  describe('removeUser', () => {
    it('should remove device user association', async () => {
      (prisma.deviceUser.deleteMany as Mock).mockResolvedValue({ count: 1 });

      await deviceRepository.removeUser('device-123', 'user-789');

      expect(prisma.deviceUser.deleteMany).toHaveBeenCalledWith({
        where: { deviceId: 'device-123', userId: 'user-789' },
      });
    });

    it('should handle removing non-existent association', async () => {
      (prisma.deviceUser.deleteMany as Mock).mockResolvedValue({ count: 0 });

      // Should not throw
      await expect(
        deviceRepository.removeUser('device-123', 'non-existent-user')
      ).resolves.not.toThrow();
    });
  });

  describe('getSharedUserCount', () => {
    it('should return count of shared users', async () => {
      (prisma.deviceUser.count as Mock).mockResolvedValue(5);

      const result = await deviceRepository.getSharedUserCount('device-123');

      expect(result).toBe(5);
      expect(prisma.deviceUser.count).toHaveBeenCalledWith({
        where: { deviceId: 'device-123' },
      });
    });

    it('should return 0 when no shared users', async () => {
      (prisma.deviceUser.count as Mock).mockResolvedValue(0);

      const result = await deviceRepository.getSharedUserCount('device-123');

      expect(result).toBe(0);
    });
  });

  describe('findByIdAndUser', () => {
    it('should return device when user owns it', async () => {
      (prisma.device.findFirst as Mock).mockResolvedValue(mockDevice);

      const result = await deviceRepository.findByIdAndUser('device-123', 'user-456');

      expect(result).toEqual(mockDevice);
      expect(prisma.device.findFirst).toHaveBeenCalledWith({
        where: { id: 'device-123', userId: 'user-456' },
        include: { model: true },
      });
    });

    it('should return null when user does not own device', async () => {
      (prisma.device.findFirst as Mock).mockResolvedValue(null);

      const result = await deviceRepository.findByIdAndUser('device-123', 'other-user');

      expect(result).toBeNull();
    });
  });

  describe('findByIdsAndUserWithAccounts', () => {
    it('should return devices with accounts for given IDs and user', async () => {
      const devicesWithAccounts = [
        { ...mockDevice, accounts: [{ id: 'acc-1', deviceId: 'device-123' }] },
      ];
      (prisma.device.findMany as Mock).mockResolvedValue(devicesWithAccounts);

      const result = await deviceRepository.findByIdsAndUserWithAccounts(
        ['device-123', 'device-456'],
        'user-456'
      );

      expect(result).toEqual(devicesWithAccounts);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['device-123', 'device-456'] },
          userId: 'user-456',
        },
        include: { accounts: true, model: true },
      });
    });

    it('should return empty array when no devices match', async () => {
      (prisma.device.findMany as Mock).mockResolvedValue([]);

      const result = await deviceRepository.findByIdsAndUserWithAccounts([], 'user-456');

      expect(result).toEqual([]);
    });
  });

  describe('findByUserIdWithAccounts', () => {
    it('should return devices with accounts for user', async () => {
      const devicesWithAccounts = [
        { ...mockDevice, accounts: [{ id: 'acc-1' }] },
      ];
      (prisma.device.findMany as Mock).mockResolvedValue(devicesWithAccounts);

      const result = await deviceRepository.findByUserIdWithAccounts('user-456');

      expect(result).toEqual(devicesWithAccounts);
      expect(prisma.device.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [] },
          userId: 'user-456',
        },
        include: { accounts: true },
      });
    });
  });
});
