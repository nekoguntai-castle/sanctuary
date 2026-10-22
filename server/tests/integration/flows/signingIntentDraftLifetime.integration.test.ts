/**
 * Non-regression: signing-intent--24h-expiry-strands-drafts-and-approvals.
 *
 * A signing intent's stored expiry is 24 h after issue and immutable (a DB
 * trigger), while its draft lives for the configured draft expiry (7 days by
 * default). Signing, broadcast and payjoin load the intent with
 * `allowLiveDraftExtension`, which keeps it live past its stored expiry while
 * an actionable draft references it; draft creation does not. Runs the real
 * intent service, draft creation and deletion against PostgreSQL; only
 * prevout authentication (a node lookup) is stubbed.
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

vi.mock('../../../src/services/bitcoin/signingIntent/prevoutValidation', () => ({
  authenticateIntentPrevouts: vi.fn(async () => [{
    amountSats: '10000', scriptPubKeyHex: `0014${'22'.repeat(20)}`, role: 'wallet',
  }]),
}));

import { disconnect as disconnectAppPrisma } from '../../../src/models/prisma';
import { createSigningIntent, loadSigningIntent } from '../../../src/services/bitcoin/signingIntent';
import { createDraft, deleteDraft } from '../../../src/services/draftService';
import {
  cleanupTestData,
  createTestUser,
  createTestWallet,
  describeIfDatabase,
  disconnectTestDatabase,
  getTestPrisma,
} from '../repositories/setup';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const unsignedPsbt = (): { psbtBase64: string; unsignedTransactionDigest: string } => {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
  psbt.addInput({
    hash: '11'.repeat(32),
    index: 0,
    witnessUtxo: { script: Buffer.from(`0014${'22'.repeat(20)}`, 'hex'), value: 10_000n },
    bip32Derivation: [{
      masterFingerprint: Buffer.from('aabbccdd', 'hex'),
      path: "m/84'/1'/0'/0/0",
      pubkey: Buffer.from(`02${'44'.repeat(32)}`, 'hex'),
    }],
  });
  psbt.addOutput({ script: Buffer.from(`0014${'33'.repeat(20)}`, 'hex'), value: 9_000n });
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as { toBuffer(): Uint8Array };
  return {
    psbtBase64: psbt.toBase64(),
    unsignedTransactionDigest: Buffer.from(bitcoin.crypto.sha256(unsignedTx.toBuffer())).toString('hex'),
  };
};

const signingContext = (walletId: string, unsignedTransactionDigest: string) => ({
  version: 1 as const,
  walletId,
  network: 'testnet3' as const,
  walletType: 'single_sig' as const,
  scriptType: 'native_segwit' as const,
  canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
  canonicalPolicyVersion: 1,
  descriptorDigest: 'ab'.repeat(32),
  unsignedTransactionDigest,
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
    scriptPubKey: `0014${'22'.repeat(20)}`,
    addressPath: "m/84'/1'/0'/0/0",
    signerOrigins: [{ masterFingerprint: 'aabbccdd', path: "m/84'/1'/0'/0/0", pubkey: `02${'44'.repeat(32)}` }],
  }],
  changeOutputs: [],
});

describeIfDatabase('signing intent lifetime follows its draft', () => {
  let walletId = '';
  let userId = '';

  beforeAll(async () => {
    await getTestPrisma();
  });

  beforeEach(async () => {
    vi.useRealTimers();
    await cleanupTestData();
    const db = await getTestPrisma();
    const user = await createTestUser(db, { username: 'intent-lifetime', email: 'intent-lifetime@example.com' });
    const wallet = await createTestWallet(db, user.id, { network: 'testnet3' });
    userId = user.id;
    walletId = wallet.id;
  });

  afterAll(async () => {
    vi.useRealTimers();
    await cleanupTestData();
    await disconnectTestDatabase();
    await disconnectAppPrisma();
  });

  const issueIntent = async () => {
    const { psbtBase64, unsignedTransactionDigest } = unsignedPsbt();
    const handle = await createSigningIntent({
      walletId,
      createdByUserId: userId,
      network: 'testnet3',
      source: 'standard',
      unsignedPsbtBase64: psbtBase64,
      feePolicy: {
        version: 1, expectedFeeSats: 1_000, requestedFeeRateSatsPerVbyte: 10, roundingMode: 'ceil', roundingToleranceSats: 1,
      },
      signingContext: signingContext(walletId, unsignedTransactionDigest),
    });
    return { ...handle, psbtBase64 };
  };

  const createLinkedDraft = (
    intent: Awaited<ReturnType<typeof issueIntent>>,
    recipient = 'tb1qxvenxvenxvenxvenxvenxvenxvenxvenqzqps5',
  ) => createDraft(walletId, userId, {
    recipient,
    amount: 9_000,
    feeRate: 10,
    fee: 1_000,
    selectedUtxoIds: [`${'11'.repeat(32)}:0`],
    psbtBase64: intent.psbtBase64,
    intentId: intent.intentId,
    intentDigest: intent.intentDigest,
    // No vault policy applies to this wallet; skip the evaluation's address lookups.
    policyEvaluation: { allowed: true, triggered: [] },
  });

  const at25Hours = () => vi.useFakeTimers({ now: Date.now() + 25 * HOUR, toFake: ['Date'] });
  const load = (intent: Awaited<ReturnType<typeof issueIntent>>, allowLiveDraftExtension?: boolean) =>
    loadSigningIntent(
      { intentId: intent.intentId, intentDigest: intent.intentDigest },
      walletId,
      allowLiveDraftExtension === undefined ? {} : { allowLiveDraftExtension },
    );

  it('keeps a draft-linked intent loadable past 24 h while a draft-less one goes stale', async () => {
    const linked = await issueIntent();
    const draftless = await issueIntent();
    const draft = await createLinkedDraft(linked);
    expect(draft.expiresAt!.getTime() - Date.now()).toBeGreaterThan(6 * DAY);

    at25Hours();
    await expect(load(linked, true)).resolves.toMatchObject({ intentId: linked.intentId });
    await expect(load(draftless, true)).rejects.toThrow('Signing intent has expired');
    await expect(load(linked)).rejects.toThrow('Signing intent has expired');
  });

  it('refuses a draft whose recipient is not the intent\'s external output', async () => {
    const intent = await issueIntent();

    await expect(createLinkedDraft(intent, 'tb1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zv8swna')).rejects.toMatchObject({
      details: expect.objectContaining({ field: 'recipient', reason: 'metadata_mismatch' }),
    });
    await expect((await getTestPrisma()).draftTransaction.count({ where: { walletId } })).resolves.toBe(0);
  });

  it('does not let a live draft seed another draft from an expired intent', async () => {
    const intent = await issueIntent();
    await createLinkedDraft(intent);

    at25Hours();
    await expect(createLinkedDraft(intent)).rejects.toThrow('Signing intent has expired');
  });

  it('returns the intent to its stored expiry when its draft is deleted', async () => {
    const intent = await issueIntent();
    const draft = await createLinkedDraft(intent);

    at25Hours();
    await expect(load(intent, true)).resolves.toMatchObject({ intentId: intent.intentId });
    await deleteDraft(walletId, draft.id, userId, 'owner');
    await expect(load(intent, true)).rejects.toThrow('Signing intent has expired');
  });

  it('refuses to delete a broadcasted draft and keeps the row', async () => {
    const db = await getTestPrisma();
    const draft = await createLinkedDraft(await issueIntent());
    await db.draftTransaction.update({ where: { id: draft.id }, data: { status: 'broadcasted' } });

    await expect(deleteDraft(walletId, draft.id, userId, 'owner')).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'draft_retained' },
    });
    await expect(db.draftTransaction.findUnique({ where: { id: draft.id } })).resolves.not.toBeNull();
  });

  const otherWalletId = async () => {
    const db = await getTestPrisma();
    const other = await createTestUser(db, { username: 'intent-lifetime-2', email: 'intent-lifetime-2@example.com' });
    return (await createTestWallet(db, other.id, { network: 'testnet3' })).id;
  };

  it.each([
    ['rejected', { approvalStatus: 'rejected' }],
    ['vetoed', { approvalStatus: 'vetoed' }],
    ['approval-expired', { approvalStatus: 'expired' }],
    ['broadcasted', { status: 'broadcasted' }],
    ['other-wallet', 'other-wallet'],
  ] as const)('does not keep an intent live through a %s draft', async (_name, change) => {
    const intent = await issueIntent();
    const draft = await createLinkedDraft(intent);
    const data = change === 'other-wallet' ? { walletId: await otherWalletId() } : change;
    await (await getTestPrisma()).draftTransaction.update({ where: { id: draft.id }, data });

    at25Hours();
    await expect(load(intent, true)).rejects.toThrow('Signing intent has expired');
  });

  it('does not keep an intent live past its draft\'s own expiry', async () => {
    const intent = await issueIntent();
    const draft = await createLinkedDraft(intent);

    vi.useFakeTimers({ now: draft.expiresAt!.getTime() + 1, toFake: ['Date'] });
    await expect(load(intent, true)).rejects.toThrow('Signing intent has expired');
  });

  it.each(['pending', 'approved'] as const)('keeps an intent live through a %s draft', async approvalStatus => {
    const intent = await issueIntent();
    const draft = await createLinkedDraft(intent);
    await (await getTestPrisma()).draftTransaction.update({ where: { id: draft.id }, data: { approvalStatus } });

    at25Hours();
    await expect(load(intent, true)).resolves.toMatchObject({ intentId: intent.intentId });
  });
});
