import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findById: vi.fn(),
  findDraftByWalletAndSigningIntent: vi.fn(),
  hasLiveDraftForSigningIntent: vi.fn(),
  authenticateIntentPrevouts: vi.fn(),
}));
vi.mock('../../../../../src/repositories/draftSigningIntentRepository', () => ({
  draftSigningIntentRepository: {
    findDraftByWalletAndSigningIntent: mocks.findDraftByWalletAndSigningIntent,
    hasLiveDraftForSigningIntent: mocks.hasLiveDraftForSigningIntent,
  },
}));

vi.mock('../../../../../src/repositories/transactionSigningIntentRepository', () => ({
  transactionSigningIntentRepository: {
    create: mocks.create,
    findById: mocks.findById,
  },
}));
vi.mock('../../../../../src/services/bitcoin/signingIntent/prevoutValidation', () => ({
  authenticateIntentPrevouts: mocks.authenticateIntentPrevouts,
}));

import {
  createSigningIntent as createSigningIntentWithContext,
  persistSigningIntent,
  prepareSigningIntent,
  loadSigningIntent,
  findDraftBySigningIntent,
} from '../../../../../src/services/bitcoin/signingIntent/service';

const signingContext = {
  version: 1 as const,
  walletId: 'wallet-1',
  network: 'testnet3' as const,
  walletType: 'single_sig' as const,
  scriptType: 'native_segwit' as const,
  canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
  canonicalPolicyVersion: 1,
  descriptorDigest: 'ab'.repeat(32),
  unsignedTransactionDigest: '',
  signers: [{
    signerIndex: 0,
    deviceId: 'device-1',
    deviceAccountId: 'account-1',
    masterFingerprint: 'aabbccdd',
    accountPath: "m/84'/1'/0'",
    accountXpub: 'tpub-test',
  }],
  inputs: [{
    inputIndex: 0,
    txid: '11'.repeat(32),
    vout: 0,
    amountSats: '10000',
    scriptPubKey: '0014' + '22'.repeat(20),
    addressPath: "m/84'/1'/0'/0/0",
    signerOrigins: [{
      masterFingerprint: 'aabbccdd',
      path: "m/84'/1'/0'/0/0",
      pubkey: '02' + '44'.repeat(32),
    }],
  }],
  changeOutputs: [],
};

const feePolicy = {
  version: 1 as const,
  expectedFeeSats: 1_000,
  requestedFeeRateSatsPerVbyte: 10,
  roundingMode: 'ceil' as const,
  roundingToleranceSats: 1,
};

const createSigningIntent = (
  input: Omit<Parameters<typeof createSigningIntentWithContext>[0], 'signingContext' | 'feePolicy'>,
) => createSigningIntentWithContext({ ...input, signingContext, feePolicy });

it('resolves a draft through the signing-intent service boundary', async () => {
  const draft = { id: 'draft-1' };
  mocks.findDraftByWalletAndSigningIntent.mockResolvedValueOnce(draft);

  await expect(findDraftBySigningIntent('wallet-1', 'intent-1')).resolves.toBe(draft);
  expect(mocks.findDraftByWalletAndSigningIntent).toHaveBeenCalledWith('wallet-1', 'intent-1');
});

const psbtBase64 = (includePayjoinPeer = false): string => {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
  psbt.addInput({
    hash: '11'.repeat(32),
    index: 0,
    witnessUtxo: { script: Buffer.from('0014' + '22'.repeat(20), 'hex'), value: 10_000n },
    bip32Derivation: [{
      masterFingerprint: Buffer.from('aabbccdd', 'hex'),
      path: "m/84'/1'/0'/0/0",
      pubkey: Buffer.from('02' + '44'.repeat(32), 'hex'),
    }],
  });
  if (includePayjoinPeer) {
    psbt.addInput({
      hash: '55'.repeat(32),
      index: 1,
      witnessUtxo: { script: Buffer.from('0014' + '66'.repeat(20), 'hex'), value: 2_000n },
    });
  }
  psbt.addOutput({ script: Buffer.from('0014' + '33'.repeat(20), 'hex'), value: 9_000n });
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Uint8Array };
  signingContext.unsignedTransactionDigest = Buffer.from(
    bitcoin.crypto.sha256(unsignedTx.toBuffer()),
  ).toString('hex');
  return psbt.toBase64();
};

describe('transaction signing intent lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateIntentPrevouts.mockResolvedValue([{
      amountSats: '10000',
      scriptPubKeyHex: '0014' + '22'.repeat(20),
      role: 'wallet',
    }]);
  });

  it('persists a versioned canonical snapshot and returns only its authenticated handle', async () => {
    mocks.create.mockImplementation(async data => ({ id: 'intent-1', ...data }));
    const result = await createSigningIntent({
      walletId: 'wallet-1',
      createdByUserId: 'user-1',
      network: 'testnet3',
      source: 'standard',
      unsignedPsbtBase64: psbtBase64(),
    });
    expect(result).toEqual({
      intentId: 'intent-1',
      intentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      signingContext,
    });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      snapshotVersion: 2,
      snapshotDigest: result.intentDigest,
      source: 'standard',
      snapshot: expect.objectContaining({ feePolicy }),
    }));
  });

  it('issues the handle together with the exact snapshot it persisted', async () => {
    mocks.create.mockImplementation(async data => ({ id: 'intent-1', ...data }));
    const issued = await persistSigningIntent(await prepareSigningIntent({
      walletId: 'wallet-1',
      createdByUserId: 'user-1',
      network: 'testnet3',
      source: 'payjoin',
      unsignedPsbtBase64: psbtBase64(),
      signingContext,
      feePolicy,
    }));
    expect(issued.handle).toEqual({
      intentId: 'intent-1',
      intentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      signingContext,
    });
    expect(issued.snapshot).toEqual(mocks.create.mock.calls[0][0].snapshot);
    expect(issued.snapshot.transaction.outputs).toEqual([
      { amountSats: '9000', scriptPubKeyHex: '0014' + '33'.repeat(20) },
    ]);
  });

  it('prepares the snapshot and digest without writing, and persists exactly what was prepared', async () => {
    mocks.create.mockImplementation(async data => ({ id: 'intent-1', ...data }));
    const input = {
      walletId: 'wallet-1',
      createdByUserId: 'user-1',
      network: 'testnet3' as const,
      source: 'payjoin' as const,
      unsignedPsbtBase64: psbtBase64(),
      signingContext,
      feePolicy,
      supersedesIntentId: 'intent-0',
    };
    const prepared = await prepareSigningIntent(input);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(prepared.snapshot.transaction.outputs).toEqual([
      { amountSats: '9000', scriptPubKeyHex: '0014' + '33'.repeat(20) },
    ]);
    expect(prepared.snapshotDigest).toMatch(/^[0-9a-f]{64}$/);

    const persisted = await persistSigningIntent(prepared);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      snapshotDigest: prepared.snapshotDigest,
      supersedesIntentId: 'intent-0',
      source: 'payjoin',
    }));
    expect(persisted).toEqual({
      handle: { intentId: 'intent-1', intentDigest: prepared.snapshotDigest, signingContext },
      snapshot: prepared.snapshot,
    });

    mocks.create.mockClear();
    await expect(createSigningIntentWithContext(input)).resolves.toEqual(persisted.handle);
    expect(mocks.create.mock.calls[0][0].snapshotDigest).toBe(prepared.snapshotDigest);
  });

  it('refuses a context outside the intent scope before preparing anything', async () => {
    await expect(prepareSigningIntent({
      walletId: 'wallet-2', createdByUserId: 'user-1', network: 'testnet3', source: 'payjoin',
      unsignedPsbtBase64: psbtBase64(), signingContext, feePolicy,
    })).rejects.toThrow('Signing context does not match signing intent scope');
    expect(mocks.authenticateIntentPrevouts).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong digest', { snapshotDigest: 'b'.repeat(64) }, 'digest'],
    ['superseded', { supersededById: 'new-intent' }, 'superseded'],
    ['consumed', { consumedAt: new Date() }, 'consumed'],
    ['expired', { expiresAt: new Date(0) }, 'expired'],
  ])('fails closed for %s intent', async (_name, overrides, message) => {
    const encoded = psbtBase64();
    const created: any = await (async () => {
      mocks.create.mockImplementationOnce(async data => ({ id: 'intent-1', ...data }));
      await createSigningIntent({
        walletId: 'wallet-1', createdByUserId: 'user-1', network: 'testnet3',
        source: 'standard', unsignedPsbtBase64: encoded,
      });
      return mocks.create.mock.calls[0][0];
    })();
    mocks.findById.mockResolvedValue({
      id: 'intent-1',
      ...created,
      supersededById: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    });
    await expect(loadSigningIntent({ intentId: 'intent-1', intentDigest: created.snapshotDigest }, 'wallet-1'))
      .rejects.toThrow(message);
  });

  it('rejects malformed PSBTs before authenticating prevouts', async () => {
    await expect(createSigningIntent({
      walletId: 'wallet-1',
      createdByUserId: 'user-1',
      network: 'testnet3',
      source: 'standard',
      unsignedPsbtBase64: 'not-psbt',
    })).rejects.toThrow('Invalid PSBT');
    expect(mocks.authenticateIntentPrevouts).not.toHaveBeenCalled();
  });

  it.each([
    ['wallet', { walletId: 'wallet-2' }],
    ['network', { network: 'mainnet' as const }],
  ])('rejects a signing context outside the intent %s scope', async (_scope, contextOverride) => {
    const unsignedPsbtBase64 = psbtBase64();

    await expect(createSigningIntentWithContext({
      walletId: 'wallet-1',
      createdByUserId: 'user-1',
      network: 'testnet3',
      source: 'standard',
      unsignedPsbtBase64,
      signingContext: { ...signingContext, ...contextOverride },
      feePolicy,
    })).rejects.toThrow('Signing context does not match signing intent scope');
    expect(mocks.authenticateIntentPrevouts).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('persists explicit lifecycle, role, and RBF replacement options', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00Z');
    mocks.create.mockImplementation(async data => ({ id: 'intent-2', ...data }));
    await createSigningIntent({
      walletId: 'wallet-1',
      createdByUserId: 'user-1',
      network: 'testnet3',
      source: 'rbf',
      unsignedPsbtBase64: psbtBase64(),
      inputRoles: ['wallet'],
      replacementTxid: 'c'.repeat(64),
      supersedesIntentId: 'intent-old',
      expiresAt,
    });
    expect(mocks.authenticateIntentPrevouts).toHaveBeenCalledWith(
      'wallet-1', 'testnet3', expect.any(bitcoin.Psbt), ['wallet'], undefined, 'c'.repeat(64),
    );
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      source: 'rbf',
      expiresAt,
      supersedesIntentId: 'intent-old',
    }));
  });

  it('preserves an explicit non-wallet input role instead of substituting the wallet default', async () => {
    mocks.create.mockImplementation(async data => ({ id: 'intent-payjoin', ...data }));
    mocks.authenticateIntentPrevouts.mockResolvedValueOnce([
      {
        amountSats: '10000',
        scriptPubKeyHex: '0014' + '22'.repeat(20),
        role: 'wallet',
      },
      {
        amountSats: '2000',
        scriptPubKeyHex: '0014' + '66'.repeat(20),
        role: 'payjoin_peer',
      },
    ]);

    await createSigningIntentWithContext({
      walletId: 'wallet-1',
      createdByUserId: 'user-1',
      network: 'testnet3',
      source: 'payjoin',
      unsignedPsbtBase64: psbtBase64(true),
      inputRoles: ['wallet', 'payjoin_peer'],
      signingContext,
      feePolicy: { ...feePolicy, expectedFeeSats: 3_000 },
    });

    expect(mocks.authenticateIntentPrevouts).toHaveBeenCalledWith(
      'wallet-1', 'testnet3', expect.any(bitcoin.Psbt), ['wallet', 'payjoin_peer'], undefined, undefined,
    );
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({
        transaction: expect.objectContaining({
          inputs: [
            expect.objectContaining({ prevout: expect.objectContaining({ role: 'wallet' }) }),
            expect.objectContaining({ prevout: expect.objectContaining({ role: 'payjoin_peer' }) }),
          ],
        }),
      }),
    }));
  });

  it('treats an intent as expired at the exact expiry instant', async () => {
    const encoded = psbtBase64();
    const expiresAt = new Date('2030-01-01T00:00:00.000Z');
    mocks.create.mockImplementationOnce(async data => ({ id: 'intent-1', ...data }));
    await createSigningIntent({
      walletId: 'wallet-1', createdByUserId: 'user-1', network: 'testnet3',
      source: 'standard', unsignedPsbtBase64: encoded, expiresAt,
    });
    const created = mocks.create.mock.calls[0][0];
    mocks.findById.mockResolvedValue({
      id: 'intent-1',
      ...created,
      broadcastState: 'ready',
      supersededById: null,
      consumedAt: null,
    });
    const now = vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime());

    await expect(loadSigningIntent(
      { intentId: 'intent-1', intentDigest: created.snapshotDigest },
      'wallet-1',
    )).rejects.toThrow('expired');
    now.mockRestore();
  });

  it('loads a fully authenticated active intent', async () => {
    mocks.create.mockImplementationOnce(async data => ({ id: 'intent-1', ...data }));
    await createSigningIntent({
      walletId: 'wallet-1', createdByUserId: 'user-1', network: 'testnet3',
      source: 'standard', unsignedPsbtBase64: psbtBase64(),
    });
    const created = mocks.create.mock.calls[0][0];
    mocks.findById.mockResolvedValue({
      id: 'intent-1',
      ...created,
      supersededById: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(loadSigningIntent(
      { intentId: 'intent-1', intentDigest: created.snapshotDigest },
      'wallet-1',
    )).resolves.toMatchObject({
      intentId: 'intent-1',
      source: 'standard',
      snapshot: created.snapshot,
    });
  });

  it('rejects a valid snapshot whose stored version metadata disagrees', async () => {
    mocks.create.mockImplementationOnce(async data => ({ id: 'intent-1', ...data }));
    await createSigningIntent({
      walletId: 'wallet-1', createdByUserId: 'user-1', network: 'testnet3',
      source: 'standard', unsignedPsbtBase64: psbtBase64(),
    });
    const created = mocks.create.mock.calls[0][0];
    mocks.findById.mockResolvedValue({
      id: 'intent-1',
      ...created,
      snapshotVersion: 1,
      supersededById: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(loadSigningIntent(
      { intentId: 'intent-1', intentDigest: created.snapshotDigest }, 'wallet-1',
    )).rejects.toThrow('snapshot version does not match its stored version');
  });

  it('loads only an exact accepted/complete consumed intent for authenticated replay', async () => {
    mocks.create.mockImplementationOnce(async data => ({ id: 'intent-1', ...data }));
    await createSigningIntent({
      walletId: 'wallet-1', createdByUserId: 'user-1', network: 'testnet3',
      source: 'standard', unsignedPsbtBase64: psbtBase64(),
    });
    const created = mocks.create.mock.calls[0][0];
    mocks.findById.mockResolvedValue({
      id: 'intent-1', ...created,
      supersededById: null,
      consumedAt: new Date(),
      expiresAt: new Date(0),
      broadcastState: 'accepted',
      broadcastTxid: 'c'.repeat(64),
      broadcastRawTx: '00',
    });
    await expect(loadSigningIntent(
      { intentId: 'intent-1', intentDigest: created.snapshotDigest },
      'wallet-1',
      { allowConsumedBroadcastReplay: true },
    )).resolves.toMatchObject({
      broadcastReplay: { state: 'accepted', txid: 'c'.repeat(64), rawTx: '00' },
    });

    mocks.findById.mockResolvedValueOnce({
      id: 'intent-1', ...created,
      supersededById: null,
      consumedAt: new Date(),
      expiresAt: new Date(0),
      broadcastState: 'ready',
      broadcastTxid: 'c'.repeat(64),
      broadcastRawTx: '00',
    });
    await expect(loadSigningIntent(
      { intentId: 'intent-1', intentDigest: created.snapshotDigest },
      'wallet-1',
      { allowConsumedBroadcastReplay: true },
    )).rejects.toThrow('consumed');

    mocks.findById.mockResolvedValueOnce({
      id: 'intent-1', ...created,
      supersededById: null,
      consumedAt: null,
      expiresAt: new Date(0),
      broadcastState: 'accepted',
      broadcastTxid: 'c'.repeat(64),
      broadcastRawTx: '00',
    });
    await expect(loadSigningIntent(
      { intentId: 'intent-1', intentDigest: created.snapshotDigest },
      'wallet-1',
      { allowConsumedBroadcastReplay: true },
    )).rejects.toThrow('expired');
  });

  it.each([
    ['missing record', null, 'not found'],
    ['wrong wallet', { walletId: 'wallet-2' }, 'not found'],
    ['unsupported version', { snapshotVersion: 3 }, 'version'],
    ['invalid network', { network: 'invalid-network' }, 'network'],
    ['malformed snapshot', { snapshot: {} }, 'malformed'],
    ['wrong snapshot wallet', { snapshotWalletId: 'wallet-2' }, 'identity'],
    ['wrong snapshot network', { snapshotNetwork: 'mainnet' }, 'identity'],
    ['altered snapshot digest', { alterSnapshot: true }, 'authentication'],
    ['altered signing context', { alterContext: true }, 'account binding authentication'],
    ['altered PSBT hash', { unsignedPsbtSha256: '0'.repeat(64) }, 'PSBT authentication'],
    ['unsupported source', { source: 'future-source' }, 'unsupported source'],
  ])('fails closed for %s', async (_name, override, message) => {
    if (override === null) {
      mocks.findById.mockResolvedValue(null);
      await expect(loadSigningIntent({ intentId: 'intent-1', intentDigest: 'a'.repeat(64) }, 'wallet-1'))
        .rejects.toThrow(message);
      return;
    }
    mocks.create.mockImplementationOnce(async data => ({ id: 'intent-1', ...data }));
    await createSigningIntent({
      walletId: 'wallet-1', createdByUserId: 'user-1', network: 'testnet3',
      source: 'standard', unsignedPsbtBase64: psbtBase64(),
    });
    const created = mocks.create.mock.calls[0][0];
    const snapshot = structuredClone(created.snapshot);
    if ('snapshotWalletId' in override) snapshot.walletId = override.snapshotWalletId;
    if ('snapshotNetwork' in override) snapshot.network = override.snapshotNetwork;
    if ('alterSnapshot' in override && override.alterSnapshot) snapshot.transaction.locktime += 1;
    mocks.findById.mockResolvedValue({
      id: 'intent-1',
      ...created,
      supersededById: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      ...override,
      snapshot: 'snapshot' in override ? override.snapshot : snapshot,
      signingContext: 'alterContext' in override
        ? { ...created.signingContext, canonicalPolicyId: 'altered-policy' }
        : created.signingContext,
    });
    await expect(loadSigningIntent(
      { intentId: 'intent-1', intentDigest: created.snapshotDigest },
      'wallet-1',
    )).rejects.toThrow(message);
  });

  it('rejects a stored intent with malformed account-binding data', async () => {
    mocks.create.mockImplementationOnce(async data => ({ id: 'intent-1', ...data }));
    await createSigningIntent({
      walletId: 'wallet-1', createdByUserId: 'user-1', network: 'testnet3',
      source: 'standard', unsignedPsbtBase64: psbtBase64(),
    });
    const created = mocks.create.mock.calls[0][0];
    mocks.findById.mockResolvedValue({
      id: 'intent-1',
      ...created,
      signingContext: {},
      supersededById: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(loadSigningIntent(
      { intentId: 'intent-1', intentDigest: created.snapshotDigest },
      'wallet-1',
    )).rejects.toThrow('Signing intent account binding is malformed');
  });
});

describe('draft-derived signing intent liveness', () => {
  const NOW = new Date('2030-01-02T00:00:00.000Z');
  let created: any;
  const handle = () => ({ intentId: 'intent-1', intentDigest: created.snapshotDigest });
  const storeIntent = (overrides: Record<string, unknown> = {}) => mocks.findById.mockResolvedValue({
    id: 'intent-1', ...created, supersededById: null, consumedAt: null, ...overrides,
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    mocks.authenticateIntentPrevouts.mockResolvedValue([{
      amountSats: '10000', scriptPubKeyHex: '0014' + '22'.repeat(20), role: 'wallet',
    }]);
    mocks.create.mockImplementationOnce(async data => ({ id: 'intent-1', ...data }));
    await createSigningIntent({
      walletId: 'wallet-1', createdByUserId: 'user-1', network: 'testnet3',
      source: 'standard', unsignedPsbtBase64: psbtBase64(), expiresAt: new Date(NOW.getTime() - 1),
    });
    created = mocks.create.mock.calls[0][0];
    storeIntent();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads an expired intent while a live draft in the request wallet references it', async () => {
    mocks.hasLiveDraftForSigningIntent.mockResolvedValueOnce(true);

    await expect(loadSigningIntent(handle(), 'wallet-1', { allowLiveDraftExtension: true }))
      .resolves.toMatchObject({ intentId: 'intent-1', expiresAt: created.expiresAt });
    expect(mocks.hasLiveDraftForSigningIntent).toHaveBeenCalledWith('wallet-1', 'intent-1', NOW);
  });

  it('keeps an expired intent stale when no live draft references it', async () => {
    // The repository answers false for no draft, an expired, broadcasted, rejected,
    // vetoed or approval-expired draft, and a draft in another wallet.
    mocks.hasLiveDraftForSigningIntent.mockResolvedValueOnce(false);

    await expect(loadSigningIntent(handle(), 'wallet-1', { allowLiveDraftExtension: true }))
      .rejects.toMatchObject({ details: { reason: 'stale_intent' } });
  });

  it('does not consult drafts without the option', async () => {
    mocks.hasLiveDraftForSigningIntent.mockResolvedValue(true);

    await expect(loadSigningIntent(handle(), 'wallet-1'))
      .rejects.toMatchObject({ details: { reason: 'stale_intent' } });
    await expect(loadSigningIntent(handle(), 'wallet-1', { allowLiveDraftExtension: false }))
      .rejects.toThrow('Signing intent has expired');
    expect(mocks.hasLiveDraftForSigningIntent).not.toHaveBeenCalled();
  });

  it('does not consult drafts for an unexpired intent', async () => {
    storeIntent({ expiresAt: new Date(NOW.getTime() + 1) });

    await expect(loadSigningIntent(handle(), 'wallet-1', { allowLiveDraftExtension: true }))
      .resolves.toMatchObject({ intentId: 'intent-1' });
    expect(mocks.hasLiveDraftForSigningIntent).not.toHaveBeenCalled();
  });

  it('checks the stored scope before consulting drafts', async () => {
    storeIntent({ walletId: 'wallet-2' });

    await expect(loadSigningIntent(handle(), 'wallet-1', { allowLiveDraftExtension: true }))
      .rejects.toThrow('Signing intent was not found');
    expect(mocks.hasLiveDraftForSigningIntent).not.toHaveBeenCalled();
  });

  it('leaves an authenticated broadcast replay unchanged', async () => {
    storeIntent({
      consumedAt: new Date(0), broadcastState: 'complete',
      broadcastTxid: 'c'.repeat(64), broadcastRawTx: '00',
    });

    await expect(loadSigningIntent(handle(), 'wallet-1', {
      allowConsumedBroadcastReplay: true, allowLiveDraftExtension: true,
    })).resolves.toMatchObject({ broadcastReplay: { state: 'complete' } });
    expect(mocks.hasLiveDraftForSigningIntent).not.toHaveBeenCalled();
  });
});
