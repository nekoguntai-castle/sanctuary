import { describe, expect, it, type Mock } from 'vitest';

import { createMockRequest, createMockResponse, createMockNext } from '../../../helpers/testUtils';
import './authTestHarness';
import { authenticate } from '../../../../src/middleware/auth';
import { verifyToken, extractTokenFromHeader, TokenAudience } from '../../../../src/utils/jwt';
import { requestContext } from '../../../../src/utils/requestContext';
import { validPayload } from './authTestHarness';

export function registerAuthenticateMiddlewareContracts() {
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
}
