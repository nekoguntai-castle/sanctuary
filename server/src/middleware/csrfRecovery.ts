import type { ErrorRequestHandler, Request } from 'express';

import config from '../config';
import { AuthCsrfSessionStaleError } from '../errors/ApiError';
import { authCsrfSessionStaleTotal } from '../observability/metrics/businessMetrics';
import { createLogger } from '../utils/logger';
import { extractTokenFromHeader } from '../utils/jwt';
import {
  SANCTUARY_ACCESS_COOKIE_NAME,
  SANCTUARY_CSRF_COOKIE_NAME,
  SANCTUARY_CSRF_HEADER_NAME,
} from './authCookieNames';
import { isRequestOriginAllowed } from './corsOrigin';
import { isInvalidCsrfTokenError } from './csrfError';

const log = createLogger('MW:CSRF_RECOVERY');

const CREDENTIAL_ENDPOINTS = new Set([
  '/auth/register',
  '/auth/login',
  '/auth/2fa/verify',
  '/auth/refresh',
]);
const DESTRUCTIVE_ENDPOINTS = new Set([
  '/auth/logout',
  '/auth/logout-all',
]);

type RecoveryClassification = {
  action: 'reject-and-clear' | 'continue-destruction';
  endpoint: string;
};

const normalizedV1AuthEndpoint = (req: Request): string | null => {
  const queryIndex = req.originalUrl.indexOf('?');
  const pathname = queryIndex === -1
    ? req.originalUrl
    : req.originalUrl.slice(0, queryIndex);
  const prefix = '/api/v1';
  if (!pathname.startsWith(`${prefix}/auth/`)) {
    return null;
  }
  const endpoint = pathname.slice(prefix.length);
  return endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
};

const hasStaleCookiePair = (req: Request): boolean => {
  const accessCookie = req.cookies?.[SANCTUARY_ACCESS_COOKIE_NAME];
  if (typeof accessCookie !== 'string' || accessCookie.length === 0) {
    return false;
  }

  const csrfCookie = req.cookies?.[SANCTUARY_CSRF_COOKIE_NAME];
  if (typeof csrfCookie !== 'string' || csrfCookie.length === 0) {
    return true;
  }

  const csrfHeader = req.headers[SANCTUARY_CSRF_HEADER_NAME];
  return typeof csrfHeader === 'string' && csrfHeader === csrfCookie;
};

const classifyStaleCsrfRequest = (req: Request): RecoveryClassification | null => {
  if (req.method !== 'POST' || extractTokenFromHeader(req.headers.authorization)) {
    return null;
  }

  const endpoint = normalizedV1AuthEndpoint(req);
  if (!endpoint || (!CREDENTIAL_ENDPOINTS.has(endpoint) && !DESTRUCTIVE_ENDPOINTS.has(endpoint))) {
    return null;
  }

  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !isRequestOriginAllowed(req, origin, {
    allowedOrigins: config.corsAllowedOrigins,
    clientUrl: config.clientUrl,
    nodeEnv: config.nodeEnv,
  })) {
    return null;
  }

  if (!hasStaleCookiePair(req)) {
    return null;
  }

  return {
    action: CREDENTIAL_ENDPOINTS.has(endpoint) ? 'reject-and-clear' : 'continue-destruction',
    endpoint,
  };
};

const recordRecovery = (classification: RecoveryClassification): void => {
  authCsrfSessionStaleTotal.inc();
  log.warn('Classified stale browser auth/CSRF cookie pair', {
    endpoint: classification.endpoint,
    action: classification.action,
  });
};

export function createCsrfRecoveryErrorHandler(
  clearCookies: (res: Parameters<ErrorRequestHandler>[2]) => void,
): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (!isInvalidCsrfTokenError(error)) {
      next(error);
      return;
    }

    const classification = classifyStaleCsrfRequest(req);
    if (!classification) {
      next(error);
      return;
    }

    recordRecovery(classification);
    if (classification.action === 'continue-destruction') {
      // Queue cleanup before authentication. An expired or revoked access
      // cookie can make authenticate reject before the real logout handler
      // gets a chance to clear the browser session.
      clearCookies(res);
      next();
      return;
    }

    clearCookies(res);
    next(new AuthCsrfSessionStaleError());
  };
}
