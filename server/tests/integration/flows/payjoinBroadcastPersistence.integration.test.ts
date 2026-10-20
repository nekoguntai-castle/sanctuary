/**
 * A payjoin broadcast persists against real PostgreSQL
 * (payjoin-broadcast--peer-input-persistence-fails-forever).
 *
 * The canonical broadcast metadata lists every input, including the receiver's
 * `payjoin_peer` input, which has no UTXO row in the sender's wallet. Marking
 * it spent used to throw P2025 and roll back the whole persistence
 * transaction, on the first attempt and on every reconciliation retry.
 */
import { vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { broadcastAndSave } from '../../../src/services/bitcoin/transactions/broadcasting';
import { reconcileSigningIntentBroadcasts } from '../../../src/services/bitcoin/signingIntent/broadcastReconciliation';
import {
  deferAcceptedReconciliation,
  listBroadcastsForReconciliation,
} from '../../../src/repositories/transactionSigningIntentRepository';
import { createValidatedBroadcastArtifactFixture } from '../../helpers/validatedBroadcastArtifact';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';

// Synthetic enabled signer; the fail-closed capability manifest has its own contract tests.
vi.mock('../../../src/services/hardwareWalletCapabilities', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/services/hardwareWalletCapabilities')>(),
  assertHardwareWalletCapability: vi.fn(),
  assertWalletHardwareCapability: vi.fn(),
  assertWalletHardwareCapabilityById: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  broadcastTransaction: vi.fn(),
  recalculateWalletBalances: vi.fn(),
}));

vi.mock('../../../src/services/bitcoin/blockchain', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/services/bitcoin/blockchain')>(),
  broadcastTransaction: mocks.broadcastTransaction,
  recalculateWalletBalances: mocks.recalculateWalletBalances,
}));

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;
const network = bitcoin.networks.testnet;
const walletAddress = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const peerAddress = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';
const recipientAddress = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 7), network }).address!;
const walletInput = { txid: '1'.repeat(64), vout: 0, address: walletAddress, amount: 60_000 };
const peerInput = { txid: '2'.repeat(64), vout: 3, address: peerAddress, amount: 70_000 };

const buildPayjoinTx = () => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  for (const input of [walletInput, peerInput]) {
    transaction.addInput(Buffer.from(input.txid, 'hex').reverse(), input.vout, 0xfffffffd);
  }
  const scriptHex = (address: string) => Buffer.from(bitcoin.address.toOutputScript(address, network));
  transaction.addOutput(scriptHex(recipientAddress), 128_000n);
  return { rawTx: transaction.toHex(), txid: transaction.getId(), recipientScript: scriptHex(recipientAddress) };
};

const payjoinMetadata = {
  recipient: recipientAddress,
  amount: 58_000,
  fee: 2_000,
  utxos: [walletInput, peerInput].map(({ txid, vout }) => ({ txid, vout })),
  inputs: [walletInput, peerInput],
  outputs: [{ address: recipientAddress, amount: 128_000, outputType: 'recipient' as const, isOurs: false }],
};

describeWithDb('Payjoin broadcast persistence integration', () => {
  let prisma: PrismaClient;
  let walletId: string;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestData();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    mocks.broadcastTransaction.mockReset();
    mocks.broadcastTransaction.mockResolvedValue({ broadcasted: true });
    mocks.recalculateWalletBalances.mockReset();
    mocks.recalculateWalletBalances.mockResolvedValue(undefined);
    const wallet = await prisma.wallet.create({
      data: { name: 'Payjoin Sender', type: 'single_sig', scriptType: 'native_segwit', network: 'testnet3' },
    });
    walletId = wallet.id;
    await prisma.address.create({
      data: { walletId, address: walletAddress, derivationPath: "m/84'/1'/0'/0/0", index: 0 },
    });
    await prisma.uTXO.create({
      data: {
        walletId,
        txid: walletInput.txid,
        vout: walletInput.vout,
        address: walletAddress,
        amount: BigInt(walletInput.amount),
        scriptPubKey: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
      },
    });
  });

  const createIntent = (id: string, data: Record<string, unknown> = {}) => prisma.transactionSigningIntent.create({
    data: {
      id,
      walletId,
      createdByUserId: 'integration-user',
      network: 'testnet3',
      source: 'payjoin',
      snapshotVersion: 1,
      snapshot: { version: 1 },
      snapshotDigest: 'a'.repeat(64),
      unsignedPsbtBase64: 'cHNidP8=',
      unsignedPsbtSha256: 'b'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000),
      ...data,
    },
  });

  const expectOnlyWalletUtxoSpent = async (txid: string) => {
    expect(await prisma.uTXO.findMany({ where: { walletId }, select: { txid: true, spent: true } }))
      .toEqual([{ txid: walletInput.txid, spent: true }]);
    const record = await prisma.transaction.findUnique({
      where: { txid_walletId: { txid, walletId } },
      include: { inputs: { orderBy: { inputIndex: 'asc' } } },
    });
    expect(record).toMatchObject({ type: 'sent', amount: -60_000n, fee: 2_000n });
    expect(record!.inputs.map(input => input.txid)).toEqual([walletInput.txid, peerInput.txid]);
  };

  it('persists a broadcast payjoin proposal and marks only the wallet UTXO spent', async () => {
    const { rawTx, txid, recipientScript } = buildPayjoinTx();
    const snapshot = {
      version: 1 as const,
      walletId,
      network: 'testnet3' as const,
      transaction: {
        version: 2,
        locktime: 0,
        inputs: [[walletInput, 'wallet'], [peerInput, 'payjoin_peer']].map(([input, role]) => {
          const { txid: inputTxid, vout, amount } = input as typeof walletInput;
          return {
            txid: inputTxid,
            vout,
            sequence: 0xfffffffd,
            prevout: { amountSats: String(amount), scriptPubKeyHex: '0014', role: role as 'wallet' | 'payjoin_peer' },
          };
        }),
        outputs: [{ amountSats: '128000', scriptPubKeyHex: recipientScript.toString('hex') }],
      },
    };
    await createIntent('payjoin-intent', { snapshot });

    const result = await broadcastAndSave(createValidatedBroadcastArtifactFixture({
      walletId, network: 'testnet3', rawTx, txid, intentId: 'payjoin-intent', snapshot,
    }), payjoinMetadata);

    expect(result).toMatchObject({ broadcasted: true, persistenceStatus: 'complete' });
    await expectOnlyWalletUtxoSpent(txid);
  });

  it('recovers an accepted payjoin row left stuck by the old persistence', async () => {
    const { rawTx, txid } = buildPayjoinTx();
    await createIntent('stuck-payjoin-intent', {
      broadcastState: 'accepted',
      broadcastTxid: txid,
      broadcastRawTx: rawTx,
      broadcastMetadata: payjoinMetadata,
      broadcastAcceptedAt: new Date(0),
      consumedAt: new Date(0),
      broadcastLastAttemptAt: new Date(0),
    });

    await expect(reconcileSigningIntentBroadcasts()).resolves.toEqual({ examined: 1, completed: 1 });

    expect(await prisma.transactionSigningIntent.findUnique({
      where: { id: 'stuck-payjoin-intent' },
      select: { broadcastState: true },
    })).toEqual({ broadcastState: 'complete' });
    await expectOnlyWalletUtxoSpent(txid);
  });

  it('sorts a deferred accepted row after the other accepted rows', async () => {
    const accepted = {
      broadcastState: 'accepted',
      broadcastTxid: '3'.repeat(64),
      broadcastRawTx: '00',
      broadcastMetadata: payjoinMetadata,
      broadcastAcceptedAt: new Date(0),
      consumedAt: new Date(0),
    };
    await createIntent('a-failing', { ...accepted, broadcastLastAttemptAt: new Date(1_000) });
    await createIntent('b-waiting', { ...accepted, broadcastLastAttemptAt: new Date(2_000) });
    const now = new Date();

    await expect(deferAcceptedReconciliation('a-failing', now)).resolves.toEqual({ count: 1 });
    await expect(deferAcceptedReconciliation('missing', now)).resolves.toEqual({ count: 0 });

    const order = await listBroadcastsForReconciliation(now);
    expect(order.map(record => record.id)).toEqual(['b-waiting', 'a-failing']);
  });
});
