/**
 * Authentication Middleware Tests
 *
 * Tests JWT token validation, extraction, and security controls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, optionalAuth, AuthenticatedRequest, JwtPayload } from '../../../src/middleware/auth';

// Mock the logger and security event logging
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

const JWT_SECRET = 'test-jwt-secret-minimum-32-chars-long';

describe('Auth Middleware', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockReq = {
      headers: {},
      path: '/api/v1/test',
      ip: '127.0.0.1',
    };

    mockRes = {
      status: statusMock,
      json: jsonMock,
    };

    mockNext = vi.fn();
  });

  function createValidToken(payload: Partial<JwtPayload> = {}): string {
    const defaultPayload: Omit<JwtPayload, 'iat' | 'exp'> = {
      userId: 'test-user-id',
      username: 'testuser',
      isAdmin: false,
      ...payload,
    };

    return jwt.sign(defaultPayload, JWT_SECRET, {
      expiresIn: '1h',
      audience: 'sanctuary:access',
    });
  }

  describe('authenticate', () => {
    it('should reject requests without authorization header', () => {
      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Missing authorization token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests with invalid authorization format', () => {
      mockReq.headers = { authorization: 'InvalidFormat token' };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject requests with missing Bearer prefix', () => {
      mockReq.headers = { authorization: 'token-without-bearer' };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject expired tokens', () => {
      const expiredToken = jwt.sign(
        { userId: 'test', username: 'test', isAdmin: false },
        JWT_SECRET,
        { expiresIn: '-1h', audience: 'sanctuary:access' }
      );
      mockReq.headers = { authorization: `Bearer ${expiredToken}` };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Token expired',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject tokens with invalid signature', () => {
      const invalidToken = jwt.sign(
        { userId: 'test', username: 'test', isAdmin: false },
        'wrong-secret-key-that-does-not-match',
        { expiresIn: '1h', audience: 'sanctuary:access' }
      );
      mockReq.headers = { authorization: `Bearer ${invalidToken}` };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject tokens with wrong audience', () => {
      const wrongAudienceToken = jwt.sign(
        { userId: 'test', username: 'test', isAdmin: false },
        JWT_SECRET,
        { expiresIn: '1h', audience: 'wrong:audience' }
      );
      mockReq.headers = { authorization: `Bearer ${wrongAudienceToken}` };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject verified tokens with non-object payloads', () => {
      mockReq.headers = { authorization: 'Bearer string-payload-token' };
      const verifySpy = vi.spyOn(jwt, 'verify').mockReturnValue('not-an-object' as never);

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
      expect(mockNext).not.toHaveBeenCalled();

      verifySpy.mockRestore();
    });

    it('should reject verified tokens with malformed access claims', () => {
      const malformedToken = jwt.sign(
        { userId: 'test', username: 'test', isAdmin: 'false' },
        JWT_SECRET,
        { expiresIn: '1h', audience: 'sanctuary:access' }
      );
      mockReq.headers = { authorization: `Bearer ${malformedToken}` };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject verified tokens missing user identity claims', () => {
      const malformedToken = jwt.sign(
        { username: 'test', isAdmin: false },
        JWT_SECRET,
        { expiresIn: '1h', audience: 'sanctuary:access' }
      );
      mockReq.headers = { authorization: `Bearer ${malformedToken}` };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject verified tokens with empty user identity claims', () => {
      const malformedToken = jwt.sign(
        { userId: '', username: 'test', isAdmin: false },
        JWT_SECRET,
        { expiresIn: '1h', audience: 'sanctuary:access' }
      );
      mockReq.headers = { authorization: `Bearer ${malformedToken}` };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject verified tokens with malformed optional claims', () => {
      const malformedToken = jwt.sign(
        { userId: 'test', username: 'test', isAdmin: false, jti: 123 },
        JWT_SECRET,
        { expiresIn: '1h', audience: 'sanctuary:access' }
      );
      mockReq.headers = { authorization: `Bearer ${malformedToken}` };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 500 on unexpected verification errors', () => {
      mockReq.headers = { authorization: 'Bearer any-token' };
      const verifySpy = vi.spyOn(jwt, 'verify').mockImplementation(() => {
        throw new Error('unexpected');
      });

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Internal Server Error' });
      expect(mockNext).not.toHaveBeenCalled();

      verifySpy.mockRestore();
    });

    it('should reject 2FA pending tokens', () => {
      const pending2FAToken = createValidToken({ pending2FA: true });
      mockReq.headers = { authorization: `Bearer ${pending2FAToken}` };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: '2FA verification required',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should accept valid tokens and attach user to request', () => {
      const validToken = createValidToken({
        userId: 'user-123',
        username: 'validuser',
        isAdmin: true,
      });
      mockReq.headers = { authorization: `Bearer ${validToken}` };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user?.userId).toBe('user-123');
      expect(mockReq.user?.username).toBe('validuser');
      expect(mockReq.user?.isAdmin).toBe(true);
    });

    it('should extract device ID from header when present', () => {
      const validToken = createValidToken();
      mockReq.headers = {
        authorization: `Bearer ${validToken}`,
        'x-device-id': 'device-abc-123',
      };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.deviceId).toBe('device-abc-123');
    });

    it('should not set deviceId when header is not a string', () => {
      const validToken = createValidToken();
      mockReq.headers = {
        authorization: `Bearer ${validToken}`,
        'x-device-id': ['multiple', 'values'],
      };

      authenticate(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.deviceId).toBeUndefined();
    });
  });

  describe('optionalAuth', () => {
    it('should continue without error when no token is provided', () => {
      optionalAuth(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });

    it('should attach user when valid token is provided', () => {
      const validToken = createValidToken({
        userId: 'optional-user',
        username: 'optionaluser',
      });
      mockReq.headers = { authorization: `Bearer ${validToken}` };

      optionalAuth(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeDefined();
      expect(mockReq.user?.userId).toBe('optional-user');
    });

    it('should continue without user when token is invalid', () => {
      mockReq.headers = { authorization: 'Bearer invalid-token' };

      optionalAuth(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });

    it('should not attach user for 2FA pending tokens', () => {
      const pending2FAToken = createValidToken({ pending2FA: true });
      mockReq.headers = { authorization: `Bearer ${pending2FAToken}` };

      optionalAuth(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });

    it('should continue without user when token is expired', () => {
      const expiredToken = jwt.sign(
        { userId: 'test', username: 'test', isAdmin: false },
        JWT_SECRET,
        { expiresIn: '-1h', audience: 'sanctuary:access' }
      );
      mockReq.headers = { authorization: `Bearer ${expiredToken}` };

      optionalAuth(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });
  });
});
