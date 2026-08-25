import { describe, expect, it } from 'vitest';

import {
  createAuthCookieClearPolicy,
  createAuthCookiePolicy,
} from '../../../src/middleware/authCookiePolicy';

describe('auth cookie policy', () => {
  it('shares access expiry and security attributes with readable host-only CSRF', () => {
    const accessExpiresAt = new Date('2030-01-02T03:04:05.000Z');
    const refreshExpiresAt = new Date('2030-01-09T03:04:05.000Z');
    const policy = createAuthCookiePolicy({
      accessExpiresAt,
      refreshExpiresAt,
      secure: true,
    });

    expect(policy.access).toMatchObject({
      expires: accessExpiresAt,
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: true,
    });
    expect(policy.csrf).toMatchObject({
      expires: accessExpiresAt,
      httpOnly: false,
      path: '/',
      sameSite: 'strict',
      secure: true,
    });
    expect(policy.refresh).toMatchObject({
      expires: refreshExpiresAt,
      httpOnly: true,
      path: '/api/v1/auth',
      sameSite: 'strict',
      secure: true,
    });
    expect(policy.access).not.toHaveProperty('domain');
    expect(policy.csrf).not.toHaveProperty('domain');
    expect(policy.refresh).not.toHaveProperty('domain');
  });

  it('keeps clear-cookie identity attributes aligned without carrying issuance expiry', () => {
    const clearPolicy = createAuthCookieClearPolicy(false);

    expect(clearPolicy.access).toEqual({
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: false,
    });
    expect(clearPolicy.csrf).toEqual({
      httpOnly: false,
      path: '/',
      sameSite: 'strict',
      secure: false,
    });
    expect(clearPolicy.refresh).toEqual({
      httpOnly: true,
      path: '/api/v1/auth',
      sameSite: 'strict',
      secure: false,
    });
  });
});
