/**
 * Auth cookie names and header names (ADR 0001 / 0002).
 *
 * This file intentionally has **zero imports**, including no import of
 * `../config`. Any module that just needs the cookie/header names can
 * depend on it without pulling in config validation as a side effect —
 * which matters for the WebSocket upgrade path where `server/src/config/index.ts`
 * runs `getConfig()` at module load and would fail in tests that don't
 * mock the config module.
 *
 * The functional helpers that DO need config (setAuthCookies,
 * clearAuthCookies, doubleCsrfProtection, generateCsrfToken,
 * setAccessExpiresAtHeader) live in `./csrf.ts` and re-use these constants.
 */

export const SANCTUARY_ACCESS_COOKIE_NAME = 'sanctuary_access';
export const SANCTUARY_REFRESH_COOKIE_NAME = 'sanctuary_refresh';
export const SANCTUARY_CSRF_COOKIE_NAME = 'sanctuary_csrf';
export const SANCTUARY_CSRF_HEADER_NAME = 'x-csrf-token';
export const SANCTUARY_ACCESS_EXPIRES_AT_HEADER = 'X-Access-Expires-At';

/**
 * Path scope for the refresh cookie. Intentionally narrow per ADR 0002 so
 * the refresh token is only sent on the single endpoint that consumes it.
 */
export const SANCTUARY_REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';
