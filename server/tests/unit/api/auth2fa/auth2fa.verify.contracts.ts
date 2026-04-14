import request from 'supertest';
import { expect, it, vi } from 'vitest';

import { app } from './auth2faTestHarness';
import { mockPrismaClient } from '../auth.testHelpers';

export function registerTwoFactorVerifyContracts() {
  it('should return 400 when tempToken or code is missing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'some-token' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Temporary token and verification code are required');
  });

  it('should return 401 when tempToken is invalid', async () => {
    const { verify2FAToken } = await import('../../../../src/utils/jwt');
    const mockVerify2FA = vi.mocked(verify2FAToken);
    mockVerify2FA.mockRejectedValueOnce(new Error('Invalid token'));

    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'invalid-token', code: '123456' });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid or expired temporary token');
  });

  it('should return 401 when user not found or 2FA not enabled', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'valid-token', code: '123456' });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid authentication state');
  });

  it('should return 401 when code is invalid', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      isAdmin: false,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
      twoFactorBackupCodes: null,
    });

    const { verifyToken } = await import('../../../../src/services/twoFactorService');
    vi.mocked(verifyToken).mockReturnValueOnce(false);

    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'valid-token', code: '000000' });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid verification code');
  });

  it('should successfully verify 2FA and return tokens', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      email: 'test@example.com',
      isAdmin: false,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
      preferences: { darkMode: true },
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'valid-token', code: '123456' });

    expect(response.status).toBe(200);
    // Phase 6: browser auth is cookie-only; JSON body no longer carries tokens.
    expect(response.body.token).toBeUndefined();
    expect(response.body.refreshToken).toBeUndefined();
    expect(response.body.user.username).toBe('testuser');
  });

  it('should successfully verify using backup code', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      email: 'test@example.com',
      isAdmin: false,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
      twoFactorBackupCodes: '[{"hash":"h1"}]',
      preferences: { darkMode: true },
    });
    mockPrismaClient.user.update.mockResolvedValue({});

    // Reset and configure mocks for backup code path
    const twoFactorService = await import('../../../../src/services/twoFactorService');
    vi.mocked(twoFactorService.isBackupCode).mockReset().mockReturnValue(true);
    vi.mocked(twoFactorService.verifyBackupCode).mockReset().mockResolvedValue({ valid: true, updatedCodesJson: '[]' });

    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'valid-token', code: 'BACKUP-CODE' });

    expect(response.status).toBe(200);
    // Phase 6: tokens are delivered via Set-Cookie, not body.
    expect(response.body.token).toBeUndefined();
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
  });

  it('should skip backup code persistence when verifyBackupCode does not return updates', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      email: 'test@example.com',
      isAdmin: false,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
      twoFactorBackupCodes: '[{"hash":"h1"}]',
      preferences: { darkMode: true },
    });

    const twoFactorService = await import('../../../../src/services/twoFactorService');
    vi.mocked(twoFactorService.isBackupCode).mockReset().mockReturnValue(true);
    vi.mocked(twoFactorService.verifyBackupCode).mockReset().mockResolvedValue({ valid: true });

    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'valid-token', code: 'BACKUP-CODE' });

    expect(response.status).toBe(200);
    // Phase 6: tokens are delivered via Set-Cookie, not body.
    expect(response.body.token).toBeUndefined();
    expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
  });

  it('should reject invalid backup code', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      isAdmin: false,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
      twoFactorBackupCodes: '[{"hash":"h1"}]',
    });

    // Reset and configure mocks for backup code path with invalid code
    const twoFactorService = await import('../../../../src/services/twoFactorService');
    vi.mocked(twoFactorService.isBackupCode).mockReset().mockReturnValue(true);
    vi.mocked(twoFactorService.verifyBackupCode).mockReset().mockResolvedValue({ valid: false });

    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'valid-token', code: 'INVALID-BACKUP' });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Invalid verification code');
  });

  it('should handle errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'valid-token', code: '123456' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('Phase 2: sets sanctuary_access/refresh/csrf cookies and X-Access-Expires-At header on success', async () => {
    // Earlier tests in this describe block leave twoFactorService mocks in
    // the backup-code-path state. Reset them to the happy-path TOTP config
    // so this test exercises the same code path as the original success
    // test at "should successfully verify 2FA and return tokens".
    const twoFactorService = await import('../../../../src/services/twoFactorService');
    vi.mocked(twoFactorService.isBackupCode).mockReset().mockReturnValue(false);
    vi.mocked(twoFactorService.verifyToken).mockReset().mockReturnValue(true);

    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      username: 'testuser',
      email: 'test@example.com',
      isAdmin: false,
      twoFactorEnabled: true,
      twoFactorSecret: 'some-secret',
      preferences: { darkMode: true },
    });

    const response = await request(app)
      .post('/api/v1/auth/2fa/verify')
      .send({ tempToken: 'valid-token', code: '123456' });

    expect(response.status).toBe(200);
    // Phase 6: JSON fields are gone; tokens are delivered via cookies.
    expect(response.body.token).toBeUndefined();
    expect(response.body.refreshToken).toBeUndefined();

    const setCookie = response.headers['set-cookie'];
    const rawCookies: string[] = Array.isArray(setCookie)
      ? (setCookie as string[])
      : typeof setCookie === 'string'
        ? [setCookie as string]
        : [];
    const names = rawCookies.map((c) => c.split(';')[0].split('=')[0]);
    expect(names).toContain('sanctuary_access');
    expect(names).toContain('sanctuary_refresh');
    expect(names).toContain('sanctuary_csrf');

    const accessCookie = rawCookies.find((c) => c.startsWith('sanctuary_access='));
    expect(accessCookie).toContain('HttpOnly');
    expect(accessCookie).toContain('SameSite=Strict');
    expect(accessCookie).toContain('Path=/');

    const refreshCookie = rawCookies.find((c) => c.startsWith('sanctuary_refresh='));
    expect(refreshCookie).toContain('HttpOnly');
    expect(refreshCookie).toContain('SameSite=Strict');
    expect(refreshCookie).toContain('Path=/api/v1/auth/refresh');

    const csrfCookie = rawCookies.find((c) => c.startsWith('sanctuary_csrf='));
    expect(csrfCookie).not.toContain('HttpOnly');
    expect(csrfCookie).toContain('SameSite=Strict');

    const expiresHeader = response.headers['x-access-expires-at'];
    expect(typeof expiresHeader).toBe('string');
    const date = new Date(expiresHeader as string);
    expect(Number.isNaN(date.getTime())).toBe(false);
  });
}
