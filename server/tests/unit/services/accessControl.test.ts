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
    it('does not restore a former owner grant after transfer invalidates an in-flight lookup', async () => {
      let releaseOldRead!: (value: WalletUser) => void;
      const oldRead = new Promise<WalletUser>((resolve) => {
        releaseOldRead = resolve;
      });
      let cachedRole: { role: string } | null = null;
      mockCache.get.mockImplementation(async () => cachedRole);
      mockCache.set.mockImplementation(async (_key, value) => {
        cachedRole = value;
      });
      mockCache.deletePattern.mockImplementation(async () => {
        cachedRole = null;
      });
      vi.mocked(prisma.walletUser.findFirst)
        .mockImplementationOnce(() => oldRead as never)
        .mockResolvedValue(makeWalletUser(walletId, userId, 'viewer'));

      const inFlightLookup = getUserWalletRole(walletId, userId);
      await vi.waitFor(() => expect(prisma.walletUser.findFirst).toHaveBeenCalledTimes(1));

      // The transfer commits the downgrade while the old lookup is in flight.
      cachedRole = null; // Transfer invalidated the old grant before this read completed.
      releaseOldRead(makeWalletUser(walletId, userId, 'owner'));
      await expect(inFlightLookup).resolves.toBe('owner');

      // A new owner-only request must see the durable viewer role.
      await expect(checkWalletOwnerAccess(walletId, userId)).resolves.toBe(false);
    });

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

    it('ignores a stale cached owner role after a durable downgrade', async () => {
      mockCache.get.mockResolvedValue({ role: 'owner' });
      vi.mocked(prisma.walletUser.findFirst).mockResolvedValue(
        makeWalletUser(walletId, userId, 'viewer'),
      );

      await expect(checkWalletOwnerAccess(walletId, userId)).resolves.toBe(false);
      expect(mockCache.get).not.toHaveBeenCalled();
    });

    it('propagates repository failures instead of granting cached access', async () => {
      mockCache.get.mockResolvedValue({ role: 'owner' });
      vi.mocked(prisma.walletUser.findFirst).mockRejectedValue(new Error('database unavailable'));

      await expect(getUserWalletRole(walletId, userId)).rejects.toThrow('database unavailable');
      expect(mockCache.get).not.toHaveBeenCalled();
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

});
