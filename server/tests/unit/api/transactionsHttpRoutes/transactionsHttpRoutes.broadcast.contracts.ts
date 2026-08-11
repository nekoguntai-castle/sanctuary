import { expect, it } from 'vitest';
import request from 'supertest';

import {
  app,
  mockAuditLogFromRequest,
  mockBroadcastAndSave,
  mockCreateTransaction,
  mockDraftFindByIdInWallet,
  mockEstimateTransaction,
  mockEvaluatePolicies,
  mockValidateSignedArtifact,
  mockWalletFindNetwork,
  mockWalletFindById,
  walletId,
} from './transactionsHttpRoutesTestHarness';

const intentHandle = {
  intentId: 'intent-http',
  intentDigest: 'a'.repeat(64),
};

const makeBroadcastDraft = (overrides: Record<string, unknown> = {}) => ({
  id: 'draft-1',
  walletId,
  userId: 'test-user-id',
  recipient: 'tb1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zjuhu9x',
  amount: BigInt(20000),
  effectiveAmount: BigInt(20000),
  fee: BigInt(400),
  selectedUtxoIds: [`${'b'.repeat(64)}:0`],
  signedPsbtBase64: 'signed-draft-psbt',
  signingIntentId: intentHandle.intentId,
  signingIntentDigest: intentHandle.intentDigest,
  status: 'signed',
  approvalStatus: 'approved',
  label: 'draft label',
  memo: 'draft memo',
  ...overrides,
});

const validBroadcastBody = {
  signedPsbtBase64: 'cHNi',
  ...intentHandle,
};

export function registerTransactionHttpBroadcastTests(): void {
  it('validates broadcast payload before sending', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ recipient: 'tb1qrecipient' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Either signedPsbtBase64, rawTxHex, or draftId is required');
    expect(mockValidateSignedArtifact).not.toHaveBeenCalled();
  });

  it('rejects ambiguous explicit broadcast sources before intent validation', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ signedPsbtBase64: 'cHNi', rawTxHex: 'deadbeef', ...intentHandle });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Provide either signedPsbtBase64 or rawTxHex, not both');
    expect(mockValidateSignedArtifact).not.toHaveBeenCalled();
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('submits only the validated artifact to the broadcast service', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send(validBroadcastBody);

    expect(
      response.status,
      JSON.stringify(mockAuditLogFromRequest.mock.calls.at(-1)?.[3]),
    ).toBe(200);
    expect(mockValidateSignedArtifact).toHaveBeenCalledWith({
      walletId,
      ...intentHandle,
      signedPsbtBase64: 'cHNi',
    });
    const artifact = await mockValidateSignedArtifact.mock.results[0].value;
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      artifact,
      expect.objectContaining({
        amount: 20000,
        fee: 400,
        utxos: [{ txid: 'b'.repeat(64), vout: 0 }],
      }),
    );
  });

  it('blocks an authenticated intent when vault policy denies it', async () => {
    mockEvaluatePolicies.mockResolvedValueOnce({ allowed: false, triggered: [] });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send(validBroadcastBody);

    expect(response.status).toBe(403);
    expect(mockValidateSignedArtifact).toHaveBeenCalled();
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('uses the signing-intent handle bound to an approved draft', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft());

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'draft-1' });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(mockValidateSignedArtifact).toHaveBeenCalledWith({
      walletId,
      ...intentHandle,
      signedPsbtBase64: 'signed-draft-psbt',
      draftId: 'draft-1',
    });
    expect(mockBroadcastAndSave).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ draftId: 'draft-1', label: 'draft label', memo: 'draft memo' }),
    );
  });

  it('rejects missing drafts before intent validation', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(null);

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'missing-draft' });

    expect(response.status).toBe(404);
    expect(mockValidateSignedArtifact).not.toHaveBeenCalled();
  });

  it('rejects drafts awaiting approval after validation determines this is not a replay', async () => {
    mockDraftFindByIdInWallet.mockResolvedValueOnce(makeBroadcastDraft({ approvalStatus: 'pending' }));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ draftId: 'draft-1' });

    expect(response.status).toBe(403);
    expect(response.body.details).toMatchObject({ reason: 'pending_approval', draftId: 'draft-1' });
    expect(mockValidateSignedArtifact).toHaveBeenCalledOnce();
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('rejects a validated artifact for the wrong wallet network', async () => {
    mockWalletFindNetwork.mockResolvedValueOnce('mainnet');

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send(validBroadcastBody);

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({ reason: 'wrong_network', field: 'network' });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });

  it('audits node submission failures after artifact validation', async () => {
    mockBroadcastAndSave.mockRejectedValueOnce(new Error('node rejected transaction'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send(validBroadcastBody);

    expect(response.status).toBe(500);
    expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
      expect.anything(),
      'TRANSACTION_BROADCAST_FAILED',
      'WALLET',
      expect.objectContaining({ success: false }),
    );
  });

  it('returns accepted when persistence needs reconciliation', async () => {
    mockBroadcastAndSave.mockResolvedValueOnce({
      txid: 'a'.repeat(64),
      broadcasted: true,
      persistenceStatus: 'pending_reconciliation',
    });

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send(validBroadcastBody);

    expect(response.status, JSON.stringify(response.body)).toBe(202);
    expect(response.body.persistenceStatus).toBe('pending_reconciliation');
  });

  it('requires and propagates the signing intent on PSBT broadcast', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/broadcast`)
      .send({ signedPsbt: 'cHNi', ...intentHandle });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(mockValidateSignedArtifact).toHaveBeenCalledWith({
      walletId,
      ...intentHandle,
      signedPsbtBase64: 'cHNi',
    });
  });

  it('validates estimate payload fields', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/estimate`)
      .send({ recipient: 'tb1qrecipient' });

    expect(response.status).toBe(400);
  });

  it('estimates transaction cost for valid request', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/estimate`)
      .send({ recipient: 'tb1qrecipient', amount: 10000, feeRate: 1.2 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ fee: 120, totalInput: 20120, totalOutput: 20000 });
  });

  it('returns server error when estimate service throws', async () => {
    mockEstimateTransaction.mockRejectedValueOnce(new Error('estimator unavailable'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/estimate`)
      .send({ recipient: 'tb1qrecipient', amount: 10000, feeRate: 1.2 });

    expect(response.status).toBe(500);
  });

  it('validates PSBT creation recipients array', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({ feeRate: 1 });

    expect(response.status).toBe(400);
  });

  it('creates PSBT for hardware wallet signing and returns its intent handle', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({
        feeRate: 1.4,
        recipients: [{ address: 'tb1qrecipient', amount: 15000 }],
        utxoIds: ['utxo-1'],
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ psbt: expect.any(String), ...intentHandle });
  });

  it('rejects hardware PSBT creation when the wallet disappears', async () => {
    mockWalletFindById.mockResolvedValueOnce(null);
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({ feeRate: 1.4, recipients: [{ address: 'tb1qrecipient', amount: 15000 }] });
    expect(response.status).toBe(404);
  });

  it('returns a server error when PSBT creation fails', async () => {
    mockCreateTransaction.mockRejectedValueOnce(new Error('psbt build failed'));

    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/psbt/create`)
      .send({ feeRate: 1.4, recipients: [{ address: 'tb1qrecipient', amount: 15000 }] });

    expect(response.status).toBe(500);
  });
}
