import type { CookieOptions } from 'express';

import { SANCTUARY_REFRESH_COOKIE_PATH } from './authCookieNames';

type AuthCookiePolicyInput = {
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  secure: boolean;
};

export type AuthCookiePolicy = {
  access: CookieOptions;
  csrf: CookieOptions;
  refresh: CookieOptions;
};

function sharedCookieOptions(secure: boolean): CookieOptions {
  return {
    secure,
    sameSite: 'strict',
  };
}

/**
 * Derive role-specific auth cookie attributes from one security policy.
 * Domain is intentionally omitted so every cookie remains host-only.
 */
export function createAuthCookiePolicy({
  accessExpiresAt,
  refreshExpiresAt,
  secure,
}: AuthCookiePolicyInput): AuthCookiePolicy {
  const shared = sharedCookieOptions(secure);
  return {
    access: {
      ...shared,
      httpOnly: true,
      path: '/',
      expires: accessExpiresAt,
    },
    csrf: {
      ...shared,
      httpOnly: false,
      path: '/',
      expires: accessExpiresAt,
    },
    refresh: {
      ...shared,
      httpOnly: true,
      path: SANCTUARY_REFRESH_COOKIE_PATH,
      expires: refreshExpiresAt,
    },
  };
}

/**
 * Clearing must repeat every identity-relevant attribute used at issuance.
 * Expiry is supplied by Express's clearCookie implementation.
 */
export function createAuthCookieClearPolicy(secure: boolean): AuthCookiePolicy {
  const shared = sharedCookieOptions(secure);
  return {
    access: { ...shared, httpOnly: true, path: '/' },
    csrf: { ...shared, httpOnly: false, path: '/' },
    refresh: {
      ...shared,
      httpOnly: true,
      path: SANCTUARY_REFRESH_COOKIE_PATH,
    },
  };
}
