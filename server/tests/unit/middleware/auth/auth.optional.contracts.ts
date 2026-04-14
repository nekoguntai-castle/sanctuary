import { describe, expect, it, type Mock } from 'vitest';

import { createMockRequest, createMockResponse, createMockNext } from '../../../helpers/testUtils';
import './authTestHarness';
import { optionalAuth } from '../../../../src/middleware/auth';
import { verifyToken, extractTokenFromHeader, TokenAudience } from '../../../../src/utils/jwt';
import { requestContext } from '../../../../src/utils/requestContext';
import { validPayload } from './authTestHarness';

export function registerOptionalAuthMiddlewareContracts() {
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
}
