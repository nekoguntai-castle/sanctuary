import { beforeEach, expect, it } from 'vitest';
import type { Request, Response } from 'express';

import { validateRequest } from '../../../../src/middleware/validateRequest';
import { jsonMock, mockNext, mockReq, mockRes, statusMock } from './validateRequestTestHarness';

export function registerPushRegistrationValidationContracts() {
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
}

export function registerPushUnregistrationValidationContracts() {
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
}

export function registerMobilePermissionUpdateValidationContracts() {
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
}
