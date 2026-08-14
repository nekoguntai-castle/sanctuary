/**
 * Access Control Service Tests
 *
 * Tests authorization checks and role-based access control.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import type { WalletUser } from '../../../src/generated/prisma/client';

const { mockGetNamespacedCache, mockCache, mockLog } = vi.hoisted(() => ({
  mockGetNamespacedCache: vi.fn(),
  mockCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    deletePattern: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  default: {
    walletUser: {
      findFirst: vi.fn(),
    },
    wallet: {
      findFirst: vi.fn(),
    },
    transaction: {
      findFirst: vi.fn(),
    },
    address: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock Redis/cache
vi.mock('../../../src/infrastructure/redis', () => ({
  getNamespacedCache: mockGetNamespacedCache,
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

import prisma from '../../../src/models/prisma';
import { clearAccessCacheStrict } from '../../../src/infrastructure/accessCache';
import {
  getUserWalletRole,
  getUserWalletRoleUncached,
  hasWalletAccess,
  checkWalletAccess,
  checkWalletAccessUncached,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  checkWalletApproveAccess,
  requireWalletAccess,
  requireWalletEditAccess,
  requireWalletOwnerAccess,
  invalidateWalletAccessCache,
  invalidateUserAccessCache,
  invalidateUserAccessCacheStrict,
  clearAccessCache,
  checkTransactionAccess,
  requireTransactionAccess,
  buildWalletAccessWhere,
} from '../../../src/services/accessControl';
import { NotFoundError, ForbiddenError } from '../../../src/errors';
import { registerResourceAccessContracts } from './accessControl.resource-access.contracts';

function makeWalletUser(walletId: string, userId: string, role: string): WalletUser {
  return {
    id: faker.string.uuid(),
    walletId,
    userId,
    role,
    createdAt: new Date(),
  } satisfies WalletUser;
}

describe('Access Control Service', () => {
  const userId = faker.string.uuid();
  const walletId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetNamespacedCache.mockReturnValue(mockCache);
    mockCache.get.mockResolvedValue(null);
    mockCache.set.mockResolvedValue(undefined);
    mockCache.deletePattern.mockResolvedValue(undefined);
    mockCache.clear.mockResolvedValue(undefined);
  });

  describe('buildWalletAccessWhere', () => {
    it('should build correct Prisma WHERE clause', () => {
      const where = buildWalletAccessWhere(userId);

      expect(where).toEqual({
        OR: [
          { users: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      });
    });
  });

  describe('getUserWalletRole', () => {
    it('can bypass a stale cached grant for security-sensitive revalidation', async () => {
      mockCache.get.mockResolvedValue({ role: 'owner' });
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      await expect(getUserWalletRoleUncached(walletId, userId)).resolves.toBeNull();

      expect(mockCache.get).not.toHaveBeenCalled();
      expect(prisma.walletUser.findFirst).toHaveBeenCalledWith({
        where: { walletId, userId },
      });
      await expect(checkWalletAccessUncached(walletId, userId)).resolves.toEqual({
        hasAccess: false,
        canEdit: false,
        role: null,
      });
      mockCache.get.mockResolvedValue(null);
    });

    it('should return owner role for direct owner access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'owner')
      );

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('owner');
      expect(prisma.walletUser.findFirst).toHaveBeenCalledWith({
        where: { walletId, userId },
      });
    });

    it('should return signer role for direct signer access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'signer')
      );

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('signer');
    });

    it('should return viewer role for direct viewer access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'viewer')
      );

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('viewer');
    });

    it('should fail closed for malformed direct wallet roles', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'admin')
      );

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBeNull();
    });

    it('should check group access when no direct access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue({
        id: walletId,
        groupRole: 'viewer',
      } as never);

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('viewer');
      expect(prisma.wallet.findFirst).toHaveBeenCalled();
    });

    it('should return null when no access exists', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBeNull();
    });

    it('should return cached role without querying database', async () => {
      mockCache.get.mockResolvedValueOnce({ role: 'owner' });

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('owner');
      expect(prisma.walletUser.findFirst).not.toHaveBeenCalled();
      expect(prisma.wallet.findFirst).not.toHaveBeenCalled();
    });

    it('should fail closed for malformed cached wallet roles', async () => {
      mockCache.get.mockResolvedValueOnce({ role: 'admin' });

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBeNull();
      expect(prisma.walletUser.findFirst).not.toHaveBeenCalled();
      expect(prisma.wallet.findFirst).not.toHaveBeenCalled();
    });

    it('continues through database lookup when access cache read or write fails', async () => {
      mockCache.get.mockRejectedValueOnce(new Error('cache read failed'));
      mockCache.set.mockRejectedValueOnce(new Error('cache write failed'));
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'owner')
      );

      const role = await getUserWalletRole(walletId, userId);

      expect(role).toBe('owner');
      expect(mockLog.debug).toHaveBeenCalledWith(
        'Access cache lookup failed, continuing to DB',
        { error: 'cache read failed' }
      );
      expect(mockLog.debug).toHaveBeenCalledWith(
        'Failed to cache access role',
        { error: 'cache write failed' }
      );
    });
  });

  describe('checkWalletAccess', () => {
    it('should return full access for owner', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'owner')
      );

      const access = await checkWalletAccess(walletId, userId);

      expect(access.hasAccess).toBe(true);
      expect(access.canEdit).toBe(true);
      expect(access.role).toBe('owner');
    });

    it('should return edit access for signer', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'signer')
      );

      const access = await checkWalletAccess(walletId, userId);

      expect(access.hasAccess).toBe(true);
      expect(access.canEdit).toBe(true);
      expect(access.role).toBe('signer');
    });

    it('should return view-only access for viewer', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'viewer')
      );

      const access = await checkWalletAccess(walletId, userId);

      expect(access.hasAccess).toBe(true);
      expect(access.canEdit).toBe(false);
      expect(access.role).toBe('viewer');
    });

    it('should return no access when user has no role', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      const access = await checkWalletAccess(walletId, userId);

      expect(access.hasAccess).toBe(false);
      expect(access.canEdit).toBe(false);
      expect(access.role).toBeNull();
    });
  });

  describe('requireWalletAccess', () => {
    it('should return context when user has access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'viewer')
      );

      const context = await requireWalletAccess(walletId, userId);

      expect(context.walletId).toBe(walletId);
      expect(context.role).toBe('viewer');
      expect(context.canEdit).toBe(false);
    });

    it('should throw NotFoundError when no access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      await expect(requireWalletAccess(walletId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('requireWalletEditAccess', () => {
    it('should return context when user can edit', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'signer')
      );

      const context = await requireWalletEditAccess(walletId, userId);

      expect(context.walletId).toBe(walletId);
      expect(context.canEdit).toBe(true);
    });

    it('should throw ForbiddenError when user cannot edit', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'viewer')
      );

      await expect(requireWalletEditAccess(walletId, userId)).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError when no access at all', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      await expect(requireWalletEditAccess(walletId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('requireWalletOwnerAccess', () => {
    it('should return context when user is owner', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'owner')
      );

      const context = await requireWalletOwnerAccess(walletId, userId);

      expect(context.walletId).toBe(walletId);
      expect(context.role).toBe('owner');
    });

    it('should throw ForbiddenError when user is signer not owner', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'signer')
      );

      await expect(requireWalletOwnerAccess(walletId, userId)).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError when no access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      await expect(requireWalletOwnerAccess(walletId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('checkTransactionAccess', () => {
    const transactionId = faker.string.uuid();

    it('should return access when user has wallet access', async () => {
      vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
        walletId,
      } as never);
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'owner')
      );

      const access = await checkTransactionAccess(transactionId, userId);

      expect(access.hasAccess).toBe(true);
      expect(access.walletId).toBe(walletId);
      expect(access.canEdit).toBe(true);
    });

    it('should return no access when transaction not found', async () => {
      vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

      const access = await checkTransactionAccess(transactionId, userId);

      expect(access.hasAccess).toBe(false);
      expect(access.walletId).toBeNull();
    });
  });

  describe('requireTransactionAccess', () => {
    const transactionId = faker.string.uuid();

    it('should return context when user has access', async () => {
      vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
        walletId,
      } as never);
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'viewer')
      );

      const result = await requireTransactionAccess(transactionId, userId);

      expect(result.walletId).toBe(walletId);
      expect(result.canEdit).toBe(false);
    });

    it('should throw NotFoundError when no access', async () => {
      vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

      await expect(requireTransactionAccess(transactionId, userId)).rejects.toThrow(NotFoundError);
    });
  });

  registerResourceAccessContracts({ userId, walletId });

  describe('hasWalletAccess', () => {
    it('should return true when user has any role', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'viewer')
      );

      expect(await hasWalletAccess(walletId, userId)).toBe(true);
    });

    it('should return false when user has no access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      expect(await hasWalletAccess(walletId, userId)).toBe(false);
    });
  });

  describe('checkWalletEditAccess', () => {
    it('should return true for owner', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'owner')
      );
      expect(await checkWalletEditAccess(walletId, userId)).toBe(true);
    });

    it('should return true for signer', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'signer')
      );
      expect(await checkWalletEditAccess(walletId, userId)).toBe(true);
    });

    it('should return false for viewer', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'viewer')
      );
      expect(await checkWalletEditAccess(walletId, userId)).toBe(false);
    });

    it('should return false when no access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);
      expect(await checkWalletEditAccess(walletId, userId)).toBe(false);
    });
  });

  describe('checkWalletOwnerAccess', () => {
    it('should return true for owner', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'owner')
      );
      expect(await checkWalletOwnerAccess(walletId, userId)).toBe(true);
    });

    it('should return false for signer', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'signer')
      );
      expect(await checkWalletOwnerAccess(walletId, userId)).toBe(false);
    });

    it('should return false when no access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);
      expect(await checkWalletOwnerAccess(walletId, userId)).toBe(false);
    });
  });

  describe('checkWalletApproveAccess', () => {
    it('should return true for owner role', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'owner')
      );

      const result = await checkWalletApproveAccess(walletId, userId);

      expect(result).toBe(true);
    });

    it('should return true for approver role', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'approver')
      );

      const result = await checkWalletApproveAccess(walletId, userId);

      expect(result).toBe(true);
    });

    it('should return false for signer role', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'signer')
      );

      const result = await checkWalletApproveAccess(walletId, userId);

      expect(result).toBe(false);
    });

    it('should return false for viewer role', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'viewer')
      );

      const result = await checkWalletApproveAccess(walletId, userId);

      expect(result).toBe(false);
    });

    it('should return false when user has no access', async () => {
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.wallet.findFirst).mockResolvedValue(null);

      const result = await checkWalletApproveAccess(walletId, userId);

      expect(result).toBe(false);
    });
  });

  describe('Cache Management', () => {
    describe('invalidateWalletAccessCache', () => {
      it('should delete cache pattern for wallet', async () => {
        await invalidateWalletAccessCache(walletId);
        // Should complete without throwing
      });

      it('should swallow cache errors when invalidating wallet cache', async () => {
        mockCache.deletePattern.mockRejectedValueOnce(new Error('cache down'));

        await expect(invalidateWalletAccessCache(walletId)).resolves.toBeUndefined();
      });
    });

    describe('invalidateUserAccessCache', () => {
      it('should delete cache pattern for user', async () => {
        await invalidateUserAccessCache(userId);
        // Should complete without throwing
      });

      it('should swallow cache errors when invalidating user cache', async () => {
        mockCache.deletePattern.mockRejectedValueOnce(new Error('cache down'));

        await expect(invalidateUserAccessCache(userId)).resolves.toBeUndefined();
      });

      it('should propagate cache errors from strict user invalidation', async () => {
        mockCache.deletePattern.mockRejectedValueOnce(new Error('cache down'));

        await expect(invalidateUserAccessCacheStrict(userId)).rejects.toThrow('cache down');
      });

      it('should strictly invalidate a user cache and record completion', async () => {
        await invalidateUserAccessCacheStrict(userId);

        expect(mockCache.deletePattern).toHaveBeenCalledWith(`${userId}:*`);
        expect(mockLog.debug).toHaveBeenCalledWith(
          'Invalidated access cache for user',
          { userId: userId.substring(0, 8) },
        );
      });
    });

    describe('clearAccessCache', () => {
      it('should clear entire cache', async () => {
        await clearAccessCache();
        // Should complete without throwing
      });

      it('should swallow cache errors when clearing cache', async () => {
        mockCache.clear.mockRejectedValueOnce(new Error('cache down'));

        await expect(clearAccessCache()).resolves.toBeUndefined();
      });
    });

    describe('clearAccessCacheStrict', () => {
      it('should clear entire cache', async () => {
        await clearAccessCacheStrict();

        expect(mockCache.clear).toHaveBeenCalled();
      });

      it('should propagate cache errors when clearing cache', async () => {
        mockCache.clear.mockRejectedValueOnce(new Error('cache down'));

        await expect(clearAccessCacheStrict()).rejects.toThrow('cache down');
      });
    });

    describe('cache invalidation causes DB re-query', () => {
      it('should use cached role without hitting DB', async () => {
        mockCache.get.mockResolvedValueOnce({ role: 'owner' });

        const role = await getUserWalletRole(walletId, userId);

        expect(role).toBe('owner');
        expect(prisma.walletUser.findFirst).not.toHaveBeenCalled();
        expect(prisma.wallet.findFirst).not.toHaveBeenCalled();
      });

      it('should query DB after cache returns null (cache miss)', async () => {
        mockCache.get.mockResolvedValueOnce(null);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'signer')
      );

        const role = await getUserWalletRole(walletId, userId);

        expect(role).toBe('signer');
        expect(prisma.walletUser.findFirst).toHaveBeenCalledWith({
          where: { walletId, userId },
        });
        // Should cache the result for next lookup
        expect(mockCache.set).toHaveBeenCalled();
      });

      it('should re-query DB after wallet cache invalidation', async () => {
        // First call: cache hit
        mockCache.get.mockResolvedValueOnce({ role: 'viewer' });
        const role1 = await getUserWalletRole(walletId, userId);
        expect(role1).toBe('viewer');
        expect(prisma.walletUser.findFirst).not.toHaveBeenCalled();

        // Invalidate cache
        await invalidateWalletAccessCache(walletId);

        // Second call: cache miss, should query DB
        mockCache.get.mockResolvedValueOnce(null);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'owner')
      );

        const role2 = await getUserWalletRole(walletId, userId);
        expect(role2).toBe('owner');
        expect(prisma.walletUser.findFirst).toHaveBeenCalled();
      });

      it('should re-query DB after user cache invalidation', async () => {
        // First call: cache hit
        mockCache.get.mockResolvedValueOnce({ role: 'viewer' });
        const role1 = await getUserWalletRole(walletId, userId);
        expect(role1).toBe('viewer');
        expect(prisma.walletUser.findFirst).not.toHaveBeenCalled();

        // Invalidate user cache (simulating group membership change)
        await invalidateUserAccessCache(userId);

        // Second call: cache miss, should query DB
        mockCache.get.mockResolvedValueOnce(null);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.wallet.findFirst).mockResolvedValue({
          id: walletId,
          groupRole: 'signer',
        } as never);

        const role2 = await getUserWalletRole(walletId, userId);
        expect(role2).toBe('signer');
        expect(prisma.wallet.findFirst).toHaveBeenCalled();
      });

      it('should handle consecutive invalidations without errors', async () => {
        await invalidateWalletAccessCache(walletId);
        await invalidateWalletAccessCache(walletId);
        await invalidateUserAccessCache(userId);
        await invalidateUserAccessCache(userId);
        // Should complete without errors
      });
    });
  });
});
