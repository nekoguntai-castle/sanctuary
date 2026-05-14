/**
 * Proxy Routes Tests
 *
 * Tests route whitelisting, checkWhitelist middleware, and proxy configuration.
 * These tests import the actual proxy.ts module to ensure real coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { Request, Response } from 'express';
import request from 'supertest';

const proxyRouteMocks = vi.hoisted(() => {
  const passThrough = vi.fn((_req: Request, _res: Response, next: () => void) => next());
  const mobilePermissionMiddleware = vi.fn((_req: Request, _res: Response, next: () => void) => next());

  return {
    authenticate: vi.fn((_req: Request, _res: Response, next: () => void) => next()),
    defaultRateLimiter: vi.fn(passThrough),
    transactionCreateRateLimiter: vi.fn(passThrough),
    broadcastRateLimiter: vi.fn(passThrough),
    deviceRegistrationRateLimiter: vi.fn(passThrough),
    addressGenerationRateLimiter: vi.fn(passThrough),
    validateRequest: vi.fn((_req: Request, _res: Response, next: () => void) => next()),
    mobilePermissionMiddleware,
    requireMobilePermission: vi.fn(() => mobilePermissionMiddleware),
    proxy: vi.fn((_req: Request, res: Response) => res.status(204).end()),
  };
});

// Mock dependencies before importing the module
vi.mock('../../../src/config', () => ({
  config: {
    backendUrl: 'http://localhost:3000',
    jwtSecret: 'test-jwt-secret-minimum-32-chars-long',
    rateLimit: {
      windowMs: 60000,
      maxRequests: 60,
    },
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/middleware/requestLogger', () => ({
  logSecurityEvent: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: proxyRouteMocks.authenticate,
  AuthenticatedRequest: {},
}));

vi.mock('../../../src/middleware/rateLimit', () => ({
  defaultRateLimiter: proxyRouteMocks.defaultRateLimiter,
  transactionCreateRateLimiter: proxyRouteMocks.transactionCreateRateLimiter,
  broadcastRateLimiter: proxyRouteMocks.broadcastRateLimiter,
  deviceRegistrationRateLimiter: proxyRouteMocks.deviceRegistrationRateLimiter,
  addressGenerationRateLimiter: proxyRouteMocks.addressGenerationRateLimiter,
}));

vi.mock('../../../src/middleware/validateRequest', () => ({
  validateRequest: proxyRouteMocks.validateRequest,
}));

vi.mock('../../../src/middleware/mobilePermission', () => ({
  requireMobilePermission: proxyRouteMocks.requireMobilePermission,
}));

vi.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: vi.fn(() => proxyRouteMocks.proxy),
}));

// Import the actual module AFTER mocks are set up
import proxyRouter, {
  isAllowedRoute,
  ALLOWED_ROUTES,
  EXPLICIT_PROXY_ROUTE_CONTRACTS,
  GATEWAY_ROUTE_CONTRACTS,
  checkWhitelist,
} from '../../../src/routes/proxy';
import { logSecurityEvent } from '../../../src/middleware/requestLogger';
import { openApiSpec } from '../../../../server/src/api/openapi/spec';

type OpenApiPathKey = keyof typeof openApiSpec.paths;

describe('Proxy Routes', () => {
  function createProxyTestApp() {
    const app = express();
    app.use(express.json());
    app.use(proxyRouter);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ALLOWED_ROUTES', () => {
    it('should export the allowed routes array', () => {
      expect(ALLOWED_ROUTES).toBeDefined();
      expect(Array.isArray(ALLOWED_ROUTES)).toBe(true);
      expect(ALLOWED_ROUTES.length).toBeGreaterThan(0);
    });

    it('should have proper structure for each route', () => {
      ALLOWED_ROUTES.forEach((route) => {
        expect(route).toHaveProperty('method');
        expect(route).toHaveProperty('pattern');
        expect(typeof route.method).toBe('string');
        expect(route.pattern).toBeInstanceOf(RegExp);
      });
    });

    it('should include authentication routes', () => {
      const authRoutes = ALLOWED_ROUTES.filter((r) => r.pattern.source.includes('auth'));
      expect(authRoutes.length).toBeGreaterThan(0);
    });

    it('should include wallet routes', () => {
      const walletRoutes = ALLOWED_ROUTES.filter((r) => r.pattern.source.includes('wallets'));
      expect(walletRoutes.length).toBeGreaterThan(0);
    });

    it('should include push notification routes', () => {
      const pushRoutes = ALLOWED_ROUTES.filter((r) => r.pattern.source.includes('push'));
      expect(pushRoutes.length).toBeGreaterThan(0);
    });

    it('keeps every gateway whitelist route documented in OpenAPI', () => {
      expect(GATEWAY_ROUTE_CONTRACTS).toHaveLength(ALLOWED_ROUTES.length);
      for (const route of GATEWAY_ROUTE_CONTRACTS) {
        const openApiPath = route.openApiPath as OpenApiPathKey;

        expect(isAllowedRoute(route.method, route.samplePath)).toBe(true);
        expect(openApiSpec.paths).toHaveProperty(route.openApiPath);
        expect(openApiSpec.paths[openApiPath]).toHaveProperty(route.method.toLowerCase());
      }
    });

    it('keeps every gateway route decision explicit in the manifest', () => {
      for (const route of GATEWAY_ROUTE_CONTRACTS) {
        expect(route.expressPath).toMatch(/^\/api\/v1\//);
        expect(['public', 'authenticated']).toContain(route.auth);
        expect(['none', 'default', 'transactionCreate', 'broadcast', 'deviceRegistration', 'addressGeneration'])
          .toContain(route.rateLimiter);
        expect(['schema', 'none']).toContain(route.validation.mode);

        if (route.validation.mode === 'none') {
          expect(route.validation.reason.length).toBeGreaterThan(0);
        }
      }
    });

    it('keeps explicit proxy route registrations tied to whitelisted manifest entries', () => {
      expect(EXPLICIT_PROXY_ROUTE_CONTRACTS.length).toBeGreaterThan(0);

      for (const route of EXPLICIT_PROXY_ROUTE_CONTRACTS) {
        expect(GATEWAY_ROUTE_CONTRACTS).toContain(route);
        expect(isAllowedRoute(route.method, route.samplePath)).toBe(true);
      }
    });

    it('documents access control for authenticated writes without mobile permission middleware', () => {
      for (const route of GATEWAY_ROUTE_CONTRACTS) {
        if (
          route.auth === 'authenticated' &&
          route.method !== 'GET' &&
          !route.mobilePermission
        ) {
          expect(typeof route.accessControlReason, `${route.method} ${route.expressPath}`).toBe('string');
          expect(route.accessControlReason?.length ?? 0, `${route.method} ${route.expressPath}`).toBeGreaterThan(0);
        }
      }
    });

    it('requires wallet-scoped write routes to declare mobile permission or backend access control', () => {
      for (const route of GATEWAY_ROUTE_CONTRACTS) {
        const isWalletScopedWrite = route.method !== 'GET' &&
          (/\/api\/v1\/wallets\/:[^/]+/.test(route.expressPath) ||
            /\/api\/v1\/sync\/wallet\/:[^/]+/.test(route.expressPath));

        if (isWalletScopedWrite) {
          expect(
            Boolean(route.mobilePermission || route.accessControlReason),
            `${route.method} ${route.expressPath}`
          ).toBe(true);
        }
      }
    });
  });

  describe('manifest-driven proxy middleware registration', () => {
    it('keeps public routes unauthenticated while preserving validation and proxying', async () => {
      await request(createProxyTestApp())
        .post('/api/v1/auth/login')
        .send({ username: 'alice', password: 'Password123' })
        .expect(204);

      expect(proxyRouteMocks.authenticate).not.toHaveBeenCalled();
      expect(proxyRouteMocks.defaultRateLimiter).not.toHaveBeenCalled();
      expect(proxyRouteMocks.validateRequest).toHaveBeenCalled();
      expect(proxyRouteMocks.proxy).toHaveBeenCalled();
    });

    it('applies manifest rate limiter and mobile permission middleware to wallet writes', async () => {
      const walletId = '12345678-1234-1234-1234-123456789abc';

      await request(createProxyTestApp())
        .post(`/api/v1/wallets/${walletId}/transactions/create`)
        .send({ recipient: 'tb1qrecipient', amount: 1000, feeRate: 1 })
        .expect(204);

      expect(proxyRouteMocks.authenticate).toHaveBeenCalled();
      expect(proxyRouteMocks.transactionCreateRateLimiter).toHaveBeenCalled();
      expect(proxyRouteMocks.mobilePermissionMiddleware).toHaveBeenCalled();
      expect(proxyRouteMocks.validateRequest).toHaveBeenCalled();
      expect(proxyRouteMocks.proxy).toHaveBeenCalled();
    });

    it('uses the authenticated default catch-all for ordinary whitelisted reads', async () => {
      await request(createProxyTestApp())
        .get('/api/v1/wallets')
        .expect(204);

      expect(proxyRouteMocks.authenticate).toHaveBeenCalled();
      expect(proxyRouteMocks.defaultRateLimiter).toHaveBeenCalled();
      expect(proxyRouteMocks.mobilePermissionMiddleware).not.toHaveBeenCalled();
      expect(proxyRouteMocks.validateRequest).toHaveBeenCalled();
      expect(proxyRouteMocks.proxy).toHaveBeenCalled();
    });
  });

  describe('isAllowedRoute', () => {
    describe('Authentication routes', () => {
      it('should allow POST /api/v1/auth/login', () => {
        expect(isAllowedRoute('POST', '/api/v1/auth/login')).toBe(true);
      });

      it('should allow POST /api/v1/auth/refresh', () => {
        expect(isAllowedRoute('POST', '/api/v1/auth/refresh')).toBe(true);
      });

      it('should allow POST /api/v1/auth/logout', () => {
        expect(isAllowedRoute('POST', '/api/v1/auth/logout')).toBe(true);
      });

      it('should allow POST /api/v1/auth/logout-all', () => {
        expect(isAllowedRoute('POST', '/api/v1/auth/logout-all')).toBe(true);
      });

      it('should allow POST /api/v1/auth/2fa/verify', () => {
        expect(isAllowedRoute('POST', '/api/v1/auth/2fa/verify')).toBe(true);
      });

      it('should allow GET /api/v1/auth/me', () => {
        expect(isAllowedRoute('GET', '/api/v1/auth/me')).toBe(true);
      });

      it('should allow PATCH /api/v1/auth/me/preferences', () => {
        expect(isAllowedRoute('PATCH', '/api/v1/auth/me/preferences')).toBe(true);
      });

      it('should block GET /api/v1/auth/login (wrong method)', () => {
        expect(isAllowedRoute('GET', '/api/v1/auth/login')).toBe(false);
      });
    });

    describe('Session routes', () => {
      it('should allow GET /api/v1/auth/sessions', () => {
        expect(isAllowedRoute('GET', '/api/v1/auth/sessions')).toBe(true);
      });

      it('should allow DELETE /api/v1/auth/sessions/:uuid', () => {
        expect(isAllowedRoute('DELETE', '/api/v1/auth/sessions/12345678-1234-1234-1234-123456789abc')).toBe(true);
      });

      it('should block DELETE with invalid UUID', () => {
        expect(isAllowedRoute('DELETE', '/api/v1/auth/sessions/invalid-uuid')).toBe(false);
      });
    });

    describe('Wallet routes', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';

      it('should allow GET /api/v1/wallets', () => {
        expect(isAllowedRoute('GET', '/api/v1/wallets')).toBe(true);
      });

      it('should allow GET /api/v1/wallets/:id', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUuid}`)).toBe(true);
      });

      it('should allow POST /api/v1/sync/wallet/:id', () => {
        expect(isAllowedRoute('POST', `/api/v1/sync/wallet/${validUuid}`)).toBe(true);
      });

      it('should block legacy wallet-scoped sync route', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUuid}/sync`)).toBe(false);
      });

      it('should block POST /api/v1/wallets (create wallet)', () => {
        expect(isAllowedRoute('POST', '/api/v1/wallets')).toBe(false);
      });

      it('should block DELETE /api/v1/wallets/:id (delete wallet)', () => {
        expect(isAllowedRoute('DELETE', `/api/v1/wallets/${validUuid}`)).toBe(false);
      });
    });

    describe('Transaction routes', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';
      const validTxid = 'a'.repeat(64);

      it('should allow GET transactions list', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUuid}/transactions`)).toBe(true);
      });

      it('should allow GET single transaction by backend txid route', () => {
        expect(isAllowedRoute('GET', `/api/v1/transactions/${validTxid}`)).toBe(true);
      });

      it('should block malformed transaction txids', () => {
        expect(isAllowedRoute('GET', `/api/v1/transactions/${'a'.repeat(63)}`)).toBe(false);
        expect(isAllowedRoute('GET', `/api/v1/transactions/${'a'.repeat(65)}`)).toBe(false);
        expect(isAllowedRoute('GET', `/api/v1/transactions/${'A'.repeat(64)}`)).toBe(false);
      });

      it('should block legacy wallet-scoped single transaction route', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUuid}/transactions/${validTxid}`)).toBe(false);
      });

      it('should block raw transaction detail unless explicitly exposed', () => {
        expect(isAllowedRoute('GET', `/api/v1/transactions/${validTxid}/raw`)).toBe(false);
      });

      it('should allow POST transaction create', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUuid}/transactions/create`)).toBe(true);
      });

      it('should allow POST transaction estimate', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUuid}/transactions/estimate`)).toBe(true);
      });

      it('should allow POST transaction broadcast', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUuid}/transactions/broadcast`)).toBe(true);
      });

      it('should allow GET pending transactions', () => {
        expect(isAllowedRoute('GET', '/api/v1/transactions/pending')).toBe(true);
      });
    });

    describe('PSBT routes', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';

      it('should allow POST psbt create', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUuid}/psbt/create`)).toBe(true);
      });

      it('should allow POST psbt broadcast', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUuid}/psbt/broadcast`)).toBe(true);
      });
    });

    describe('Address routes', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';

      it('should allow GET addresses', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUuid}/addresses`)).toBe(true);
      });

      it('should allow POST generate address', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUuid}/addresses/generate`)).toBe(true);
      });
    });

    describe('UTXO routes', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';

      it('should allow GET utxos', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUuid}/utxos`)).toBe(true);
      });
    });

    describe('Label routes', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';

      it('should allow GET labels', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUuid}/labels`)).toBe(true);
      });

      it('should allow POST labels', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUuid}/labels`)).toBe(true);
      });

      it('should allow PUT wallet label', () => {
        expect(isAllowedRoute('PUT', `/api/v1/wallets/${validUuid}/labels/${validUuid}`)).toBe(true);
      });

      it('should allow DELETE wallet label', () => {
        expect(isAllowedRoute('DELETE', `/api/v1/wallets/${validUuid}/labels/${validUuid}`)).toBe(true);
      });

      it('should block legacy label item routes', () => {
        expect(isAllowedRoute('PATCH', `/api/v1/labels/${validUuid}`)).toBe(false);
        expect(isAllowedRoute('DELETE', `/api/v1/labels/${validUuid}`)).toBe(false);
      });
    });

    describe('Bitcoin status routes', () => {
      it('should allow GET bitcoin status', () => {
        expect(isAllowedRoute('GET', '/api/v1/bitcoin/status')).toBe(true);
      });

      it('should allow GET bitcoin fees', () => {
        expect(isAllowedRoute('GET', '/api/v1/bitcoin/fees')).toBe(true);
      });
    });

    describe('Price routes', () => {
      it('should allow GET price', () => {
        expect(isAllowedRoute('GET', '/api/v1/price')).toBe(true);
      });
    });

    describe('Push notification routes', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';

      it('should allow POST push register', () => {
        expect(isAllowedRoute('POST', '/api/v1/push/register')).toBe(true);
      });

      it('should allow DELETE push unregister', () => {
        expect(isAllowedRoute('DELETE', '/api/v1/push/unregister')).toBe(true);
      });

      it('should allow GET push devices', () => {
        expect(isAllowedRoute('GET', '/api/v1/push/devices')).toBe(true);
      });

      it('should allow DELETE push device by id', () => {
        expect(isAllowedRoute('DELETE', `/api/v1/push/devices/${validUuid}`)).toBe(true);
      });
    });

    describe('Device routes', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';

      it('should allow GET devices', () => {
        expect(isAllowedRoute('GET', '/api/v1/devices')).toBe(true);
      });

      it('should allow POST devices', () => {
        expect(isAllowedRoute('POST', '/api/v1/devices')).toBe(true);
      });

      it('should allow PATCH device', () => {
        expect(isAllowedRoute('PATCH', `/api/v1/devices/${validUuid}`)).toBe(true);
      });

      it('should allow DELETE device', () => {
        expect(isAllowedRoute('DELETE', `/api/v1/devices/${validUuid}`)).toBe(true);
      });
    });

    describe('Draft routes (multisig)', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';

      it('should allow GET drafts', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUuid}/drafts`)).toBe(true);
      });

      it('should allow GET single draft', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUuid}/drafts/${validUuid}`)).toBe(true);
      });

      it('should allow PATCH draft signing update', () => {
        expect(isAllowedRoute('PATCH', `/api/v1/wallets/${validUuid}/drafts/${validUuid}`)).toBe(true);
      });

      it('should block legacy draft signing route', () => {
        expect(isAllowedRoute('POST', `/api/v1/wallets/${validUuid}/drafts/${validUuid}/sign`)).toBe(false);
      });
    });

    describe('Mobile permission routes', () => {
      const validUuid = '12345678-1234-1234-1234-123456789abc';

      it('should allow GET mobile permissions', () => {
        expect(isAllowedRoute('GET', '/api/v1/mobile-permissions')).toBe(true);
      });

      it('should allow GET wallet mobile permissions', () => {
        expect(isAllowedRoute('GET', `/api/v1/wallets/${validUuid}/mobile-permissions`)).toBe(true);
      });

      it('should allow PATCH wallet mobile permissions', () => {
        expect(isAllowedRoute('PATCH', `/api/v1/wallets/${validUuid}/mobile-permissions`)).toBe(true);
      });

      it('should allow PATCH specific mobile permission', () => {
        expect(isAllowedRoute('PATCH', `/api/v1/wallets/${validUuid}/mobile-permissions/${validUuid}`)).toBe(true);
      });

      it('should allow DELETE mobile permission caps', () => {
        expect(isAllowedRoute('DELETE', `/api/v1/wallets/${validUuid}/mobile-permissions/${validUuid}/caps`)).toBe(true);
      });

      it('should allow DELETE mobile permissions', () => {
        expect(isAllowedRoute('DELETE', `/api/v1/wallets/${validUuid}/mobile-permissions`)).toBe(true);
      });
    });

    describe('Blocked routes (admin/sensitive)', () => {
      it('should block admin routes', () => {
        expect(isAllowedRoute('GET', '/api/v1/admin/users')).toBe(false);
        expect(isAllowedRoute('POST', '/api/v1/admin/settings')).toBe(false);
      });

      it('should block user management routes', () => {
        expect(isAllowedRoute('DELETE', '/api/v1/users/12345678-1234-1234-1234-123456789abc')).toBe(false);
        expect(isAllowedRoute('POST', '/api/v1/users')).toBe(false);
      });

      it('should block node configuration routes', () => {
        expect(isAllowedRoute('GET', '/api/v1/nodes')).toBe(false);
        expect(isAllowedRoute('POST', '/api/v1/nodes')).toBe(false);
      });

      it('should block arbitrary paths', () => {
        expect(isAllowedRoute('GET', '/api/v1/something-random')).toBe(false);
        expect(isAllowedRoute('POST', '/api/v2/wallets')).toBe(false);
      });
    });
  });

  describe('checkWhitelist middleware', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: ReturnType<typeof vi.fn>;
    let jsonMock: ReturnType<typeof vi.fn>;
    let statusMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      jsonMock = vi.fn();
      statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      mockNext = vi.fn();

      mockReq = {
        method: 'GET',
        path: '/api/v1/wallets',
        baseUrl: '', // Top-level routes have empty baseUrl
        ip: '127.0.0.1',
        headers: {
          'user-agent': 'test-agent',
        },
      };

      mockRes = {
        status: statusMock,
        json: jsonMock,
      };
    });

    it('should call next() for allowed routes', () => {
      mockReq.method = 'GET';
      mockReq.path = '/api/v1/wallets';
      mockReq.baseUrl = '';

      checkWhitelist(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should call next() for routes mounted under /api/v1', () => {
      // When mounted at /api/v1, path is stripped but baseUrl preserves it
      mockReq.method = 'GET';
      mockReq.path = '/wallets';
      mockReq.baseUrl = '/api/v1';

      checkWhitelist(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 403 for blocked routes', () => {
      mockReq.method = 'GET';
      mockReq.path = '/api/v1/admin/users';
      mockReq.baseUrl = '';

      checkWhitelist(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Forbidden',
        message: 'This endpoint is not available via the mobile API',
      });
    });

    it('should return 403 for blocked routes when mounted under /api/v1', () => {
      // When mounted at /api/v1, path is stripped but baseUrl preserves it
      mockReq.method = 'GET';
      mockReq.path = '/admin/users';
      mockReq.baseUrl = '/api/v1';

      checkWhitelist(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should log security event for blocked routes', () => {
      mockReq.method = 'POST';
      mockReq.path = '/api/v1/admin/settings';

      checkWhitelist(mockReq as Request, mockRes as Response, mockNext);

      expect(logSecurityEvent).toHaveBeenCalledWith('ROUTE_BLOCKED', expect.objectContaining({
        method: 'POST',
        path: '/api/v1/admin/settings',
        ip: '127.0.0.1',
        severity: 'low',
      }));
    });

    it('should include user ID in security log if authenticated', () => {
      mockReq.method = 'GET';
      mockReq.path = '/api/v1/admin/users';
      (mockReq as any).user = { userId: 'user-123', username: 'testuser' };

      checkWhitelist(mockReq as Request, mockRes as Response, mockNext);

      expect(logSecurityEvent).toHaveBeenCalledWith('ROUTE_BLOCKED', expect.objectContaining({
        userId: 'user-123',
      }));
    });

    it('should handle missing user-agent header', () => {
      mockReq.method = 'GET';
      mockReq.path = '/api/v1/something-blocked';
      mockReq.headers = {};

      checkWhitelist(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(logSecurityEvent).toHaveBeenCalled();
    });
  });
});
