/**
 * Refresh Token Service Tests
 *
 * Tests refresh token creation, verification, rotation, and session management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

// Hoist mocks to avoid reference before initialization
const { mockSessionRepository, mockPublishRevokedToken, mockDisconnectWebSocketAccessToken } = vi.hoisted(() => {
  const mockSessionRepository = {
    createRefreshToken: vi.fn(),
    consumeAndReplaceRefreshToken: vi.fn(),
    revokeSessionById: vi.fn(),
    revokeLogoutCredentials: vi.fn(),
    findRefreshToken: vi.fn(),
    findRefreshTokenById: vi.fn(),
    findRefreshTokenByHash: vi.fn(),
    revokeRefreshToken: vi.fn(),
    revokeAllUserTokens: vi.fn(),
    updateLastUsed: vi.fn(),
    getSessionsForUser: vi.fn(),
    deleteExpiredRefreshTokens: vi.fn(),
    countActiveSessions: vi.fn(),
  };
  return {
    mockSessionRepository,
    mockPublishRevokedToken: vi.fn(),
    mockDisconnectWebSocketAccessToken: vi.fn(),
  };
});

vi.mock('../../../src/repositories', () => ({
  sessionRepository: mockSessionRepository,
}));

vi.mock('../../../src/services/tokenRevocation', () => ({
  publishRevokedToken: mockPublishRevokedToken,
}));

vi.mock('../../../src/services/websocketAuthorizationInvalidation', () => ({
  disconnectWebSocketAccessToken: mockDisconnectWebSocketAccessToken,
}));

// Mock JWT utilities
vi.mock('../../../src/utils/jwt', () => ({
  generateRefreshToken: vi.fn((userId: string) => `refresh-token-for-${userId}`),
  decodeToken: vi.fn(() => ({
    exp: Math.floor(Date.now() / 1000) + 604800, // 7 days
    userId: 'test-user',
    sessionFamilyId: 'session-family-123',
  })),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  createRefreshToken,
  verifyRefreshTokenExists,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeSession,
  revokeLogoutCredentials,
  revokeAllUserRefreshTokens,
  getUserSessions,
  cleanupExpiredRefreshTokens,
  getActiveSessionCount,
  DeviceInfo,
} from '../../../src/services/refreshTokenService';

describe('Refresh Token Service', () => {
  const testUserId = faker.string.uuid();
  const testToken = `refresh-token-for-${testUserId}`;
  const testSessionId = faker.string.uuid();
  const accessToken = {
    jti: 'access-jti',
    expiresAt: new Date(Date.now() + 3600000),
  };

  const testDeviceInfo: DeviceInfo = {
    deviceId: faker.string.uuid(),
    deviceName: 'Test iPhone',
    userAgent: 'Mozilla/5.0 (iPhone)',
    ipAddress: faker.internet.ip(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDisconnectWebSocketAccessToken.mockResolvedValue(undefined);
  });

  describe('createRefreshToken', () => {
    it('should create and store a refresh token', async () => {
      mockSessionRepository.createRefreshToken.mockResolvedValue({
        id: testSessionId,
        userId: testUserId,
        tokenHash: 'hashed-token',
      });

      const token = await createRefreshToken(testUserId, testDeviceInfo, 0, accessToken);

      expect(token).toBe(testToken);
      const jwt = await import('../../../src/utils/jwt');
      expect(jwt.generateRefreshToken).toHaveBeenCalledWith(testUserId, 0, expect.any(String));
      expect(mockSessionRepository.createRefreshToken).toHaveBeenCalledWith({
        userId: testUserId,
        token: testToken,
        expiresAt: expect.any(Date),
        accessTokenJti: accessToken.jti,
        accessTokenExpiresAt: accessToken.expiresAt,
        sessionFamilyId: expect.any(String),
        deviceId: testDeviceInfo.deviceId,
        deviceName: testDeviceInfo.deviceName,
        userAgent: testDeviceInfo.userAgent,
        ipAddress: testDeviceInfo.ipAddress,
      });
    });

    it('should create token without device info', async () => {
      mockSessionRepository.createRefreshToken.mockResolvedValue({
        id: testSessionId,
        userId: testUserId,
      });

      const token = await createRefreshToken(testUserId, undefined, 0, accessToken);

      expect(token).toBe(testToken);
      expect(mockSessionRepository.createRefreshToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          deviceId: undefined,
          deviceName: undefined,
        })
      );
    });

    it('defaults an omitted session version to zero', async () => {
      mockSessionRepository.createRefreshToken.mockResolvedValue({
        id: testSessionId,
        userId: testUserId,
      });

      await createRefreshToken(testUserId, undefined, undefined, accessToken);

      const jwt = await import('../../../src/utils/jwt');
      expect(jwt.generateRefreshToken).toHaveBeenCalledWith(testUserId, 0, expect.any(String));
    });

    it('should include the supplied session version in the refresh JWT', async () => {
      mockSessionRepository.createRefreshToken.mockResolvedValue({
        id: testSessionId,
        userId: testUserId,
      });

      await createRefreshToken(testUserId, undefined, 9, accessToken);

      const jwt = await import('../../../src/utils/jwt');
      expect(jwt.generateRefreshToken).toHaveBeenCalledWith(testUserId, 9, expect.any(String));
    });

    it('should throw error on repository failure', async () => {
      mockSessionRepository.createRefreshToken.mockRejectedValue(new Error('DB error'));

      await expect(createRefreshToken(testUserId, undefined, 0, accessToken)).rejects.toThrow('DB error');
    });

    it('should reject a generated refresh token with no exp claim', async () => {
      const jwt = await import('../../../src/utils/jwt');
      (jwt.decodeToken as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
      mockSessionRepository.createRefreshToken.mockResolvedValue({ id: testSessionId, userId: testUserId });

      await expect(createRefreshToken(testUserId, undefined, 0, accessToken))
        .rejects.toThrow('Generated refresh token is missing expiry');
      expect(mockSessionRepository.createRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('verifyRefreshTokenExists', () => {
    it('should return true for valid non-expired token', async () => {
      mockSessionRepository.findRefreshToken.mockResolvedValue({
        id: testSessionId,
        userId: testUserId,
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      });
      mockSessionRepository.updateLastUsed.mockResolvedValue(undefined);

      const result = await verifyRefreshTokenExists(testToken);

      expect(result).toBe(true);
      expect(mockSessionRepository.updateLastUsed).toHaveBeenCalledWith(testToken);
    });

    it('should return false for non-existent token', async () => {
      mockSessionRepository.findRefreshToken.mockResolvedValue(null);

      const result = await verifyRefreshTokenExists(testToken);

      expect(result).toBe(false);
    });

    it('should return false and revoke expired token', async () => {
      mockSessionRepository.findRefreshToken.mockResolvedValue({
        id: testSessionId,
        userId: testUserId,
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago (expired)
      });
      mockSessionRepository.revokeRefreshToken.mockResolvedValue(undefined);

      const result = await verifyRefreshTokenExists(testToken);

      expect(result).toBe(false);
      expect(mockSessionRepository.revokeRefreshToken).toHaveBeenCalledWith(testToken);
    });

    it('should throw on repository lookup error', async () => {
      mockSessionRepository.findRefreshToken.mockRejectedValue(new Error('DB error'));

      await expect(verifyRefreshTokenExists(testToken)).rejects.toThrow('DB error');
    });

    it('should throw when last-used persistence fails', async () => {
      mockSessionRepository.findRefreshToken.mockResolvedValue({
        id: testSessionId,
        userId: testUserId,
        expiresAt: new Date(Date.now() + 3600000),
      });
      mockSessionRepository.updateLastUsed.mockRejectedValue(new Error('last-used failed'));

      await expect(verifyRefreshTokenExists(testToken)).rejects.toThrow('last-used failed');
    });
  });

  describe('rotateRefreshToken', () => {
    it('should rotate token and return new token', async () => {
      const oldToken = 'old-refresh-token';
      const rotatedToken = 'refresh-token-for-test-user';
      mockSessionRepository.consumeAndReplaceRefreshToken.mockResolvedValue({
        status: 'rotated',
        replacement: { id: faker.string.uuid(), userId: testUserId },
        revokedAccessToken: accessToken,
      });

      const newToken = await rotateRefreshToken(oldToken, testDeviceInfo, undefined, undefined, accessToken);

      expect(newToken).toEqual({ status: 'rotated', refreshToken: rotatedToken });
      expect(mockSessionRepository.consumeAndReplaceRefreshToken).toHaveBeenCalledWith({
        oldToken,
        expectedUserId: 'test-user',
        newToken: rotatedToken,
        expiresAt: expect.any(Date),
        accessTokenJti: accessToken.jti,
        accessTokenExpiresAt: accessToken.expiresAt,
        sessionFamilyId: 'session-family-123',
        deviceId: testDeviceInfo.deviceId,
        deviceName: testDeviceInfo.deviceName,
        userAgent: testDeviceInfo.userAgent,
        ipAddress: testDeviceInfo.ipAddress,
      });
      expect(mockSessionRepository.revokeRefreshToken).not.toHaveBeenCalled();
      expect(mockSessionRepository.createRefreshToken).not.toHaveBeenCalled();
      expect(mockPublishRevokedToken).toHaveBeenCalledWith(accessToken.jti, accessToken.expiresAt);
      expect(mockDisconnectWebSocketAccessToken).toHaveBeenCalledWith(accessToken.jti);
    });

    it('should carry the current session version into rotated refresh tokens', async () => {
      const oldToken = 'old-refresh-token-versioned';
      mockSessionRepository.consumeAndReplaceRefreshToken.mockResolvedValue({
        status: 'rotated',
        replacement: { id: faker.string.uuid(), userId: testUserId },
        revokedAccessToken: accessToken,
      });

      await rotateRefreshToken(oldToken, undefined, 12, undefined, accessToken);

      const jwt = await import('../../../src/utils/jwt');
      expect(jwt.generateRefreshToken).toHaveBeenLastCalledWith(
        'test-user',
        12,
        'session-family-123'
      );
    });

    it('should return terminal for a non-existent token family', async () => {
      mockSessionRepository.consumeAndReplaceRefreshToken.mockResolvedValue({ status: 'terminal' });

      const result = await rotateRefreshToken('non-existent-token', undefined, undefined, undefined, accessToken);

      expect(result).toEqual({ status: 'terminal' });
    });

    it('should return null without touching storage when the old token has no user id', async () => {
      const jwt = await import('../../../src/utils/jwt');
      vi.mocked(jwt.decodeToken).mockReturnValueOnce(null);

      const result = await rotateRefreshToken(
        'malformed-refresh-token',
        undefined,
        undefined,
        undefined,
        accessToken
      );

      expect(result).toEqual({ status: 'terminal' });
      expect(mockSessionRepository.consumeAndReplaceRefreshToken).not.toHaveBeenCalled();
    });

    it('should return terminal without touching storage when the old token has no session family', async () => {
      const jwt = await import('../../../src/utils/jwt');
      vi.mocked(jwt.decodeToken).mockReturnValueOnce({ userId: 'test-user' });

      const result = await rotateRefreshToken(
        'legacy-refresh-token',
        undefined,
        undefined,
        undefined,
        accessToken
      );

      expect(result).toEqual({ status: 'terminal' });
      expect(mockSessionRepository.consumeAndReplaceRefreshToken).not.toHaveBeenCalled();
    });

    it('should throw on repository error', async () => {
      mockSessionRepository.consumeAndReplaceRefreshToken.mockRejectedValue(new Error('DB error'));

      await expect(rotateRefreshToken(testToken, undefined, undefined, undefined, accessToken)).rejects.toThrow('DB error');
    });

    it('should pass no device override so the repository can reuse stored metadata', async () => {
      const oldToken = 'old-refresh-token-no-device-override';
      mockSessionRepository.consumeAndReplaceRefreshToken.mockResolvedValue({
        status: 'rotated',
        replacement: { id: faker.string.uuid(), userId: testUserId },
        revokedAccessToken: accessToken,
      });

      const newToken = await rotateRefreshToken(oldToken, undefined, undefined, undefined, accessToken);

      expect(newToken).toEqual({
        status: 'rotated',
        refreshToken: 'refresh-token-for-test-user',
      });
      const call = mockSessionRepository.consumeAndReplaceRefreshToken.mock.calls.at(-1)?.[0];
      expect(call.deviceId).toBeUndefined();
      expect(call.deviceName).toBeUndefined();
    });

    it('should set device metadata to undefined when no source has values', async () => {
      const oldToken = 'old-refresh-token-empty-device';
      mockSessionRepository.consumeAndReplaceRefreshToken.mockResolvedValue({
        status: 'rotated',
        replacement: { id: faker.string.uuid(), userId: testUserId },
        revokedAccessToken: accessToken,
      });

      const newToken = await rotateRefreshToken(oldToken, undefined, undefined, undefined, accessToken);

      expect(newToken).toEqual({
        status: 'rotated',
        refreshToken: 'refresh-token-for-test-user',
      });
      const call = mockSessionRepository.consumeAndReplaceRefreshToken.mock.calls.at(-1)?.[0];
      expect(call.deviceId).toBeUndefined();
      expect(call.deviceName).toBeUndefined();
    });
  });

  describe('revokeRefreshToken', () => {
    it('should revoke token and return true', async () => {
      mockSessionRepository.revokeRefreshToken.mockResolvedValue(undefined);

      const result = await revokeRefreshToken(testToken);

      expect(result).toBe(true);
      expect(mockSessionRepository.revokeRefreshToken).toHaveBeenCalledWith(testToken);
    });

    it('should surface storage errors', async () => {
      mockSessionRepository.revokeRefreshToken.mockRejectedValue(new Error('Not found'));

      await expect(revokeRefreshToken(testToken)).rejects.toThrow('Not found');
    });
  });

  describe('revokeSession', () => {
    it('should revoke session belonging to user', async () => {
      mockSessionRepository.revokeSessionById.mockResolvedValue(accessToken);

      const result = await revokeSession(testSessionId, testUserId);

      expect(result).toBe(true);
      expect(mockSessionRepository.revokeSessionById).toHaveBeenCalledWith(testSessionId, testUserId);
      expect(mockPublishRevokedToken).toHaveBeenCalledWith(accessToken.jti, accessToken.expiresAt);
      expect(mockDisconnectWebSocketAccessToken).toHaveBeenCalledWith(accessToken.jti);
    });

    it('should return false for session not found', async () => {
      mockSessionRepository.revokeSessionById.mockResolvedValue(null);

      const result = await revokeSession(testSessionId, testUserId);

      expect(result).toBe(false);
    });

    it('should return false for session belonging to another user', async () => {
      mockSessionRepository.revokeSessionById.mockResolvedValue(null);

      const result = await revokeSession(testSessionId, testUserId);

      expect(result).toBe(false);
      expect(mockPublishRevokedToken).not.toHaveBeenCalled();
    });

    it('should surface storage errors', async () => {
      mockSessionRepository.revokeSessionById.mockRejectedValue(new Error('DB error'));

      await expect(revokeSession(testSessionId, testUserId)).rejects.toThrow('DB error');
    });
  });

  describe('revokeLogoutCredentials', () => {
    it('publishes the access revocation only after the transaction succeeds', async () => {
      mockSessionRepository.revokeLogoutCredentials.mockResolvedValue('revoked');

      await revokeLogoutCredentials({
        userId: testUserId,
        accessToken,
        refreshToken: testToken,
        refreshSessionFamilyId: 'session-family-123',
        refreshTokenExpiresAt: accessToken.expiresAt,
      });

      expect(mockSessionRepository.revokeLogoutCredentials).toHaveBeenCalledWith({
        userId: testUserId,
        accessTokenJti: accessToken.jti,
        accessTokenExpiresAt: accessToken.expiresAt,
        refreshToken: testToken,
        refreshSessionFamilyId: 'session-family-123',
        refreshTokenExpiresAt: accessToken.expiresAt,
      });
      expect(mockPublishRevokedToken).toHaveBeenCalledAfter(
        mockSessionRepository.revokeLogoutCredentials
      );
      expect(mockDisconnectWebSocketAccessToken).toHaveBeenCalledWith(accessToken.jti);
    });

    it('does not publish or hide transaction failures', async () => {
      mockSessionRepository.revokeLogoutCredentials.mockRejectedValue(new Error('DB error'));

      await expect(revokeLogoutCredentials({ userId: testUserId, accessToken }))
        .rejects.toThrow('DB error');
      expect(mockPublishRevokedToken).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllUserRefreshTokens', () => {
    it('should revoke all user tokens and return count', async () => {
      mockSessionRepository.revokeAllUserTokens.mockResolvedValue(5);

      const count = await revokeAllUserRefreshTokens(testUserId);

      expect(count).toBe(5);
      expect(mockSessionRepository.revokeAllUserTokens).toHaveBeenCalledWith(testUserId);
    });

    it('should throw error on failure', async () => {
      mockSessionRepository.revokeAllUserTokens.mockRejectedValue(new Error('DB error'));

      await expect(revokeAllUserRefreshTokens(testUserId)).rejects.toThrow('DB error');
    });
  });

  describe('getUserSessions', () => {
    it('should return all user sessions', async () => {
      const mockSessions = [
        {
          id: testSessionId,
          deviceId: testDeviceInfo.deviceId,
          deviceName: testDeviceInfo.deviceName,
          userAgent: testDeviceInfo.userAgent,
          ipAddress: testDeviceInfo.ipAddress,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          isCurrent: false,
        },
      ];
      mockSessionRepository.getSessionsForUser.mockResolvedValue(mockSessions);

      const sessions = await getUserSessions(testUserId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(testSessionId);
      expect(sessions[0].deviceName).toBe(testDeviceInfo.deviceName);
    });

    it('should mark current session when hash provided', async () => {
      const tokenHash = 'current-token-hash';
      mockSessionRepository.findRefreshTokenByHash.mockResolvedValue({
        id: testSessionId,
        userId: testUserId,
      });
      mockSessionRepository.getSessionsForUser.mockResolvedValue([
        {
          id: testSessionId,
          isCurrent: true,
          deviceId: null,
          deviceName: null,
          userAgent: null,
          ipAddress: null,
          createdAt: new Date(),
          lastUsedAt: new Date(),
        },
      ]);

      const sessions = await getUserSessions(testUserId, tokenHash);

      expect(sessions[0].isCurrent).toBe(true);
    });

    it('should throw error on failure', async () => {
      mockSessionRepository.getSessionsForUser.mockRejectedValue(new Error('DB error'));

      await expect(getUserSessions(testUserId)).rejects.toThrow('DB error');
    });

    it('should ignore current token hash when token belongs to another user', async () => {
      const tokenHash = 'other-user-token-hash';
      mockSessionRepository.findRefreshTokenByHash.mockResolvedValue({
        id: faker.string.uuid(),
        userId: faker.string.uuid(),
      });
      mockSessionRepository.getSessionsForUser.mockResolvedValue([]);

      const sessions = await getUserSessions(testUserId, tokenHash);

      expect(sessions).toEqual([]);
      expect(mockSessionRepository.getSessionsForUser).toHaveBeenCalledWith(testUserId, undefined);
    });
  });

  describe('cleanupExpiredRefreshTokens', () => {
    it('should delete expired tokens and return count', async () => {
      mockSessionRepository.deleteExpiredRefreshTokens.mockResolvedValue(10);

      const count = await cleanupExpiredRefreshTokens();

      expect(count).toBe(10);
    });

    it('should return 0 on error', async () => {
      mockSessionRepository.deleteExpiredRefreshTokens.mockRejectedValue(new Error('DB error'));

      const count = await cleanupExpiredRefreshTokens();

      expect(count).toBe(0);
    });

    it('should return 0 when no tokens were deleted', async () => {
      mockSessionRepository.deleteExpiredRefreshTokens.mockResolvedValue(0);

      const count = await cleanupExpiredRefreshTokens();

      expect(count).toBe(0);
    });
  });

  describe('getActiveSessionCount', () => {
    it('should return active session count', async () => {
      mockSessionRepository.countActiveSessions.mockResolvedValue(3);

      const count = await getActiveSessionCount(testUserId);

      expect(count).toBe(3);
    });

    it('should return 0 on error', async () => {
      mockSessionRepository.countActiveSessions.mockRejectedValue(new Error('DB error'));

      const count = await getActiveSessionCount(testUserId);

      expect(count).toBe(0);
    });
  });
});
