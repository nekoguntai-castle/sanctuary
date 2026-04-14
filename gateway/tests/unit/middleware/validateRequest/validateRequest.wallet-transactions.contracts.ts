import { beforeEach, expect, it } from 'vitest';
import type { Request, Response } from 'express';

import { validateRequest } from '../../../../src/middleware/validateRequest';
import { mockNext, mockReq, mockRes, statusMock } from './validateRequestTestHarness';

export function registerDraftUpdateValidationContracts() {
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
}

export function registerTransactionRequestValidationContracts() {
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
}

export function registerPsbtRequestValidationContracts() {
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
}
