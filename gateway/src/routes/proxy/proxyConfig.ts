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
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { config } from '../../config';
import { AuthenticatedRequest } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';

const log = createLogger('PROXY');

// Create proxy middleware
export const proxy = createProxyMiddleware({
  target: config.backendUrl,
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq, req) => {
      // Fix for body parsing: when express.json() parses the body,
      // the raw stream is consumed. This re-attaches the parsed body
      // to the proxy request so it can be forwarded to the backend.
      fixRequestBody(proxyReq, req as Request);

      const authReq = req as AuthenticatedRequest;

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
