/**
 * Mobile Permission Middleware Tests
 *
 * Tests the mobile permission checking middleware that enforces
 * wallet-level permissions for mobile API access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// Mock config before importing
vi.mock('../../../src/config', () => ({
  config: {
    backendUrl: 'http://localhost:3000',
    gatewaySecret: 'test-gateway-secret-32-characters-long',
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock request logger
vi.mock('../../../src/middleware/requestLogger', () => ({
  logSecurityEvent: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import the module after mocks
import { requireMobilePermission, ROUTE_ACTION_MAP } from '../../../src/middleware/mobilePermission';
import { logSecurityEvent } from '../../../src/middleware/requestLogger';

describe('Mobile Permission Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: ReturnType<typeof vi.fn>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    mockNext = vi.fn();

    mockReq = {
      params: { id: '12345678-1234-1234-1234-123456789abc' },
      path: '/api/v1/wallets/12345678-1234-1234-1234-123456789abc/transactions/create',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test-agent' },
    };

    mockRes = {
      status: statusMock,
      json: jsonMock,
    };

    // Reset fetch mock
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ROUTE_ACTION_MAP', () => {
    it('should export route action mappings', () => {
      expect(ROUTE_ACTION_MAP).toBeDefined();
      expect(typeof ROUTE_ACTION_MAP).toBe('object');
    });

    it('should map transaction routes correctly', () => {
      expect(ROUTE_ACTION_MAP['POST:/wallets/:id/transactions/create']).toBe('createTransaction');
      expect(ROUTE_ACTION_MAP['POST:/wallets/:id/transactions/estimate']).toBe('createTransaction');
      expect(ROUTE_ACTION_MAP['POST:/wallets/:id/transactions/broadcast']).toBe('broadcast');
    });

    it('should map PSBT routes correctly', () => {
      expect(ROUTE_ACTION_MAP['POST:/wallets/:id/psbt/create']).toBe('createTransaction');
      expect(ROUTE_ACTION_MAP['POST:/wallets/:id/psbt/broadcast']).toBe('broadcast');
    });

    it('should map address generation routes', () => {
      expect(ROUTE_ACTION_MAP['POST:/wallets/:id/addresses/generate']).toBe('generateAddress');
    });

    it('should map label management routes', () => {
      expect(ROUTE_ACTION_MAP['POST:/wallets/:id/labels']).toBe('manageLabels');
      expect(ROUTE_ACTION_MAP['PUT:/wallets/:id/labels/:labelId']).toBe('manageLabels');
      expect(ROUTE_ACTION_MAP['DELETE:/wallets/:id/labels/:labelId']).toBe('manageLabels');
    });

    it('should map draft signing routes', () => {
      expect(ROUTE_ACTION_MAP['PATCH:/wallets/:id/drafts/:draftId']).toBe('signPsbt');
    });
  });

  describe('requireMobilePermission', () => {
    describe('authentication checks', () => {
      it('should return 401 when no user is authenticated', async () => {
        const middleware = requireMobilePermission('createTransaction');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Unauthorized',
          message: 'Authentication required',
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should return 400 when walletId is missing', async () => {
        (mockReq as any).user = { userId: 'user-123', username: 'testuser' };
        mockReq.params = {}; // No id param

        const middleware = requireMobilePermission('createTransaction');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Bad Request',
          message: 'Wallet ID required for this operation',
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should accept walletId from params.walletId as fallback', async () => {
        (mockReq as any).user = { userId: 'user-123', username: 'testuser' };
        mockReq.params = { walletId: '12345678-1234-1234-1234-123456789abc' };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ allowed: true }),
        });

        const middleware = requireMobilePermission('createTransaction');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(mockNext).toHaveBeenCalled();
      });
    });

    describe('permission granted', () => {
      beforeEach(() => {
        (mockReq as any).user = { userId: 'user-123', username: 'testuser' };
      });

      it('should call next() when permission is granted', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ allowed: true }),
        });

        const middleware = requireMobilePermission('createTransaction');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(mockNext).toHaveBeenCalled();
        expect(statusMock).not.toHaveBeenCalled();
      });

      it('should send correct payload to backend', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ allowed: true }),
        });

        const middleware = requireMobilePermission('broadcast');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3000/internal/mobile-permissions/check',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
              'X-Gateway-Signature': expect.any(String),
              'X-Gateway-Timestamp': expect.any(String),
            }),
            body: expect.stringContaining('"action":"broadcast"'),
          })
        );
      });

      it('should include walletId and userId in payload', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ allowed: true }),
        });

        const middleware = requireMobilePermission('createTransaction');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);

        expect(body.walletId).toBe('12345678-1234-1234-1234-123456789abc');
        expect(body.userId).toBe('user-123');
        expect(body.action).toBe('createTransaction');
      });
    });

    describe('permission denied', () => {
      beforeEach(() => {
        (mockReq as any).user = { userId: 'user-123', username: 'testuser' };
      });

      it('should return 403 when permission is denied', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ allowed: false, reason: 'User does not have broadcast permission' }),
        });

        const middleware = requireMobilePermission('broadcast');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Forbidden',
          message: 'User does not have broadcast permission',
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should use default message when no reason provided', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ allowed: false }),
        });

        const middleware = requireMobilePermission('signPsbt');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Forbidden',
          message: 'Mobile access denied for action: signPsbt',
        });
      });

      it('should log security event when permission denied', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ allowed: false, reason: 'Not allowed' }),
        });

        const middleware = requireMobilePermission('createTransaction');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(logSecurityEvent).toHaveBeenCalledWith('MOBILE_PERMISSION_DENIED', expect.objectContaining({
          action: 'createTransaction',
          walletId: '12345678-1234-1234-1234-123456789abc',
          userId: 'user-123',
          reason: 'Not allowed',
          severity: 'medium',
        }));
      });
    });

    describe('error handling (fail closed)', () => {
      beforeEach(() => {
        (mockReq as any).user = { userId: 'user-123', username: 'testuser' };
      });

      it('should deny access when backend returns non-OK response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

        const middleware = requireMobilePermission('createTransaction');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Forbidden',
          message: 'Permission check failed',
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should deny access when fetch throws error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const middleware = requireMobilePermission('broadcast');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Forbidden',
          message: 'Permission check unavailable',
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should handle non-Error thrown values via String() fallback', async () => {
        mockFetch.mockRejectedValueOnce('string error');

        const middleware = requireMobilePermission('broadcast');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Forbidden',
          message: 'Permission check unavailable',
        });
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should deny access when backend is unreachable', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const middleware = requireMobilePermission('generateAddress');

        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        expect(statusMock).toHaveBeenCalledWith(403);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('different actions', () => {
      beforeEach(() => {
        (mockReq as any).user = { userId: 'user-123', username: 'testuser' };
        mockFetch.mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ allowed: true }),
        });
      });

      it('should work with viewBalance action', async () => {
        const middleware = requireMobilePermission('viewBalance');
        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.action).toBe('viewBalance');
      });

      it('should work with viewTransactions action', async () => {
        const middleware = requireMobilePermission('viewTransactions');
        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.action).toBe('viewTransactions');
      });

      it('should work with viewUtxos action', async () => {
        const middleware = requireMobilePermission('viewUtxos');
        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.action).toBe('viewUtxos');
      });

      it('should work with manageLabels action', async () => {
        const middleware = requireMobilePermission('manageLabels');
        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.action).toBe('manageLabels');
      });

      it('should work with manageDevices action', async () => {
        const middleware = requireMobilePermission('manageDevices');
        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.action).toBe('manageDevices');
      });

      it('should work with shareWallet action', async () => {
        const middleware = requireMobilePermission('shareWallet');
        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.action).toBe('shareWallet');
      });

      it('should work with deleteWallet action', async () => {
        const middleware = requireMobilePermission('deleteWallet');
        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.action).toBe('deleteWallet');
      });
    });

    describe('HMAC signature', () => {
      beforeEach(() => {
        (mockReq as any).user = { userId: 'user-123', username: 'testuser' };
      });

      it('should include signature header', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ allowed: true }),
        });

        const middleware = requireMobilePermission('createTransaction');
        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const fetchCall = mockFetch.mock.calls[0];
        expect(fetchCall[1].headers['X-Gateway-Signature']).toBeDefined();
        expect(typeof fetchCall[1].headers['X-Gateway-Signature']).toBe('string');
        expect(fetchCall[1].headers['X-Gateway-Signature'].length).toBe(64); // SHA256 hex
      });

      it('should include timestamp header', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ allowed: true }),
        });

        const middleware = requireMobilePermission('createTransaction');
        await middleware(mockReq as Request, mockRes as Response, mockNext as NextFunction);

        const fetchCall = mockFetch.mock.calls[0];
        expect(fetchCall[1].headers['X-Gateway-Timestamp']).toBeDefined();
        const timestamp = parseInt(fetchCall[1].headers['X-Gateway-Timestamp']);
        expect(timestamp).toBeGreaterThan(Date.now() - 10000); // Within last 10 seconds
        expect(timestamp).toBeLessThanOrEqual(Date.now());
      });
    });
  });
});
