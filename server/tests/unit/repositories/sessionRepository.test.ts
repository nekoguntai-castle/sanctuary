/**
 * Session Repository Tests
 *
 * Tests for session and token management operations including
 * refresh tokens, JWT revocation, and session tracking.
 */

import { vi, Mock } from 'vitest';
import crypto from 'crypto';
import { Prisma } from '../../../src/generated/prisma/client';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    refreshToken: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    revokedToken: {
      count: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import { sessionRepository } from '../../../src/repositories/sessionRepository';

// Helper to generate expected token hash
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

describe('Session Repository', () => {
  const mockRefreshToken = {
    id: 'token-123',
    userId: 'user-456',
    tokenHash: hashToken('raw-token-value'),
    expiresAt: new Date(Date.now() + 86400000), // Tomorrow
    userAgent: 'Mozilla/5.0',
    ipAddress: '192.168.1.1',
    deviceId: 'device-123',
    deviceName: 'My Browser',
    createdAt: new Date(),
    lastUsedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findRefreshToken', () => {
    it('should find token by hashing the raw value', async () => {
      (prisma.refreshToken.findUnique as Mock).mockResolvedValue(mockRefreshToken);

      const result = await sessionRepository.findRefreshToken('raw-token-value');

      expect(result).toEqual(mockRefreshToken);
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashToken('raw-token-value') },
      });
    });

    it('should return null when token not found', async () => {
      (prisma.refreshToken.findUnique as Mock).mockResolvedValue(null);

      const result = await sessionRepository.findRefreshToken('unknown-token');

      expect(result).toBeNull();
    });
  });

  describe('findRefreshTokenById', () => {
    it('should find token by database ID', async () => {
      (prisma.refreshToken.findUnique as Mock).mockResolvedValue(mockRefreshToken);

      const result = await sessionRepository.findRefreshTokenById('token-123');

      expect(result).toEqual(mockRefreshToken);
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { id: 'token-123' },
      });
    });
  });

  describe('findRefreshTokenByHash', () => {
    it('should find token by hash directly', async () => {
      const tokenHash = hashToken('some-token');
      (prisma.refreshToken.findUnique as Mock).mockResolvedValue(mockRefreshToken);

      const result = await sessionRepository.findRefreshTokenByHash(tokenHash);

      expect(result).toEqual(mockRefreshToken);
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash },
      });
    });
  });

  describe('findRefreshTokensByUserId', () => {
    it('should find all tokens for a user', async () => {
      const tokens = [mockRefreshToken, { ...mockRefreshToken, id: 'token-456' }];
      (prisma.refreshToken.findMany as Mock).mockResolvedValue(tokens);

      const result = await sessionRepository.findRefreshTokensByUserId('user-456');

      expect(result).toHaveLength(2);
      expect(prisma.refreshToken.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-456' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findActiveRefreshTokens', () => {
    it('should find only non-expired tokens', async () => {
      (prisma.refreshToken.findMany as Mock).mockResolvedValue([mockRefreshToken]);

      const result = await sessionRepository.findActiveRefreshTokens('user-456');

      expect(result).toHaveLength(1);
      expect(prisma.refreshToken.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-456',
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('countActiveSessions', () => {
    it('should count active sessions', async () => {
      (prisma.refreshToken.count as Mock).mockResolvedValue(3);

      const count = await sessionRepository.countActiveSessions('user-456');

      expect(count).toBe(3);
      expect(prisma.refreshToken.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-456',
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });
  });

  describe('createRefreshToken', () => {
    it('should create token with hashed value', async () => {
      (prisma.refreshToken.create as Mock).mockResolvedValue(mockRefreshToken);

      const input = {
        userId: 'user-456',
        token: 'new-raw-token',
        expiresAt: new Date(Date.now() + 86400000),
        userAgent: 'Mozilla/5.0',
        ipAddress: '192.168.1.1',
        deviceId: 'device-123',
        deviceName: 'My Browser',
      };

      const result = await sessionRepository.createRefreshToken(input);

      expect(result).toEqual(mockRefreshToken);
      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-456',
          tokenHash: hashToken('new-raw-token'),
          expiresAt: input.expiresAt,
          userAgent: 'Mozilla/5.0',
          ipAddress: '192.168.1.1',
          deviceId: 'device-123',
          deviceName: 'My Browser',
        },
      });
    });

    it('should handle null optional fields', async () => {
      (prisma.refreshToken.create as Mock).mockResolvedValue(mockRefreshToken);

      await sessionRepository.createRefreshToken({
        userId: 'user-456',
        token: 'token',
        expiresAt: new Date(),
      });

      expect(prisma.refreshToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userAgent: undefined,
          ipAddress: undefined,
          deviceId: undefined,
          deviceName: undefined,
        }),
      });
    });
  });

  describe('revokeRefreshToken', () => {
    it('should delete token by hash', async () => {
      (prisma.refreshToken.delete as Mock).mockResolvedValue(mockRefreshToken);

      await sessionRepository.revokeRefreshToken('raw-token-value');

      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { tokenHash: hashToken('raw-token-value') },
      });
    });

    it('should not throw if token already deleted', async () => {
      (prisma.refreshToken.delete as Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        })
      );

      await expect(sessionRepository.revokeRefreshToken('unknown')).resolves.not.toThrow();
    });

    it('should surface database errors when token revocation fails', async () => {
      (prisma.refreshToken.delete as Mock).mockRejectedValue(new Error('database unavailable'));

      await expect(sessionRepository.revokeRefreshToken('raw-token-value'))
        .rejects.toThrow('database unavailable');
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should delete all tokens for user', async () => {
      (prisma.refreshToken.deleteMany as Mock).mockResolvedValue({ count: 5 });

      const count = await sessionRepository.revokeAllUserTokens('user-456');

      expect(count).toBe(5);
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-456' },
      });
    });
  });

  describe('deleteRefreshTokenById', () => {
    it('should delete token by ID', async () => {
      (prisma.refreshToken.delete as Mock).mockResolvedValue(mockRefreshToken);

      await sessionRepository.deleteRefreshTokenById('token-123');

      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({
        where: { id: 'token-123' },
      });
    });

    it('should not throw if token already deleted', async () => {
      (prisma.refreshToken.delete as Mock).mockRejectedValue(new Error('Not found'));

      await expect(sessionRepository.deleteRefreshTokenById('unknown')).resolves.not.toThrow();
    });
  });

  describe('deleteExpiredRefreshTokens', () => {
    it('should delete expired tokens', async () => {
      (prisma.refreshToken.deleteMany as Mock).mockResolvedValue({ count: 10 });

      const count = await sessionRepository.deleteExpiredRefreshTokens();

      expect(count).toBe(10);
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });
  });

  describe('updateLastUsed', () => {
    it('should update last used timestamp', async () => {
      (prisma.refreshToken.update as Mock).mockResolvedValue(mockRefreshToken);

      await sessionRepository.updateLastUsed('raw-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { tokenHash: hashToken('raw-token') },
        data: { lastUsedAt: expect.any(Date) },
      });
    });

    it('should not throw if token not found', async () => {
      (prisma.refreshToken.update as Mock).mockRejectedValue(new Error('Not found'));

      await expect(sessionRepository.updateLastUsed('unknown')).resolves.not.toThrow();
    });
  });

  describe('isTokenRevoked', () => {
    it('should return true when token is revoked', async () => {
      (prisma.revokedToken.count as Mock).mockResolvedValue(1);

      const result = await sessionRepository.isTokenRevoked('jti-123');

      expect(result).toBe(true);
      expect(prisma.revokedToken.count).toHaveBeenCalledWith({
        where: { jti: 'jti-123' },
      });
    });

    it('should return false when token is not revoked', async () => {
      (prisma.revokedToken.count as Mock).mockResolvedValue(0);

      const result = await sessionRepository.isTokenRevoked('jti-456');

      expect(result).toBe(false);
    });
  });

  describe('revokeJwt', () => {
    it('should add JWT to revoked list', async () => {
      const revokedToken = {
        id: 'revoked-1',
        jti: 'jti-123',
        expiresAt: new Date(),
        userId: 'user-456',
        reason: 'logout',
        createdAt: new Date(),
      };
      (prisma.revokedToken.create as Mock).mockResolvedValue(revokedToken);

      const expiresAt = new Date();
      const result = await sessionRepository.revokeJwt('jti-123', expiresAt, 'user-456', 'logout');

      expect(result).toEqual(revokedToken);
      expect(prisma.revokedToken.create).toHaveBeenCalledWith({
        data: {
          jti: 'jti-123',
          expiresAt,
          userId: 'user-456',
          reason: 'logout',
        },
      });
    });
  });

  describe('cleanupExpiredRevokedTokens', () => {
    it('should clean up expired revoked tokens', async () => {
      (prisma.revokedToken.deleteMany as Mock).mockResolvedValue({ count: 25 });

      const count = await sessionRepository.cleanupExpiredRevokedTokens();

      expect(count).toBe(25);
      expect(prisma.revokedToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });
  });

  describe('getSessionsForUser', () => {
    it('should return sessions with current session marked', async () => {
      const tokens = [
        { ...mockRefreshToken, id: 'current-token' },
        { ...mockRefreshToken, id: 'other-token' },
      ];
      (prisma.refreshToken.findMany as Mock).mockResolvedValue(tokens);

      const sessions = await sessionRepository.getSessionsForUser('user-456', 'current-token');

      expect(sessions).toHaveLength(2);
      expect(sessions[0].isCurrent).toBe(true);
      expect(sessions[1].isCurrent).toBe(false);
    });

    it('should return sessions without current when not specified', async () => {
      (prisma.refreshToken.findMany as Mock).mockResolvedValue([mockRefreshToken]);

      const sessions = await sessionRepository.getSessionsForUser('user-456');

      expect(sessions[0].isCurrent).toBe(false);
    });
  });
});
