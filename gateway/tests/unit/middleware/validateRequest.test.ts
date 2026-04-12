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
  pushUnregisterSchema,
  twoFactorVerifySchema,
  userPreferencesSchema,
  labelSchema,
  mobilePermissionUpdateSchema,
  draftUpdateSchema,
  transactionCreateSchema,
  transactionEstimateSchema,
  transactionBroadcastSchema,
  psbtCreateSchema,
  psbtBroadcastSchema,
  createDeviceSchema,
  updateDeviceSchema,
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

    describe('2FA verification validation', () => {
      beforeEach(() => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/auth/2fa/verify';
      });

      it('should accept valid 2FA verification request', () => {
        mockReq.body = { tempToken: 'temp-token', code: '123456' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject missing temp token', () => {
        mockReq.body = { code: '123456' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject missing verification code', () => {
        mockReq.body = { tempToken: 'temp-token' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('user preferences validation', () => {
      beforeEach(() => {
        mockReq.method = 'PATCH';
        mockReq.path = '/api/v1/auth/me/preferences';
      });

      it('should accept valid user preference updates', () => {
        mockReq.body = {
          unit: 'sats',
          fiatCurrency: 'usd',
          showFiat: true,
          notificationSounds: {
            enabled: true,
            volume: 65,
          },
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject invalid user preference values', () => {
        mockReq.body = {
          unit: 'bits',
          notificationSounds: {
            volume: 101,
          },
        };

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
          token: 'abc123devicetoken',
          platform: 'ios',
          deviceName: 'iPhone 15',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should accept valid Android push registration', () => {
        mockReq.body = {
          token: 'fcm-token-here',
          platform: 'android',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject invalid platform', () => {
        mockReq.body = {
          token: 'abc123',
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
          token: 'a'.repeat(501),
          platform: 'ios',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
      });

      it('should reject the legacy gateway-only deviceToken field', () => {
        mockReq.body = {
          deviceToken: 'abc123',
          platform: 'ios',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining([
              expect.objectContaining({
                field: 'token',
                message: 'Device token is required',
              }),
            ]),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('push unregistration validation', () => {
      beforeEach(() => {
        mockReq.method = 'DELETE';
        mockReq.path = '/api/v1/push/unregister';
      });

      it('should accept valid push unregistration request', () => {
        mockReq.body = { token: 'abc123devicetoken' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject missing device token', () => {
        mockReq.body = {};

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should validate schema routes mounted through /api/v1', () => {
        mockReq.baseUrl = '/api/v1';
        mockReq.path = '/push/unregister';
        mockReq.body = {};

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('mobile permission update validation', () => {
      beforeEach(() => {
        mockReq.method = 'PATCH';
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/mobile-permissions';
      });

      it('should accept valid mobile permission updates', () => {
        mockReq.body = {
          broadcast: false,
          managePolicies: true,
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject unknown mobile permission keys', () => {
        mockReq.body = {
          invalidPermission: true,
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject non-boolean mobile permission values', () => {
        mockReq.body = {
          broadcast: 'false',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject empty mobile permission updates', () => {
        mockReq.body = {};

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should validate owner cap routes mounted through /api/v1', () => {
        mockReq.baseUrl = '/api/v1';
        mockReq.path = '/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/mobile-permissions/b1b2c3d4-e5f6-7890-abcd-ef1234567890';
        mockReq.body = { invalidPermission: true };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('draft update validation', () => {
      beforeEach(() => {
        mockReq.method = 'PATCH';
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/drafts/b1b2c3d4-e5f6-7890-abcd-ef1234567890';
      });

      it('should accept valid draft signing updates', () => {
        mockReq.body = {
          signedPsbtBase64: 'cHNidP8BAHECAAAAAQ==',
          signedDeviceId: 'device-1',
          status: 'partial',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject invalid draft status values', () => {
        mockReq.body = {
          status: 'broadcasted',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject unknown draft update fields', () => {
        mockReq.body = {
          rawTransaction: 'deadbeef',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('transaction request validation', () => {
      beforeEach(() => {
        mockReq.method = 'POST';
      });

      it('should accept valid transaction create requests', () => {
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/transactions/create';
        mockReq.body = {
          recipient: 'tb1qrecipient',
          amount: 10000,
          feeRate: 0.5,
          selectedUtxoIds: ['utxo-1'],
          enableRBF: true,
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject transaction create requests below backend fee floor', () => {
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/transactions/create';
        mockReq.body = {
          recipient: 'tb1qrecipient',
          amount: 10000,
          feeRate: 0.01,
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject transaction estimate requests with missing fields', () => {
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/transactions/estimate';
        mockReq.body = {
          recipient: 'tb1qrecipient',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should accept transaction broadcast requests with raw transaction hex', () => {
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/transactions/broadcast';
        mockReq.body = {
          rawTxHex: 'deadbeef',
          recipient: 'tb1qrecipient',
          amount: 10000,
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject transaction broadcast requests without signed payload', () => {
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/transactions/broadcast';
        mockReq.body = {
          recipient: 'tb1qrecipient',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('PSBT request validation', () => {
      beforeEach(() => {
        mockReq.method = 'POST';
      });

      it('should accept valid PSBT create requests', () => {
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/psbt/create';
        mockReq.body = {
          recipients: [{ address: 'tb1qrecipient', amount: 15000 }],
          feeRate: 0.5,
          utxoIds: ['utxo-1'],
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject PSBT create requests without recipients', () => {
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/psbt/create';
        mockReq.body = {
          feeRate: 1,
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should accept valid PSBT broadcast requests', () => {
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/psbt/broadcast';
        mockReq.body = {
          signedPsbt: 'cHNi',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject PSBT broadcast requests without signed PSBT', () => {
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/psbt/broadcast';
        mockReq.body = {};

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('device request validation', () => {
      it('should accept legacy single-account device create requests', () => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/devices';
        mockReq.body = {
          type: 'trezor',
          label: 'My Trezor',
          fingerprint: 'abc12345',
          xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWV',
          derivationPath: "m/84'/0'/0'",
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should accept multi-account device create requests', () => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/devices';
        mockReq.body = {
          type: 'trezor',
          label: 'My Trezor',
          fingerprint: 'abc12345',
          accounts: [
            {
              purpose: 'single_sig',
              scriptType: 'native_segwit',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub-single',
            },
          ],
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject device create requests without xpub or accounts', () => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/devices';
        mockReq.body = {
          type: 'trezor',
          label: 'My Trezor',
          fingerprint: 'abc12345',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject device account entries with invalid purpose', () => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/devices';
        mockReq.body = {
          type: 'trezor',
          label: 'My Trezor',
          fingerprint: 'abc12345',
          accounts: [
            {
              purpose: 'shared',
              scriptType: 'native_segwit',
              derivationPath: "m/84'/0'/0'",
              xpub: 'xpub-single',
            },
          ],
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should accept device update requests', () => {
        mockReq.method = 'PATCH';
        mockReq.path = '/api/v1/devices/a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        mockReq.body = {
          label: 'Updated Label',
          modelSlug: 'trezor-model-t',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });
    });

    describe('label validation', () => {
      beforeEach(() => {
        mockReq.method = 'POST';
        mockReq.path = '/api/v1/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/labels';
      });

      it('should accept valid label create request', () => {
        mockReq.body = {
          name: 'Exchange withdrawal',
          color: '#22c55e',
          description: 'Incoming exchange funds',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should accept label create request without optional fields', () => {
        mockReq.body = {
          name: 'Cold storage',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalled();
      });

      it('should reject missing label name', () => {
        mockReq.body = { color: '#22c55e' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
      });

      it('should reject empty label name', () => {
        mockReq.body = {
          name: '',
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
      });

      it('should reject label name that is too long', () => {
        mockReq.body = {
          name: 'a'.repeat(101),
        };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
      });

      it('should validate schema routes mounted through /api/v1', () => {
        mockReq.method = 'PUT';
        mockReq.baseUrl = '/api/v1';
        mockReq.path = '/wallets/a1b2c3d4-e5f6-7890-abcd-ef1234567890/labels/b1b2c3d4-e5f6-7890-abcd-ef1234567890';
        mockReq.body = { name: '' };

        validateRequest(mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            details: expect.arrayContaining([
              expect.objectContaining({
                field: 'name',
                message: 'Label name is required',
              }),
            ]),
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
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
          token: 'token123',
          platform: 'ios',
          deviceName: 'My iPhone',
        });

        expect(result.success).toBe(true);
      });

      it('should validate push registration without optional deviceName', () => {
        const result = pushRegisterSchema.safeParse({
          token: 'token123',
          platform: 'android',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('pushUnregisterSchema', () => {
      it('should validate push unregistration payloads', () => {
        const result = pushUnregisterSchema.safeParse({
          token: 'token123',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('twoFactorVerifySchema', () => {
      it('should validate 2FA verification payloads', () => {
        const result = twoFactorVerifySchema.safeParse({
          tempToken: 'temp-token',
          code: '123456',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('userPreferencesSchema', () => {
      it('should validate known user preference payloads and allow unknown preferences', () => {
        const result = userPreferencesSchema.safeParse({
          fiatCurrency: 'usd',
          customPreference: true,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('mobilePermissionUpdateSchema', () => {
      it('should validate mobile permission update payloads', () => {
        const result = mobilePermissionUpdateSchema.safeParse({
          broadcast: false,
          managePolicies: true,
        });

        expect(result.success).toBe(true);
      });

      it('should reject empty mobile permission update payloads', () => {
        const result = mobilePermissionUpdateSchema.safeParse({});

        expect(result.success).toBe(false);
      });
    });

    describe('draftUpdateSchema', () => {
      it('should validate draft update payloads', () => {
        const result = draftUpdateSchema.safeParse({
          signedPsbtBase64: 'cHNidP8BAHECAAAAAQ==',
          signedDeviceId: 'device-1',
          status: 'signed',
        });

        expect(result.success).toBe(true);
      });
    });

    describe('transaction and PSBT schemas', () => {
      it('should validate transaction create payloads', () => {
        const result = transactionCreateSchema.safeParse({
          recipient: 'tb1qrecipient',
          amount: 10000,
          feeRate: 0.5,
        });

        expect(result.success).toBe(true);
      });

      it('should validate transaction estimate payloads', () => {
        const result = transactionEstimateSchema.safeParse({
          recipient: 'tb1qrecipient',
          amount: 10000,
          feeRate: 0.5,
        });

        expect(result.success).toBe(true);
      });

      it('should validate transaction broadcast payloads', () => {
        const result = transactionBroadcastSchema.safeParse({
          signedPsbtBase64: 'cHNi',
        });

        expect(result.success).toBe(true);
      });

      it('should validate PSBT create and broadcast payloads', () => {
        expect(psbtCreateSchema.safeParse({
          recipients: [{ address: 'tb1qrecipient', amount: 10000 }],
          feeRate: 0.5,
        }).success).toBe(true);
        expect(psbtBroadcastSchema.safeParse({
          signedPsbt: 'cHNi',
        }).success).toBe(true);
      });
    });

    describe('device schemas', () => {
      it('should validate device create and update payloads', () => {
        expect(createDeviceSchema.safeParse({
          type: 'trezor',
          label: 'My Trezor',
          fingerprint: 'abc12345',
          xpub: 'xpub-single',
        }).success).toBe(true);
        expect(updateDeviceSchema.safeParse({
          label: 'Updated Label',
        }).success).toBe(true);
      });
    });

    describe('labelSchema', () => {
      it('should validate backend label create payloads', () => {
        const result = labelSchema.safeParse({
          name: 'My Label',
          color: '#22c55e',
          description: 'Useful context',
        });

        expect(result.success).toBe(true);
      });
    });
  });
});
