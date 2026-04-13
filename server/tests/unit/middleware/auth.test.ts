import { vi, Mock } from 'vitest';
/**
 * Authentication Middleware Tests
 *
 * Comprehensive tests for JWT authentication middleware covering:
 * - Token validation (valid, expired, invalid signature, malformed)
 * - Token extraction (Authorization header, missing token)
 * - Admin role checking
 * - 2FA token handling
 * - Edge cases
 */

import jwt from 'jsonwebtoken';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
  generateExpiredToken,
  generateInvalidSignatureToken,
  generate2FATestToken,
} from '../../helpers/testUtils';

// Mock dependencies
vi.mock('../../../src/utils/jwt');
vi.mock('../../../src/services/tokenRevocation');
vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    setUser: vi.fn(),
  },
}));

// Import after mocks
import { authenticate, requireAdmin, optionalAuth } from '../../../src/middleware/auth';
import { verifyToken, extractTokenFromHeader, TokenAudience } from '../../../src/utils/jwt';
import { isTokenRevoked } from '../../../src/services/tokenRevocation';
import { requestContext } from '../../../src/utils/requestContext';

describe('Authentication Middleware', () => {
  const validPayload = {
    userId: 'user-123',
    username: 'testuser',
    isAdmin: false,
    jti: 'token-jti-123',
  };

  const adminPayload = {
    userId: 'admin-456',
    username: 'adminuser',
    isAdmin: true,
    jti: 'token-jti-456',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authenticate middleware', () => {
    describe('JWT Token Validation', () => {
      it('should pass authentication with valid token', async () => {
        const token = 'valid-jwt-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(validPayload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect(extractTokenFromHeader).toHaveBeenCalledWith(`Bearer ${token}`);
        expect(verifyToken).toHaveBeenCalledWith(token, TokenAudience.ACCESS);
        expect((req as any).user).toEqual(validPayload);
        expect(requestContext.setUser).toHaveBeenCalledWith(
          validPayload.userId,
          validPayload.username
        );
        expect(next).toHaveBeenCalled();
      });

      it('should reject expired token', async () => {
        const token = 'expired-jwt-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('Token expired'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('Invalid or expired token');
        expect(next).not.toHaveBeenCalled();
        expect((req as any).user).toBeUndefined();
      });

      it('should reject token with invalid signature', async () => {
        const token = 'invalid-signature-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('Invalid token'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('Invalid or expired token');
        expect(next).not.toHaveBeenCalled();
      });

      it('should reject malformed token', async () => {
        const token = 'malformed-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('jwt malformed'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('Invalid or expired token');
        expect(next).not.toHaveBeenCalled();
      });

      it('should reject missing token', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: {},
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('No authentication token provided');
        expect(next).not.toHaveBeenCalled();
        expect(verifyToken).not.toHaveBeenCalled();
      });

      it('should reject token with wrong audience', async () => {
        const token = 'wrong-audience-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('jwt audience invalid'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('Invalid or expired token');
        expect(next).not.toHaveBeenCalled();
      });

      it('should reject revoked token', async () => {
        const token = 'revoked-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('Token has been revoked'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('Invalid or expired token');
        expect(next).not.toHaveBeenCalled();
      });
    });

    describe('Token Extraction', () => {
      it('should extract token from Authorization header with Bearer scheme', async () => {
        const token = 'valid-jwt-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(validPayload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect(extractTokenFromHeader).toHaveBeenCalledWith(`Bearer ${token}`);
        expect(next).toHaveBeenCalled();
      });

      it('should handle missing Authorization header', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: {},
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('No authentication token provided');
        expect(next).not.toHaveBeenCalled();
      });

      it('should handle undefined Authorization header', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: { authorization: undefined as any },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('No authentication token provided');
        expect(next).not.toHaveBeenCalled();
      });
    });

    describe('Cookie Token Source (ADR 0001)', () => {
      it('should authenticate from sanctuary_access cookie when no Authorization header is present', async () => {
        const cookieToken = 'cookie-jwt-token';
        (extractTokenFromHeader as Mock).mockReturnValue(null);
        (verifyToken as Mock).mockResolvedValue(validPayload);

        const req = createMockRequest({
          headers: {},
          cookies: { sanctuary_access: cookieToken },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect(verifyToken).toHaveBeenCalledWith(cookieToken, TokenAudience.ACCESS);
        expect((req as any).user).toEqual(validPayload);
        expect(requestContext.setUser).toHaveBeenCalledWith(
          validPayload.userId,
          validPayload.username
        );
        expect(next).toHaveBeenCalled();
      });

      it('should prefer Authorization header over cookie when both are present', async () => {
        const headerToken = 'header-jwt-token';
        const cookieToken = 'cookie-jwt-token';
        (extractTokenFromHeader as Mock).mockReturnValue(headerToken);
        (verifyToken as Mock).mockResolvedValue(validPayload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${headerToken}` },
          cookies: { sanctuary_access: cookieToken },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect(verifyToken).toHaveBeenCalledWith(headerToken, TokenAudience.ACCESS);
        expect(verifyToken).not.toHaveBeenCalledWith(cookieToken, expect.anything());
        expect(next).toHaveBeenCalled();
      });

      it('should reject when neither Authorization header nor sanctuary_access cookie is present', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: {},
          cookies: {},
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('No authentication token provided');
        expect(next).not.toHaveBeenCalled();
        expect(verifyToken).not.toHaveBeenCalled();
      });

      it('should reject when sanctuary_access cookie is an empty string', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: {},
          cookies: { sanctuary_access: '' },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('No authentication token provided');
        expect(next).not.toHaveBeenCalled();
        expect(verifyToken).not.toHaveBeenCalled();
      });

      it('should reject when sanctuary_access cookie value is invalid', async () => {
        const cookieToken = 'invalid-cookie-token';
        (extractTokenFromHeader as Mock).mockReturnValue(null);
        (verifyToken as Mock).mockRejectedValue(new Error('Invalid token'));

        const req = createMockRequest({
          headers: {},
          cookies: { sanctuary_access: cookieToken },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('Invalid or expired token');
        expect(next).not.toHaveBeenCalled();
      });

      it('should reject 2FA pending tokens delivered via cookie', async () => {
        const cookieToken = '2fa-cookie-token';
        (extractTokenFromHeader as Mock).mockReturnValue(null);
        (verifyToken as Mock).mockResolvedValue({ ...validPayload, pending2FA: true });

        const req = createMockRequest({
          headers: {},
          cookies: { sanctuary_access: cookieToken },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('2FA verification required');
        expect(next).not.toHaveBeenCalled();
        expect((req as any).user).toBeUndefined();
      });
    });

    describe('2FA Token Handling', () => {
      it('should reject 2FA pending tokens for regular endpoints', async () => {
        const token = '2fa-pending-token';
        const pending2FAPayload = {
          ...validPayload,
          pending2FA: true,
        };

        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(pending2FAPayload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('2FA verification required');
        expect(next).not.toHaveBeenCalled();
        expect((req as any).user).toBeUndefined();
        expect(requestContext.setUser).not.toHaveBeenCalled();
      });

      it('should accept tokens without pending2FA flag', async () => {
        const token = 'normal-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(validPayload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect((req as any).user).toEqual(validPayload);
        expect(next).toHaveBeenCalled();
      });

      it('should accept tokens with pending2FA explicitly set to false', async () => {
        const token = 'normal-token';
        const payloadWithFalse2FA = {
          ...validPayload,
          pending2FA: false,
        };

        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(payloadWithFalse2FA);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect((req as any).user).toEqual(payloadWithFalse2FA);
        expect(next).toHaveBeenCalled();
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty Authorization header', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: { authorization: '' },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('No authentication token provided');
        expect(next).not.toHaveBeenCalled();
      });

      it('should handle "Bearer" without token', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: { authorization: 'Bearer' },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('No authentication token provided');
        expect(next).not.toHaveBeenCalled();
      });

      it('should handle "Bearer " with space but no token', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: { authorization: 'Bearer ' },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('No authentication token provided');
        expect(next).not.toHaveBeenCalled();
      });

      it('should handle non-Bearer authorization scheme', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: { authorization: 'Basic dXNlcjpwYXNzd29yZA==' },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('No authentication token provided');
        expect(next).not.toHaveBeenCalled();
      });

      it('should set user context for valid token', async () => {
        const token = 'valid-jwt-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(validPayload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect(requestContext.setUser).toHaveBeenCalledWith(
          validPayload.userId,
          validPayload.username
        );
      });

      it('should not set user context for invalid token', async () => {
        const token = 'invalid-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('Invalid token'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect(requestContext.setUser).not.toHaveBeenCalled();
      });

      it('should handle token with missing jti', async () => {
        const token = 'token-without-jti';
        const payloadWithoutJti = {
          userId: 'user-123',
          username: 'testuser',
          isAdmin: false,
        };

        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(payloadWithoutJti);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect((req as any).user).toEqual(payloadWithoutJti);
        expect(next).toHaveBeenCalled();
      });

      it('should handle token with usingDefaultPassword flag', async () => {
        const token = 'default-password-token';
        const payloadWithDefaultPassword = {
          ...validPayload,
          usingDefaultPassword: true,
        };

        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(payloadWithDefaultPassword);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect((req as any).user).toEqual(payloadWithDefaultPassword);
        expect(next).toHaveBeenCalled();
      });
    });
  });

  describe('requireAdmin middleware', () => {
    describe('Admin Role Checking', () => {
      it('should allow access for admin users', () => {
        const req = createMockRequest({
          user: adminPayload,
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        expect(next).toHaveBeenCalled();
      });

      it('should deny access for non-admin users', () => {
        const req = createMockRequest({
          user: validPayload,
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(403);
        expect(response.body.error).toBe('Forbidden');
        expect(response.body.message).toBe('Admin access required');
        expect(next).not.toHaveBeenCalled();
      });

      it('should deny access when user is not authenticated', () => {
        const req = createMockRequest({
          // No user attached
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('Authentication required');
        expect(next).not.toHaveBeenCalled();
      });

      it('should deny access when user is undefined', () => {
        const req = createMockRequest({
          user: undefined,
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(response.body.message).toBe('Authentication required');
        expect(next).not.toHaveBeenCalled();
      });

      it('should deny access when isAdmin is false', () => {
        const req = createMockRequest({
          user: {
            userId: 'user-123',
            username: 'testuser',
            isAdmin: false,
          },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(403);
        expect(response.body.error).toBe('Forbidden');
        expect(response.body.message).toBe('Admin access required');
        expect(next).not.toHaveBeenCalled();
      });

      it('should deny access when isAdmin is missing', () => {
        const req = createMockRequest({
          user: {
            userId: 'user-123',
            username: 'testuser',
            isAdmin: undefined as any,
          },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(403);
        expect(response.body.message).toBe('Admin access required');
        expect(next).not.toHaveBeenCalled();
      });
    });
  });

  describe('optionalAuth middleware', () => {
    describe('Optional Authentication', () => {
      it('should attach user for valid token', async () => {
        const token = 'valid-jwt-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(validPayload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect(extractTokenFromHeader).toHaveBeenCalledWith(`Bearer ${token}`);
        expect(verifyToken).toHaveBeenCalledWith(token, TokenAudience.ACCESS);
        expect((req as any).user).toEqual(validPayload);
        expect(requestContext.setUser).toHaveBeenCalledWith(
          validPayload.userId,
          validPayload.username
        );
        expect(next).toHaveBeenCalled();
      });

      it('should continue without user when token is missing', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: {},
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toBeUndefined();
        expect(next).toHaveBeenCalled();
        expect(verifyToken).not.toHaveBeenCalled();
      });

      it('should continue without user when token is invalid', async () => {
        const token = 'invalid-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('Invalid token'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toBeUndefined();
        expect(next).toHaveBeenCalled();
        expect(requestContext.setUser).not.toHaveBeenCalled();
      });

      it('should continue without user when token is expired', async () => {
        const token = 'expired-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('Token expired'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toBeUndefined();
        expect(next).toHaveBeenCalled();
      });

      it('should not attach user for 2FA pending tokens', async () => {
        const token = '2fa-pending-token';
        const pending2FAPayload = {
          ...validPayload,
          pending2FA: true,
        };

        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(pending2FAPayload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toBeUndefined();
        expect(requestContext.setUser).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
      });

      it('should attach user for tokens with pending2FA = false', async () => {
        const token = 'normal-token';
        const payloadWithFalse2FA = {
          ...validPayload,
          pending2FA: false,
        };

        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockResolvedValue(payloadWithFalse2FA);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toEqual(payloadWithFalse2FA);
        expect(requestContext.setUser).toHaveBeenCalledWith(
          validPayload.userId,
          validPayload.username
        );
        expect(next).toHaveBeenCalled();
      });

      it('should continue when Authorization header is empty', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: { authorization: '' },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toBeUndefined();
        expect(next).toHaveBeenCalled();
      });

      it('should continue when token has wrong audience', async () => {
        const token = 'wrong-audience-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('jwt audience invalid'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toBeUndefined();
        expect(next).toHaveBeenCalled();
      });

      it('should continue when token is revoked', async () => {
        const token = 'revoked-token';
        (extractTokenFromHeader as Mock).mockReturnValue(token);
        (verifyToken as Mock).mockRejectedValue(new Error('Token has been revoked'));

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toBeUndefined();
        expect(next).toHaveBeenCalled();
      });

      it('should attach user from sanctuary_access cookie when no Authorization header is present', async () => {
        const cookieToken = 'cookie-jwt-token';
        (extractTokenFromHeader as Mock).mockReturnValue(null);
        (verifyToken as Mock).mockResolvedValue(validPayload);

        const req = createMockRequest({
          headers: {},
          cookies: { sanctuary_access: cookieToken },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect(verifyToken).toHaveBeenCalledWith(cookieToken, TokenAudience.ACCESS);
        expect((req as any).user).toEqual(validPayload);
        expect(next).toHaveBeenCalled();
      });

      it('should prefer Authorization header over cookie when both are present', async () => {
        const headerToken = 'header-jwt-token';
        const cookieToken = 'cookie-jwt-token';
        (extractTokenFromHeader as Mock).mockReturnValue(headerToken);
        (verifyToken as Mock).mockResolvedValue(validPayload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${headerToken}` },
          cookies: { sanctuary_access: cookieToken },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect(verifyToken).toHaveBeenCalledWith(headerToken, TokenAudience.ACCESS);
        expect(verifyToken).not.toHaveBeenCalledWith(cookieToken, expect.anything());
        expect(next).toHaveBeenCalled();
      });

      it('should continue without user when sanctuary_access cookie is empty', async () => {
        (extractTokenFromHeader as Mock).mockReturnValue(null);

        const req = createMockRequest({
          headers: {},
          cookies: { sanctuary_access: '' },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toBeUndefined();
        expect(verifyToken).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
      });

      it('should not attach 2FA pending users delivered via cookie', async () => {
        const cookieToken = '2fa-cookie-token';
        (extractTokenFromHeader as Mock).mockReturnValue(null);
        (verifyToken as Mock).mockResolvedValue({ ...validPayload, pending2FA: true });

        const req = createMockRequest({
          headers: {},
          cookies: { sanctuary_access: cookieToken },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect((req as any).user).toBeUndefined();
        expect(requestContext.setUser).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should allow authenticated user to pass both authenticate and requireAdmin for admin', async () => {
      const token = 'admin-token';
      (extractTokenFromHeader as Mock).mockReturnValue(token);
      (verifyToken as Mock).mockResolvedValue(adminPayload);

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const { res: res1 } = createMockResponse();
      const next1 = createMockNext();

      // First: authenticate
      await authenticate(req as any, res1 as any, next1);

      expect(next1).toHaveBeenCalled();
      expect((req as any).user).toEqual(adminPayload);

      // Second: requireAdmin
      const { res: res2 } = createMockResponse();
      const next2 = createMockNext();

      requireAdmin(req as any, res2 as any, next2);

      expect(next2).toHaveBeenCalled();
    });

    it('should block non-admin user at requireAdmin even after successful authentication', async () => {
      const token = 'user-token';
      (extractTokenFromHeader as Mock).mockReturnValue(token);
      (verifyToken as Mock).mockResolvedValue(validPayload);

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const { res: res1 } = createMockResponse();
      const next1 = createMockNext();

      // First: authenticate
      await authenticate(req as any, res1 as any, next1);

      expect(next1).toHaveBeenCalled();
      expect((req as any).user).toEqual(validPayload);

      // Second: requireAdmin - should fail
      const { res: res2, getResponse } = createMockResponse();
      const next2 = createMockNext();

      requireAdmin(req as any, res2 as any, next2);

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(response.body.message).toBe('Admin access required');
      expect(next2).not.toHaveBeenCalled();
    });

    it('should handle optionalAuth followed by requireAdmin correctly', async () => {
      const token = 'admin-token';
      (extractTokenFromHeader as Mock).mockReturnValue(token);
      (verifyToken as Mock).mockResolvedValue(adminPayload);

      const req = createMockRequest({
        headers: { authorization: `Bearer ${token}` },
      });
      const { res: res1 } = createMockResponse();
      const next1 = createMockNext();

      // First: optionalAuth
      await optionalAuth(req as any, res1 as any, next1);

      expect(next1).toHaveBeenCalled();
      expect((req as any).user).toEqual(adminPayload);

      // Second: requireAdmin
      const { res: res2 } = createMockResponse();
      const next2 = createMockNext();

      requireAdmin(req as any, res2 as any, next2);

      expect(next2).toHaveBeenCalled();
    });

    it('should fail requireAdmin when optionalAuth did not attach user', async () => {
      (extractTokenFromHeader as Mock).mockReturnValue(null);

      const req = createMockRequest({
        headers: {},
      });
      const { res: res1 } = createMockResponse();
      const next1 = createMockNext();

      // First: optionalAuth
      await optionalAuth(req as any, res1 as any, next1);

      expect(next1).toHaveBeenCalled();
      expect((req as any).user).toBeUndefined();

      // Second: requireAdmin - should fail
      const { res: res2, getResponse } = createMockResponse();
      const next2 = createMockNext();

      requireAdmin(req as any, res2 as any, next2);

      const response = getResponse();
      expect(response.statusCode).toBe(401);
      expect(response.body.message).toBe('Authentication required');
      expect(next2).not.toHaveBeenCalled();
    });
  });
});
