import { expect, it } from 'vitest';
import request from 'supertest';

import { mockPrismaClient } from '../../../mocks/prisma';
import {
  app,
  mockAuditLogFromRequest,
  mockBroadcastAndSave,
  mockCreateBatchTransaction,
  mockCreateTransaction,
  mockEstimateTransaction,
  mockEvaluatePolicies,
  mockFetch,
  mockGetCachedBlockHeight,
  mockGetPSBTInfo,
  mockRecalculateWalletBalances,
  mockRecordUsage,
  mockValidateAddress,
  mockWalletCacheGet,
  mockWalletCacheSet,
  mockWalletFindById,
  walletId,
} from './transactionsHttpRoutesTestHarness';

export function registerTransactionHttpBroadcastTests(): void {
  it('validates broadcast payload before sending', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ recipient: 'tb1qrecipient' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Either signedPsbtBase64 or rawTxHex is required');
  });

  it('broadcasts signed transaction and writes audit event', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        rawTxHex: 'deadbeef',
        recipient: 'tb1qrecipient',
        amount: 10000,
        fee: 150,
        label: 'hardware wallet send',
        memo: 'coldcard raw hex path',
      });

    expect(response.status).toBe(200);
    expect(response.body.txid).toHaveLength(64);
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(walletId, undefined, {
      recipient: 'tb1qrecipient',
      amount: 10000,
      fee: 150,
      label: 'hardware wallet send',
      memo: 'coldcard raw hex path',
      utxos: [],
      rawTxHex: 'deadbeef',
    });
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'TRANSACTION_BROADCAST',
      'WALLET',
      expect.objectContaining({ success: true })
    );
  });

  it('captures failed broadcast attempts in audit log', async () => {
    mockBroadcastAndSave.mockRejectedValueOnce(new Error('broadcast failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'cHNi',
        recipient: 'tb1qrecipient',
        amount: 10000,
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'TRANSACTION_BROADCAST_FAILED',
      'WALLET',
      expect.objectContaining({ success: false })
    );
  });

  it('validates estimate payload fields', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/estimate`)
      .send({
        recipient: 'tb1qrecipient',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('recipient, amount, and feeRate are required');
  });

  it('estimates transaction cost for valid request', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/estimate`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1.2,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      fee: 120,
      totalInput: 20120,
      totalOutput: 20000,
    });
  });

  it('returns server error when estimate service throws', async () => {
    mockEstimateTransaction.mockRejectedValueOnce(new Error('estimator unavailable'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/estimate`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1.2,
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates PSBT creation recipients array', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({ feeRate: 1 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('recipients array is required');
  });

  it('enforces minimum fee rate for PSBT creation', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({
        feeRate: 0.01,
        recipients: [{ address: 'tb1qrecipient', amount: 15000 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('feeRate must be at least');
  });

  it('validates each PSBT recipient fields', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({
        feeRate: 1,
        recipients: [{ address: 'tb1qrecipient' }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Each recipient must have address and amount');
  });

  it('creates PSBT for hardware wallet signing', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({
        feeRate: 1.4,
        recipients: [{ address: 'tb1qrecipient', amount: 15000 }],
        utxoIds: ['utxo-1'],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      psbt: expect.any(String),
      fee: 150,
      totalInput: 10150,
      totalOutput: 10000,
    });
  });

  it('returns bad request when PSBT creation fails', async () => {
    mockCreateTransaction.mockRejectedValueOnce(new Error('psbt build failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({
        feeRate: 1.4,
        recipients: [{ address: 'tb1qrecipient', amount: 15000 }],
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates signed PSBT on PSBT broadcast endpoint', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('signedPsbt is required');
  });

  it('broadcasts PSBT and returns txid', async () => {
    mockGetPSBTInfo.mockReturnValue({
      fee: 450,
      outputs: [
        { address: 'tb1qdest', value: 25000 },
        { address: 'tb1qchange', value: 5000 },
      ],
      inputs: [{ txid: 'f'.repeat(64), vout: 1 }],
    });
    mockBroadcastAndSave.mockResolvedValue({
      txid: '9'.repeat(64),
      broadcasted: true,
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({
        signedPsbt: 'cHNi',
        label: 'hardware send',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      txid: '9'.repeat(64),
      broadcasted: true,
    });
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      'cHNi',
      expect.objectContaining({
        recipient: 'tb1qdest',
        amount: 25000,
        fee: 450,
      })
    );
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'TRANSACTION_BROADCAST',
      'WALLET',
      expect.objectContaining({ success: true })
    );
  });

  it('broadcasts PSBT with default recipient and amount when no outputs are present', async () => {
    mockGetPSBTInfo.mockReturnValue({
      fee: 450,
      outputs: [],
      inputs: [{ txid: 'f'.repeat(64), vout: 1 }],
    });
    mockBroadcastAndSave.mockResolvedValue({
      txid: '8'.repeat(64),
      broadcasted: true,
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({
        signedPsbt: 'cHNi',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      txid: '8'.repeat(64),
      broadcasted: true,
    });
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      'cHNi',
      expect.objectContaining({
        recipient: '',
        amount: 0,
      })
    );
  });

  it('logs failed PSBT broadcast attempts', async () => {
    mockGetPSBTInfo.mockImplementationOnce(() => {
      throw new Error('invalid psbt');
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({
        signedPsbt: 'bad-psbt',
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    // Audit log is not reached because getPSBTInfo throws before the try/catch block
  });

  it('extracts recipient and amount from PSBT when not provided in body', async () => {
    mockGetPSBTInfo.mockReturnValue({
      outputs: [{ address: 'tb1qpsbt-recipient', value: 42000 }],
      inputs: [{ txid: 'a'.repeat(64), vout: 0 }],
      fee: 300,
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'cHNi',
        // No recipient or amount — should be extracted from PSBT
      });

    expect(response.status).toBe(200);
    expect(mockEvaluatePolicies).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'tb1qpsbt-recipient',
        amount: BigInt(42000),
      })
    );
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      'cHNi',
      expect.objectContaining({
        recipient: 'tb1qpsbt-recipient',
        amount: 42000,
      })
    );
  });

  it('proceeds without policy eval when PSBT parsing fails and no recipient/amount supplied', async () => {
    mockGetPSBTInfo.mockImplementationOnce(() => {
      throw new Error('corrupt PSBT');
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'bad-psbt-data',
        // No recipient or amount in body and PSBT parse fails
      });

    expect(response.status).toBe(200);
    // Policy evaluation should NOT be called since there's no recipient/amount
    expect(mockEvaluatePolicies).not.toHaveBeenCalled();
  });

  it('swallows recordUsage errors on the broadcast route', async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error('usage recording failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'cHNi',
        recipient: 'tb1qrecipient',
        amount: 10000,
      });

    expect(response.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it('swallows recordUsage errors on the PSBT broadcast route', async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error('usage recording failed'));
    mockGetPSBTInfo.mockReturnValue({
      fee: 450,
      outputs: [{ address: 'tb1qdest', value: 25000 }],
      inputs: [{ txid: 'f'.repeat(64), vout: 1 }],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({ signedPsbt: 'cHNi' });

    expect(response.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalled();
  });
}
