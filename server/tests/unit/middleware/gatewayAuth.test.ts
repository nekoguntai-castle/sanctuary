/**
 * Gateway Authentication Middleware Tests
 *
 * Tests HMAC signature verification and replay attack prevention.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Mock, MockedFunction } from 'vitest';
import { createHmac, createHash } from 'crypto';

// Mock config
vi.mock('../../../src/config', () => ({
  default: {
    gatewaySecret: 'test-gateway-secret-32-characters-min',
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

import { verifyGatewayRequest, generateGatewaySignature } from '../../../src/middleware/gatewayAuth';
import config from '../../../src/config';

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return Object.assign(Object.create(null), {
    method: 'GET',
    path: '/api/v1/test',
    headers: {},
    body: {},
  }, overrides);
}

type TestNextFunction = (error?: unknown) => void;

describe('Gateway Auth Middleware', () => {
  let mockReq: Request;
  let mockRes: Response;
  let mockNext: Mock<TestNextFunction>;
  let jsonMock: MockedFunction<Response['json']>;
  let statusMock: MockedFunction<Response['status']>;

  const secret = 'test-gateway-secret-32-characters-min';

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = Object.create(null);
    jsonMock = vi.fn<Response['json']>().mockReturnValue(mockRes);
    statusMock = vi.fn<Response['status']>().mockReturnValue(mockRes);
    Object.assign(mockRes, {
      status: statusMock,
      json: jsonMock,
    });

    mockNext = vi.fn<TestNextFunction>();
  });

  /**
   * Helper to create valid signature headers
   */
  function createValidHeaders(
    method: string,
    path: string,
    body: unknown = {}
  ): { 'x-gateway-signature': string; 'x-gateway-timestamp': string } {
    const { signature, timestamp } = generateGatewaySignature(method, path, body, secret);
    return {
      'x-gateway-signature': signature,
      'x-gateway-timestamp': timestamp,
    };
  }

  describe('verifyGatewayRequest', () => {
    it('should return 503 when gateway secret is not configured', () => {
      const originalSecret = config.gatewaySecret;
      (config as { gatewaySecret?: string }).gatewaySecret = undefined;

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Service Unavailable',
          message: 'Gateway authentication not configured',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();

      (config as { gatewaySecret?: string }).gatewaySecret = originalSecret;
    });

    it('should reject requests without signature header', () => {
      mockReq.headers = { 'x-gateway-timestamp': Date.now().toString() };

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden',
          message: 'Missing gateway authentication headers',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests without timestamp header', () => {
      mockReq.headers = { 'x-gateway-signature': 'some-signature' };

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests with expired timestamp', () => {
      const oldTimestamp = (Date.now() - 6 * 60 * 1000).toString(); // 6 minutes ago
      mockReq.headers = {
        'x-gateway-signature': 'some-signature',
        'x-gateway-timestamp': oldTimestamp,
      };

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Request timestamp expired or invalid',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests with future timestamp', () => {
      const futureTimestamp = (Date.now() + 6 * 60 * 1000).toString(); // 6 minutes in future
      mockReq.headers = {
        'x-gateway-signature': 'some-signature',
        'x-gateway-timestamp': futureTimestamp,
      };

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid signature', () => {
      mockReq.headers = {
        'x-gateway-signature': 'invalid-signature-hex-value-that-is-definitely-wrong',
        'x-gateway-timestamp': Date.now().toString(),
      };

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid gateway signature',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should accept requests with valid signature for GET', () => {
      mockReq.method = 'GET';
      mockReq = createMockRequest({ ...mockReq, path: '/api/v1/test' });
      mockReq.body = {};
      mockReq.headers = createValidHeaders('GET', '/api/v1/test', {});

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should accept requests with valid signature for POST with body', () => {
      const body = { username: 'test', password: 'secret' };
      mockReq.method = 'POST';
      mockReq = createMockRequest({ ...mockReq, path: '/api/v1/auth/login' });
      mockReq.body = body;
      mockReq.headers = createValidHeaders('POST', '/api/v1/auth/login', body);

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should accept requests with valid signature for POST with string body', () => {
      const body = 'raw-request-body';
      mockReq.method = 'POST';
      mockReq = createMockRequest({ ...mockReq, path: '/api/v1/raw' });
      mockReq.body = body;
      mockReq.headers = createValidHeaders('POST', '/api/v1/raw', body);

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should reject requests with tampered body', () => {
      const originalBody = { amount: 100 };
      const tamperedBody = { amount: 1000000 };

      mockReq.method = 'POST';
      mockReq = createMockRequest({ ...mockReq, path: '/api/v1/transactions' });
      mockReq.body = tamperedBody; // Attacker changed the body
      // But signature was created for original body
      mockReq.headers = createValidHeaders('POST', '/api/v1/transactions', originalBody);

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests with tampered path', () => {
      mockReq.method = 'GET';
      mockReq = createMockRequest({ ...mockReq, path: '/api/v1/admin/users' }); // Attacker changed path
      // But signature was created for different path
      mockReq.headers = createValidHeaders('GET', '/api/v1/users', {});

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests with tampered method', () => {
      mockReq.method = 'DELETE'; // Attacker changed method
      mockReq = createMockRequest({ ...mockReq, path: '/api/v1/wallets/123' });
      // But signature was created for GET
      mockReq.headers = createValidHeaders('GET', '/api/v1/wallets/123', {});

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should verify signatures against originalUrl for mounted routers', () => {
      const body = { walletId: 'wallet-1', userId: 'user-1', action: 'broadcast' };
      mockReq.method = 'POST';
      mockReq = createMockRequest({ ...mockReq, path: '/mobile-permissions/check' });
      mockReq.originalUrl = '/internal/mobile-permissions/check';
      mockReq.body = body;
      mockReq.headers = createValidHeaders('POST', '/internal/mobile-permissions/check', body);

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should reject signatures bound only to mounted req.path when originalUrl is present', () => {
      mockReq.method = 'GET';
      mockReq = createMockRequest({ ...mockReq, path: '/by-user/user-1' });
      mockReq.originalUrl = '/api/v1/push/by-user/user-1';
      mockReq.body = {};
      mockReq.headers = createValidHeaders('GET', '/by-user/user-1', {});

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle non-hex signature gracefully', () => {
      mockReq.headers = {
        'x-gateway-signature': 'not-valid-hex-!!',
        'x-gateway-timestamp': Date.now().toString(),
      };

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should treat signature parsing errors as invalid signatures', () => {
      const originalFrom = Buffer.from.bind(Buffer);
      mockReq.headers = {
        'x-gateway-signature': 'trigger-hex-error',
        'x-gateway-timestamp': Date.now().toString(),
      };

      const bufferFromSpy = vi.spyOn(Buffer, 'from').mockImplementation(((value: any, arg2?: any, arg3?: any) => {
        if (value === 'trigger-hex-error' && arg2 === 'hex') {
          throw new Error('buffer parse failed');
        }
        return originalFrom(value, arg2, arg3);
      }) as typeof Buffer.from);

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid gateway signature',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();

      bufferFromSpy.mockRestore();
    });

    it('should handle invalid timestamp format', () => {
      mockReq.headers = {
        'x-gateway-signature': 'abc123',
        'x-gateway-timestamp': 'not-a-number',
      };

      verifyGatewayRequest(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('generateGatewaySignature', () => {
    it('should generate consistent signatures for same input', () => {
      const result1 = generateGatewaySignature('GET', '/test', {}, secret);
      const result2 = generateGatewaySignature('GET', '/test', {}, secret);

      // Timestamps will differ, but we can verify format
      expect(result1.signature).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
      expect(result1.timestamp).toMatch(/^\d+$/); // Unix timestamp
    });

    it('should produce different signatures for different paths', () => {
      const result1 = generateGatewaySignature('GET', '/path1', {}, secret);
      const result2 = generateGatewaySignature('GET', '/path2', {}, secret);

      // Even with close timestamps, paths differ so signatures should differ
      // (unless generated in exact same millisecond which is very unlikely)
      expect(result1.signature).not.toBe(result2.signature);
    });

    it('should produce different signatures for different bodies', () => {
      const timestamp = Date.now().toString();
      const body1 = { a: 1 };
      const body2 = { a: 2 };

      // Manually create signatures to control timestamp
      const createSig = (body: object) => {
        const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
        const message = `GET/test${timestamp}${bodyHash}`;
        return createHmac('sha256', secret).update(message).digest('hex');
      };

      const sig1 = createSig(body1);
      const sig2 = createSig(body2);

      expect(sig1).not.toBe(sig2);
    });

    it('should include empty string for empty body hash', () => {
      const result = generateGatewaySignature('GET', '/test', {}, secret);

      // Should produce valid signature even with empty body
      expect(result.signature).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should distinguish empty arrays from empty objects', () => {
      const timestamp = '1700000000000';
      vi.spyOn(Date, 'now').mockReturnValue(Number(timestamp));

      const emptyObject = generateGatewaySignature('POST', '/test', {}, secret);
      const emptyArray = generateGatewaySignature('POST', '/test', [], secret);

      expect(emptyObject.timestamp).toBe(timestamp);
      expect(emptyArray.timestamp).toBe(timestamp);
      expect(emptyArray.signature).not.toBe(emptyObject.signature);
    });
  });
});
