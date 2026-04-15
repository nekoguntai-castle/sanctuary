/**
 * Session Repository Integration Tests
 *
 * Tests the session repository against a real PostgreSQL database.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestSession,
} from './setup';
import crypto from 'crypto';

describeIfDatabase('SessionRepository Integration Tests', () => {
  setupRepositoryTests();

  // Helper to hash tokens (mimics repository behavior)
  function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  describe('createRefreshToken', () => {
    it('should create a refresh token', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);

        const session = await tx.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            userAgent: 'Test Browser',
            ipAddress: '127.0.0.1',
            deviceName: 'Test Device',
          },
        });

        expect(session.userId).toBe(user.id);
        expect(session.tokenHash).toBe(tokenHash);
        expect(session.deviceName).toBe('Test Device');
      });
    });

    it('should store device info with token', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const session = await createTestSession(tx, user.id, {
          deviceName: 'iPhone 15',
          userAgent: 'Sanctuary/1.0 iOS',
          ipAddress: '192.168.1.100',
        });

        expect(session.deviceName).toBe('iPhone 15');
        expect(session.userAgent).toBe('Sanctuary/1.0 iOS');
        expect(session.ipAddress).toBe('192.168.1.100');
      });
    });
  });

  describe('findRefreshToken', () => {
    it('should find token by hash', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);

        await tx.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });

        const found = await tx.refreshToken.findUnique({
          where: { tokenHash },
        });

        expect(found).not.toBeNull();
        expect(found?.userId).toBe(user.id);
      });
    });

    it('should return null for unknown token', async () => {
      await withTestTransaction(async (tx) => {
        const unknownHash = hashToken('unknown-token');

        const found = await tx.refreshToken.findUnique({
          where: { tokenHash: unknownHash },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('findRefreshTokensByUserId', () => {
    it('should find all tokens for a user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestSession(tx, user.id);
        await createTestSession(tx, user.id);
        await createTestSession(tx, user.id);

        const tokens = await tx.refreshToken.findMany({
          where: { userId: user.id },
        });

        expect(tokens).toHaveLength(3);
      });
    });
  });

  describe('findActiveRefreshTokens', () => {
    it('should find only non-expired tokens', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        // Active token
        await createTestSession(tx, user.id, {
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        // Expired token
        await tx.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(crypto.randomBytes(32).toString('hex')),
            expiresAt: new Date(Date.now() - 1000), // Expired
          },
        });

        const activeTokens = await tx.refreshToken.findMany({
          where: {
            userId: user.id,
            expiresAt: { gt: new Date() },
          },
        });

        expect(activeTokens).toHaveLength(1);
      });
    });
  });

  describe('countActiveSessions', () => {
    it('should count active sessions', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        // 3 active sessions
        for (let i = 0; i < 3; i++) {
          await createTestSession(tx, user.id);
        }

        // 1 expired session
        await tx.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(crypto.randomBytes(32).toString('hex')),
            expiresAt: new Date(Date.now() - 1000),
          },
        });

        const count = await tx.refreshToken.count({
          where: {
            userId: user.id,
            expiresAt: { gt: new Date() },
          },
        });

        expect(count).toBe(3);
      });
    });
  });

  describe('revokeRefreshToken', () => {
    it('should delete token by hash', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);

        await tx.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });

        await tx.refreshToken.delete({
          where: { tokenHash },
        });

        const found = await tx.refreshToken.findUnique({
          where: { tokenHash },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should delete all tokens for a user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestSession(tx, user.id);
        await createTestSession(tx, user.id);
        await createTestSession(tx, user.id);

        const result = await tx.refreshToken.deleteMany({
          where: { userId: user.id },
        });

        expect(result.count).toBe(3);

        const remaining = await tx.refreshToken.count({
          where: { userId: user.id },
        });
        expect(remaining).toBe(0);
      });
    });
  });

  describe('deleteExpiredRefreshTokens', () => {
    it('should delete expired tokens', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        // Create active token
        await createTestSession(tx, user.id);

        // Create expired tokens
        for (let i = 0; i < 3; i++) {
          await tx.refreshToken.create({
            data: {
              userId: user.id,
              tokenHash: hashToken(crypto.randomBytes(32).toString('hex')),
              expiresAt: new Date(Date.now() - 1000),
            },
          });
        }

        const result = await tx.refreshToken.deleteMany({
          where: {
            expiresAt: { lt: new Date() },
          },
        });

        expect(result.count).toBe(3);

        const remaining = await tx.refreshToken.count({
          where: { userId: user.id },
        });
        expect(remaining).toBe(1);
      });
    });
  });

  describe('updateLastUsed', () => {
    it('should update last used timestamp', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(token);
        const originalLastUsed = new Date('2024-01-01T00:00:00.000Z');
        const nextLastUsed = new Date('2024-01-01T00:00:01.000Z');

        const session = await tx.refreshToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            lastUsedAt: originalLastUsed,
          },
        });

        expect(session.lastUsedAt.getTime()).toBe(originalLastUsed.getTime());

        await tx.refreshToken.update({
          where: { tokenHash },
          data: { lastUsedAt: nextLastUsed },
        });

        const updated = await tx.refreshToken.findUnique({
          where: { tokenHash },
        });

        expect(updated?.lastUsedAt.getTime()).toBeGreaterThan(originalLastUsed.getTime());
      });
    });
  });

  describe('JWT revocation', () => {
    it('should add JWT to revoked list', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const jti = crypto.randomUUID();

        await tx.revokedToken.create({
          data: {
            jti,
            userId: user.id,
            reason: 'logout',
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
          },
        });

        const count = await tx.revokedToken.count({
          where: { jti },
        });

        expect(count).toBe(1);
      });
    });

    it('should check if token is revoked', async () => {
      await withTestTransaction(async (tx) => {
        const jti = crypto.randomUUID();

        // Not revoked yet
        let count = await tx.revokedToken.count({
          where: { jti },
        });
        expect(count).toBe(0);

        // Revoke it
        await tx.revokedToken.create({
          data: {
            jti,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });

        // Should be revoked now
        count = await tx.revokedToken.count({
          where: { jti },
        });
        expect(count).toBe(1);
      });
    });

    it('should clean up expired revocations', async () => {
      await withTestTransaction(async (tx) => {
        const testPrefix = `test_${Date.now()}_`;

        // Create expired revocations
        for (let i = 0; i < 5; i++) {
          await tx.revokedToken.create({
            data: {
              jti: `${testPrefix}expired_${i}`,
              expiresAt: new Date(Date.now() - 1000), // Expired
            },
          });
        }

        // Create valid revocation
        await tx.revokedToken.create({
          data: {
            jti: `${testPrefix}valid`,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        });

        const result = await tx.revokedToken.deleteMany({
          where: {
            jti: { startsWith: testPrefix },
            expiresAt: { lt: new Date() },
          },
        });

        expect(result.count).toBe(5);

        const remaining = await tx.revokedToken.count({
          where: { jti: { startsWith: testPrefix } },
        });
        expect(remaining).toBe(1);
      });
    });
  });

  describe('session info', () => {
    it('should get sessions with device info', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestSession(tx, user.id, {
          deviceName: 'iPhone',
          userAgent: 'iOS App',
          ipAddress: '192.168.1.1',
        });

        await createTestSession(tx, user.id, {
          deviceName: 'MacBook',
          userAgent: 'Chrome',
          ipAddress: '192.168.1.2',
        });

        const sessions = await tx.refreshToken.findMany({
          where: {
            userId: user.id,
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            deviceName: true,
            userAgent: true,
            ipAddress: true,
            createdAt: true,
            lastUsedAt: true,
            expiresAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        expect(sessions).toHaveLength(2);
        expect(sessions.map((s) => s.deviceName)).toContain('iPhone');
        expect(sessions.map((s) => s.deviceName)).toContain('MacBook');
      });
    });
  });
});
