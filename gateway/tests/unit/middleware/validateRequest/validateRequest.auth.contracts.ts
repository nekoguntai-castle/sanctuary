import { beforeEach, expect, it } from 'vitest';
import type { Request, Response } from 'express';

import { validateRequest } from '../../../../src/middleware/validateRequest';
import { jsonMock, mockNext, mockReq, mockRes, statusMock } from './validateRequestTestHarness';

export function registerLoginValidationContracts() {
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
}

export function registerRefreshTokenValidationContracts() {
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
}

export function registerTwoFactorVerificationContracts() {
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
}

export function registerUserPreferencesValidationContracts() {
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
}
