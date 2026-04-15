/**
 * Browser auth policy for cookie-backed API calls.
 *
 * This module owns the frontend decisions that must stay stable across
 * ApiClient, direct fetch helpers, UserContext, and auth tests.
 */

export const CSRF_COOKIE_NAME = 'sanctuary_csrf';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';
export const ACCESS_EXPIRES_AT_HEADER = 'X-Access-Expires-At';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const REFRESH_ON_401_EXEMPT_ENDPOINTS = Object.freeze([
  '/auth/login',
  '/auth/register',
  '/auth/2fa/verify',
  '/auth/refresh',
]);

const REFRESH_ON_401_EXEMPT_ENDPOINT_SET = new Set<string>(REFRESH_ON_401_EXEMPT_ENDPOINTS);

interface RefreshDecisionInput {
  endpoint: string;
  status: number;
  isRefreshRetry: boolean;
}

function getDocumentCookieHeader(): string {
  if (typeof document === 'undefined') return '';
  return document.cookie;
}

export function normalizeAuthEndpoint(endpoint: string): string {
  const queryIndex = endpoint.indexOf('?');
  const hashIndex = endpoint.indexOf('#');
  const cutIndexes = [queryIndex, hashIndex].filter(index => index >= 0);
  const cutIndex = cutIndexes.length > 0 ? Math.min(...cutIndexes) : -1;
  return cutIndex >= 0 ? endpoint.substring(0, cutIndex) : endpoint;
}

export function isRefreshOn401ExemptEndpoint(endpoint: string): boolean {
  return REFRESH_ON_401_EXEMPT_ENDPOINT_SET.has(normalizeAuthEndpoint(endpoint));
}

export function shouldAttemptRefreshAfterUnauthorized(input: RefreshDecisionInput): boolean {
  return (
    input.status === 401
    && !input.isRefreshRetry
    && !isRefreshOn401ExemptEndpoint(input.endpoint)
  );
}

export function requiresCsrfHeader(method: string): boolean {
  return STATE_CHANGING_METHODS.has(method.toUpperCase());
}

export function readCookieValue(cookieHeader: string, cookieName: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.split('=');
    if (rawName?.trim() !== cookieName) continue;

    const rawValue = rest.join('=').trim();
    try {
      return decodeURIComponent(rawValue).trim();
    } catch {
      return rawValue;
    }
  }

  return null;
}

export function readCsrfCookieValue(cookieHeader: string = getDocumentCookieHeader()): string | null {
  return readCookieValue(cookieHeader, CSRF_COOKIE_NAME);
}

export function attachCsrfHeader(
  headers: Record<string, string>,
  method: string,
  cookieHeader: string = getDocumentCookieHeader(),
): void {
  if (!requiresCsrfHeader(method) || headers[CSRF_HEADER_NAME]) return;

  const csrf = readCsrfCookieValue(cookieHeader);
  if (csrf) {
    headers[CSRF_HEADER_NAME] = csrf;
  }
}
