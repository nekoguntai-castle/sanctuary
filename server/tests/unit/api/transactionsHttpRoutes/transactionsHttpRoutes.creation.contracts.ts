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

export function registerTransactionHttpCreationTests(): void {
  it('recalculates wallet balances and returns final amount', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      balanceAfter: BigInt(123456),
    });

    const response = await request(app).post(`/api/v1/wallets/${walletId}/transactions/recalculate`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Balances recalculated',
      finalBalance: 123456,
      finalBalanceBtc: 0.00123456,
    });
    expect(mockRecalculateWalletBalances).toHaveBeenCalledWith(walletId);
  });

  it('returns zero balances when recalculation finds no final transaction', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

    const response = await request(app).post(`/api/v1/wallets/${walletId}/transactions/recalculate`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Balances recalculated',
      finalBalance: 0,
      finalBalanceBtc: 0,
    });
  });

  it('returns error when balance recalculation fails', async () => {
    mockRecalculateWalletBalances.mockRejectedValueOnce(new Error('recalc failed'));

    const response = await request(app).post(`/api/v1/wallets/${walletId}/transactions/recalculate`);

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates required fields for transaction creation', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({ recipient: 'tb1qrecipient' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('required');
  });

  it('enforces minimum fee rate for transaction creation', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 0.01,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('feeRate must be at least');
  });

  it('returns 404 when creating a transaction for missing wallet', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);
    mockWalletFindById.mockResolvedValue(null);

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1,
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Wallet not found');
  });

  it('rejects invalid recipient address during transaction creation', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockValidateAddress.mockReturnValueOnce({
      valid: false,
      error: 'bad checksum',
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'bad-address',
        amount: 10000,
        feeRate: 1,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid Bitcoin address');
  });

  it('creates transaction and returns PSBT payload', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'testnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'testnet' });
    mockCreateTransaction.mockResolvedValue({
      psbtBase64: 'cHNiYmFzZTY0',
      fee: 160,
      totalInput: 10160,
      totalOutput: 10000,
      changeAmount: 0,
      changeAddress: null,
      utxos: [],
      inputPaths: { '0': "m/84'/1'/0'/0/0" },
      effectiveAmount: 10000,
      decoyOutputs: [],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1.5,
        label: 'rent',
        memo: 'jan',
        sendMax: false,
      });

    expect(response.status).toBe(200);
    expect(response.body.psbtBase64).toBe('cHNiYmFzZTY0');
    expect(mockCreateTransaction).toHaveBeenCalledWith(
      walletId,
      'tb1qrecipient',
      10000,
      1.5,
      expect.objectContaining({
        label: 'rent',
        memo: 'jan',
      })
    );
  });

  it('returns 403 when vault policy blocks transaction creation', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockEvaluatePolicies.mockResolvedValueOnce({
      allowed: false,
      triggered: [{ policyId: 'p1', policyName: 'Daily Limit', type: 'spending_limit', action: 'blocked', reason: 'Exceeded daily limit' }],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1,
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(mockCreateTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 when vault policy blocks broadcast', async () => {
    mockEvaluatePolicies.mockResolvedValueOnce({
      allowed: false,
      triggered: [{ policyId: 'p1', policyName: 'Limit', type: 'spending_limit', action: 'blocked', reason: 'Over limit' }],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'cHNi',
        recipient: 'tb1qrecipient',
        amount: 50000,
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('returns 403 when vault policy blocks PSBT broadcast', async () => {
    mockGetPSBTInfo.mockReturnValue({
      outputs: [{ address: 'tb1qdest', value: 25000 }, { address: 'tb1qchange', value: 5000 }],
      inputs: [{ txid: 'f'.repeat(64), vout: 1 }],
      fee: 450,
    });
    mockEvaluatePolicies.mockResolvedValueOnce({
      allowed: false,
      triggered: [{ policyId: 'p1', policyName: 'Denylist', type: 'address_control', action: 'blocked', reason: 'Denied address' }],
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({ signedPsbt: 'cHNi' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('returns bad request when transaction creation service throws', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockCreateTransaction.mockRejectedValueOnce(new Error('insufficient funds'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/create`)
      .send({
        recipient: 'tb1qrecipient',
        amount: 10000,
        feeRate: 1,
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('validates batch transaction output list', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({ feeRate: 1 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('outputs array is required');
  });

  it('enforces minimum fee rate for batch transactions', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 0.01,
        outputs: [{ address: 'tb1qone', amount: 10000 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('feeRate must be at least');
  });

  it('rejects malformed batch transaction field types before wallet lookup', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: '1',
        outputs: [{ address: 'tb1qone', amount: 10000 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('feeRate');
    expect(mockWalletFindById).not.toHaveBeenCalled();
    expect(mockCreateBatchTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 when creating a batch transaction for missing wallet', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);
    mockWalletFindById.mockResolvedValue(null);

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ address: 'tb1qone', amount: 10000 }],
      });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Wallet not found');
  });

  it('validates that each batch output has an address', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ amount: 10000 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Output 1: address is required');
  });

  it('validates that each non-sendMax batch output has an amount', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ address: 'tb1qone' }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Output 1: amount is required');
  });

  it('rejects batch outputs with invalid recipient addresses', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockValidateAddress.mockReturnValueOnce({
      valid: false,
      error: 'invalid checksum',
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ address: 'bad-address', amount: 10000 }],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid Bitcoin address');
  });

  it('returns bad request when batch transaction creation throws', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockCreateBatchTransaction.mockRejectedValueOnce(new Error('batch create failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [{ address: 'tb1qone', amount: 10000 }],
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('rejects batch transaction when more than one output uses sendMax', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'mainnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'mainnet' });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1,
        outputs: [
          { address: 'tb1qone', sendMax: true },
          { address: 'tb1qtwo', sendMax: true },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Only one output can have sendMax');
  });

  it('creates batch transaction with validated outputs', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ id: walletId, network: 'testnet' });
    mockWalletFindById.mockResolvedValue({ id: walletId, network: 'testnet' });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/batch`)
      .send({
        feeRate: 1.2,
        outputs: [
          { address: 'tb1qone', amount: 10000 },
          { address: 'tb1qtwo', amount: 5000 },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.psbtBase64).toBe('cHNi');
    expect(mockCreateBatchTransaction).toHaveBeenCalledWith(
      walletId,
      expect.any(Array),
      1.2,
      expect.objectContaining({ enableRBF: true })
    );
  });
}
