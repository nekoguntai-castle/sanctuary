import { describe, expect, it, vi } from 'vitest';
import { app } from './authRegistrationTestHarness';
import request from 'supertest';
import { hashPassword } from '../../../../src/utils/password';
import { mockPrismaClient } from '../../../mocks/prisma';
import { createCsrfTokenForAccessCookie } from '../auth.testHelpers';

export function registerAuthPasswordTokenTests(): void {
  describe('POST /auth/me/change-password - Change Password', () => {
    it('should reject when current password is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Current password and new password are required');
    });

    it('should reject when new password is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'OldPassword123!' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Current password and new password are required');
    });

    it('should reject weak new password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'OldPassword123!', newPassword: 'weak' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Password does not meet requirements');
    });

    it('should reject when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'OldPassword123!', newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });

    it('should reject when current password is wrong', async () => {
      const correctPassword = 'CorrectOldPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
      });

      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'WrongOldPassword123!', newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Current password is incorrect');
    });

    // Skip these tests because they hit the rate limiter threshold from previous tests
    it('should successfully change password', async () => {
      const correctPassword = 'CorrectOldPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
      });
      mockPrismaClient.user.update.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
      });
      mockPrismaClient.systemSetting.deleteMany.mockResolvedValue({ count: 0 });

      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: correctPassword, newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Password changed successfully');
      expect(mockPrismaClient.user.update).toHaveBeenCalled();
    });

    // Skip this test because it hits the rate limiter threshold from previous tests
    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'OldPassword123!', newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  // ========================================
  // Password Helper Functions
  // ========================================

  describe('isUsingInitialPassword helper', () => {
    it('should return false when no initial password marker exists', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const { isUsingInitialPassword } = await import('../../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'initialPassword_user-id',
        value: 'hashed-initial-password',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const { isUsingInitialPassword } = await import('../../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(false);
    });

    it('should return true when password matches initial password', async () => {
      const initialHash = 'initial-password-hash';
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'initialPassword_user-id',
        value: initialHash,
      });
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        password: initialHash, // Same as initial
      });

      const { isUsingInitialPassword } = await import('../../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(true);
    });

    it('should return false when password differs from initial', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'initialPassword_user-id',
        value: 'initial-password-hash',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        password: 'different-password-hash',
      });

      const { isUsingInitialPassword } = await import('../../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      mockPrismaClient.systemSetting.findUnique.mockRejectedValue(new Error('Database error'));

      const { isUsingInitialPassword } = await import('../../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(false);
    });
  });

  describe('clearInitialPasswordMarker helper', () => {
    it('should delete the initial password marker', async () => {
      mockPrismaClient.systemSetting.delete.mockResolvedValue({ key: 'initialPassword_user-id', value: '' });

      const { clearInitialPasswordMarker } = await import('../../../../src/api/auth/password');
      await clearInitialPasswordMarker('user-id');

      expect(mockPrismaClient.systemSetting.delete).toHaveBeenCalledWith({
        where: { key: 'initialPassword_user-id' },
      });
    });

    it('should handle deletion errors gracefully', async () => {
      mockPrismaClient.systemSetting.delete.mockRejectedValue(new Error('Delete error'));

      const { clearInitialPasswordMarker } = await import('../../../../src/api/auth/password');
      // Should not throw
      await expect(clearInitialPasswordMarker('user-id')).resolves.toBeUndefined();
    });
  });

  // ========================================
  // Token Routes
  // ========================================

  describe('POST /auth/refresh - Refresh Token', () => {
    it('should reject when refresh token is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Refresh token is required');
    });

    it('should reject invalid refresh token body field types', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 42 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid refresh token', async () => {
      const { verifyRefreshToken } = await import('../../../../src/utils/jwt');
      const mockVerifyRefreshToken = vi.mocked(verifyRefreshToken);
      mockVerifyRefreshToken.mockRejectedValueOnce(new Error('Invalid token'));

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid or expired refresh token');
    });

    it('should reject revoked refresh token', async () => {
      const { verifyRefreshTokenExists } = await import('../../../../src/services/refreshTokenService');
      const mockVerifyExists = vi.mocked(verifyRefreshTokenExists);
      mockVerifyExists.mockResolvedValueOnce(false);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'revoked-token' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Refresh token has been revoked');
    });

    it('should reject when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('User not found');
    });

    it('should rotate the access token via cookies', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(response.status).toBe(200);
      // Phase 6: rotated tokens are delivered via Set-Cookie, not body.
      expect(response.body.token).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      expect(response.body.expiresIn).toBe(3600);
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie);
      expect(cookieHeader).toContain('sanctuary_access=');
      expect(cookieHeader).toContain('sanctuary_refresh=');
    });

    it('should rotate the refresh token via cookies when rotation is requested', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-token', rotate: true });

      expect(response.status).toBe(200);
      // Phase 6: rotated tokens are delivered via Set-Cookie, not body.
      expect(response.body.token).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie);
      // The rotated refresh token value is visible in the Set-Cookie header.
      expect(cookieHeader).toContain('sanctuary_refresh=new-refresh-token');
    });

    it('should return 500 when mandatory token rotation fails and must NOT clear the browser auth cookies', async () => {
      // Regression test for ADR 0002 conformance. Rotation failure is a
      // transient server error — the refresh token was already verified
      // as valid, so clearing cookies would punish the client for a
      // server bug. The client must be able to retry with the same
      // credentials. Only the three terminal auth-failure paths
      // (invalid/revoked token, missing user) clear cookies.
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
      });

      const { rotateRefreshToken } = await import('../../../../src/services/refreshTokenService');
      vi.mocked(rotateRefreshToken).mockResolvedValueOnce(null);
      const csrfToken = await createCsrfTokenForAccessCookie('live-access-cookie');

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('X-CSRF-Token', csrfToken)
        .set('Cookie', [
          'sanctuary_access=live-access-cookie',
          'sanctuary_refresh=live-refresh-cookie',
          `sanctuary_csrf=${csrfToken}`,
        ])
        .send({ refreshToken: 'valid-token' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');

      // The Set-Cookie header must not contain any cookie clearings for
      // the three auth cookies. Parse into a name→value map and assert
      // none of the three names appear (or if they do, none has an
      // empty value which is Express's clearCookie signature).
      const setCookie = response.headers['set-cookie'];
      const cookieStrings: string[] = Array.isArray(setCookie)
        ? (setCookie as string[])
        : typeof setCookie === 'string'
          ? [setCookie as string]
          : [];
      for (const name of ['sanctuary_access', 'sanctuary_refresh', 'sanctuary_csrf']) {
        const clearing = cookieStrings.find(
          (c) => c.startsWith(`${name}=;`) || c.startsWith(`${name}=`) && c.split(';')[0].split('=')[1] === '',
        );
        expect(clearing).toBeUndefined();
      }
    });

    it('should handle errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('POST /auth/logout - Logout', () => {
    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logged out successfully');
    });

    it('should logout without revoking access token when no Bearer header', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Basic some-auth') // Not a Bearer token
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should logout when decoded token is missing jti', async () => {
      const { decodeToken } = await import('../../../../src/utils/jwt');
      vi.mocked(decodeToken).mockReturnValueOnce({ userId: 'test-user-id' }); // Missing jti and exp

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should logout and revoke refresh token if provided', async () => {
      const { revokeRefreshToken } = await import('../../../../src/services/refreshTokenService');
      const mockRevokeRefreshToken = vi.mocked(revokeRefreshToken);

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .send({ refreshToken: 'some-refresh-token' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockRevokeRefreshToken).toHaveBeenCalledWith('some-refresh-token');
    });

    it('should audit logout with unknown username fallback', async () => {
      const { auditService } = await import('../../../../src/services/auditService');

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Test-No-Username', '1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'unknown',
        })
      );
    });

    it('should handle errors gracefully', async () => {
      const { revokeToken } = await import('../../../../src/services/tokenRevocation');
      const mockRevokeToken = vi.mocked(revokeToken);
      mockRevokeToken.mockRejectedValueOnce(new Error('Revocation error'));

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('POST /auth/logout-all - Logout All Devices', () => {
    it('should logout from all devices successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logged out from all devices');
      expect(response.body.sessionsRevoked).toBe(5);
    });

    it('should handle errors gracefully', async () => {
      const { revokeAllUserRefreshTokens } = await import('../../../../src/services/refreshTokenService');
      const mockRevokeAll = vi.mocked(revokeAllUserRefreshTokens);
      mockRevokeAll.mockRejectedValueOnce(new Error('Revocation error'));

      const response = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });

    it('should audit logout-all with unknown username fallback', async () => {
      const { auditService } = await import('../../../../src/services/auditService');

      const response = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Test-No-Username', '1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'unknown',
          details: expect.objectContaining({ action: 'logout_all' }),
        })
      );
    });
  });

  // =========================================================================
  // Phase 2 — Browser cookie auth + X-Access-Expires-At header (ADR 0001/0002)
  // =========================================================================
  //
  // These tests cover the Phase 2 additions on top of the existing route
  // contracts. Every existing behavior stays in the tests above; the block
  // below only verifies the new Set-Cookie headers, cookie attributes, and
  // the X-Access-Expires-At response header.
  //
  // Helpers: the supertest response's `headers['set-cookie']` is an array
  // of cookie strings in the format "name=value; Attr1; Attr2=val; ..."
  // We parse by name to assert attributes without depending on ordering.
}
