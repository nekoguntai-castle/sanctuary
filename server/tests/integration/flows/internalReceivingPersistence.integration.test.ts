import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { broadcastAndSave } from '../../../src/services/bitcoin/transactions/broadcasting';
import { persistTransaction } from '../../../src/services/bitcoin/transactions/persistTransaction';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';

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
const ECPair = ECPairFactory(ecc);

const createSignedMultisigPayment = () => {
  const signerA = ECPair.fromPrivateKey(Buffer.alloc(32, 1), { network });
  const signerB = ECPair.fromPrivateKey(Buffer.alloc(32, 2), { network });
  const multisig = bitcoin.payments.p2ms({
    m: 2,
    pubkeys: [Buffer.from(signerA.publicKey), Buffer.from(signerB.publicKey)],
    network,
  });
  const payment = bitcoin.payments.p2wsh({ redeem: multisig, network });
  const inputHash = Buffer.alloc(32, 3);
  const psbt = new bitcoin.Psbt({ network });
  psbt.addInput({
    hash: inputHash,
    index: 0,
    witnessUtxo: { script: payment.output!, value: 100_000n },
    witnessScript: multisig.output!,
    bip32Derivation: [
      {
        masterFingerprint: Buffer.alloc(4, 1),
        path: "m/48'/1'/0'/2'/0/0",
        pubkey: Buffer.from(signerA.publicKey),
      },
      {
        masterFingerprint: Buffer.alloc(4, 2),
        path: "m/48'/1'/0'/2'/0/0",
        pubkey: Buffer.from(signerB.publicKey),
      },
    ],
  });
  psbt.addOutput({ address: payment.address!, value: 90_000n });
  psbt.signInput(0, signerA);
  psbt.signInput(0, signerB);
  const finalized = bitcoin.Psbt.fromBase64(psbt.toBase64(), { network });
  finalized.finalizeAllInputs();

  return {
    address: payment.address!,
    inputScript: payment.output!.toString('hex'),
    inputTxid: Buffer.from(inputHash).reverse().toString('hex'),
    rawTx: finalized.extractTransaction().toHex(),
    signedPsbt: psbt.toBase64(),
  };
};

describeWithDb('Internal receiving persistence integration', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    mocks.broadcastTransaction.mockReset();
    mocks.broadcastTransaction.mockResolvedValue({ broadcasted: true });
    mocks.recalculateWalletBalances.mockReset();
    mocks.recalculateWalletBalances.mockResolvedValue(undefined);
  });

  it('persists a signed 2-of-2 P2WSH receive and reuses both wallet rows', async () => {
    const [sender, receiver, otherNetworkReceiver] = await Promise.all([
      prisma.wallet.create({
        data: {
          name: 'Sender Multisig',
          type: 'multi_sig',
          scriptType: 'p2wsh',
          network: 'testnet3',
          quorum: 2,
          totalSigners: 2,
        },
      }),
      prisma.wallet.create({
        data: {
          name: 'Receiver Multisig',
          type: 'multi_sig',
          scriptType: 'p2wsh',
          network: 'testnet3',
          quorum: 2,
          totalSigners: 2,
        },
      }),
      prisma.wallet.create({
        data: {
          name: 'Signet Receiver Multisig',
          type: 'multi_sig',
          scriptType: 'p2wsh',
          network: 'signet',
          quorum: 2,
          totalSigners: 2,
        },
      }),
    ]);
    const payment = createSignedMultisigPayment();
    const address = payment.address;
    const amount = 90_000;
    await prisma.address.createMany({
      data: [receiver, otherNetworkReceiver].map(wallet => ({
        walletId: wallet.id,
        address,
        derivationPath: "m/48'/1'/0'/2'/0/0",
        index: 0,
      })),
    });
    await prisma.uTXO.create({
      data: {
        walletId: sender.id,
        txid: payment.inputTxid,
        vout: 0,
        address,
        amount: 100_000n,
        scriptPubKey: payment.inputScript,
      },
    });
    const metadata = {
      recipient: address,
      amount,
      fee: 10_000,
      label: 'sender-private-label',
      utxos: [{ txid: payment.inputTxid, vout: 0 }],
      inputs: [{ txid: payment.inputTxid, vout: 0, address, amount: 100_000 }],
      outputs: [{ address, amount, outputType: 'recipient' as const, isOurs: false }],
    };

    const broadcastResult = await broadcastAndSave(sender.id, payment.signedPsbt, {
      ...metadata,
      network: 'testnet3',
    });
    const { txid } = broadcastResult;

    expect(broadcastResult).toMatchObject({ broadcasted: true, persistenceStatus: 'complete' });
    expect(mocks.broadcastTransaction).toHaveBeenCalledTimes(1);
    const records = await prisma.transaction.findMany({
      where: { txid },
      orderBy: { walletId: 'asc' },
      include: { outputs: true },
    });
    expect(records).toHaveLength(2);
    const receiverRecord = records.find(record => record.walletId === receiver.id)!;
    expect(receiverRecord).toMatchObject({
      type: 'received',
      amount: BigInt(amount),
      confirmations: 0,
      blockHeight: null,
      label: null,
    });
    expect(receiverRecord.outputs).toEqual([
      expect.objectContaining({ address, amount: BigInt(amount), isOurs: true }),
    ]);
    expect(records.some(record => record.walletId === otherNetworkReceiver.id)).toBe(false);

    const replayPersistence = await persistTransaction(sender.id, txid, payment.rawTx, metadata);
    expect(replayPersistence.mainTransactionCreated).toBe(false);
    expect(replayPersistence.receivingTransactions).toEqual([
      expect.objectContaining({ status: 'existing' }),
    ]);
    expect(await prisma.transaction.count({ where: { txid } })).toBe(2);
    expect(await prisma.transactionOutput.count({ where: { transactionId: receiverRecord.id } })).toBe(1);
  });
});
