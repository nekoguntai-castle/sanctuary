/**
 * Non-regression: broadcast-retry--policy-usage-double-reserved.
 *
 * A broadcast whose outcome is unknown leaves its intent `unknown` with the
 * spend still reserved against the enforce-mode usage windows. Retrying it
 * must reuse that reservation — persisted on the intent's broadcast metadata —
 * instead of reserving the same transaction again. Runs the real broadcast
 * route, broadcastAndSave, intent lifecycle and policy engine against a real
 * PolicyUsageWindow; only artifact validation, the node and wallet access are
 * stubbed.
 */
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  validateSignedArtifact: vi.fn(),
  broadcastTransaction: vi.fn(),
  userId: { current: '' },
}));

vi.mock('../../../src/services/bitcoin/signingIntent', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/services/bitcoin/signingIntent')>(),
  validateSignedArtifact: mocks.validateSignedArtifact,
}));
vi.mock('../../../src/services/bitcoin/blockchain', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/services/bitcoin/blockchain')>(),
  broadcastTransaction: mocks.broadcastTransaction,
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/services/hardwareWalletCapabilities', () => ({
  assertWalletHardwareCapabilityById: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/services/auditService', () => ({
  auditService: { logFromRequest: vi.fn().mockResolvedValue(undefined) },
  AuditAction: { TRANSACTION_BROADCAST: 'broadcast', TRANSACTION_BROADCAST_FAILED: 'failed' },
  AuditCategory: { WALLET: 'wallet' },
}));
vi.mock('../../../src/middleware/walletAccess', () => ({
  requireWalletAccess: () => (req: any, _res: any, next: () => void) => {
    req.walletId = req.params.walletId;
    req.user = { userId: mocks.userId.current };
    next();
  },
}));

import appPrisma, { disconnect as disconnectAppPrisma } from '../../../src/models/prisma';
import broadcastRouter from '../../../src/api/transactions/broadcasting';
import { claimBroadcast } from '../../../src/repositories/transactionSigningIntentRepository';
import { errorHandler } from '../../../src/errors/errorHandler';
import {
  cleanupTestData,
  createTestUser,
  createTestWallet,
  describeIfDatabase,
  disconnectTestDatabase,
  getTestPrisma,
} from '../repositories/setup';

const AMOUNT = 9_000;
const txid = '9'.repeat(64);
const digest = 'a'.repeat(64);

describeIfDatabase('broadcast retry policy usage (real PolicyUsageWindow)', () => {
  let app: Express;

  beforeAll(async () => {
    await getTestPrisma();
    app = express();
    app.use(express.json());
    app.use('/api/v1', broadcastRouter);
    app.use(errorHandler);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await disconnectTestDatabase();
    await disconnectAppPrisma();
  });

  const seed = async () => {
    const db = await getTestPrisma();
    const user = await createTestUser(db, { username: 'retry-owner', email: 'retry-owner@example.com' });
    mocks.userId.current = user.id;
    const wallet = await createTestWallet(db, user.id, { network: 'testnet3' });
    const policy = await db.vaultPolicy.create({
      data: {
        walletId: wallet.id,
        name: 'Daily limit',
        type: 'spending_limit',
        config: { daily: 100_000, scope: 'wallet' },
        enforcement: 'enforce',
        createdBy: user.id,
        sourceType: 'wallet',
      },
    });
    const snapshot = {
      version: 1,
      walletId: wallet.id,
      network: 'testnet3',
      transaction: {
        version: 2,
        locktime: 0,
        inputs: [{
          txid: '1'.repeat(64), vout: 0, sequence: 0xfffffffd,
          prevout: { amountSats: '10000', scriptPubKeyHex: `0014${'22'.repeat(20)}`, role: 'wallet' },
        }],
        outputs: [{ amountSats: String(AMOUNT), scriptPubKeyHex: `0014${'33'.repeat(20)}` }],
      },
    };
    const intent = await db.transactionSigningIntent.create({
      data: {
        walletId: wallet.id,
        createdByUserId: user.id,
        network: 'testnet3',
        source: 'standard',
        snapshotVersion: 1,
        snapshot,
        snapshotDigest: digest,
        unsignedPsbtBase64: 'cHNi',
        unsignedPsbtSha256: 'c'.repeat(64),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    mocks.validateSignedArtifact.mockResolvedValue({
      walletId: wallet.id,
      network: 'testnet3',
      txid,
      rawTx: '00',
      intent: { intentId: intent.id, intentDigest: digest },
      snapshot,
    });
    return { db, wallet, policy, intent };
  };

  it('counts a retried unknown-outcome broadcast once', async () => {
    const { db, wallet, policy, intent } = await seed();
    const broadcast = () => request(app)
      .post(`/api/v1/wallets/${wallet.id}/transactions/broadcast`)
      .send({ signedPsbtBase64: 'cHNi', intentId: intent.id, intentDigest: digest });

    mocks.broadcastTransaction.mockRejectedValueOnce(new Error('Broadcast outcome is unknown: connection lost'));
    expect((await broadcast()).status).toBe(500);
    await expect(db.transactionSigningIntent.findUnique({ where: { id: intent.id } }))
      .resolves.toMatchObject({ broadcastState: 'unknown', broadcastTxid: txid });

    mocks.broadcastTransaction.mockResolvedValueOnce({ txid, broadcasted: true });
    const retry = await broadcast();

    expect([200, 202], JSON.stringify(retry.body)).toContain(retry.status);
    expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(2);
    const windows = await db.policyUsageWindow.findMany({ where: { policyId: policy.id } });
    expect(windows).toHaveLength(1);
    expect(windows[0].totalSpent).toBe(BigInt(AMOUNT));
    expect(windows[0].txCount).toBe(1);
    // The app client shares the database with the test client.
    await expect(appPrisma.transactionSigningIntent.findUnique({ where: { id: intent.id } }))
      .resolves.toMatchObject({ broadcastState: expect.stringMatching(/^(accepted|complete)$/) });
  });

  const heldMetadata = { recipient: 'tb1qheld', amount: AMOUNT, fee: 1000, policyReservations: [{ windowId: 'w1', amount: '9000' }] };
  it.each([
    ['refuses to overwrite held reservations', heldMetadata, 'busy'],
    ['resumes legacy metadata without reservations', { recipient: 'tb1qlegacy', amount: AMOUNT }, 'claimed'],
  ] as const)('a fresh keepHeldReservations claim on an unknown intent %s', async (_label, stored, status) => {
    const { db, intent } = await seed();
    await db.transactionSigningIntent.update({
      where: { id: intent.id },
      data: { broadcastState: 'unknown', broadcastTxid: txid, broadcastRawTx: '00', broadcastMetadata: stored },
    });
    const now = new Date();

    const result = await claimBroadcast({
      id: intent.id, digest, txid, rawTx: '00', metadata: { fresh: true }, leaseToken: 'lease-fresh',
      now, leaseExpiresAt: new Date(now.getTime() + 60_000), allowStalled: true, keepHeldReservations: true,
    });

    expect(result.status).toBe(status);
    const after = await db.transactionSigningIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(after.broadcastMetadata).toEqual(status === 'busy' ? heldMetadata : { fresh: true });
  });
});
