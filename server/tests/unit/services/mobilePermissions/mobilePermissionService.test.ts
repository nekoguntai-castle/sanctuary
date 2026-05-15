/**
 * Mobile Permission Service Tests
 *
 * Tests for the MobilePermissionService class methods including:
 * - canPerformAction / assertCanPerformAction
 * - getEffectivePermissions
 * - updateOwnPermissions
 * - setMaxPermissions / clearMaxPermissions
 * - checkForGateway
 */

import { vi, Mock } from 'vitest';

// Mock dependencies before imports
vi.mock('../../../../src/repositories', () => ({
  mobilePermissionRepository: {
    findByWalletAndUser: vi.fn(),
    findByUserIdWithWallet: vi.fn(),
    findByWalletIdAndUserIds: vi.fn(),
    upsert: vi.fn(),
    updateByWalletAndUser: vi.fn(),
    deleteByWalletAndUser: vi.fn(),
  },
  walletSharingRepository: {
    findWalletUserByCompositeKey: vi.fn(),
    findWalletUsersWithUsername: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { mobilePermissionRepository, walletSharingRepository } from '../../../../src/repositories';
import { mobilePermissionService } from '../../../../src/services/mobilePermissions';
import { ForbiddenError, NotFoundError } from '../../../../src/errors';

describe('MobilePermissionService', () => {
  const userId = 'user-123';
  const walletId = 'wallet-456';
  const ownerId = 'owner-789';
  const targetUserId = 'target-111';

  // Mock mobile permission record
  const mockPermission = {
    id: 'perm-1',
    walletId,
    userId,
    canViewBalance: true,
    canViewTransactions: true,
    canViewUtxos: true,
    canCreateTransaction: true,
    canBroadcast: true,
    canSignPsbt: true,
    canGenerateAddress: true,
    canManageLabels: true,
    canManageDevices: true,
    canShareWallet: true,
    canDeleteWallet: true,
    ownerMaxPermissions: null,
    lastModifiedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('canPerformAction', () => {
    it('should return true when role and permissions allow action', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);

      const result = await mobilePermissionService.canPerformAction(walletId, userId, 'broadcast');

      expect(result).toBe(true);
      expect(walletSharingRepository.findWalletUserByCompositeKey).toHaveBeenCalledWith(walletId, userId);
    });

    it('should return false when role does not allow action', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'viewer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);

      const result = await mobilePermissionService.canPerformAction(walletId, userId, 'broadcast');

      expect(result).toBe(false);
    });

    it('should return false when user has no wallet access', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue(null);

      const result = await mobilePermissionService.canPerformAction(walletId, userId, 'viewBalance');

      expect(result).toBe(false);
    });

    it('should return false when user self-restricted the action', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue({
        ...mockPermission,
        canBroadcast: false,
      });

      const result = await mobilePermissionService.canPerformAction(walletId, userId, 'broadcast');

      expect(result).toBe(false);
    });

    it('should return false when owner has restricted the action', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue({
        ...mockPermission,
        ownerMaxPermissions: { broadcast: false },
      });

      const result = await mobilePermissionService.canPerformAction(walletId, userId, 'broadcast');

      expect(result).toBe(false);
    });
  });

  describe('assertCanPerformAction', () => {
    it('should not throw when action is allowed', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);

      await expect(
        mobilePermissionService.assertCanPerformAction(walletId, userId, 'broadcast')
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenError when action is denied', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'viewer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);

      await expect(
        mobilePermissionService.assertCanPerformAction(walletId, userId, 'broadcast')
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getEffectivePermissions', () => {
    it('should return effective permissions for user with access', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);

      const result = await mobilePermissionService.getEffectivePermissions(walletId, userId);

      expect(result.walletId).toBe(walletId);
      expect(result.userId).toBe(userId);
      expect(result.role).toBe('signer');
      expect(result.permissions.viewBalance).toBe(true);
      expect(result.permissions.broadcast).toBe(true);
      expect(result.permissions.manageDevices).toBe(false); // signer can't manage devices
      expect(result.hasCustomRestrictions).toBe(false);
      expect(result.hasOwnerRestrictions).toBe(false);
    });

    it('should throw ForbiddenError when user has no access', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue(null);

      await expect(
        mobilePermissionService.getEffectivePermissions(walletId, userId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should indicate custom restrictions when permission record exists', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue({
        ...mockPermission,
        canBroadcast: false,
      });

      const result = await mobilePermissionService.getEffectivePermissions(walletId, userId);

      expect(result.hasCustomRestrictions).toBe(true);
      expect(result.permissions.broadcast).toBe(false);
    });

    it('should indicate owner restrictions when ownerMaxPermissions is set', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue({
        ...mockPermission,
        ownerMaxPermissions: { broadcast: false },
      });

      const result = await mobilePermissionService.getEffectivePermissions(walletId, userId);

      expect(result.hasOwnerRestrictions).toBe(true);
    });
  });

  describe('updateOwnPermissions', () => {
    it('should update user permissions successfully', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);
      (mobilePermissionRepository.upsert as Mock).mockResolvedValue(mockPermission);

      const result = await mobilePermissionService.updateOwnPermissions(
        walletId,
        userId,
        { broadcast: false },
        userId
      );

      expect(mobilePermissionRepository.upsert).toHaveBeenCalledWith(walletId, userId, {
        canBroadcast: false,
        lastModifiedBy: userId,
      });
      expect(result.walletId).toBe(walletId);
    });

    it('should throw ForbiddenError when user has no access', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue(null);

      await expect(
        mobilePermissionService.updateOwnPermissions(walletId, userId, { broadcast: false })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError when trying to exceed owner max', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue({
        ...mockPermission,
        ownerMaxPermissions: { broadcast: false },
      });

      await expect(
        mobilePermissionService.updateOwnPermissions(walletId, userId, { broadcast: true })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow disabling a permission under owner max and default lastModifiedBy to userId', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue({
        ...mockPermission,
        ownerMaxPermissions: { broadcast: false },
      });
      (mobilePermissionRepository.upsert as Mock).mockResolvedValue(mockPermission);

      await mobilePermissionService.updateOwnPermissions(walletId, userId, { broadcast: false });

      expect(mobilePermissionRepository.upsert).toHaveBeenCalledWith(walletId, userId, {
        canBroadcast: false,
        lastModifiedBy: userId,
      });
    });

    it('should ignore undefined permission fields in input', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);
      (mobilePermissionRepository.upsert as Mock).mockResolvedValue(mockPermission);

      await mobilePermissionService.updateOwnPermissions(
        walletId,
        userId,
        { broadcast: undefined } as any
      );

      expect(mobilePermissionRepository.upsert).toHaveBeenCalledWith(walletId, userId, {
        lastModifiedBy: userId,
      });
    });
  });

  describe('setMaxPermissions', () => {
    it('should set max permissions when called by owner', async () => {
      // First call for owner check, second for target check, third for getEffectivePermissions
      (walletSharingRepository.findWalletUserByCompositeKey as Mock)
        .mockResolvedValueOnce({ role: 'owner' })
        .mockResolvedValueOnce({ role: 'signer' })
        .mockResolvedValueOnce({ role: 'signer' });
      (mobilePermissionRepository.upsert as Mock).mockResolvedValue(mockPermission);
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue({
        ...mockPermission,
        ownerMaxPermissions: { broadcast: false },
      });

      const result = await mobilePermissionService.setMaxPermissions(
        walletId,
        targetUserId,
        ownerId,
        { broadcast: false }
      );

      expect(mobilePermissionRepository.upsert).toHaveBeenCalledWith(walletId, targetUserId, {
        ownerMaxPermissions: { broadcast: false },
        lastModifiedBy: ownerId,
      });
      expect(result.hasOwnerRestrictions).toBe(true);
    });

    it('should throw ForbiddenError when caller is not owner', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });

      await expect(
        mobilePermissionService.setMaxPermissions(walletId, targetUserId, userId, { broadcast: false })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError when target user has no access', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock)
        .mockResolvedValueOnce({ role: 'owner' })
        .mockResolvedValueOnce(null);

      await expect(
        mobilePermissionService.setMaxPermissions(walletId, targetUserId, ownerId, { broadcast: false })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw ForbiddenError when trying to restrict another owner', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock)
        .mockResolvedValueOnce({ role: 'owner' })
        .mockResolvedValueOnce({ role: 'owner' });

      await expect(
        mobilePermissionService.setMaxPermissions(walletId, targetUserId, ownerId, { broadcast: false })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('clearMaxPermissions', () => {
    it('should clear max permissions when called by owner', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock)
        .mockResolvedValueOnce({ role: 'owner' })
        .mockResolvedValueOnce({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue({
        ...mockPermission,
        ownerMaxPermissions: { broadcast: false },
      });
      (mobilePermissionRepository.updateByWalletAndUser as Mock).mockResolvedValue(mockPermission);

      const result = await mobilePermissionService.clearMaxPermissions(
        walletId,
        targetUserId,
        ownerId
      );

      expect(mobilePermissionRepository.updateByWalletAndUser).toHaveBeenCalledWith(
        walletId,
        targetUserId,
        { ownerMaxPermissions: null, lastModifiedBy: ownerId }
      );
      expect(result).toBeDefined();
    });

    it('should throw ForbiddenError when caller is not owner', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });

      await expect(
        mobilePermissionService.clearMaxPermissions(walletId, targetUserId, userId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError when no permission record exists', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'owner' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);

      await expect(
        mobilePermissionService.clearMaxPermissions(walletId, targetUserId, ownerId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('resetPermissions', () => {
    it('should delete the permission record', async () => {
      (mobilePermissionRepository.deleteByWalletAndUser as Mock).mockResolvedValue(undefined);

      await mobilePermissionService.resetPermissions(walletId, userId);

      expect(mobilePermissionRepository.deleteByWalletAndUser).toHaveBeenCalledWith(
        walletId,
        userId
      );
    });
  });

  describe('getUserMobilePermissions', () => {
    it('should return permissions with wallet details and effective permissions', async () => {
      const mockPermsWithWallet = [
        {
          ...mockPermission,
          wallet: {
            id: walletId,
            name: 'Test Wallet',
            type: 'single_sig',
            network: 'testnet',
            users: [{ role: 'signer' }],
          },
        },
      ];

      (mobilePermissionRepository.findByUserIdWithWallet as Mock).mockResolvedValue(mockPermsWithWallet);

      const result = await mobilePermissionService.getUserMobilePermissions(userId);

      expect(result).toHaveLength(1);
      expect(result[0].wallet.name).toBe('Test Wallet');
      expect(result[0].role).toBe('signer');
      expect(result[0].effectivePermissions).toBeDefined();
      expect(result[0].effectivePermissions.viewBalance).toBe(true);
    });

    it('should fail closed when users is empty', async () => {
      const mockPermsWithWallet = [
        {
          ...mockPermission,
          wallet: {
            id: walletId,
            name: 'Test Wallet',
            type: 'single_sig',
            network: 'testnet',
            users: [],
          },
        },
      ];

      (mobilePermissionRepository.findByUserIdWithWallet as Mock).mockResolvedValue(mockPermsWithWallet);

      const result = await mobilePermissionService.getUserMobilePermissions(userId);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBeNull();
      expect(result[0].effectivePermissions.viewBalance).toBe(false);
      expect(result[0].effectivePermissions.broadcast).toBe(false);
    });
  });

  describe('getWalletPermissions', () => {
    it('should return permissions for all wallet users', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'owner' });
      (walletSharingRepository.findWalletUsersWithUsername as Mock).mockResolvedValue([
        { userId: 'user-1', role: 'owner', user: { id: 'user-1', username: 'alice' } },
        { userId: 'user-2', role: 'signer', user: { id: 'user-2', username: 'bob' } },
      ]);
      // Mock batch query returning an empty map (no custom permissions)
      (mobilePermissionRepository.findByWalletIdAndUserIds as Mock).mockResolvedValue(new Map());

      const result = await mobilePermissionService.getWalletPermissions(walletId, userId);

      expect(result).toHaveLength(2);
      expect(result[0].username).toBe('alice');
      expect(result[0].role).toBe('owner');
      expect(result[1].username).toBe('bob');
      expect(result[1].role).toBe('signer');
      expect(mobilePermissionRepository.findByWalletIdAndUserIds).toHaveBeenCalledWith(
        walletId,
        ['user-1', 'user-2']
      );
    });

    it('should include custom permissions from batch query', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'owner' });
      (walletSharingRepository.findWalletUsersWithUsername as Mock).mockResolvedValue([
        { userId: 'user-1', role: 'owner', user: { id: 'user-1', username: 'alice' } },
        { userId: 'user-2', role: 'signer', user: { id: 'user-2', username: 'bob' } },
      ]);
      // Mock batch query returning custom permissions for user-2
      const permissionsMap = new Map([
        ['user-2', { ...mockPermission, userId: 'user-2', canBroadcast: false }],
      ]);
      (mobilePermissionRepository.findByWalletIdAndUserIds as Mock).mockResolvedValue(permissionsMap);

      const result = await mobilePermissionService.getWalletPermissions(walletId, userId);

      expect(result).toHaveLength(2);
      expect(result[0].hasCustomRestrictions).toBe(false);
      expect(result[1].hasCustomRestrictions).toBe(true);
      expect(result[1].effectivePermissions.broadcast).toBe(false);
    });

    it('should throw ForbiddenError when requester has no access', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue(null);

      await expect(
        mobilePermissionService.getWalletPermissions(walletId, userId)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('checkForGateway', () => {
    it('should return allowed: true when action is permitted', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'signer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);

      const result = await mobilePermissionService.checkForGateway(walletId, userId, 'broadcast');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return allowed: false when action is denied', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockResolvedValue({ role: 'viewer' });
      (mobilePermissionRepository.findByWalletAndUser as Mock).mockResolvedValue(null);

      const result = await mobilePermissionService.checkForGateway(walletId, userId, 'broadcast');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Mobile access denied for action: broadcast');
    });

    it('should return allowed: false with reason on error', async () => {
      (walletSharingRepository.findWalletUserByCompositeKey as Mock).mockRejectedValue(new Error('DB error'));

      const result = await mobilePermissionService.checkForGateway(walletId, userId, 'broadcast');

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Permission check failed');
    });
  });
});
