/**
 * A retry of a no-external-output broadcast (consolidation, CPFP child) whose
 * first attempt ended `unknown`. Unlike transactionsSigningIntentBroadcast.test.ts,
 * broadcastAndSave, the claim lifecycle and the signing-intent repository run
 * for real against an in-memory intent row, so the claim guard is exercised
 * end to end from the route.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

type Row = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  validateSignedArtifact: vi.fn(),
  findLinkedDraft: vi.fn(),
  findAddressStrings: vi.fn(),
  broadcastTransaction: vi.fn(),
  persistTransaction: vi.fn(),
  evaluatePolicies: vi.fn(),
  reserveEnforcedUsage: vi.fn(),
  intentRow: { current: null as Row | null },
}));

/** Just enough of Prisma's where semantics for the claim/transition queries. */
const matchesCondition = (value: unknown, condition: unknown): boolean => {
  if (condition === null || typeof condition !== 'object') return value === condition;
  const c = condition as Record<string, unknown>;
  if ('equals' in c) {
    // A JSON value compares by content; Prisma's null sentinels (AnyNull) match a null column.
    const plain = Array.isArray(c.equals) || Object.getPrototypeOf(c.equals) === Object.prototype;
    return plain ? JSON.stringify(value) === JSON.stringify(c.equals) : value === null;
  }
  if ('lt' in c) return (value as number | Date) < (c.lt as number | Date);
  if ('lte' in c) return (value as number | Date) <= (c.lte as number | Date);
  if ('gte' in c) return (value as number | Date) >= (c.gte as number | Date);
  return false;
};

const matchesWhere = (row: Row, where: Row): boolean => Object.entries(where).every(([key, condition]) => (
  key === 'OR'
    ? (condition as Row[]).some(branch => matchesWhere(row, branch))
    : matchesCondition(row[key], condition)
));

const applyUpdate = (row: Row, data: Row): void => {
  for (const [key, value] of Object.entries(data)) {
    const op = value as { increment?: number; decrement?: number } | null;
    if (op && typeof op === 'object' && 'increment' in op) row[key] = (row[key] as number) + op.increment!;
    else if (op && typeof op === 'object' && 'decrement' in op) row[key] = (row[key] as number) - op.decrement!;
    else row[key] = value;
  }
};

vi.mock('../../../src/models/prisma', () => {
  const delegate = {
    findUnique: vi.fn(async () => (mocks.intentRow.current ? { ...mocks.intentRow.current } : null)),
    findUniqueOrThrow: vi.fn(async () => ({ ...mocks.intentRow.current })),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = mocks.intentRow.current;
      if (!row || !matchesWhere(row, where)) return { count: 0 };
      applyUpdate(row, data);
      return { count: 1 };
    }),
  };
  const client = {
    transactionSigningIntent: delegate,
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({ transactionSigningIntent: delegate })),
  };
  return { default: client };
});
vi.mock('../../../src/repositories/addressRepository', () => ({
  addressRepository: { findAddressStrings: mocks.findAddressStrings },
}));
vi.mock('../../../src/repositories/draftRepository', () => ({
  draftRepository: { findByIdInWallet: vi.fn() },
}));
vi.mock('../../../src/repositories/walletRepository', () => ({
  walletRepository: { findNetwork: vi.fn(async () => 'testnet3') },
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
  auditService: { logFromRequest: vi.fn(async () => undefined) },
  AuditAction: { TRANSACTION_BROADCAST: 'broadcast', TRANSACTION_BROADCAST_FAILED: 'failed' },
  AuditCategory: { WALLET: 'wallet' },
}));
vi.mock('../../../src/services/vaultPolicy', () => ({
  policyEvaluationEngine: {
    evaluatePolicies: mocks.evaluatePolicies,
    reserveEnforcedUsage: mocks.reserveEnforcedUsage,
    recordUsage: vi.fn(async () => undefined),
    releasePolicyUsage: vi.fn(async () => undefined),
  },
}));
vi.mock('../../../src/services/bitcoin/signingIntent', async () => {
  const { deriveIntentSpend } = await vi.importActual<
    typeof import('../../../src/services/bitcoin/signingIntent/intentSpend')
  >('../../../src/services/bitcoin/signingIntent/intentSpend');
  const { findHeldPolicyReservations } = await vi.importActual<
    typeof import('../../../src/services/bitcoin/signingIntent/broadcastLifecycle')
  >('../../../src/services/bitcoin/signingIntent/broadcastLifecycle');
  return {
    validateSignedArtifact: mocks.validateSignedArtifact,
    findDraftBySigningIntent: mocks.findLinkedDraft,
    deriveIntentSpend,
    findHeldPolicyReservations,
  };
});
vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  broadcastTransaction: mocks.broadcastTransaction,
  recalculateWalletBalances: vi.fn(async () => undefined),
  isNodeAnsweredBroadcastFailure: () => true,
  DefiniteBroadcastRejectionError: class DefiniteBroadcastRejectionError extends Error {},
}));
vi.mock('../../../src/services/bitcoin/transactions/persistTransaction', () => ({
  persistTransaction: mocks.persistTransaction,
}));
vi.mock('../../../src/services/hardwareWalletCapabilities', () => ({
  assertWalletHardwareCapabilityById: vi.fn(async () => undefined),
}));
vi.mock('../../../src/services/eventService', () => ({
  eventService: { emitTransactionSent: vi.fn(), emitTransactionReceived: vi.fn() },
}));
vi.mock('../../../src/services/bitcoin/transactions/replacementLink', () => ({
  findVerifiedReplacement: vi.fn(async () => null),
  assertReplacementLink: vi.fn(async () => undefined),
  selectCandidateOutpoints: (inputs: unknown[] | undefined, utxos: unknown[]) => (
    inputs && inputs.length > 0 ? inputs : utxos
  ),
}));
vi.mock('../../../src/services/bitcoin/utils', () => ({
  getNetwork: () => testnet,
}));

const testnet = {
  messagePrefix: '\u0018Bitcoin Signed Message:\n', bech32: 'tb',
  bip32: { public: 0x043587cf, private: 0x04358394 }, pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef,
};

import router from '../../../src/api/transactions/broadcasting';
import { errorHandler } from '../../../src/errors/errorHandler';

const ownScript = '0014' + '33'.repeat(20);
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
      outputs: [{ amountSats: '9000', scriptPubKeyHex: ownScript }],
    },
  },
};

/** The intent as the first attempt left it: claimed with `policyReservations: []`, outcome unknown. */
const unknownAttempt = (): Row => ({
  id: 'intent-1',
  snapshotDigest: 'a'.repeat(64),
  supersededById: null,
  consumedAt: null,
  broadcastState: 'unknown',
  broadcastTxid: artifact.txid,
  broadcastRawTx: artifact.rawTx,
  broadcastMetadata: {
    recipient: 'own', amount: 0, fee: 1000, utxos: [{ txid: '1'.repeat(64), vout: 0 }], policyReservations: [],
  },
  broadcastLeaseToken: null,
  broadcastLeaseExpiresAt: null,
  broadcastAttemptCount: 1,
  broadcastLastError: 'outcome unknown',
});

describe('signing-intent broadcast retry of a no-external-output transaction', () => {
  let app: Express;
  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', router);
    app.use(errorHandler);
    const bitcoin = await import('bitcoinjs-lib');
    mocks.findAddressStrings.mockResolvedValue([
      bitcoin.address.fromOutputScript(Buffer.from(ownScript, 'hex'), testnet),
    ]);
  });
  beforeEach(() => {
    mocks.intentRow.current = unknownAttempt();
    mocks.validateSignedArtifact.mockResolvedValue(artifact);
    mocks.findLinkedDraft.mockResolvedValue(null);
    mocks.broadcastTransaction.mockReset().mockResolvedValue({ txid: artifact.txid, broadcasted: true });
    mocks.persistTransaction.mockReset().mockResolvedValue({
      unlockedCount: 0, draftArchived: false, mainTransactionCreated: false, receivingTransactions: [],
    });
  });

  const post = () => request(app).post('/api/v1/wallets/wallet-1/transactions/broadcast').send({
    signedPsbtBase64: 'cHNi', intentId: 'intent-1', intentDigest: 'a'.repeat(64),
  });

  it('claims the unknown attempt and broadcasts instead of reporting it busy', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(mocks.broadcastTransaction).toHaveBeenCalledWith(artifact, false);
    expect(mocks.intentRow.current).toMatchObject({
      broadcastState: 'complete', broadcastAttemptCount: 2, broadcastMetadata: { policyReservations: [] },
    });
    expect(mocks.evaluatePolicies).not.toHaveBeenCalled();
    expect(mocks.reserveEnforcedUsage).not.toHaveBeenCalled();
  });

  it('still reports busy while another attempt holds a live claim', async () => {
    mocks.intentRow.current = {
      ...unknownAttempt(),
      broadcastState: 'claimed',
      broadcastLeaseToken: 'lease-other',
      broadcastLeaseExpiresAt: new Date(Date.now() + 60_000),
    };

    const response = await post();

    expect(response.status).toBe(409);
    expect(mocks.broadcastTransaction).not.toHaveBeenCalled();
  });
});
