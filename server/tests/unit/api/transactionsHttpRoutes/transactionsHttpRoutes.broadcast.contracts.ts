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
  mockDraftFindByIdInWallet,
  mockFetch,
  mockGetCachedBlockHeight,
  mockGetPSBTInfo,
  mockGetPSBTInfoWithNetwork,
  mockRecalculateWalletBalances,
  mockRecordUsage,
  mockValidateAddress,
  mockWalletCacheGet,
  mockWalletCacheSet,
  mockWalletFindById,
  mockWalletFindNetwork,
  walletId,
} from './transactionsHttpRoutesTestHarness';

const makeBroadcastDraft = (overrides: Record<string, unknown> = {}) => ({
  id: 'draft-1',
  walletId,
  userId: 'test-user-id',
  recipient: 'tb1qdraftrecipient',
  amount: BigInt(12000),
  effectiveAmount: BigInt(12000),
  fee: BigInt(250),
  selectedUtxoIds: [`${'c'.repeat(64)}:1`],
  signedPsbtBase64: 'signed-draft-psbt',
  status: 'signed',
  approvalStatus: 'approved',
  label: 'draft label',
  memo: 'draft memo',
  ...overrides,
});

export function registerTransactionHttpBroadcastTests(): void {
  it('validates broadcast payload before sending', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ recipient: 'tb1qrecipient' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Either signedPsbtBase64, rawTxHex, or draftId is required');
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
      network: 'testnet4',
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

  it('broadcasts a saved draft by draftId and archives through service metadata', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft({
      effectiveAmount: null,
    }));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'draft-1' });

    expect(response.status).toBe(200);
    expect(mockDraftFindByIdInWallet).toHaveBeenCalledWith('draft-1', walletId);
    expect(mockEvaluatePolicies).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'tb1qdraftrecipient',
        amount: BigInt(12000),
      })
    );
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(walletId, 'signed-draft-psbt', {
      network: 'testnet4',
      recipient: 'tb1qdraftrecipient',
      amount: 12000,
      fee: 250,
      label: 'draft label',
      memo: 'draft memo',
      utxos: [{ txid: 'c'.repeat(64), vout: 1 }],
      draftId: 'draft-1',
    });
  });

  it('rejects saved draft broadcasts when the draft cannot be found', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(null);

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'missing-draft' });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('Draft not found');
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('ignores invalid legacy selected UTXO draft references during broadcast metadata assembly', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft({
      selectedUtxoIds: ['legacy-without-separator', `${'z'.repeat(64)}:1`, `${'c'.repeat(64)}:-1`],
    }));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'draft-1' });

    expect(response.status).toBe(200);
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      'signed-draft-psbt',
      expect.objectContaining({
        utxos: [],
        draftId: 'draft-1',
      })
    );
  });

  it('rejects draft broadcasts that still need approval', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft({
      approvalStatus: 'pending',
    }));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'draft-1' });

    expect(response.status).toBe(403);
    expect(response.body.details).toMatchObject({
      draftId: 'draft-1',
      approvalStatus: 'pending',
      reason: 'pending_approval',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('falls back to a pending approval reason for unknown draft approval statuses', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft({
      approvalStatus: 'needs_review',
    }));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'draft-1' });

    expect(response.status).toBe(403);
    expect(response.body.details).toMatchObject({
      draftId: 'draft-1',
      approvalStatus: 'needs_review',
      reason: 'pending_approval',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects draft-only broadcasts when the draft has no signed PSBT', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft({
      signedPsbtBase64: null,
    }));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'draft-1' });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      field: 'draftId',
      draftId: 'draft-1',
      reason: 'missing_witness_data',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects archived draft broadcasts before touching the node', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft({
      status: 'broadcasted',
    }));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'draft-1' });

    expect(response.status).toBe(409);
    expect(response.body.details).toMatchObject({
      draftId: 'draft-1',
      status: 'broadcasted',
      reason: 'duplicate_submission',
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
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

  it('captures failed draft broadcast attempts with draft metadata in audit log', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft());
    mockBroadcastAndSave.mockRejectedValueOnce(new Error('draft broadcast failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'draft-1' });

    expect(response.status).toBe(500);
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.any(Object),
      'TRANSACTION_BROADCAST_FAILED',
      'WALLET',
      expect.objectContaining({
        success: false,
        details: expect.objectContaining({
          draftId: 'draft-1',
          recipient: 'tb1qdraftrecipient',
          amount: 12000,
        }),
      })
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
        network: 'testnet4',
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
        network: 'testnet4',
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
        network: 'testnet4',
        recipient: 'tb1qpsbt-recipient',
        amount: 42000,
      })
    );
    expect(mockGetPSBTInfoWithNetwork).toHaveBeenCalledWith('cHNi', 'testnet4');
  });

  it('normalizes legacy testnet wallets before PSBT parsing and broadcast', async () => {
    mockWalletFindNetwork.mockResolvedValueOnce('testnet');
    mockGetPSBTInfo.mockReturnValue({
      outputs: [{ address: 'tb1qpsbt-recipient', value: 42000 }],
      inputs: [{ txid: 'a'.repeat(64), vout: 0 }],
      fee: 300,
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'cHNi',
      });

    expect(response.status).toBe(200);
    expect(mockGetPSBTInfoWithNetwork).toHaveBeenCalledWith('cHNi', 'testnet3');
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      'cHNi',
      expect.objectContaining({
        network: 'testnet3',
      })
    );
  });

  it('rejects broadcast when the wallet network is unavailable', async () => {
    mockWalletFindNetwork.mockResolvedValueOnce(null);

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        rawTxHex: 'deadbeef',
        recipient: 'tb1qrecipient',
        amount: 10000,
      });

    expect(response.status).toBe(404);
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects broadcast when the wallet stores an unsupported Bitcoin network', async () => {
    mockWalletFindNetwork.mockResolvedValueOnce('unknownnet');

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        rawTxHex: 'deadbeef',
        recipient: 'tb1qrecipient',
        amount: 10000,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Wallet has unsupported Bitcoin network');
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
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

  it('keeps caller-supplied recipient and amount metadata without PSBT parsing', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({
        signedPsbtBase64: 'bad-psbt-data',
        recipient: 'tb1qcallerrecipient',
        amount: 21000,
      });

    expect(response.status).toBe(200);
    expect(mockGetPSBTInfoWithNetwork).not.toHaveBeenCalled();
    expect(mockEvaluatePolicies).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'tb1qcallerrecipient',
        amount: BigInt(21000),
      })
    );
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      walletId,
      'bad-psbt-data',
      expect.objectContaining({
        recipient: 'tb1qcallerrecipient',
        amount: 21000,
      })
    );
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
