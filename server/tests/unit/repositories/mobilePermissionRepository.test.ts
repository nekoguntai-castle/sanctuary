/**
 * Mobile Permission Repository Tests
 *
 * Tests for mobile permission data access layer operations including
 * permission CRUD, batch queries, and wallet/user associations.
 */

import { vi, Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    wallet: { findUnique: vi.fn() },
    mobilePermission: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { mobilePermissionRepository } from '../../../src/repositories/mobilePermissionRepository';

describe('Mobile Permission Repository', () => {
  const mockPermission = {
    id: 'perm-123',
    walletId: 'wallet-456',
    userId: 'user-789',
    canViewBalance: true,
    canViewTransactions: true,
    canViewUtxos: true,
    canCreateTransaction: false,
    canBroadcast: false,
    canSignPsbt: false,
    canGenerateAddress: true,
    canManageLabels: false,
    canManageDevices: false,
    canShareWallet: false,
    canDeleteWallet: false,
    ownerMaxPermissions: null,
    lastModifiedBy: 'admin-user',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findById', () => {
    it('should find mobile permission by ID', async () => {
      (prisma.mobilePermission.findUnique as Mock).mockResolvedValue(mockPermission);

      const result = await mobilePermissionRepository.findById('perm-123');

      expect(result).toEqual(mockPermission);
      expect(prisma.mobilePermission.findUnique).toHaveBeenCalledWith({
        where: { id: 'perm-123' },
      });
    });

    it('should return null when permission not found', async () => {
      (prisma.mobilePermission.findUnique as Mock).mockResolvedValue(null);

      const result = await mobilePermissionRepository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByWalletAndUser', () => {
    it('should find permission by wallet and user', async () => {
      (prisma.mobilePermission.findUnique as Mock).mockResolvedValue(mockPermission);

      const result = await mobilePermissionRepository.findByWalletAndUser('wallet-456', 'user-789');

      expect(result).toEqual(mockPermission);
      expect(prisma.mobilePermission.findUnique).toHaveBeenCalledWith({
        where: {
          walletId_userId: { walletId: 'wallet-456', userId: 'user-789' },
        },
      });
    });

    it('should return null when no permission exists', async () => {
      (prisma.mobilePermission.findUnique as Mock).mockResolvedValue(null);

      const result = await mobilePermissionRepository.findByWalletAndUser('wallet-456', 'other-user');

      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should find all permissions for a user', async () => {
      const permissions = [mockPermission, { ...mockPermission, id: 'perm-456', walletId: 'wallet-2' }];
      (prisma.mobilePermission.findMany as Mock).mockResolvedValue(permissions);

      const result = await mobilePermissionRepository.findByUserId('user-789');

      expect(result).toHaveLength(2);
      expect(prisma.mobilePermission.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-789' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when user has no permissions', async () => {
      (prisma.mobilePermission.findMany as Mock).mockResolvedValue([]);

      const result = await mobilePermissionRepository.findByUserId('user-no-perms');

      expect(result).toEqual([]);
    });
  });

  describe('findByWalletId', () => {
    it('should find all permissions for a wallet', async () => {
      const permissions = [mockPermission, { ...mockPermission, id: 'perm-456', userId: 'user-2' }];
      (prisma.mobilePermission.findMany as Mock).mockResolvedValue(permissions);

      const result = await mobilePermissionRepository.findByWalletId('wallet-456');

      expect(result).toHaveLength(2);
      expect(prisma.mobilePermission.findMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when wallet has no permissions', async () => {
      (prisma.mobilePermission.findMany as Mock).mockResolvedValue([]);

      const result = await mobilePermissionRepository.findByWalletId('empty-wallet');

      expect(result).toEqual([]);
    });
  });

  describe('findByUserIdWithWallet', () => {
    it('should find permissions with wallet details', async () => {
      const permissionWithWallet = {
        ...mockPermission,
        wallet: {
          id: 'wallet-456',
          name: 'My Wallet',
          type: 'single_sig',
          network: 'mainnet',
          users: [{ role: 'viewer' }],
        },
      };
      (prisma.mobilePermission.findMany as Mock).mockResolvedValue([permissionWithWallet]);

      const result = await mobilePermissionRepository.findByUserIdWithWallet('user-789');

      expect(result).toHaveLength(1);
      expect(result[0].wallet.name).toBe('My Wallet');
      expect(prisma.mobilePermission.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-789' },
        include: {
          wallet: {
            select: {
              id: true,
              name: true,
              type: true,
              network: true,
              groupRole: true,
              users: {
                where: { userId: 'user-789' },
                select: { role: true },
                take: 1,
              },
              group: {
                select: {
                  members: {
                    where: { userId: 'user-789' },
                    select: { userId: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findWalletAccessUsers', () => {
    it('includes group-only members and keeps direct roles for overlapping users', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue({
        groupRole: 'signer',
        users: [
          { userId: 'owner', role: 'owner', user: { username: 'alice' } },
          { userId: 'mixed', role: 'viewer', user: { username: 'bob' } },
        ],
        group: { members: [
          { userId: 'mixed', user: { username: 'bob' } },
          { userId: 'group-only', user: { username: 'carol' } },
        ] },
      });

      const result = await mobilePermissionRepository.findWalletAccessUsers('wallet-456');

      expect(result).toEqual([
        { userId: 'owner', role: 'owner', user: { username: 'alice' } },
        { userId: 'mixed', role: 'viewer', user: { username: 'bob' } },
        { userId: 'group-only', role: 'signer', user: { username: 'carol' } },
      ]);
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'wallet-456' },
        select: expect.objectContaining({ groupRole: true, group: expect.any(Object) }),
      }));
    });

    it('returns no users when the wallet is absent', async () => {
      (prisma.wallet.findUnique as Mock).mockResolvedValue(null);
      await expect(mobilePermissionRepository.findWalletAccessUsers('missing')).resolves.toEqual([]);
    });

    it('keeps direct users when the wallet has no group', async () => {
      const direct = { userId: 'owner', role: 'owner', user: { username: 'alice' } };
      (prisma.wallet.findUnique as Mock).mockResolvedValue({
        groupRole: 'viewer', users: [direct], group: null,
      });

      await expect(mobilePermissionRepository.findWalletAccessUsers('wallet-456'))
        .resolves.toEqual([direct]);
    });
  });

  describe('findByWalletIdAndUserIds', () => {
    it('should find permissions for multiple users in a wallet', async () => {
      const permissions = [
        mockPermission,
        { ...mockPermission, id: 'perm-456', userId: 'user-2' },
      ];
      (prisma.mobilePermission.findMany as Mock).mockResolvedValue(permissions);

      const result = await mobilePermissionRepository.findByWalletIdAndUserIds(
        'wallet-456',
        ['user-789', 'user-2', 'user-3']
      );

      expect(result.size).toBe(2);
      expect(result.get('user-789')).toEqual(mockPermission);
      expect(result.get('user-2')).toBeDefined();
      expect(result.has('user-3')).toBe(false);
      expect(prisma.mobilePermission.findMany).toHaveBeenCalledWith({
        where: {
          walletId: 'wallet-456',
          userId: { in: ['user-789', 'user-2', 'user-3'] },
        },
      });
    });

    it('should return empty map when no permissions found', async () => {
      (prisma.mobilePermission.findMany as Mock).mockResolvedValue([]);

      const result = await mobilePermissionRepository.findByWalletIdAndUserIds('wallet-456', ['user-1']);

      expect(result.size).toBe(0);
    });
  });

  describe('create', () => {
    it('should create a new mobile permission', async () => {
      (prisma.mobilePermission.create as Mock).mockResolvedValue(mockPermission);

      const result = await mobilePermissionRepository.create({
        walletId: 'wallet-456',
        userId: 'user-789',
        canViewBalance: true,
        canViewTransactions: true,
        canGenerateAddress: true,
        lastModifiedBy: 'admin-user',
      });

      expect(result).toEqual(mockPermission);
      expect(prisma.mobilePermission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          walletId: 'wallet-456',
          userId: 'user-789',
          canViewBalance: true,
        }),
      });
    });

    it('should create permission with ownerMaxPermissions', async () => {
      const permWithMax = {
        ...mockPermission,
        ownerMaxPermissions: { canBroadcast: false },
      };
      (prisma.mobilePermission.create as Mock).mockResolvedValue(permWithMax);

      const result = await mobilePermissionRepository.create({
        walletId: 'wallet-456',
        userId: 'user-789',
        ownerMaxPermissions: { canBroadcast: false },
      });

      expect(result.ownerMaxPermissions).toEqual({ canBroadcast: false });
    });
  });

  describe('upsert', () => {
    it('should upsert mobile permission (update existing)', async () => {
      const updatedPerm = { ...mockPermission, canBroadcast: true };
      (prisma.mobilePermission.upsert as Mock).mockResolvedValue(updatedPerm);

      const result = await mobilePermissionRepository.upsert('wallet-456', 'user-789', {
        canBroadcast: true,
        lastModifiedBy: 'admin-user',
      });

      expect(result.canBroadcast).toBe(true);
      expect(prisma.mobilePermission.upsert).toHaveBeenCalledWith({
        where: {
          walletId_userId: { walletId: 'wallet-456', userId: 'user-789' },
        },
        update: expect.objectContaining({
          canBroadcast: true,
        }),
        create: expect.objectContaining({
          walletId: 'wallet-456',
          userId: 'user-789',
          canBroadcast: true,
        }),
      });
    });

    it('should upsert with ownerMaxPermissions', async () => {
      (prisma.mobilePermission.upsert as Mock).mockResolvedValue(mockPermission);

      await mobilePermissionRepository.upsert('wallet-456', 'user-789', {
        ownerMaxPermissions: { canDeleteWallet: false },
      });

      expect(prisma.mobilePermission.upsert).toHaveBeenCalled();
    });
  });

  describe('updateById', () => {
    it('should update permission by ID', async () => {
      const updated = { ...mockPermission, canCreateTransaction: true };
      (prisma.mobilePermission.update as Mock).mockResolvedValue(updated);

      const result = await mobilePermissionRepository.updateById('perm-123', {
        canCreateTransaction: true,
      });

      expect(result.canCreateTransaction).toBe(true);
      expect(prisma.mobilePermission.update).toHaveBeenCalledWith({
        where: { id: 'perm-123' },
        data: expect.objectContaining({
          canCreateTransaction: true,
        }),
      });
    });

    it('should update ownerMaxPermissions', async () => {
      (prisma.mobilePermission.update as Mock).mockResolvedValue(mockPermission);

      await mobilePermissionRepository.updateById('perm-123', {
        ownerMaxPermissions: { canBroadcast: true },
      });

      expect(prisma.mobilePermission.update).toHaveBeenCalled();
    });
  });

  describe('updateByWalletAndUser', () => {
    it('should update permission by wallet and user', async () => {
      const updated = { ...mockPermission, canManageLabels: true };
      (prisma.mobilePermission.update as Mock).mockResolvedValue(updated);

      const result = await mobilePermissionRepository.updateByWalletAndUser('wallet-456', 'user-789', {
        canManageLabels: true,
      });

      expect(result.canManageLabels).toBe(true);
      expect(prisma.mobilePermission.update).toHaveBeenCalledWith({
        where: {
          walletId_userId: { walletId: 'wallet-456', userId: 'user-789' },
        },
        data: expect.objectContaining({
          canManageLabels: true,
        }),
      });
    });
  });

  describe('deleteById', () => {
    it('should delete permission by ID', async () => {
      (prisma.mobilePermission.delete as Mock).mockResolvedValue(mockPermission);

      await mobilePermissionRepository.deleteById('perm-123');

      expect(prisma.mobilePermission.delete).toHaveBeenCalledWith({
        where: { id: 'perm-123' },
      });
    });
  });

  describe('deleteByWalletAndUser', () => {
    it('should delete permission by wallet and user', async () => {
      (prisma.mobilePermission.delete as Mock).mockResolvedValue(mockPermission);

      await mobilePermissionRepository.deleteByWalletAndUser('wallet-456', 'user-789');

      expect(prisma.mobilePermission.delete).toHaveBeenCalledWith({
        where: {
          walletId_userId: { walletId: 'wallet-456', userId: 'user-789' },
        },
      });
    });
  });

  describe('deleteByUserId', () => {
    it('should delete all permissions for a user', async () => {
      (prisma.mobilePermission.deleteMany as Mock).mockResolvedValue({ count: 5 });

      const count = await mobilePermissionRepository.deleteByUserId('user-789');

      expect(count).toBe(5);
      expect(prisma.mobilePermission.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-789' },
      });
    });

    it('should return 0 when user has no permissions', async () => {
      (prisma.mobilePermission.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const count = await mobilePermissionRepository.deleteByUserId('user-no-perms');

      expect(count).toBe(0);
    });
  });

  describe('deleteByWalletId', () => {
    it('should delete all permissions for a wallet', async () => {
      (prisma.mobilePermission.deleteMany as Mock).mockResolvedValue({ count: 10 });

      const count = await mobilePermissionRepository.deleteByWalletId('wallet-456');

      expect(count).toBe(10);
      expect(prisma.mobilePermission.deleteMany).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
      });
    });

    it('should return 0 when wallet has no permissions', async () => {
      (prisma.mobilePermission.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const count = await mobilePermissionRepository.deleteByWalletId('empty-wallet');

      expect(count).toBe(0);
    });
  });

  describe('countByWalletId', () => {
    it('should count permissions for a wallet', async () => {
      (prisma.mobilePermission.count as Mock).mockResolvedValue(3);

      const count = await mobilePermissionRepository.countByWalletId('wallet-456');

      expect(count).toBe(3);
      expect(prisma.mobilePermission.count).toHaveBeenCalledWith({
        where: { walletId: 'wallet-456' },
      });
    });

    it('should return 0 for wallet with no permissions', async () => {
      (prisma.mobilePermission.count as Mock).mockResolvedValue(0);

      const count = await mobilePermissionRepository.countByWalletId('empty-wallet');

      expect(count).toBe(0);
    });
  });
});
