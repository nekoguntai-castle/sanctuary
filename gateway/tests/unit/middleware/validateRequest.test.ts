/**
 * Request Validation Middleware Tests
 *
 * Tests Zod schema validation for incoming requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  validateRequest,
  validate,
  loginSchema,
  refreshTokenSchema,
  pushRegisterSchema,
  labelSchema,
} from '../../../src/middleware/validateRequest';

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Request Validation Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockReq = {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: {},
    };

    mockRes = {
      status: statusMock,
      json: jsonMock,
    };

    mockNext = vi.fn();
  });

  describe('validateRequest middleware', () => {
    describe('login validation', () => {
      beforeEach(() => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/auth/login';
      });

      it('should accept valid login request', () => {
        mockReq.body = { username: 'testuser', password: 'password123' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(statusMock).not.toHaveBeenCalled();
      });

      it('should reject login without username', () => {
        mockReq.body = { password: 'password123' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Bad Request',
            message: 'Validation failed',
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject login without password', () => {
        mockReq.body = { username: 'testuser' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject login with empty username', () => {
        mockReq.body = { username: '', password: 'password123' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject username that is too long', () => {
        mockReq.body = { username: 'a'.repeat(51), password: 'password123' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('refresh token validation', () => {
      beforeEach(() => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/auth/refresh';
      });

      it('should accept valid refresh request', () => {
        mockReq.body = { refreshToken: 'valid-refresh-token' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should accept refresh request with rotate flag', () => {
        mockReq.body = { refreshToken: 'valid-refresh-token', rotate: true };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject refresh without token', () => {
        mockReq.body = {};

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('push registration validation', () => {
      beforeEach(() => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/push/register';
      });

      it('should accept valid iOS push registration', () => {
        mockReq.body = {
          deviceToken: 'abc123devicetoken',
          platform: 'ios',
          deviceName: 'iPhone 15',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should accept valid Android push registration', () => {
        mockReq.body = {
          deviceToken: 'fcm-token-here',
          platform: 'android',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject invalid platform', () => {
        mockReq.body = {
          deviceToken: 'abc123',
          platform: 'windows',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining([
              expect.objectContaining({
                field: 'platform',
                message: 'Platform must be ios or android',
              }),
            ]),
          })
        );
      });

      it('should reject missing device token', () => {
        mockReq.body = { platform: 'ios' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
      });

      it('should reject device token that is too long', () => {
        mockReq.body = {
          deviceToken: 'a'.repeat(501),
          platform: 'ios',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
      });
    });

    describe('label validation', () => {
      beforeEach(() => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/labels';
      });

      it('should accept valid address label', () => {
        mockReq.body = {
          type: 'address',
          ref: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
          label: 'Exchange withdrawal',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should accept valid transaction label', () => {
        mockReq.body = {
          type: 'transaction',
          ref: 'abc123def456...',
          label: 'Monthly rent payment',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should accept valid UTXO label', () => {
        mockReq.body = {
          type: 'utxo',
          ref: 'txid:0',
          label: 'Cold storage',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject invalid label type', () => {
        mockReq.body = {
          type: 'wallet',
          ref: 'some-ref',
          label: 'Test',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
      });

      it('should reject empty label', () => {
        mockReq.body = {
          type: 'address',
          ref: 'bc1q...',
          label: '',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
      });

      it('should reject label that is too long', () => {
        mockReq.body = {
          type: 'address',
          ref: 'bc1q...',
          label: 'a'.repeat(501),
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
      });
    });

    describe('routes without schemas', () => {
      it('should pass through GET requests without validation', () => {
        mockReq.method = 'GET';
        mockReq.path = '/api/v1/wallets';

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should pass through DELETE requests without validation', () => {
        mockReq.method = 'DELETE';
        mockReq.path = '/api/v1/wallets/123';

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should pass through routes without defined schemas', () => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/some/undefined/route';
        mockReq.body = { anything: 'goes' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should return 500 when schema parsing throws unexpected errors', () => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/auth/login';
        mockReq.body = { username: 'alice', password: 'secret' };

        const parseSpy = vi.spyOn(loginSchema, 'parse').mockImplementation(() => {
          throw new Error('unexpected parser failure');
        });

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith({
          error: 'Internal Server Error',
          message: 'Request validation failed',
        });
        expect(mockNext).not.toHaveBeenCalled();

        parseSpy.mockRestore();
      });
    });
  });

  describe('validate factory function', () => {
    it('should create middleware that validates against provided schema', () => {
      const middleware = validate(loginSchema);
      mockReq.body = { username: 'test', password: 'pass' };

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject invalid data with created middleware', () => {
      const middleware = validate(loginSchema);
      mockReq.body = { username: 'test' }; // Missing password

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should forward non-zod errors to next()', () => {
      const middleware = validate({
        parse: () => {
          throw new Error('boom');
        },
      } as any);

      middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(statusMock).not.toHaveBeenCalled();
    });
  });

  describe('schema validation details', () => {
    describe('loginSchema', () => {
      it('should validate correct login data', () => {
        const result = loginSchema.safeParse({
          username: 'testuser',
          password: 'mypassword',
        });

        expect(result.success).toBe(true);
      });

      it('should reject non-string username', () => {
        const result = loginSchema.safeParse({
          username: 123,
          password: 'mypassword',
        });

        expect(result.success).toBe(false);
      });
    });

    describe('refreshTokenSchema', () => {
      it('should validate refresh token with optional rotate', () => {
        const result = refreshTokenSchema.safeParse({
          refreshToken: 'token123',
          rotate: true,
        });

        expect(result.success).toBe(true);
      });

      it('should validate refresh token without rotate', () => {
        const result = refreshTokenSchema.safeParse({
          refreshToken: 'token123',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('pushRegisterSchema', () => {
      it('should validate complete push registration', () => {
        const result = pushRegisterSchema.safeParse({
          deviceToken: 'token123',
          platform: 'ios',
          deviceName: 'My iPhone',
        });

        expect(result.success).toBe(true);
      });

      it('should validate push registration without optional deviceName', () => {
        const result = pushRegisterSchema.safeParse({
          deviceToken: 'token123',
          platform: 'android',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('labelSchema', () => {
      it('should accept all valid label types', () => {
        const types = ['address', 'transaction', 'utxo'];

        types.forEach((type) => {
          const result = labelSchema.safeParse({
            type,
            ref: 'some-reference',
            label: 'My Label',
          });

          expect(result.success).toBe(true);
        });
      });
    });
  });
});
