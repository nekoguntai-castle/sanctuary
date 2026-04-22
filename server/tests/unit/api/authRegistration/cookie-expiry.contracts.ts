import { describe, expect, it, vi } from 'vitest';
import { app } from './authRegistrationTestHarness';
import request from 'supertest';
import { hashPassword } from '../../../../src/utils/password';
import { mockPrismaClient } from '../../../mocks/prisma';
import { createCsrfTokenForAccessCookie, mockIsVerificationRequired } from '../auth.testHelpers';

export function registerAuthCookieExpiryTests(): void {
  describe('Phase 2 — cookies and expiry header', () => {
    type CookieAttrs = { value: string; attrs: Record<string, string | true> };

    function parseSetCookieHeaders(headers: unknown): Record<string, CookieAttrs> {
      const arr: string[] = Array.isArray(headers)
        ? (headers as string[])
        : typeof headers === 'string'
          ? [headers as string]
          : [];
      const parsed: Record<string, CookieAttrs> = {};
      for (const header of arr) {
        const [nameValue, ...parts] = header.split(';').map((s) => s.trim());
        const [name, ...valueBits] = nameValue.split('=');
        const value = valueBits.join('=');
        const attrs: Record<string, string | true> = {};
        for (const part of parts) {
          const [k, ...vBits] = part.split('=');
          attrs[k] = vBits.length > 0 ? vBits.join('=') : true;
        }
        parsed[name] = { value, attrs };
      }
      return parsed;
    }

    function assertAuthCookiesIssued(setCookieHeader: unknown): Record<string, CookieAttrs> {
      const cookies = parseSetCookieHeaders(setCookieHeader);
      expect(cookies.sanctuary_access).toBeDefined();
      expect(cookies.sanctuary_refresh).toBeDefined();
      expect(cookies.sanctuary_csrf).toBeDefined();

      // sanctuary_access: HttpOnly, SameSite=Strict, path=/
      expect(cookies.sanctuary_access.attrs.HttpOnly).toBe(true);
      expect(cookies.sanctuary_access.attrs.SameSite).toBe('Strict');
      expect(cookies.sanctuary_access.attrs.Path).toBe('/');
      // Should carry an absolute expiry matching the JWT exp claim (the
      // mocked decodeToken returns now+3600, so Expires is set).
      expect(cookies.sanctuary_access.attrs.Expires).toBeDefined();

      // sanctuary_refresh: HttpOnly, SameSite=Strict, scoped path
      expect(cookies.sanctuary_refresh.attrs.HttpOnly).toBe(true);
      expect(cookies.sanctuary_refresh.attrs.SameSite).toBe('Strict');
      expect(cookies.sanctuary_refresh.attrs.Path).toBe('/api/v1/auth/refresh');
      expect(cookies.sanctuary_refresh.attrs['Max-Age']).toBeDefined();

      // sanctuary_csrf: NOT HttpOnly (frontend needs to read it),
      // SameSite=Strict, path=/
      expect(cookies.sanctuary_csrf.attrs.HttpOnly).toBeUndefined();
      expect(cookies.sanctuary_csrf.attrs.SameSite).toBe('Strict');
      expect(cookies.sanctuary_csrf.attrs.Path).toBe('/');

      return cookies;
    }

    function assertAccessExpiresAtHeader(headers: Record<string, string | string[] | undefined>): void {
      const header = headers['x-access-expires-at'];
      expect(typeof header).toBe('string');
      const iso = header as string;
      const date = new Date(iso);
      // Must parse as a valid ISO 8601 timestamp.
      expect(Number.isNaN(date.getTime())).toBe(false);
      // Must be within ~5 minutes of now + 1h (matches mocked decodeToken
      // which returns exp = now + 3600s).
      const now = Date.now();
      const expected = now + 60 * 60 * 1000;
      expect(Math.abs(date.getTime() - expected)).toBeLessThan(5 * 60 * 1000);
    }

    function assertAuthCookiesCleared(setCookieHeader: unknown): void {
      const cookies = parseSetCookieHeaders(setCookieHeader);
      expect(cookies.sanctuary_access).toBeDefined();
      expect(cookies.sanctuary_refresh).toBeDefined();
      expect(cookies.sanctuary_csrf).toBeDefined();
      // Express clearCookie sets the value to empty and Expires to the epoch.
      expect(cookies.sanctuary_access.value).toBe('');
      expect(cookies.sanctuary_refresh.value).toBe('');
      expect(cookies.sanctuary_csrf.value).toBe('');
      // Refresh cookie must be cleared on its scoped path or the browser
      // will not expire the right cookie.
      expect(cookies.sanctuary_refresh.attrs.Path).toBe('/api/v1/auth/refresh');
    }

    // -- Login ------------------------------------------------------------
    it('login sets sanctuary_access/refresh/csrf cookies and X-Access-Expires-At header', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: true,
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: false,
        preferences: { darkMode: true },
      });
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(200);
      // Phase 6: JSON fields are gone; tokens are delivered via cookies.
      expect(response.body.token).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      assertAuthCookiesIssued(response.headers['set-cookie']);
      assertAccessExpiresAtHeader(response.headers);
    });

    // -- Register ---------------------------------------------------------
    it('register sets the browser auth cookies and X-Access-Expires-At header', async () => {
      mockIsVerificationRequired.mockResolvedValueOnce(false);
      mockPrismaClient.user.findUnique
        .mockResolvedValueOnce(null) // username check
        .mockResolvedValueOnce(null); // email check
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        emailVerified: false,
        isAdmin: false,
        preferences: {},
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'newuser',
          password: 'StrongP@ssword123',
          email: 'new@example.com',
        });

      expect(response.status).toBe(201);
      assertAuthCookiesIssued(response.headers['set-cookie']);
      assertAccessExpiresAtHeader(response.headers);
    });

    // -- Refresh ---------------------------------------------------------
    it('refresh from body rotates all three cookies and sets expiry header', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'body-refresh-token' });

      expect(response.status).toBe(200);
      // Phase 6: tokens are in Set-Cookie, not body. assertAuthCookiesIssued
      // already verifies both sanctuary_access and sanctuary_refresh are set.
      expect(response.body.token).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      assertAuthCookiesIssued(response.headers['set-cookie']);
      assertAccessExpiresAtHeader(response.headers);
    });

    it('refresh from sanctuary_refresh cookie alone succeeds and rotates the cookies', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['sanctuary_refresh=cookie-refresh-token'])
        .send({});

      expect(response.status).toBe(200);
      // Phase 6: tokens are in Set-Cookie, not body.
      expect(response.body.token).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
      assertAuthCookiesIssued(response.headers['set-cookie']);
      assertAccessExpiresAtHeader(response.headers);
    });

    it('refresh prefers cookie token over body token when both are present (ADR 0002)', async () => {
      // ADR 0002 migration plan item 2 and required test spec: "both
      // present uses the cookie." Mobile/gateway callers only ever have
      // the body field, so this precedence has no effect on the mobile
      // path.
      const { rotateRefreshToken } = await import('../../../../src/services/refreshTokenService');
      const rotateMock = vi.mocked(rotateRefreshToken);
      rotateMock.mockClear();
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
      });

      await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['sanctuary_refresh=cookie-refresh-token'])
        .send({ refreshToken: 'body-refresh-token' })
        .expect(200);

      // The backend must have used the cookie token, not the body field.
      expect(rotateMock).toHaveBeenCalledWith(
        'cookie-refresh-token',
        expect.any(Object),
      );
      expect(rotateMock).not.toHaveBeenCalledWith(
        'body-refresh-token',
        expect.any(Object),
      );
    });

    it('refresh with neither body nor cookie returns 400 with the legacy error message', async () => {
      const response = await request(app).post('/api/v1/auth/refresh').send({});
      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Refresh token is required');
    });

    it('refresh clears browser auth cookies on terminal failure (invalid refresh token)', async () => {
      // ADR 0002 required test: "refresh clears cookies on failure
      // (revoked refresh token)." Evicts a browser sitting on a stale
      // refresh cookie so it does not keep 401-looping.
      const { verifyRefreshToken } = await import('../../../../src/utils/jwt');
      vi.mocked(verifyRefreshToken).mockRejectedValueOnce(new Error('Refresh token expired'));

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['sanctuary_refresh=stale-refresh-token'])
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid or expired refresh token');
      assertAuthCookiesCleared(response.headers['set-cookie']);
    });

    it('refresh clears browser auth cookies when the refresh token has been revoked', async () => {
      const { verifyRefreshTokenExists } = await import('../../../../src/services/refreshTokenService');
      vi.mocked(verifyRefreshTokenExists).mockResolvedValueOnce(false);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['sanctuary_refresh=revoked-refresh-token'])
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Refresh token has been revoked');
      assertAuthCookiesCleared(response.headers['set-cookie']);
    });

    it('refresh clears browser auth cookies when the user no longer exists', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['sanctuary_refresh=orphan-refresh-token'])
        .send({});

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('User not found');
      assertAuthCookiesCleared(response.headers['set-cookie']);
    });

    // -- Logout ----------------------------------------------------------
    it('logout clears sanctuary_access/refresh/csrf cookies', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      assertAuthCookiesCleared(response.headers['set-cookie']);
    });

    it('logout revokes refresh token supplied via sanctuary_refresh cookie', async () => {
      const { revokeRefreshToken } = await import('../../../../src/services/refreshTokenService');
      const mockRevoke = vi.mocked(revokeRefreshToken);

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .set('Cookie', ['sanctuary_refresh=cookie-refresh-to-revoke'])
        .send({});

      expect(response.status).toBe(200);
      expect(mockRevoke).toHaveBeenCalledWith('cookie-refresh-to-revoke');
      assertAuthCookiesCleared(response.headers['set-cookie']);
    });

    it('logout reads the access token from sanctuary_access cookie when no Authorization header is present', async () => {
      // Cookie-only browser logout: no Authorization header, just the two
      // HttpOnly cookies. The handler must still revoke the access token's
      // JTI (read from the cookie) and clear the response cookies.
      const { revokeToken } = await import('../../../../src/services/tokenRevocation');
      const mockRevokeToken = vi.mocked(revokeToken);
      mockRevokeToken.mockClear();
      const csrfToken = await createCsrfTokenForAccessCookie('cookie-access-token');

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('X-CSRF-Token', csrfToken)
        .set('Cookie', [
          'sanctuary_access=cookie-access-token',
          'sanctuary_refresh=cookie-refresh-token',
          `sanctuary_csrf=${csrfToken}`,
        ])
        .send({});

      expect(response.status).toBe(200);
      // revokeToken was called with the jti+exp from the decoded cookie token.
      expect(mockRevokeToken).toHaveBeenCalled();
      assertAuthCookiesCleared(response.headers['set-cookie']);
    });

    it('logout-all clears the browser cookies on the calling tab', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      assertAuthCookiesCleared(response.headers['set-cookie']);
    });

    // -- /auth/me --------------------------------------------------------
    it('GET /auth/me sets X-Access-Expires-At header when the caller has a valid access token', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        preferences: null,
        createdAt: new Date(),
        twoFactorEnabled: false,
        password: 'hashed',
      });
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer valid-access-token');

      expect(response.status).toBe(200);
      assertAccessExpiresAtHeader(response.headers);
    });

    it('GET /auth/me reads the access token from sanctuary_access cookie when no header is present', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        preferences: null,
        createdAt: new Date(),
        twoFactorEnabled: false,
        password: 'hashed',
      });
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', ['sanctuary_access=cookie-access-token']);

      expect(response.status).toBe(200);
      assertAccessExpiresAtHeader(response.headers);
    });
  });
}
