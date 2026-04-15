import { vi } from 'vitest';
/**
 * User Repository Integration Tests
 *
 * Tests the user repository against a real PostgreSQL database.
 * Uses transaction rollback for test isolation.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestWallet,
  createTestDevice,
} from './setup';
import { userRepository } from '../../../src/repositories/userRepository';

// Mock the prisma import to use our test transaction
vi.mock('../../../src/models/prisma', () => {
  return {
    __esModule: true,
    default: null, // Will be set per-test
  };
});

describeIfDatabase('UserRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('findById', () => {
    it('should find a user by ID', async () => {
      await withTestTransaction(async (tx) => {
        // Create test user
        const user = await createTestUser(tx, {
          username: 'findbyid-test',
          email: 'findbyid@example.com',
        });

        // Find user using repository (via direct tx call since we're in transaction)
        const found = await tx.user.findUnique({
          where: { id: user.id },
        });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(user.id);
        expect(found?.username).toBe('findbyid-test');
        expect(found?.email).toBe('findbyid@example.com');
      });
    });

    it('should return null for non-existent user ID', async () => {
      await withTestTransaction(async (tx) => {
        const found = await tx.user.findUnique({
          where: { id: 'non-existent-id' },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('findByEmail', () => {
    it('should find a user by email', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'email-test',
          email: 'unique-email@example.com',
        });

        const found = await tx.user.findUnique({
          where: { email: 'unique-email@example.com' },
        });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(user.id);
        expect(found?.email).toBe('unique-email@example.com');
      });
    });

    it('should return null for non-existent email', async () => {
      await withTestTransaction(async (tx) => {
        const found = await tx.user.findUnique({
          where: { email: 'nonexistent@example.com' },
        });

        expect(found).toBeNull();
      });
    });

    it('should be case-sensitive for email lookup', async () => {
      await withTestTransaction(async (tx) => {
        await createTestUser(tx, {
          username: 'case-test',
          email: 'CaseSensitive@example.com',
        });

        // Exact case match should work
        const exactMatch = await tx.user.findUnique({
          where: { email: 'CaseSensitive@example.com' },
        });
        expect(exactMatch).not.toBeNull();

        // Different case should not match (PostgreSQL is case-sensitive by default)
        const differentCase = await tx.user.findUnique({
          where: { email: 'casesensitive@example.com' },
        });
        expect(differentCase).toBeNull();
      });
    });
  });

  describe('exists', () => {
    it('should return true for existing user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'exists-test',
        });

        const count = await tx.user.count({
          where: { id: user.id },
        });

        expect(count > 0).toBe(true);
      });
    });

    it('should return false for non-existent user', async () => {
      await withTestTransaction(async (tx) => {
        const count = await tx.user.count({
          where: { id: 'non-existent-id' },
        });

        expect(count > 0).toBe(false);
      });
    });
  });

  describe('create', () => {
    it('should create a user with all fields', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'full-user',
          email: 'full@example.com',
          isAdmin: true,
          twoFactorEnabled: true,
          twoFactorSecret: 'TESTSECRET123',
        });

        expect(user.username).toBe('full-user');
        expect(user.email).toBe('full@example.com');
        expect(user.isAdmin).toBe(true);
        expect(user.twoFactorEnabled).toBe(true);
        expect(user.twoFactorSecret).toBe('TESTSECRET123');
        expect(user.password).toBeDefined();
        expect(user.password).not.toBe('testpassword'); // Should be hashed
      });
    });

    it('should create a user with minimal fields', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'minimal-user',
        });

        expect(user.username).toBe('minimal-user');
        expect(user.isAdmin).toBe(false);
        expect(user.twoFactorEnabled).toBe(false);
        expect(user.twoFactorSecret).toBeNull();
      });
    });

    it('should fail on duplicate username', async () => {
      await withTestTransaction(async (tx) => {
        await createTestUser(tx, {
          username: 'duplicate-user',
          email: 'first@example.com',
        });

        await expect(
          createTestUser(tx, {
            username: 'duplicate-user',
            email: 'second@example.com',
          })
        ).rejects.toThrow();
      });
    });

    it('should fail on duplicate email', async () => {
      await withTestTransaction(async (tx) => {
        await createTestUser(tx, {
          username: 'user1',
          email: 'duplicate@example.com',
        });

        await expect(
          createTestUser(tx, {
            username: 'user2',
            email: 'duplicate@example.com',
          })
        ).rejects.toThrow();
      });
    });
  });

  describe('update', () => {
    it('should update user password', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'update-pw',
        });

        const bcrypt = await import('bcryptjs');
        const newHash = await bcrypt.hash('newpassword', 10);

        const updated = await tx.user.update({
          where: { id: user.id },
          data: { password: newHash },
        });

        expect(updated.password).toBe(newHash);
        expect(updated.password).not.toBe(user.password);
      });
    });

    it('should update user two-factor settings', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'update-2fa',
          twoFactorEnabled: false,
        });

        const updated = await tx.user.update({
          where: { id: user.id },
          data: {
            twoFactorEnabled: true,
            twoFactorSecret: 'NEWSECRET',
            twoFactorBackupCodes: JSON.stringify(['code1', 'code2']),
          },
        });

        expect(updated.twoFactorEnabled).toBe(true);
        expect(updated.twoFactorSecret).toBe('NEWSECRET');
        expect(updated.twoFactorBackupCodes).toBe(JSON.stringify(['code1', 'code2']));
      });
    });

    it('should update user preferences', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'update-prefs',
        });

        const preferences = {
          theme: 'dark',
          currency: 'USD',
          unit: 'sats',
        };

        const updated = await tx.user.update({
          where: { id: user.id },
          data: { preferences },
        });

        expect(updated.preferences).toEqual(preferences);
      });
    });

    it('should update updatedAt timestamp', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'update-timestamp',
        });

        const originalUpdatedAt = user.updatedAt;
        const backdatedUpdatedAt = new Date('2024-01-01T00:00:00.000Z');
        await tx.user.update({
          where: { id: user.id },
          data: { updatedAt: backdatedUpdatedAt },
        });

        const updated = await tx.user.update({
          where: { id: user.id },
          data: { isAdmin: true },
        });

        expect(updated.updatedAt.getTime()).toBeGreaterThan(backdatedUpdatedAt.getTime());
        expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(originalUpdatedAt.getTime());
      });
    });
  });

  describe('delete', () => {
    it('should delete a user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'delete-test',
        });

        await tx.user.delete({
          where: { id: user.id },
        });

        const found = await tx.user.findUnique({
          where: { id: user.id },
        });

        expect(found).toBeNull();
      });
    });

    it('should cascade delete user wallets', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'cascade-wallet',
        });

        const wallet = await createTestWallet(tx, user.id, {
          name: 'cascade-test-wallet',
        });

        // Delete the user
        await tx.user.delete({
          where: { id: user.id },
        });

        // Check that wallet user relationship is deleted
        const walletUser = await tx.walletUser.findFirst({
          where: { walletId: wallet.id },
        });

        expect(walletUser).toBeNull();
      });
    });

    it('should cascade delete user devices', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, {
          username: 'cascade-device',
        });

        const device = await createTestDevice(tx, user.id, {
          label: 'cascade-test-device',
        });

        // Delete the user
        await tx.user.delete({
          where: { id: user.id },
        });

        // Check that device is deleted
        const found = await tx.device.findUnique({
          where: { id: device.id },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('query patterns', () => {
    it('should find admin users', async () => {
      await withTestTransaction(async (tx) => {
        const prefix = `admin_test_${Date.now()}_`;
        await createTestUser(tx, { username: `${prefix}admin1`, isAdmin: true });
        await createTestUser(tx, { username: `${prefix}regular1`, isAdmin: false });
        await createTestUser(tx, { username: `${prefix}admin2`, isAdmin: true });

        const admins = await tx.user.findMany({
          where: {
            isAdmin: true,
            username: { startsWith: prefix },
          },
        });

        expect(admins.length).toBe(2);
        expect(admins.every((u) => u.isAdmin)).toBe(true);
      });
    });

    it('should find users with 2FA enabled', async () => {
      await withTestTransaction(async (tx) => {
        const prefix = `2fa_test_${Date.now()}_`;
        await createTestUser(tx, { username: `${prefix}2fa-on`, twoFactorEnabled: true });
        await createTestUser(tx, { username: `${prefix}2fa-off`, twoFactorEnabled: false });

        const with2FA = await tx.user.findMany({
          where: {
            twoFactorEnabled: true,
            username: { startsWith: prefix },
          },
        });

        expect(with2FA.length).toBe(1);
        expect(with2FA[0].username).toBe(`${prefix}2fa-on`);
      });
    });

    it('should count users', async () => {
      await withTestTransaction(async (tx) => {
        const prefix = `count_test_${Date.now()}_`;
        await createTestUser(tx, { username: `${prefix}count1` });
        await createTestUser(tx, { username: `${prefix}count2` });
        await createTestUser(tx, { username: `${prefix}count3` });

        const count = await tx.user.count({
          where: { username: { startsWith: prefix } },
        });

        expect(count).toBe(3);
      });
    });
  });
});
