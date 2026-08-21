import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  validateSignedArtifact: vi.fn(),
  broadcastAndSave: vi.fn(),
  findNetwork: vi.fn(),
  findAddressStrings: vi.fn(),
  findDraft: vi.fn(),
  findLinkedDraft: vi.fn(),
  evaluatePolicies: vi.fn(),
  recordUsage: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../../../src/repositories/addressRepository', () => ({
  addressRepository: { findAddressStrings: mocks.findAddressStrings },
}));
vi.mock('../../../src/repositories/draftRepository', () => ({
  draftRepository: { findByIdInWallet: mocks.findDraft },
}));
vi.mock('../../../src/repositories/walletRepository', () => ({
  walletRepository: { findNetwork: mocks.findNetwork },
}));
vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId;
    req.user = { userId: 'user-1' };
    next();
  },
}));
vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user,
}));
vi.mock('../../../src/services/auditService', () => ({
  auditService: { logFromRequest: mocks.audit },
  AuditAction: { TRANSACTION_BROADCAST: 'broadcast', TRANSACTION_BROADCAST_FAILED: 'failed' },
  AuditCategory: { WALLET: 'wallet' },
}));
vi.mock('../../../src/services/vaultPolicy', () => ({
  policyEvaluationEngine: {
    evaluatePolicies: mocks.evaluatePolicies,
    recordUsage: mocks.recordUsage,
  },
}));
vi.mock('../../../src/services/bitcoin/signingIntent', () => ({
  validateSignedArtifact: mocks.validateSignedArtifact,
  findDraftBySigningIntent: mocks.findLinkedDraft,
}));
vi.mock('../../../src/services/bitcoin/transactions/broadcasting', () => ({
  broadcastAndSave: mocks.broadcastAndSave,
}));
vi.mock('../../../src/services/bitcoin/utils', () => ({
  getNetwork: () => ({
    messagePrefix: '\u0018Bitcoin Signed Message:\n',
    bech32: 'tb',
    bip32: { public: 0x043587cf, private: 0x04358394 },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
  }),
}));

import router from '../../../src/api/transactions/broadcasting';
import { errorHandler } from '../../../src/errors/errorHandler';

const artifact = {
  walletId: 'wallet-1',
  network: 'testnet3',
  txid: '9'.repeat(64),
  rawTx: '00',
  intent: { intentId: 'intent-1', intentDigest: 'a'.repeat(64) },
  snapshot: {
    version: 1,
    walletId: 'wallet-1',
    network: 'testnet3',
    transaction: {
      version: 2,
      locktime: 0,
      inputs: [{
        txid: '1'.repeat(64), vout: 0, sequence: 0xfffffffd,
        prevout: { amountSats: '10000', scriptPubKeyHex: '0014' + '22'.repeat(20), role: 'wallet' },
      }],
      outputs: [{ amountSats: '9000', scriptPubKeyHex: '0014' + '33'.repeat(20) }],
    },
  },
};

describe('transaction signing-intent broadcast route', () => {
  let app: Express;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', router);
    app.use(errorHandler);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findLinkedDraft.mockResolvedValue(null);
    mocks.validateSignedArtifact.mockResolvedValue(artifact);
    mocks.findNetwork.mockResolvedValue('testnet3');
    mocks.findAddressStrings.mockResolvedValue([]);
    mocks.evaluatePolicies.mockResolvedValue({ allowed: true });
    mocks.recordUsage.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
    mocks.broadcastAndSave.mockResolvedValue({
      txid: artifact.txid,
      broadcasted: true,
      persistenceStatus: 'complete',
    });
  });

  const body = {
    signedPsbtBase64: 'cHNi',
    intentId: 'intent-1',
    intentDigest: 'a'.repeat(64),
  };

  const draft = (overrides: Record<string, unknown> = {}) => ({
    id: 'draft-1',
    status: 'signed',
    approvalStatus: 'not_required',
    signingIntentId: 'intent-1',
    signingIntentDigest: 'a'.repeat(64),
    signedPsbtBase64: 'cHNi',
    recipient: undefined,
    effectiveAmount: 9000n,
    fee: 1000n,
    selectedUtxoIds: [`${'1'.repeat(64)}:0`],
    label: null,
    memo: null,
    ...overrides,
  });

  it('requires the authenticated handle before validation or propagation', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ signedPsbtBase64: 'cHNi' });
    expect(response.status).toBe(400);
    expect(mocks.validateSignedArtifact).not.toHaveBeenCalled();
    expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
  });

  it.each([
    { intentId: 'intent-1', signedPsbtBase64: 'cHNi' },
    { intentDigest: 'a'.repeat(64), signedPsbtBase64: 'cHNi' },
  ])('requires both parts of the authenticated handle', async (requestBody) => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send(requestBody);
    expect(response.status).toBe(400);
  });

  it('propagates only the artifact returned by signing-intent validation', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send(body);
    expect(response.status).toBe(200);
    expect(mocks.validateSignedArtifact).toHaveBeenCalledWith(expect.objectContaining({
      walletId: 'wallet-1', intentId: 'intent-1', intentDigest: 'a'.repeat(64),
    }));
    expect(mocks.broadcastAndSave).toHaveBeenCalledWith(artifact, expect.objectContaining({
      fee: 1000,
      utxos: [{ txid: '1'.repeat(64), vout: 0 }],
    }));
  });

  it('rejects caller metadata that disagrees with the authenticated snapshot', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ ...body, fee: 999 });
    expect(response.status).toBe(400);
    expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
  });

  it.each([
    [{ utxos: [] }, 'utxos'],
    [{ amount: 1 }, 'amount'],
    [{ recipient: 'tb1qwrong' }, 'recipient'],
  ])('rejects mismatched optional metadata %j', async (extra, _field) => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ ...body, ...extra });
    expect(response.status).toBe(400);
    expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
  });

  it('loads the artifact and intent handle from an actionable draft', async () => {
    mocks.findDraft.mockResolvedValue(draft());
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ draftId: 'draft-1' });
    expect(response.status).toBe(200);
    expect(mocks.validateSignedArtifact).toHaveBeenCalledWith(expect.objectContaining({
      draftId: 'draft-1', intentId: 'intent-1', signedPsbtBase64: 'cHNi',
    }));
  });

  it('rejects a legacy draft that has no authenticated handle', async () => {
    mocks.findDraft.mockResolvedValue(draft({ signingIntentId: null, signingIntentDigest: null }));
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ draftId: 'draft-1' });
    expect(response.status).toBe(400);
  });

  it.each([
    { signingIntentId: null },
    { signingIntentDigest: null },
  ])('rejects a draft with a partial authenticated handle: %j', async override => {
    mocks.findDraft.mockResolvedValue(draft(override));
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ draftId: 'draft-1' });
    expect(response.status).toBe(400);
    expect(mocks.validateSignedArtifact).not.toHaveBeenCalled();
  });

  it.each([
    [null, 404],
    [draft({ status: 'broadcasted' }), 409],
    [draft({ approvalStatus: 'pending' }), 403],
    [draft({ approvalStatus: 'rejected' }), 403],
  ])('rejects unavailable or unactionable drafts', async (value, status) => {
    mocks.findDraft.mockResolvedValue(value);
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ draftId: 'draft-1' });
    expect(response.status).toBe(status);
    expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
  });

  it.each([
    [{ signingIntentId: 'other' }, { ...body, draftId: 'draft-1' }],
    [{ signingIntentDigest: 'b'.repeat(64) }, { ...body, draftId: 'draft-1' }],
    [{ selectedUtxoIds: [`${'2'.repeat(64)}:0`] }, { draftId: 'draft-1' }],
  ])('rejects draft metadata that disagrees with the request or snapshot', async (change, requestBody) => {
    mocks.findDraft.mockResolvedValue(draft(change));
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send(requestBody);
    expect(response.status).toBe(400);
    expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
  });

  it('accepts a raw transaction artifact', async () => {
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ rawTxHex: '00', intentId: body.intentId, intentDigest: body.intentDigest });
    expect(response.status).toBe(200);
    expect(mocks.validateSignedArtifact).toHaveBeenCalledWith(expect.objectContaining({ rawTxHex: '00' }));
  });

  it('rejects a request and draft with no signed artifact', async () => {
    mocks.findDraft.mockResolvedValue(draft({ signedPsbtBase64: null }));
    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ draftId: 'draft-1' });
    expect(response.status).toBe(400);
  });

  it('rejects wallet-network mismatches but accepts the testnet alias', async () => {
    mocks.findNetwork.mockResolvedValueOnce('mainnet');
    expect((await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body)).status).toBe(400);
    mocks.findNetwork.mockResolvedValueOnce('testnet');
    expect((await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body)).status).toBe(200);
  });

  it('rejects unsupported paid scripts, invalid amounts, and negative fees', async () => {
    const badScript = structuredClone(artifact);
    badScript.snapshot.transaction.outputs[0].scriptPubKeyHex = 'ff';
    mocks.validateSignedArtifact.mockResolvedValueOnce(badScript);
    expect((await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body)).status).toBe(400);

    const badAmount = structuredClone(artifact);
    badAmount.snapshot.transaction.inputs[0].prevout.amountSats = '9007199254740992';
    mocks.validateSignedArtifact.mockResolvedValueOnce(badAmount);
    expect((await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body)).status).toBe(400);

    const negativeFee = structuredClone(artifact);
    negativeFee.snapshot.transaction.outputs[0].amountSats = '11000';
    mocks.validateSignedArtifact.mockResolvedValueOnce(negativeFee);
    expect((await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body)).status).toBe(400);
  });

  it('enforces policy for external outputs and audits propagation failures', async () => {
    mocks.evaluatePolicies.mockResolvedValueOnce({ allowed: false });
    expect((await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body)).status).toBe(403);
    expect(mocks.broadcastAndSave).not.toHaveBeenCalled();

    mocks.broadcastAndSave.mockRejectedValueOnce(new Error('node unavailable'));
    expect((await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body)).status).toBe(500);
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), 'failed', 'wallet', expect.objectContaining({
      success: false,
    }));
  });

  it('skips policy evaluation when every output belongs to the wallet', async () => {
    const bitcoin = await import('bitcoinjs-lib');
    const address = bitcoin.address.fromOutputScript(
      Buffer.from(artifact.snapshot.transaction.outputs[0].scriptPubKeyHex, 'hex'),
      { messagePrefix: '\u0018Bitcoin Signed Message:\n', bech32: 'tb', bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
    );
    mocks.findAddressStrings.mockResolvedValue([address]);
    const response = await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body);
    expect(response.status).toBe(200);
    expect(mocks.evaluatePolicies).not.toHaveBeenCalled();
  });

  it('supports zero-value undecodable outputs and optional labels', async () => {
    const value = structuredClone(artifact);
    value.snapshot.transaction.outputs[0] = { amountSats: '0', scriptPubKeyHex: '6a' };
    mocks.validateSignedArtifact.mockResolvedValue(value);
    const response = await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send({
      ...body, label: 'Label', memo: 'Memo',
    });
    expect(response.status).toBe(200);
    expect(mocks.broadcastAndSave).toHaveBeenCalledWith(value, expect.objectContaining({
      recipient: '', amount: 0, label: 'Label', memo: 'Memo',
    }));
  });

  it('does not fail broadcast when asynchronous policy usage recording fails', async () => {
    mocks.recordUsage.mockRejectedValueOnce(new Error('usage unavailable'));
    const response = await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body);
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(mocks.recordUsage).toHaveBeenCalled());
  });

  it('returns an authenticated completed replay without reapplying draft or policy side effects', async () => {
    mocks.findDraft.mockResolvedValue(draft({ status: 'broadcasted' }));
    mocks.validateSignedArtifact.mockResolvedValue({
      ...artifact,
      broadcastReplay: { state: 'complete', txid: artifact.txid, rawTx: artifact.rawTx },
    });

    const response = await request(app)
      .post('/api/v1/wallets/wallet-1/transactions/broadcast')
      .send({ draftId: 'draft-1' });

    expect(response.status).toBe(200);
    expect(mocks.broadcastAndSave).toHaveBeenCalledOnce();
    expect(mocks.evaluatePolicies).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it('returns an authenticated PSBT replay without reapplying policy side effects', async () => {
    mocks.validateSignedArtifact.mockResolvedValue({
      ...artifact,
      broadcastReplay: { state: 'accepted', txid: artifact.txid, rawTx: artifact.rawTx },
    });

    const response = await request(app).post('/api/v1/wallets/wallet-1/psbt/broadcast').send({
      signedPsbt: 'cHNi', intentId: body.intentId, intentDigest: body.intentDigest,
    });

    expect(response.status).toBe(200);
    expect(mocks.broadcastAndSave).toHaveBeenCalledOnce();
    expect(mocks.evaluatePolicies).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it('returns reconciliation status from both transaction and PSBT routes', async () => {
    mocks.broadcastAndSave.mockResolvedValue({
      txid: artifact.txid, broadcasted: true, persistenceStatus: 'pending_reconciliation',
    });
    expect((await request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send(body)).status).toBe(202);
    const response = await request(app).post('/api/v1/wallets/wallet-1/psbt/broadcast').send({
      signedPsbt: 'cHNi', intentId: body.intentId, intentDigest: body.intentDigest,
    });
    expect(response.status).toBe(202);
    expect(mocks.validateSignedArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
      walletId: 'wallet-1', signedPsbtBase64: 'cHNi',
    }));
  });

  it('returns complete status from the PSBT route', async () => {
    const response = await request(app).post('/api/v1/wallets/wallet-1/psbt/broadcast').send({
      signedPsbt: 'cHNi', intentId: body.intentId, intentDigest: body.intentDigest,
    });
    expect(response.status).toBe(200);
  });

  describe('intent-linked draft resolution', () => {
    it('rejects an omitted pending-approval draft linked to the intent', async () => {
      mocks.findLinkedDraft.mockResolvedValue(draft({ approvalStatus: 'pending' }));
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/transactions/broadcast')
        .send(body);
      expect(response.status).toBe(403);
      expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
    });

    it('rejects a caller draft that differs from the intent-linked draft (parallel creation)', async () => {
      mocks.findDraft.mockResolvedValue(draft());
      mocks.findLinkedDraft.mockResolvedValue(draft({ id: 'draft-linked' }));
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/transactions/broadcast')
        .send({ ...body, draftId: 'draft-1' });
      expect(response.status).toBe(400);
      expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
    });

    it.each([
      ['approved'],
      ['not_required'],
    ])('accepts an intent-linked draft with approvalStatus %s', async (approvalStatus) => {
      mocks.findLinkedDraft.mockResolvedValue(draft({ approvalStatus }));
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/transactions/broadcast')
        .send(body);
      expect(response.status).toBe(200);
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(artifact, expect.objectContaining({
        draftId: 'draft-1',
      }));
    });

    it('keeps a draftless PSBT broadcast valid when no draft is linked to the intent', async () => {
      mocks.findLinkedDraft.mockResolvedValue(null);
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/psbt/broadcast')
        .send({ signedPsbt: 'cHNi', intentId: body.intentId, intentDigest: body.intentDigest });
      expect(response.status).toBe(200);
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(
        artifact,
        expect.not.objectContaining({ draftId: expect.anything() }),
      );
    });

    it('returns a replay for an intent-linked broadcasted draft without reapplying approval or policy', async () => {
      mocks.findLinkedDraft.mockResolvedValue(draft({ status: 'broadcasted' }));
      const replayArtifact = {
        ...artifact,
        broadcastReplay: { state: 'complete', txid: artifact.txid, rawTx: artifact.rawTx },
      };
      mocks.validateSignedArtifact.mockResolvedValue(replayArtifact);
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/transactions/broadcast')
        .send(body);
      expect(response.status).toBe(200);
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(replayArtifact, expect.objectContaining({
        draftId: 'draft-1',
      }));
      expect(mocks.evaluatePolicies).not.toHaveBeenCalled();
      expect(mocks.recordUsage).not.toHaveBeenCalled();
    });

    it('scopes the intent-linked draft lookup to the route wallet', async () => {
      mocks.findLinkedDraft.mockResolvedValue(null);
      const response = await request(app)
        .post('/api/v1/wallets/wallet-2/transactions/broadcast')
        .send(body);
      expect(response.status).toBe(200);
      expect(mocks.findLinkedDraft).toHaveBeenCalledWith('wallet-2', 'intent-1');
    });

    it('accepts a duplicate caller draft that matches the intent-linked draft and persists it once', async () => {
      mocks.findDraft.mockResolvedValue(draft());
      mocks.findLinkedDraft.mockResolvedValue(draft());
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/transactions/broadcast')
        .send({ ...body, draftId: 'draft-1' });
      expect(response.status).toBe(200);
      expect(mocks.broadcastAndSave).toHaveBeenCalledTimes(1);
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(artifact, expect.objectContaining({
        draftId: 'draft-1',
      }));
    });

    it('rejects a PSBT broadcast when the intent-linked draft metadata disagrees with the snapshot', async () => {
      mocks.findLinkedDraft.mockResolvedValue(draft({
        approvalStatus: 'approved',
        selectedUtxoIds: [`${'2'.repeat(64)}:0`],
      }));
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/psbt/broadcast')
        .send({ signedPsbt: 'cHNi', intentId: body.intentId, intentDigest: body.intentDigest });
      expect(response.status).toBe(400);
      expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
    });

    it('persists the intent-linked draft on an approved PSBT broadcast', async () => {
      mocks.findLinkedDraft.mockResolvedValue(draft({ approvalStatus: 'approved' }));
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/psbt/broadcast')
        .send({ signedPsbt: 'cHNi', intentId: body.intentId, intentDigest: body.intentDigest });
      expect(response.status).toBe(200);
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(artifact, expect.objectContaining({
        draftId: 'draft-1',
      }));
    });

    it('rejects a PSBT broadcast for an intent linked to a pending-approval draft', async () => {
      mocks.findLinkedDraft.mockResolvedValue(draft({ approvalStatus: 'pending' }));
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/psbt/broadcast')
        .send({ signedPsbt: 'cHNi', intentId: body.intentId, intentDigest: body.intentDigest });
      expect(response.status).toBe(403);
      expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
    });

    it('enforces intent-linked draft metadata when the request omits draftId', async () => {
      mocks.findLinkedDraft.mockResolvedValue(draft({
        selectedUtxoIds: [`${'2'.repeat(64)}:0`],
      }));
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/transactions/broadcast')
        .send(body);
      expect(response.status).toBe(400);
      expect(mocks.broadcastAndSave).not.toHaveBeenCalled();
    });

    it('falls back to intent-linked draft labels and memo when the request omits them', async () => {
      mocks.findLinkedDraft.mockResolvedValue(draft({ label: 'L', memo: 'M' }));
      const response = await request(app)
        .post('/api/v1/wallets/wallet-1/transactions/broadcast')
        .send(body);
      expect(response.status).toBe(200);
      expect(mocks.broadcastAndSave).toHaveBeenCalledWith(artifact, expect.objectContaining({
        label: 'L', memo: 'M',
      }));
    });
  });
});
