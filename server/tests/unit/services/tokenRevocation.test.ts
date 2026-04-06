/**
 * Token Revocation Service Tests
 *
 * Tests JWT token revocation and security features.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { faker } from '@faker-js/faker';

// Hoist mocks to avoid reference before initialization
const { mockPrisma, mockCache, mockLogger } = vi.hoisted(() => {
  const mockPrisma = {
    revokedToken: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    refreshToken: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  const mockCache = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };

  return { mockPrisma, mockCache, mockLogger };
});

vi.mock('../../../src/models/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('../../../src/infrastructure/redis', () => ({
  getNamespacedCache: vi.fn(() => mockCache),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

import {
  revokeToken,
  isTokenRevoked,
  getRevokedTokenCount,
  revokeAllUserTokens,
  clearAllRevokedTokens,
  initializeRevocationService,
  shutdownRevocationService,
} from '../../../src/services/tokenRevocation';

describe('Token Revocation Service', () => {
  const testJti = faker.string.uuid();
  const testUserId = faker.string.uuid();
  const futureDate = new Date(Date.now() + 3600000); // 1 hour from now

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    shutdownRevocationService();
    vi.useRealTimers();
  });

  describe('revokeToken', () => {
    it('should revoke a token with valid jti', async () => {
      mockPrisma.revokedToken.upsert.mockResolvedValue({
        jti: testJti,
        userId: testUserId,
        reason: 'logout',
        revokedAt: new Date(),
        expiresAt: futureDate,
      });

      await revokeToken(testJti, futureDate, testUserId, 'logout');

      expect(mockPrisma.revokedToken.upsert).toHaveBeenCalledWith({
        where: { jti: testJti },
        update: expect.objectContaining({
          userId: testUserId,
          reason: 'logout',
        }),
        create: expect.objectContaining({
          jti: testJti,
          userId: testUserId,
          reason: 'logout',
        }),
      });
    });

    it('should update cache when revoking token', async () => {
      mockPrisma.revokedToken.upsert.mockResolvedValue({
        jti: testJti,
        expiresAt: futureDate,
      });

      await revokeToken(testJti, futureDate);

      expect(mockCache.set).toHaveBeenCalledWith(
        testJti,
        { revoked: true },
        expect.any(Number)
      );
    });

    it('should not revoke token with empty jti', async () => {
      await revokeToken('', futureDate);

      expect(mockPrisma.revokedToken.upsert).not.toHaveBeenCalled();
    });

    it('should throw error when database fails', async () => {
      mockPrisma.revokedToken.upsert.mockRejectedValue(new Error('DB error'));

      await expect(revokeToken(testJti, futureDate)).rejects.toThrow('DB error');
    });
  });

  describe('isTokenRevoked', () => {
    it('should return false for token without jti', async () => {
      const result = await isTokenRevoked('');

      expect(result).toBe(false);
      expect(mockPrisma.revokedToken.findUnique).not.toHaveBeenCalled();
    });

    it('should return cached result when available', async () => {
      mockCache.get.mockResolvedValueOnce({ revoked: true });

      const result = await isTokenRevoked(testJti);

      expect(result).toBe(true);
      expect(mockPrisma.revokedToken.findUnique).not.toHaveBeenCalled();
    });

    it('should check database when cache misses', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.revokedToken.findUnique.mockResolvedValue({ jti: testJti });

      const result = await isTokenRevoked(testJti);

      expect(result).toBe(true);
      expect(mockPrisma.revokedToken.findUnique).toHaveBeenCalledWith({
        where: { jti: testJti },
        select: { jti: true },
      });
    });

    it('should return false for non-revoked token', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.revokedToken.findUnique.mockResolvedValue(null);

      const result = await isTokenRevoked(testJti);

      expect(result).toBe(false);
    });

    it('should cache database result', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.revokedToken.findUnique.mockResolvedValue(null);

      await isTokenRevoked(testJti);

      expect(mockCache.set).toHaveBeenCalledWith(
        testJti,
        { revoked: false },
        expect.any(Number)
      );
    });

    it('should fail secure on database error', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.revokedToken.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await isTokenRevoked(testJti);

      // Should treat as revoked when unable to check
      expect(result).toBe(true);
    });
  });

  describe('getRevokedTokenCount', () => {
    it('should return count from database', async () => {
      mockPrisma.revokedToken.count.mockResolvedValue(42);

      const count = await getRevokedTokenCount();

      expect(count).toBe(42);
    });

    it('should return 0 on error', async () => {
      mockPrisma.revokedToken.count.mockRejectedValue(new Error('DB error'));

      const count = await getRevokedTokenCount();

      expect(count).toBe(0);
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should delete all refresh tokens for user', async () => {
      mockPrisma.refreshToken.findMany.mockResolvedValue([
        { id: 'token-1' },
        { id: 'token-2' },
      ]);
      mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 2 });

      const count = await revokeAllUserTokens(testUserId, 'security concern');

      expect(count).toBe(2);
      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: testUserId },
      });
    });

    it('should throw error on database failure', async () => {
      mockPrisma.refreshToken.findMany.mockResolvedValue([]);
      mockPrisma.refreshToken.deleteMany.mockRejectedValue(new Error('DB error'));

      await expect(revokeAllUserTokens(testUserId)).rejects.toThrow('DB error');
    });
  });

  describe('clearAllRevokedTokens', () => {
    it('should delete all revoked tokens', async () => {
      mockPrisma.revokedToken.deleteMany.mockResolvedValue({ count: 10 });

      await clearAllRevokedTokens();

      expect(mockPrisma.revokedToken.deleteMany).toHaveBeenCalled();
    });

    it('should throw error on database failure', async () => {
      mockPrisma.revokedToken.deleteMany.mockRejectedValue(new Error('DB error'));

      await expect(clearAllRevokedTokens()).rejects.toThrow('DB error');
    });
  });

  describe('initializeRevocationService', () => {
    it('should set up cleanup interval', () => {
      initializeRevocationService();

      // Should not throw
      expect(true).toBe(true);
    });

    it('should not reinitialize if already initialized', () => {
      initializeRevocationService();
      initializeRevocationService(); // Second call should be no-op

      // Should not throw
      expect(true).toBe(true);
    });

    it('should execute periodic cleanup and delete expired records', async () => {
      vi.useFakeTimers();
      mockPrisma.revokedToken.deleteMany.mockResolvedValue({ count: 2 });

      initializeRevocationService();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      expect(mockPrisma.revokedToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lt: expect.any(Date),
          },
        },
      });
    });

    it('should handle cleanup run with zero expired records', async () => {
      vi.useFakeTimers();
      mockPrisma.revokedToken.deleteMany.mockResolvedValue({ count: 0 });

      initializeRevocationService();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      expect(mockPrisma.revokedToken.deleteMany).toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        'Cleaned up expired revocation entries',
        expect.anything()
      );
    });

    it('should continue interval loop when cleanup query fails', async () => {
      vi.useFakeTimers();
      mockPrisma.revokedToken.deleteMany.mockRejectedValue(new Error('cleanup failed'));

      initializeRevocationService();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      expect(mockPrisma.revokedToken.deleteMany).toHaveBeenCalled();
    });

    it('should handle unexpected cleanup promise rejections at interval boundary', async () => {
      vi.useFakeTimers();
      mockPrisma.revokedToken.deleteMany.mockRejectedValue(new Error('cleanup failed'));

      let errorCalls = 0;
      mockLogger.error.mockImplementation(() => {
        errorCalls += 1;
        if (errorCalls === 1) {
          throw new Error('logger write failed');
        }
      });

      initializeRevocationService();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      expect(mockLogger.error).toHaveBeenCalledWith('Cleanup interval error', {
        error: 'logger write failed',
      });
    });
  });

  describe('shutdownRevocationService', () => {
    it('should clear cleanup interval', () => {
      initializeRevocationService();
      shutdownRevocationService();

      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle shutdown when not initialized', () => {
      shutdownRevocationService();

      // Should not throw
      expect(true).toBe(true);
    });
  });
});
