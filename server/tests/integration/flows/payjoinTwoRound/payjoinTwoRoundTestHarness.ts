/**
 * Harness for the two-round BIP78 payjoin proof against real PostgreSQL.
 *
 * Imported first by payjoinTwoRound.integration.test.ts so every vi.mock below
 * is registered before the routers load. Only the edges a test cannot reach
 * are replaced: the hardware capability manifest (every row is disabled
 * today), the node's prevout lookup, the outbound payjoin HTTP request (wired
 * to a fake receiver) and the node broadcast. Account binding, signing-context
 * validation, artifact validation, persistence, policy evaluation and the
 * routers are real. With `realPrevoutAuthentication` set, prevout
 * authentication is real too and only the node client's transaction lookup is
 * stubbed (it serves the funding transactions of both inputs). The draft
 * insert is real but runs behind `draftCreateHook`, so a race test can hold a
 * draft creation open after its intent check.
 */
import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import * as bitcoin from 'bitcoinjs-lib';

const mocks = vi.hoisted(() => ({
  broadcastTransaction: vi.fn(),
  recalculateWalletBalances: vi.fn(),
  requestPinnedAddress: vi.fn(),
  /** Runs before every prevout authentication; a test may stall chosen calls. */
  prevoutHook: { current: null as null | ((psbt: import('bitcoinjs-lib').Psbt) => Promise<void>) },
  realPrevoutAuthentication: { current: false },
  getTransactionsBatch: vi.fn(),
  /** Runs before every draft insert; a test may hold one open mid-transaction. */
  draftCreateHook: { current: null as null | (() => Promise<void>) },
}));

// Synthetic enabled signer; the fail-closed capability manifest has its own contract tests.
vi.mock('../../../../src/services/hardwareWalletCapabilities', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/services/hardwareWalletCapabilities')>(),
  assertHardwareWalletCapability: vi.fn(),
  assertWalletHardwareCapability: vi.fn(),
  assertWalletHardwareCapabilityById: vi.fn(),
}));

// The node lookup: prevouts are read back from the PSBT with the requested roles,
// unless a scenario runs the real authentication against the stubbed node client.
vi.mock('../../../../src/services/bitcoin/signingIntent/prevoutValidation', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/services/bitcoin/signingIntent/prevoutValidation')>();
  return {
    authenticateIntentPrevouts: vi.fn(async (
      ...args: Parameters<typeof actual.authenticateIntentPrevouts>
    ) => {
      const [, , psbt, roles] = args;
      await mocks.prevoutHook.current?.(psbt);
      if (mocks.realPrevoutAuthentication.current) return actual.authenticateIntentPrevouts(...args);
      return psbt.data.inputs.map((input, index) => ({
        amountSats: input.witnessUtxo!.value.toString(),
        scriptPubKeyHex: Buffer.from(input.witnessUtxo!.script).toString('hex'),
        role: roles[index],
      }));
    }),
  };
});

// The real draft insert, behind a hook that can hold it after the intent check.
vi.mock('../../../../src/repositories/draftRepository', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../src/repositories/draftRepository')>();
  const create: typeof actual.create = async (...args) => {
    await mocks.draftCreateHook.current?.();
    return actual.create(...args);
  };
  const draftRepository = { ...actual.draftRepository, create };
  return { ...actual, create, draftRepository, default: draftRepository };
});

vi.mock('../../../../src/services/bitcoin/nodeClient', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/services/bitcoin/nodeClient')>(),
  getNodeClient: vi.fn(async () => ({ getTransactionsBatch: mocks.getTransactionsBatch })),
}));

vi.mock('../../../../src/services/payjoin/ssrf', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/services/payjoin/ssrf')>(),
  validatePayjoinUrl: vi.fn(async (value: string) => ({
    valid: true,
    url: new URL(value),
    resolvedAddresses: [{ address: '203.0.113.10', family: 4 }],
  })),
}));

vi.mock('../../../../src/services/outboundNetwork/nativeRequest', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/services/outboundNetwork/nativeRequest')>(),
  requestPinnedAddress: mocks.requestPinnedAddress,
}));

vi.mock('../../../../src/services/bitcoin/blockchain', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/services/bitcoin/blockchain')>(),
  broadcastTransaction: mocks.broadcastTransaction,
  recalculateWalletBalances: mocks.recalculateWalletBalances,
}));

import type { PrismaClient } from '../../../../src/generated/prisma/client';
import { errorHandler } from '../../../../src/errors/errorHandler';
import payjoinRoutes from '../../../../src/api/payjoin';
import transactionRoutes from '../../../../src/api/transactions';
import draftRoutes from '../../../../src/api/drafts';
import { featureFlagService } from '../../../../src/services/featureFlagService';
import bip32 from '../../../../src/services/bitcoin/bip32';
import { bindPsbtAccount } from '../../../../src/services/bitcoin/psbtAccountBinding';
import { createSigningIntent } from '../../../../src/services/bitcoin/signingIntent';
import {
  buildSigningIntentFeePolicy,
  estimatePsbtMaximumSignedVsize,
} from '../../../../src/services/bitcoin/signingIntent/feePolicy';
import { feeForRate } from '../../../../src/services/bitcoin/transactionWeight';
import { buildCanonicalAddressEvidence } from '../../../../src/services/wallet/addressGeneration';
import { generateToken } from '../../../../src/utils/jwt';
import { authHeader } from '../../setup/helpers';
import { cleanupTestData, setupTestDatabase, teardownTestDatabase } from '../../setup/testDatabase';
import {
  answerReceiverRequest,
  createFakeReceiver,
  NETWORK,
  RECEIVER_FUNDING_TX,
  RECEIVER_INPUT,
  RECEIVER_PAY_TO_ADDRESS,
  RECEIVER_PAY_TO_SCRIPT,
  type FakeReceiver,
} from './fakeBip78Receiver';

export { mocks };

export const PAYJOIN_URL = 'https://payjoin.example.com/pj';
const POLICY_ID = 'single-sig-native-segwit-bip84-v1';
const FEE_RATE = 10;

const walletRoot = bip32.fromSeed(Buffer.alloc(32, 0x5a), NETWORK);
const walletAccount = walletRoot.derivePath("m/84'/1'/0'");
const FINGERPRINT = Buffer.from(walletRoot.fingerprint).toString('hex');
const ACCOUNT_XPUB = walletAccount.neutered().toBase58();
const descriptor = (branch: 0 | 1) => `wpkh([${FINGERPRINT}/84h/1h/0h]${ACCOUNT_XPUB}/${branch}/*)`;
const walletSigner = walletAccount.derive(0).derive(0);
const walletScript = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(walletSigner.publicKey), network: NETWORK }).output!;

/** The node's view of the wallet's funding transaction; its output 0 is the wallet's one UTXO. */
const WALLET_FUNDING_TX = new bitcoin.Transaction();
WALLET_FUNDING_TX.addInput(Buffer.alloc(32, 0x5a), 0);
WALLET_FUNDING_TX.addOutput(walletScript, 100_000n);
export const WALLET_INPUT = { txid: WALLET_FUNDING_TX.getId(), vout: 0, amount: 100_000 };

/** The node client's batch lookup: both funding transactions are known, anything else is not. */
export const nodeTransactions = async (txids: string[]) => new Map(
  [WALLET_FUNDING_TX, RECEIVER_FUNDING_TX]
    .filter(tx => txids.includes(tx.getId()))
    .map(tx => [tx.getId(), { hex: tx.toHex() }]),
);

const state: {
  prisma: PrismaClient | null;
  app: Express | null;
  payjoinEnabled: boolean;
  receiver: FakeReceiver;
  seq: number;
} = { prisma: null, app: null, payjoinEnabled: true, receiver: createFakeReceiver(), seq: 0 };

export const db = (): PrismaClient => state.prisma!;
export const receiver = (): FakeReceiver => state.receiver;
export const setPayjoinEnabled = (enabled: boolean): void => {
  state.payjoinEnabled = enabled;
};

/** The production mount order (routes.ts): payjoin, then transactions and drafts at /api/v1. */
const buildApp = (): Express => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1/payjoin', payjoinRoutes);
  app.use('/api/v1', transactionRoutes);
  app.use('/api/v1', draftRoutes);
  app.use(errorHandler);
  return app;
};

export const setupPayjoinTwoRoundHarness = (): void => {
  beforeAll(async () => {
    state.prisma = await setupTestDatabase();
    state.app = buildApp();
  });

  beforeEach(async () => {
    await cleanupTestData();
    state.payjoinEnabled = true;
    state.receiver = createFakeReceiver();
    mocks.prevoutHook.current = null;
    mocks.draftCreateHook.current = null;
    mocks.realPrevoutAuthentication.current = false;
    mocks.getTransactionsBatch.mockReset();
    mocks.getTransactionsBatch.mockImplementation(nodeTransactions);
    mocks.broadcastTransaction.mockReset();
    mocks.broadcastTransaction.mockResolvedValue({ broadcasted: true });
    mocks.recalculateWalletBalances.mockReset();
    mocks.recalculateWalletBalances.mockResolvedValue(undefined);
    mocks.requestPinnedAddress.mockReset();
    mocks.requestPinnedAddress.mockImplementation(async (options: { url: URL; body: string | Buffer }) =>
      answerReceiverRequest(state.receiver, options.url, options.body.toString()));
    const realIsEnabled = featureFlagService.isEnabled.bind(featureFlagService);
    vi.spyOn(featureFlagService, 'isEnabled').mockImplementation(async key => (
      key === 'payjoinSupport' ? state.payjoinEnabled : realIsEnabled(key)
    ));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanupTestData();
    await teardownTestDatabase();
  });
};

export interface PolicySeed {
  type: 'spending_limit' | 'velocity' | 'approval_required';
  enforcement: 'enforce' | 'monitor';
  config: Record<string, number | string | boolean | Record<string, number | boolean>>;
}

/** Scenarios 2-6 run with a monitor-mode daily limit: payjoin is allowed and usage is recorded, not reserved. */
export const MONITOR_DAILY_LIMIT: PolicySeed = {
  type: 'spending_limit',
  enforcement: 'monitor',
  config: { daily: 10_000_000, scope: 'wallet' },
};

export interface SeededWallet {
  walletId: string;
  userId: string;
  auth: { Authorization: string };
}

const seedSigner = async (prisma: PrismaClient, userId: string, walletId: string, tag: string) => {
  const device = await prisma.device.create({
    data: {
      userId, type: 'trezor', label: `payjoin ${tag}`, fingerprint: FINGERPRINT,
      derivationPath: "m/84'/1'/0'", xpub: ACCOUNT_XPUB,
    },
  });
  const account = await prisma.deviceAccount.create({
    data: {
      deviceId: device.id, purpose: 'single_sig', scriptType: 'native_segwit',
      derivationPath: "m/84'/1'/0'", xpub: ACCOUNT_XPUB,
    },
  });
  await prisma.walletDevice.create({
    data: {
      walletId, deviceId: device.id, deviceAccountId: account.id, signerIndex: 0, signerBindingVersion: 1,
      signerFingerprint: FINGERPRINT, signerXpub: ACCOUNT_XPUB, signerDerivationPath: "m/84'/1'/0'",
      signerPurpose: 'single_sig', signerScriptType: 'native_segwit',
    },
  });
};

/**
 * A single-sig P2WPKH testnet wallet with one canonical receive address, one
 * 100,000 sat UTXO at it, an edit-role user (email verified) and an access
 * token minted for that user, plus the given vault policies.
 */
export const seedWallet = async (policies: PolicySeed[] = [MONITOR_DAILY_LIMIT]): Promise<SeededWallet> => {
  const prisma = db();
  state.seq += 1;
  const tag = `${state.seq}`;
  const user = await prisma.user.create({
    data: { username: `payjoin-sender-${tag}`, password: 'not-a-login-hash', emailVerified: true },
  });
  const wallet = await prisma.wallet.create({
    data: {
      name: `Payjoin sender ${tag}`, type: 'single_sig', scriptType: 'native_segwit', network: 'testnet3',
      descriptor: descriptor(0), changeDescriptor: descriptor(1), fingerprint: FINGERPRINT,
      canonicalPolicyId: POLICY_ID, canonicalPolicyVersion: 1, descriptorPolicyVersion: 1,
      descriptorSourceKind: 'imported_multipath',
      sourceDescriptor: `wpkh([${FINGERPRINT}/84h/1h/0h]${ACCOUNT_XPUB}/<0;1>/*)`,
    },
  });
  await prisma.walletUser.create({ data: { walletId: wallet.id, userId: user.id, role: 'owner' } });
  await seedSigner(prisma, user.id, wallet.id, tag);
  const evidence = buildCanonicalAddressEvidence(
    descriptor(0), descriptor(1), 'testnet3', { canonicalPolicyId: POLICY_ID, canonicalPolicyVersion: 1 }, 0, 0,
  );
  await prisma.address.create({ data: { ...evidence, walletId: wallet.id, branch: 0, index: 0 } });
  await prisma.uTXO.create({
    data: {
      walletId: wallet.id, txid: WALLET_INPUT.txid, vout: WALLET_INPUT.vout, address: evidence.address,
      amount: BigInt(WALLET_INPUT.amount), scriptPubKey: evidence.scriptPubKey,
    },
  });
  for (const policy of policies) {
    await prisma.vaultPolicy.create({
      data: { walletId: wallet.id, name: `${policy.type} ${policy.enforcement}`, createdBy: user.id, ...policy },
    });
  }
  const token = generateToken({
    userId: user.id, username: user.username, isAdmin: user.isAdmin, sessionVersion: user.sessionVersion,
  });
  return { walletId: wallet.id, userId: user.id, auth: authHeader(token) };
};

export interface OriginalIntent {
  intentId: string;
  intentDigest: string;
  unsignedPsbt: string;
  signedPsbt: string;
  /** What the client reports on broadcast: recipient, amount P, fee and its outpoints. */
  metadata: { recipient: string; amount: number; fee: number; utxos: Array<{ txid: string; vout: number }> };
}

const walletUtxoPsbt = (recipientValue: bigint): bitcoin.Psbt => {
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.setVersion(2);
  psbt.addInput({
    hash: Buffer.from(WALLET_INPUT.txid, 'hex').reverse(),
    index: WALLET_INPUT.vout,
    sequence: 0xfffffffd,
    witnessUtxo: { script: walletScript, value: BigInt(WALLET_INPUT.amount) },
  });
  psbt.addOutput({ script: RECEIVER_PAY_TO_SCRIPT, value: recipientValue });
  return psbt;
};

/** Signs every wallet input (partial signatures only; the server finalizes). */
export const signWalletInputs = (psbtBase64: string): string => {
  const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: NETWORK });
  psbt.txInputs.forEach((input, index) => {
    if (Buffer.from(input.hash).reverse().toString('hex') === WALLET_INPUT.txid) psbt.signInput(index, walletSigner);
  });
  return psbt.toBase64();
};

/**
 * The original: one wallet input paying the receiver everything but the fee,
 * at exactly the requested rate over its maximum signed size, issued as a
 * standard intent bound to the wallet account, then signed (round one).
 */
export const createOriginalIntent = async (seeded: SeededWallet): Promise<OriginalIntent> => {
  const fee = feeForRate(estimatePsbtMaximumSignedVsize(walletUtxoPsbt(0n)), FEE_RATE);
  const amount = WALLET_INPUT.amount - fee;
  const psbt = walletUtxoPsbt(BigInt(amount));
  const signingContext = await bindPsbtAccount(seeded.walletId, psbt);
  const unsignedPsbt = psbt.toBase64();
  const handle = await createSigningIntent({
    walletId: seeded.walletId,
    createdByUserId: seeded.userId,
    network: 'testnet3',
    source: 'standard',
    unsignedPsbtBase64: unsignedPsbt,
    feePolicy: buildSigningIntentFeePolicy(unsignedPsbt, FEE_RATE, fee),
    signingContext,
  });
  return {
    intentId: handle.intentId,
    intentDigest: handle.intentDigest,
    unsignedPsbt,
    signedPsbt: signWalletInputs(unsignedPsbt),
    metadata: {
      recipient: RECEIVER_PAY_TO_ADDRESS,
      amount,
      fee,
      utxos: [{ txid: WALLET_INPUT.txid, vout: WALLET_INPUT.vout }],
    },
  };
};

const api = () => request(state.app!);
type Handle = { intentId: string; intentDigest: string };

export const postAttempt = (seeded: SeededWallet, body: Record<string, unknown>) => api()
  .post('/api/v1/payjoin/attempt')
  .set(seeded.auth)
  .send({ walletId: seeded.walletId, payjoinUrl: PAYJOIN_URL, network: 'testnet3', ...body });

export const attemptWithOriginal = (seeded: SeededWallet, original: OriginalIntent) => postAttempt(seeded, {
  signedPsbt: original.signedPsbt,
  intentId: original.intentId,
  intentDigest: original.intentDigest,
});

export const releaseOriginal = (seeded: SeededWallet, handle: Handle) => api()
  .post('/api/v1/payjoin/release-original')
  .set(seeded.auth)
  .send({ walletId: seeded.walletId, intentId: handle.intentId, intentDigest: handle.intentDigest });

/** The web path (`src/api/transactions/transactions.ts`): signedPsbtBase64 plus the client's metadata. */
export const broadcastWeb = (seeded: SeededWallet, body: Record<string, unknown>) => api()
  .post(`/api/v1/wallets/${seeded.walletId}/transactions/broadcast`)
  .set(seeded.auth)
  .send(body);

export const broadcastOriginal = (seeded: SeededWallet, original: OriginalIntent) => broadcastWeb(seeded, {
  signedPsbtBase64: original.signedPsbt,
  intentId: original.intentId,
  intentDigest: original.intentDigest,
  ...original.metadata,
});

/** The mobile path posts `signedPsbt` and no client metadata. */
export const broadcastMobile = (seeded: SeededWallet, body: { signedPsbt: string } & Handle) => api()
  .post(`/api/v1/wallets/${seeded.walletId}/psbt/broadcast`)
  .set(seeded.auth)
  .send(body);

export const postDraft = (seeded: SeededWallet, body: Record<string, unknown>) => api()
  .post(`/api/v1/wallets/${seeded.walletId}/drafts`)
  .set(seeded.auth)
  .send({ feeRate: FEE_RATE, ...body });

export interface ProposalResponse extends Handle {
  proposalPsbt: string;
  amount: number;
}

/** Round two: the client signs the stripped proposal's wallet input with the same key. */
export const proposalBroadcastBody = (proposal: ProposalResponse, original: OriginalIntent) => {
  const psbt = bitcoin.Psbt.fromBase64(proposal.proposalPsbt, { network: NETWORK });
  const inputTotal = WALLET_INPUT.amount + RECEIVER_INPUT.amount;
  const outputTotal = psbt.txOutputs.reduce((sum, output) => sum + Number(output.value), 0);
  return {
    signedPsbtBase64: signWalletInputs(proposal.proposalPsbt),
    intentId: proposal.intentId,
    intentDigest: proposal.intentDigest,
    recipient: original.metadata.recipient,
    amount: proposal.amount,
    fee: inputTotal - outputTotal,
    utxos: psbt.txInputs.map(input => ({
      txid: Buffer.from(input.hash).reverse().toString('hex'),
      vout: input.index,
    })),
  };
};

export const intentRow = (id: string) => db().transactionSigningIntent.findUniqueOrThrow({
  where: { id },
  select: {
    source: true, broadcastState: true, broadcastMetadata: true, broadcastRawTx: true,
    supersededById: true, consumedAt: true,
  },
});

export const usageWindows = (walletId: string) => db().policyUsageWindow.findMany({
  where: { walletId },
  select: { windowType: true, totalSpent: true, txCount: true },
});

export const payjoinReplacements = (walletId: string) => db().transactionSigningIntent.findMany({
  where: { walletId, source: 'payjoin' },
  select: { id: true, broadcastState: true, supersededById: true, broadcastMetadata: true },
});

/** A promise and its resolver: holds a receiver answer or a prevout lookup open. */
export const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
};
