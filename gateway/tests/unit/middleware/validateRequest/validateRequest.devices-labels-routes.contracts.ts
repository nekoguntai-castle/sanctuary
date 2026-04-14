import { beforeEach, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import { loginSchema, validateRequest } from '../../../../src/middleware/validateRequest';
import { jsonMock, mockNext, mockReq, mockRes, statusMock } from './validateRequestTestHarness';

export function registerDeviceRequestValidationContracts() {
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
}

export function registerLabelValidationContracts() {
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
}

export function registerRoutesWithoutSchemasContracts() {
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
}
