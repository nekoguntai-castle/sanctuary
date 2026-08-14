/**
 * User Repository Tests
 *
 * Tests for user data access layer operations.
 */

import { vi, Mock } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: vi.fn(),
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    refreshToken: {
      deleteMany: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { userRepository } from '../../../src/repositories/userRepository';
import { passwordSecurityRepository } from '../../../src/repositories/passwordSecurityRepository';

describe('User Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        password: 'hashed-password',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.findUnique as Mock).mockResolvedValue(mockUser);

      const result = await userRepository.findById('user-123');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
    });

    it('should return null when user not found', async () => {
      (prisma.user.findUnique as Mock).mockResolvedValue(null);

      const result = await userRepository.findById('non-existent');

      expect(result).toBeNull();
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'non-existent' },
      });
    });

    it('should propagate database errors', async () => {
      (prisma.user.findUnique as Mock).mockRejectedValue(new Error('Database connection failed'));

      await expect(userRepository.findById('user-123')).rejects.toThrow('Database connection failed');
    });
  });

  describe('findByEmail', () => {
    it('should return user when found by email', async () => {
      const mockUser = {
        id: 'user-456',
        email: 'found@example.com',
        username: 'founduser',
        password: 'hashed-password',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.findUnique as Mock).mockResolvedValue(mockUser);

      const result = await userRepository.findByEmail('found@example.com');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'found@example.com' },
      });
    });

    it('should return null when email not found', async () => {
      (prisma.user.findUnique as Mock).mockResolvedValue(null);

      const result = await userRepository.findByEmail('notfound@example.com');

      expect(result).toBeNull();
    });

    it('should canonicalize mixed-case email lookup', async () => {
      (prisma.user.findUnique as Mock).mockResolvedValue(null);

      await userRepository.findByEmail('Test@Example.com');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
    });
  });

  describe('exists', () => {
    it('should return true when user exists', async () => {
      (prisma.user.count as Mock).mockResolvedValue(1);

      const result = await userRepository.exists('user-123');

      expect(result).toBe(true);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
    });

    it('should return false when user does not exist', async () => {
      (prisma.user.count as Mock).mockResolvedValue(0);

      const result = await userRepository.exists('non-existent');

      expect(result).toBe(false);
    });

    it('should handle database errors', async () => {
      (prisma.user.count as Mock).mockRejectedValue(new Error('Database error'));

      await expect(userRepository.exists('user-123')).rejects.toThrow('Database error');
    });
  });

  describe('selected mutations', () => {
    it('updates a user with the requested projection', async () => {
      const selectedUser = { id: 'user-123', username: 'renamed' };
      (prisma.user.update as Mock).mockResolvedValue(selectedUser);

      await expect(userRepository.updateWithSelect(
        'user-123',
        { username: 'renamed' },
        { id: true, username: true },
      )).resolves.toEqual(selectedUser);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { username: 'renamed' },
        select: { id: true, username: true },
      });
    });

    it('deletes a user by id and resolves without exposing the database result', async () => {
      (prisma.user.delete as Mock).mockResolvedValue({ id: 'user-123' });

      await expect(userRepository.deleteById('user-123')).resolves.toBeUndefined();

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
    });
  });

  describe('updateEmailVerification', () => {
    it('should set emailVerified to true with timestamp', async () => {
      const mockUpdatedUser = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.update as Mock).mockResolvedValue(mockUpdatedUser);

      const result = await userRepository.updateEmailVerification('user-123', true);

      expect(result).toEqual(mockUpdatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          emailVerified: true,
          emailVerifiedAt: expect.any(Date),
        },
      });
    });

    it('should set emailVerified to false with null timestamp', async () => {
      const mockUpdatedUser = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        emailVerified: false,
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.update as Mock).mockResolvedValue(mockUpdatedUser);

      const result = await userRepository.updateEmailVerification('user-123', false);

      expect(result).toEqual(mockUpdatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          emailVerified: false,
          emailVerifiedAt: null,
        },
      });
    });

    it('should propagate database errors', async () => {
      (prisma.user.update as Mock).mockRejectedValue(new Error('Update failed'));

      await expect(userRepository.updateEmailVerification('user-123', true))
        .rejects.toThrow('Update failed');
    });
  });

  describe('updateEmail', () => {
    it('should update email and reset verification status', async () => {
      const mockUpdatedUser = {
        id: 'user-123',
        email: 'new@example.com',
        username: 'testuser',
        emailVerified: false,
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.user.update as Mock).mockResolvedValue(mockUpdatedUser);

      const result = await userRepository.updateEmail('user-123', 'new@example.com');

      expect(result).toEqual(mockUpdatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          email: 'new@example.com',
          emailVerified: false,
          emailVerifiedAt: null,
        },
      });
    });

    it('should canonicalize mixed-case email before updating', async () => {
      (prisma.user.update as Mock).mockResolvedValue({
        id: 'user-123',
        email: 'new@example.com',
        emailVerified: false,
      });

      await userRepository.updateEmail('user-123', 'New@Example.COM');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          email: 'new@example.com',
          emailVerified: false,
          emailVerifiedAt: null,
        },
      });
    });

    it('should propagate database errors', async () => {
      (prisma.user.update as Mock).mockRejectedValue(new Error('Email update failed'));

      await expect(userRepository.updateEmail('user-123', 'new@example.com'))
        .rejects.toThrow('Email update failed');
    });
  });

  describe('emailExists', () => {
    it('should return true when email exists', async () => {
      (prisma.user.count as Mock).mockResolvedValue(1);

      const result = await userRepository.emailExists('existing@example.com');

      expect(result).toBe(true);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { email: 'existing@example.com' },
      });
    });

    it('should return false when email does not exist', async () => {
      (prisma.user.count as Mock).mockResolvedValue(0);

      const result = await userRepository.emailExists('new@example.com');

      expect(result).toBe(false);
    });

    it('should canonicalize mixed-case email before counting', async () => {
      (prisma.user.count as Mock).mockResolvedValue(1);

      const result = await userRepository.emailExists('Existing@Example.COM');

      expect(result).toBe(true);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { email: 'existing@example.com' },
      });
    });

    it('should handle database errors', async () => {
      (prisma.user.count as Mock).mockRejectedValue(new Error('Database error'));

      await expect(userRepository.emailExists('test@example.com'))
        .rejects.toThrow('Database error');
    });
  });

  describe('update2FA', () => {
    it('should enable 2FA with secret', async () => {
      const updatedUser = { id: 'user-123', twoFactorEnabled: true, twoFactorSecret: 'secret' };
      (prisma.user.update as Mock).mockResolvedValue(updatedUser);

      const result = await userRepository.update2FA('user-123', {
        twoFactorEnabled: true,
        twoFactorSecret: 'secret',
      });

      expect(result).toEqual(updatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { twoFactorEnabled: true, twoFactorSecret: 'secret' },
      });
    });

    it('should disable 2FA and clear secret', async () => {
      const updatedUser = { id: 'user-123', twoFactorEnabled: false, twoFactorSecret: null };
      (prisma.user.update as Mock).mockResolvedValue(updatedUser);

      const result = await userRepository.update2FA('user-123', {
        twoFactorEnabled: false,
        twoFactorSecret: null,
      });

      expect(result).toEqual(updatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
      });
    });
  });

  describe('findAllWithWalletAssociations', () => {
    it('should return users with wallet associations', async () => {
      const users = [
        {
          id: 'u1',
          preferences: {},
          wallets: [{ wallet: { id: 'w1', name: 'Wallet 1' } }],
        },
      ];
      (prisma.user.findMany as Mock).mockResolvedValue(users);

      const result = await userRepository.findAllWithWalletAssociations();

      expect(result).toEqual(users);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        select: {
          id: true,
          preferences: true,
          wallets: {
            select: {
              wallet: { select: { id: true, name: true } },
            },
          },
          groupMemberships: {
            select: {
              group: {
                select: {
                  wallets: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      });
    });
  });

  describe('updatePreferencesAtomically', () => {
    const p2034 = () => new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const wrappedP2010 = () => new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } },
    });

    function mockTransactionWithPreferences(preferences: unknown) {
      const tx = {
        user: {
          findUnique: vi.fn().mockResolvedValue({ preferences }),
          update: vi.fn().mockImplementation(async ({ data }) => ({
            id: 'u1',
            preferences: data.preferences,
          })),
        },
      };
      (prisma.$transaction as Mock).mockImplementation(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      );
      return tx;
    }

    it.each([
      ['P2034', p2034],
      ['wrapped P2010', wrappedP2010],
    ])('retries %s against a fresh preference document', async (_label, conflictFactory) => {
      const tx = mockTransactionWithPreferences({ theme: 'dark' });
      (prisma.$transaction as Mock)
        .mockImplementationOnce(async (callback: (client: typeof tx) => Promise<unknown>) => {
          await callback(tx);
          throw conflictFactory();
        })
        .mockImplementationOnce(async (callback: (client: typeof tx) => Promise<unknown>) => {
          tx.user.findUnique.mockResolvedValueOnce({ preferences: { theme: 'dark', telegram: { enabled: true } } });
          return callback(tx);
        });

      const updater = vi.fn((current: any) => ({
        preferences: { ...current, intelligence: { enabled: true } },
        result: 'committed',
      }));
      const result = await userRepository.updatePreferencesAtomically('u1', updater);

      expect(result.result).toBe('committed');
      expect(updater).toHaveBeenCalledTimes(2);
      expect(tx.user.update).toHaveBeenLastCalledWith(expect.objectContaining({
        data: {
          preferences: {
            theme: 'dark',
            telegram: { enabled: true },
            intelligence: { enabled: true },
          },
        },
      }));
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(prisma.$transaction).toHaveBeenLastCalledWith(
        expect.any(Function),
        { isolationLevel: 'Serializable' },
      );
    });

    it('maps bounded conflict exhaustion to the normal 409 conflict error', async () => {
      (prisma.$transaction as Mock).mockRejectedValue(p2034());

      await expect(userRepository.updatePreferencesAtomically('u1', () => ({
        preferences: {},
        result: undefined,
      }))).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('propagates non-conflict failures without retrying', async () => {
      const failure = new Prisma.PrismaClientKnownRequestError('unique conflict', {
        code: 'P2002',
        clientVersion: 'test',
      });
      (prisma.$transaction as Mock).mockRejectedValueOnce(failure);

      await expect(userRepository.updatePreferencesAtomically('u1', () => ({
        preferences: {},
        result: undefined,
      }))).rejects.toBe(failure);
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it.each([
      ['ordinary error', new Error('database unavailable')],
      ['unclassified P2010', new Prisma.PrismaClientKnownRequestError('raw query failed', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { driverAdapterError: { cause: { kind: 'Other' } } },
      })],
    ])('does not retry an %s', async (_label, failure) => {
      (prisma.$transaction as Mock).mockRejectedValueOnce(failure);

      await expect(userRepository.updatePreferencesAtomically('u1', () => ({
        preferences: {},
        result: undefined,
      }))).rejects.toBe(failure);
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it('preserves two concurrent cross-namespace updates after one transaction retries', async () => {
      let stored: Record<string, unknown> = { theme: 'dark' };
      let version = 0;
      (prisma.$transaction as Mock).mockImplementation(async (
        callback: (client: any) => Promise<unknown>,
      ) => {
        const startVersion = version;
        let pending = stored;
        const tx = {
          user: {
            findUnique: vi.fn().mockResolvedValue({ preferences: { ...stored } }),
            update: vi.fn().mockImplementation(async ({ data }) => {
              pending = data.preferences;
              return { id: 'u1', preferences: pending };
            }),
          },
        };
        const result = await callback(tx);
        if (startVersion !== version) throw p2034();
        stored = pending;
        version += 1;
        return result;
      });

      const intelligence = userRepository.updatePreferencesAtomically('u1', (current: any) => ({
        preferences: { ...current, intelligence: { enabled: true } },
        result: 'intelligence',
      }));
      const telegram = userRepository.updatePreferencesAtomically('u1', (current: any) => ({
        preferences: { ...current, telegram: { enabled: true } },
        result: 'telegram',
      }));

      await expect(Promise.all([intelligence, telegram])).resolves.toEqual([
        expect.objectContaining({ result: 'intelligence' }),
        expect.objectContaining({ result: 'telegram' }),
      ]);
      expect(stored).toEqual({
        theme: 'dark',
        intelligence: { enabled: true },
        telegram: { enabled: true },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    });

    it('does not call the updater when the user no longer exists', async () => {
      const tx = mockTransactionWithPreferences(null);
      tx.user.findUnique.mockResolvedValueOnce(null);
      const updater = vi.fn();

      await expect(userRepository.updatePreferencesAtomically('missing', updater))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(updater).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });

  describe('findByWalletAccess', () => {
    it('returns each user through direct or group-derived wallet access', async () => {
      const users = [{ id: 'direct' }, { id: 'group' }];
      (prisma.user.findMany as Mock).mockResolvedValueOnce(users);

      await expect(userRepository.findByWalletAccess('wallet-1')).resolves.toEqual(users);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { wallets: { some: { walletId: 'wallet-1' } } },
            {
              groupMemberships: {
                some: {
                  group: { wallets: { some: { id: 'wallet-1' } } },
                },
              },
            },
          ],
        },
        select: {
          id: true,
          username: true,
          preferences: true,
        },
      });
    });
  });

  describe('findWithAutopilotPreferences', () => {
    it('should return users with autopilot preferences', async () => {
      const users = [
        {
          id: 'u1',
          preferences: { autopilot: { enabled: true } },
          wallets: [],
          groupMemberships: [],
        },
      ];
      (prisma.user.findMany as Mock).mockResolvedValue(users);

      const result = await userRepository.findWithAutopilotPreferences();

      expect(result).toEqual(users);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          preferences: {
            path: ['autopilot'],
            not: expect.anything(),
          },
        },
        select: expect.objectContaining({
          id: true,
          preferences: true,
          wallets: expect.any(Object),
          groupMemberships: expect.any(Object),
        }),
      });
    });
  });

  describe('findAllWithSelect', () => {
    it('should find all users with custom select', async () => {
      const users = [{ id: 'u1', username: 'alice' }];
      (prisma.user.findMany as Mock).mockResolvedValue(users);

      const result = await userRepository.findAllWithSelect({ id: true, username: true });

      expect(result).toEqual(users);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: undefined,
        select: { id: true, username: true },
      });
    });

    it('should apply where filter when provided', async () => {
      (prisma.user.findMany as Mock).mockResolvedValue([]);

      await userRepository.findAllWithSelect(
        { id: true },
        { isAdmin: true }
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { isAdmin: true },
        select: { id: true },
      });
    });
  });

  describe('consumeBackupCodesIfUnchanged', () => {
    it('should update backup codes only when the previous JSON and enabled state match', async () => {
      (prisma.user.updateMany as Mock).mockResolvedValue({ count: 1 });

      const result = await userRepository.consumeBackupCodesIfUnchanged(
        'user-123',
        '[{"hash":"old","used":false}]',
        '[{"hash":"old","used":true}]',
      );

      expect(result).toBe(true);
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'user-123',
          twoFactorEnabled: true,
          twoFactorSecret: { not: null },
          twoFactorBackupCodes: '[{"hash":"old","used":false}]',
        },
        data: {
          twoFactorBackupCodes: '[{"hash":"old","used":true}]',
        },
      });
    });

    it('should return false when a concurrent request already changed the backup codes', async () => {
      (prisma.user.updateMany as Mock).mockResolvedValue({ count: 0 });

      await expect(userRepository.consumeBackupCodesIfUnchanged(
        'user-123',
        '[{"hash":"old","used":false}]',
        '[{"hash":"old","used":true}]',
      )).resolves.toBe(false);
    });
  });

  describe('changePasswordAndRevokeSessions', () => {
    function installTransaction(options: {
      updateCount?: number;
      sessionVersion?: number | null;
      revokedTokenCount?: number;
      deletionError?: Error;
    } = {}) {
      const tx = {
        user: {
          updateMany: vi.fn().mockResolvedValue({ count: options.updateCount ?? 1 }),
          findUnique: vi.fn().mockResolvedValue(
            options.sessionVersion === null
              ? null
              : { sessionVersion: options.sessionVersion ?? 5 },
          ),
        },
        refreshToken: {
          deleteMany: options.deletionError
            ? vi.fn().mockRejectedValue(options.deletionError)
            : vi.fn().mockResolvedValue({ count: options.revokedTokenCount ?? 3 }),
        },
      };
      (prisma.$transaction as Mock).mockImplementation(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      );
      return tx;
    }

    it('uses one transaction for the password CAS, version advance, and refresh deletion', async () => {
      const tx = installTransaction({ sessionVersion: 9, revokedTokenCount: 4 });

      await expect(passwordSecurityRepository.changePasswordAndRevokeSessions(
        'user-123',
        'verified-old-hash',
        'new-hash',
      )).resolves.toEqual({
        sessionVersion: 9,
        revokedRefreshTokenCount: 4,
      });

      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-123', password: 'verified-old-hash' },
        data: {
          password: 'new-hash',
          sessionVersion: { increment: 1 },
        },
      });
      expect(tx.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        select: { sessionVersion: true },
      });
      expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
      expect(tx.user.updateMany).toHaveBeenCalledBefore(tx.refreshToken.deleteMany);
      expect(prisma.$transaction).toHaveBeenCalledOnce();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    });

    it('rejects refresh deletion failure from the atomic transaction', async () => {
      const failure = new Error('refresh delete failed');
      const tx = installTransaction({ deletionError: failure });

      await expect(passwordSecurityRepository.changePasswordAndRevokeSessions(
        'user-123',
        'verified-old-hash',
        'new-hash',
      )).rejects.toBe(failure);

      expect(tx.user.updateMany).toHaveBeenCalledOnce();
      expect(tx.refreshToken.deleteMany).toHaveBeenCalledOnce();
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it('rejects a stale hash before reading session state or deleting tokens', async () => {
      const tx = installTransaction({ updateCount: 0 });

      await expect(passwordSecurityRepository.changePasswordAndRevokeSessions(
        'user-123',
        'stale-hash',
        'new-hash',
      )).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });

      expect(tx.user.findUnique).not.toHaveBeenCalled();
      expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
    });

    it('fails closed if the conditionally updated user cannot be reread', async () => {
      const tx = installTransaction({ sessionVersion: null });

      await expect(passwordSecurityRepository.changePasswordAndRevokeSessions(
        'user-123',
        'verified-old-hash',
        'new-hash',
      )).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });

      expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
    });

    it('allows only one concurrent compare-and-swap against the same old hash', async () => {
      let storedPassword = 'verified-old-hash';
      let sessionVersion = 11;
      let refreshTokenCount = 6;
      let transactionCount = 0;
      let releaseTransactions!: () => void;
      const bothTransactionsStarted = new Promise<void>((resolve) => {
        releaseTransactions = resolve;
      });

      (prisma.$transaction as Mock).mockImplementation(async (
        callback: (client: any) => Promise<unknown>,
      ) => {
        transactionCount += 1;
        if (transactionCount === 2) releaseTransactions();
        await bothTransactionsStarted;
        const tx = {
          user: {
            updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
              if (where.password !== storedPassword) return { count: 0 };
              storedPassword = data.password;
              sessionVersion += 1;
              return { count: 1 };
            }),
            findUnique: vi.fn().mockImplementation(async () => ({ sessionVersion })),
          },
          refreshToken: {
            deleteMany: vi.fn().mockImplementation(async () => {
              const count = refreshTokenCount;
              refreshTokenCount = 0;
              return { count };
            }),
          },
        };
        return callback(tx);
      });

      const results = await Promise.allSettled([
        passwordSecurityRepository.changePasswordAndRevokeSessions(
          'user-123', 'verified-old-hash', 'first-new-hash',
        ),
        passwordSecurityRepository.changePasswordAndRevokeSessions(
          'user-123', 'verified-old-hash', 'second-new-hash',
        ),
      ]);

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(sessionVersion).toBe(12);
      expect(refreshTokenCount).toBe(0);
      expect(['first-new-hash', 'second-new-hash']).toContain(storedPassword);
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });
});
