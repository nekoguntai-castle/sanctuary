/**
 * Proxy Configuration
 *
 * HTTP proxy middleware configuration for forwarding requests to the backend.
 *
 * ## Proxy Headers
 *
 * The proxy adds these headers to backend requests:
 * - `X-Gateway-Request: true` - Identifies request as coming from gateway
 * - `X-Gateway-User-Id` - Authenticated user's ID
 * - `X-Gateway-Username` - Authenticated user's username
 */

import { Request, Response } from 'express';
import type { ClientRequest } from 'http';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { config } from '../../config';
import { AuthenticatedRequest } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';

const log = createLogger('PROXY');
const BODY_AUTH_ROUTES = new Set(['/api/v1/auth/refresh', '/api/v1/auth/logout']);
const BROWSER_AUTH_COOKIES = new Set([
  'sanctuary_access',
  'sanctuary_refresh',
  'sanctuary_csrf',
]);

function stripBrowserAuthCookies(proxyReq: ClientRequest, req: Request): void {
  if (!BODY_AUTH_ROUTES.has(req.path)) {
    return;
  }
  const forwarded = req.headers.cookie
    ?.split(';')
    .map(cookie => cookie.trim())
    .filter(cookie => !BROWSER_AUTH_COOKIES.has(cookie.split('=', 1)[0]!))
    .join('; ');
  if (forwarded) {
    proxyReq.setHeader('cookie', forwarded);
    return;
  }
  proxyReq.removeHeader('cookie');
}

// Create proxy middleware
export const proxy = createProxyMiddleware({
  target: config.backendUrl,
  changeOrigin: true,
  // Express strips the mount prefix from default routes; restore it for the backend.
  pathRewrite: (path, req) => `${(req as Request).baseUrl || ''}${path}`,
  on: {
    proxyReq: (proxyReq, req) => {
      stripBrowserAuthCookies(proxyReq, req as Request);

      const authReq = req as AuthenticatedRequest;

      // Replace (never append to) client-supplied forwarding headers: the backend derives
      // req.ip from X-Forwarded-For, so it must see exactly the client this gateway observed.
      const clientIp = (req as Request).ip || req.socket?.remoteAddress;
      if (clientIp) {
        proxyReq.setHeader('X-Forwarded-For', clientIp);
      } else {
        proxyReq.removeHeader('X-Forwarded-For');
      }
      proxyReq.removeHeader('Forwarded');
      proxyReq.removeHeader('X-Real-IP');

      // Forward user info to backend
      if (authReq.user) {
        proxyReq.setHeader('X-Gateway-User-Id', authReq.user.userId);
        proxyReq.setHeader('X-Gateway-Username', authReq.user.username);
      }

      // Mark request as coming from gateway
      proxyReq.setHeader('X-Gateway-Request', 'true');

      log.debug('Proxying request', {
        method: req.method,
        path: req.url,
        userId: authReq.user?.userId,
      });

      // Fix for body parsing: when express.json() parses the body,
      // the raw stream is consumed. This re-attaches the parsed body
      // to the proxy request so it can be forwarded to the backend.
      // Keep this last because writing the body commits the outgoing headers.
      fixRequestBody(proxyReq, req as Request);
    },
    proxyRes: (proxyRes, req) => {
      log.debug('Proxy response', {
        method: req.method,
        path: req.url,
        status: proxyRes.statusCode,
      });
    },
    error: (err, req, res) => {
      log.error('Proxy error', { error: (err as Error).message, path: req.url });
      (res as Response).status(502).json({
        error: 'Bad Gateway',
        message: 'Unable to reach backend service',
      });
    },
  },
});
