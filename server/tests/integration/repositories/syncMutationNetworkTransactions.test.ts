import { randomUUID } from 'node:crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { vi } from 'vitest';
import type { CompactTransactionEvidenceEnvelope } from '../../../src/services/bitcoin/sync/transactionEvidenceProjection';

/** A scripted Electrum server answered through the real `electrum/methods` parsers. */
interface ElectrumWire {
  history: Map<string, Array<{ tx_hash: string; height: number }>>;
  utxos: Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>;
  /** Raw transaction hex keyed by lowercase txid: served for a request in any case. */
  rawTransactions: Map<string, string>;
  served: Array<{ method: string; param: string; txids: string[] }>;
}

const fakeNode = vi.hoisted(() => {
  let wire: ElectrumWire | undefined;
  const methods = () => import('../../../src/services/bitcoin/electrum/methods');
  const answer = (method: string, params: unknown[] = []): unknown => {
    const param = String(params[0]);
    if (method === 'blockchain.transaction.get') return wire!.rawTransactions.get(param.toLowerCase()) ?? null;
    const items = method === 'blockchain.scripthash.listunspent'
      ? wire!.utxos.get(param) ?? []
      : wire!.history.get(param) ?? [];
    wire!.served.push({ method, param, txids: items.map(item => item.tx_hash) });
    return items;
  };
  const requestFn = async (method: string, params?: unknown[]) => answer(method, params);
  const batchRequestFn = async (requests: Array<{ method: string; params: unknown[] }>) => (
    requests.map(request => answer(request.method, request.params))
  );

  let releaseNetwork: (() => void) | undefined;
  let networkGate = Promise.resolve();
  let expectedCalls = 0;
  let reachedCalls = 0;
  let reportReached: (() => void) | undefined;
  let allReached = Promise.resolve();
  const transactionDetails = new Map<string, unknown>();

  const resetSlowHistory = (count: number) => {
    expectedCalls = count;
    reachedCalls = 0;
    networkGate = new Promise<void>(resolve => { releaseNetwork = resolve; });
    allReached = new Promise<void>(resolve => { reportReached = resolve; });
  };

  const client = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => true),
    getServerVersion: vi.fn(async () => ({ server: 'integration', protocol: '1.4' })),
    getServerFeatures: vi.fn(async () => ({})),
    getBlockHeight: vi.fn(async () => 840_000),
    getBlockHeader: vi.fn(async () => '00'),
    getAddressHistory: vi.fn(async (address: string) => (
      wire ? (await methods()).getAddressHistory(requestFn, address, 'testnet3') : []
    )),
    getAddressBalance: vi.fn(async () => ({ confirmed: 0, unconfirmed: 0 })),
    getAddressUTXOs: vi.fn(async (address: string) => (
      wire ? (await methods()).getAddressUTXOs(requestFn, address, 'testnet3') : []
    )),
    getTransaction: vi.fn(async (txid: string) => (
      wire
        ? (await methods()).getTransaction(requestFn, txid, 'testnet3')
        : transactionDetails.get(txid) ?? null
    )),
    broadcastTransaction: vi.fn(async () => 'txid'),
    estimateFee: vi.fn(async () => 0.00001),
    subscribeAddress: vi.fn(async () => null),
    subscribeAddressBatch: vi.fn(async (addresses: string[]) => (
      new Map(addresses.map(address => [address, null]))
    )),
    getAddressHistoryBatch: vi.fn(async (addresses: string[]) => {
      if (wire) return (await methods()).getAddressHistoryBatch(batchRequestFn, addresses, 'testnet3');
      reachedCalls++;
      if (reachedCalls === expectedCalls) reportReached?.();
      await networkGate;
      return new Map(addresses.map(address => [address, []]));
    }),
    getAddressUTXOsBatch: vi.fn(async (addresses: string[]) => (
      wire
        ? (await methods()).getAddressUTXOsBatch(batchRequestFn, addresses, 'testnet3')
        : new Map(addresses.map(address => [address, []]))
    )),
    getTransactionsBatch: vi.fn(async (txids: string[]) => (
      wire ? (await methods()).getTransactionsBatch(batchRequestFn, txids, 'testnet3', 0) : new Map()
    )),
  };

  return {
    client,
    resetSlowHistory,
    waitUntilAllReached: () => allReached,
    release: () => releaseNetwork?.(),
    setTransactionDetails: (txid: string, details: unknown) => {
      transactionDetails.set(txid, details);
    },
    setWire: (next: ElectrumWire | undefined) => {
      wire = next;
    },
  };
});

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn(async () => fakeNode.client),
  resetNodeClient: vi.fn(async () => undefined),
}));

vi.mock('../../../src/services/bitcoin/electrumPool', () => ({
  getElectrumPool: () => ({ isProxyEnabled: () => false }),
}));

// The evidence worker thread cannot load the .ts sources here (extensionless
// imports, no loader), so compact evidence is projected in process through the
// same projection module the worker runs.
vi.mock('../../../src/services/bitcoin/sync/transactionEvidenceThread', async () => {
  const actual = await vi.importActual<typeof import(
    '../../../src/services/bitcoin/sync/transactionEvidenceThread'
  )>('../../../src/services/bitcoin/sync/transactionEvidenceThread');
  const projection = await import('../../../src/services/bitcoin/sync/transactionEvidenceProjection');
  type ProjectionInput = Parameters<typeof projection.projectAuthenticatedTransactionWithComplexity>[0];
  const sealed = (envelope: CompactTransactionEvidenceEnvelope) => ({
    expectedTxid: envelope.txid,
    canonicalBytes: envelope.canonicalBytes,
    digest: envelope.digest,
    complexity: envelope.complexity,
    metadata: envelope.metadata,
  });
  const project = async (input: ProjectionInput, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    return projection.projectAuthenticatedTransactionWithComplexity(input).value;
  };
  return {
    ...actual,
    createTransactionEvidenceProjector: () => ({ project, close: async () => undefined }),
    createCompactTransactionEvidenceProjector: (walletScripts: readonly string[]) => ({
      project,
      projectCompact: async (input: ProjectionInput, signal?: AbortSignal) => {
        signal?.throwIfAborted();
        return projection.projectCompactAuthenticatedTransaction({
          expectedTxid: input.expectedTxid,
          remoteTxid: input.details.txid,
          canonicalBytes: Uint8Array.from(Buffer.from(input.details.hex ?? '', 'hex')),
          metadata: {
            time: input.details.time,
            blocktime: input.details.blocktime,
            blockheight: input.details.blockheight,
            confirmations: input.details.confirmations,
            blockhash: input.details.blockhash,
          },
          limits: input.limits,
        }, walletScripts.map(script => script.toLowerCase()));
      },
      projectFull: async (envelope: CompactTransactionEvidenceEnvelope) => projection.reprojectFullAuthenticatedTransaction(sealed(envelope)),
      extractOutput: async (envelope: CompactTransactionEvidenceEnvelope, vout: number) => (
        projection.extractExactAuthenticatedTransactionOutput(sealed(envelope), vout)
      ),
      extractOutputs: async (envelope: CompactTransactionEvidenceEnvelope, vouts: readonly number[]) => (
        projection.extractExactAuthenticatedTransactionOutputs(sealed(envelope), vouts)
      ),
      close: async () => undefined,
    }),
  };
});

import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { syncWallet } from '../../../src/services/bitcoin/blockchain/syncWallet';
import { addressToScriptHash, decodeRawTransaction } from '../../../src/services/bitcoin/electrum/methods';
import { populateMissingTransactionFields } from '../../../src/services/bitcoin/sync/confirmations';
import {
  claimIncrementalSync,
  requestIncrementalSync,
} from '../../../src/repositories/syncIntentRepository';
import {
  createTestAddress,
  createTestTransaction,
  createTestUser,
  createTestUtxo,
  createTestWallet,
} from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;
const ADDRESSES = [
  'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
  'tb1q9u62588spffmq4dzjxsr5l297znf3z6j5p2688',
  'tb1qcrh3yqn4nlleplcez2yndq2ry8h9ncg3qh7n54',
  'tb1q3vya2h5435jkugq2few7dmktlrwq4ejmfaw7kr',
  'tb1ql4k5ayv7p7w0t0ge7tpntgpkgw53g2payxkszr',
] as const;
const HISTORY_HEIGHT = 100_000;

/** A coinbase-shaped transaction (no parents to fetch) paying 50_000 sats to ADDRESSES[2]. */
function receivedTransaction() {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from('03a08601', 'hex'));
  transaction.addOutput(bitcoin.address.toOutputScript(ADDRESSES[2], bitcoin.networks.testnet), BigInt(50_000));
  return transaction;
}

/** History and listunspent for ADDRESSES[2] name `servedTxid`; the bytes are genuine for any case. */
function wireServing(transaction: bitcoin.Transaction, servedTxid: string): ElectrumWire {
  const scriptHash = addressToScriptHash(ADDRESSES[2], 'testnet3');
  return {
    history: new Map([[scriptHash, [{ tx_hash: servedTxid, height: HISTORY_HEIGHT }]]]),
    utxos: new Map([[scriptHash, [{ tx_hash: servedTxid, tx_pos: 0, height: HISTORY_HEIGHT, value: 50_000 }]]]),
    rawTransactions: new Map([[transaction.getId(), transaction.toHex()]]),
    served: [],
  };
}

async function countCaseInsensitive(walletId: string, txid: string) {
  const where = { walletId, txid: { equals: txid, mode: 'insensitive' as const } };
  const [transactions, utxos] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.uTXO.count({ where }),
  ]);
  return { transactions, utxos };
}

async function nonLowercaseTxids(walletId: string) {
  const [transactions, utxos] = await Promise.all([
    prisma.transaction.findMany({ where: { walletId }, select: { txid: true } }),
    prisma.uTXO.findMany({ where: { walletId }, select: { txid: true } }),
  ]);
  return [...transactions, ...utxos].map(row => row.txid).filter(txid => txid !== txid.toLowerCase());
}

async function claimFence(walletId: string) {
  await requestIncrementalSync(walletId);
  const leaseToken = randomUUID();
  const claimedAt = new Date();
  await claimIncrementalSync(walletId, {
    leaseToken,
    claimedAt,
    leaseExpiresAt: new Date(claimedAt.getTime() + 60_000),
    expectedRequestedGeneration: 1,
  });
  return { walletId, generation: 1, leaseToken } as const;
}

describeWithDatabase('production wallet sync network transaction boundaries', () => {
  const factoryClient = prisma as unknown as PrismaClient;
  const userIds: string[] = [];
  const walletIds: string[] = [];

  afterEach(async () => {
    fakeNode.setWire(undefined);
    await prisma.wallet.deleteMany({ where: { id: { in: walletIds.splice(0) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('skips node work when nullable fields do not apply to the transaction type', async () => {
    const identity = randomUUID();
    const user = await createTestUser(factoryClient, {
      username: `complete-fields-${identity}`,
      email: `complete-fields-${identity}@example.com`,
    });
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, { network: 'testnet3' });
    walletIds.push(wallet.id);
    const address = await createTestAddress(factoryClient, wallet.id, { address: ADDRESSES[0] });
    const received = await createTestTransaction(factoryClient, wallet.id, { type: 'received' });
    const consolidation = await createTestTransaction(factoryClient, wallet.id, {
      type: 'consolidation',
    });
    await Promise.all([
      prisma.transaction.update({
        where: { id: received.id },
        data: { addressId: address.id, fee: null, counterpartyAddress: address.address },
      }),
      prisma.transaction.update({
        where: { id: consolidation.id },
        data: { addressId: null, counterpartyAddress: null },
      }),
    ]);
    vi.clearAllMocks();

    await expect(populateMissingTransactionFields(wallet.id)).resolves.toEqual({
      updated: 0,
      confirmationUpdates: [],
    });
    expect(fakeNode.client.getBlockHeight).not.toHaveBeenCalled();
    expect(fakeNode.client.getAddressHistory).not.toHaveBeenCalled();
    expect(fakeNode.client.getTransaction).not.toHaveBeenCalled();
  });

  it('runs five production syncWallet network waits without pinning PostgreSQL transactions', async () => {
    const fences = await Promise.all(ADDRESSES.map(async (address, index) => {
      const identity = randomUUID();
      const user = await createTestUser(factoryClient, {
        username: `slow-sync-${identity}`,
        email: `slow-sync-${identity}@example.com`,
      });
      userIds.push(user.id);
      const wallet = await createTestWallet(factoryClient, user.id, { network: 'testnet3' });
      walletIds.push(wallet.id);
      await createTestAddress(factoryClient, wallet.id, { address, index });
      await requestIncrementalSync(wallet.id);
      const leaseToken = randomUUID();
      const claimedAt = new Date();
      await claimIncrementalSync(wallet.id, {
        leaseToken,
        claimedAt,
        leaseExpiresAt: new Date(claimedAt.getTime() + 60_000),
        expectedRequestedGeneration: 1,
      });
      return { walletId: wallet.id, generation: 1, leaseToken } as const;
    }));

    fakeNode.resetSlowHistory(fences.length);
    const syncs = fences.map(fence => syncWallet(fence.walletId, 0, undefined, fence));
    await fakeNode.waitUntilAllReached();

    await Promise.all(fences.map(fence => prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '250ms'");
      await tx.wallet.update({
        where: { id: fence.walletId },
        data: { lastSyncError: 'network-wait-observed' },
      });
    })));
    fakeNode.release();
    await Promise.all(syncs);

    await expect(prisma.wallet.count({
      where: {
        id: { in: fences.map(fence => fence.walletId) },
        lastSyncError: 'network-wait-observed',
      },
    })).resolves.toBe(5);
  });

  it('commits production missing-field network work through the exact fence', async () => {
    const identity = randomUUID();
    const user = await createTestUser(factoryClient, {
      username: `missing-field-${identity}`,
      email: `missing-field-${identity}@example.com`,
    });
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, { network: 'testnet3' });
    walletIds.push(wallet.id);
    const address = await createTestAddress(factoryClient, wallet.id, { address: ADDRESSES[0] });
    // Population authenticates the served bytes against the row txid. The dummy
    // parent is unknown to the fake node, so the counterparty stays null.
    const paid = new bitcoin.Transaction();
    paid.version = 2;
    paid.addInput(Buffer.from('11'.repeat(32), 'hex'), 0);
    paid.addOutput(bitcoin.address.toOutputScript(ADDRESSES[0], bitcoin.networks.testnet), BigInt(100_000));
    const transaction = await createTestTransaction(factoryClient, wallet.id, { txid: paid.getId() });
    fakeNode.setTransactionDetails(transaction.txid, {
      ...decodeRawTransaction(paid.toHex(), 'testnet3'),
      confirmations: 6,
      blockheight: 100_000,
      time: Math.floor(Date.now() / 1000),
    });
    await requestIncrementalSync(wallet.id);
    const leaseToken = randomUUID();
    const claimedAt = new Date();
    await claimIncrementalSync(wallet.id, {
      leaseToken,
      claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + 60_000),
      expectedRequestedGeneration: 1,
    });
    const fence = { walletId: wallet.id, generation: 1, leaseToken } as const;
    const commits = vi.fn();

    await expect(populateMissingTransactionFields(
      wallet.id,
      undefined,
      commits,
      fence,
    )).resolves.toMatchObject({ updated: 1 });
    expect(commits).toHaveBeenCalledOnce();
    await expect(prisma.transaction.findUnique({ where: { id: transaction.id } }))
      .resolves.toMatchObject({ addressId: address.id });
  });

  async function walletWatchingAddress(label: string) {
    const identity = randomUUID();
    const user = await createTestUser(factoryClient, {
      username: `${label}-${identity}`,
      email: `${label}-${identity}@example.com`,
    });
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, { network: 'testnet3' });
    walletIds.push(wallet.id);
    await createTestAddress(factoryClient, wallet.id, { address: ADDRESSES[2], index: 2 });
    return wallet;
  }

  async function syncAgainst(walletId: string, wire: ElectrumWire) {
    fakeNode.setWire(wire);
    await expect(syncWallet(walletId, 0, undefined, await claimFence(walletId))).resolves.toBeDefined();
    await expect(prisma.wallet.findUnique({ where: { id: walletId } }))
      .resolves.toMatchObject({ lastSyncError: null });
  }

  it('does not duplicate an authenticated transaction or UTXO served under an uppercase txid', async () => {
    const transaction = receivedTransaction();
    const txid = transaction.getId();
    const servedTxid = txid.toUpperCase();
    const wallet = await walletWatchingAddress('txid-case');
    await createTestTransaction(factoryClient, wallet.id, {
      txid, type: 'received', amount: BigInt(50_000), blockHeight: HISTORY_HEIGHT,
    });
    await createTestUtxo(factoryClient, wallet.id, {
      txid,
      vout: 0,
      amount: BigInt(50_000),
      address: ADDRESSES[2],
      scriptPubKey: Buffer.from(transaction.outs[0].script).toString('hex'),
      blockHeight: HISTORY_HEIGHT,
    });
    const wire = wireServing(transaction, servedTxid);

    await syncAgainst(wallet.id, wire);

    const scriptHash = addressToScriptHash(ADDRESSES[2], 'testnet3');
    expect(wire.served).toEqual(expect.arrayContaining([
      { method: 'blockchain.scripthash.get_history', param: scriptHash, txids: [servedTxid] },
      { method: 'blockchain.scripthash.listunspent', param: scriptHash, txids: [servedTxid] },
    ]));
    await expect(countCaseInsensitive(wallet.id, txid)).resolves.toEqual({ transactions: 1, utxos: 1 });
    await expect(nonLowercaseTxids(wallet.id)).resolves.toEqual([]);
  });

  it('inserts the served transaction and UTXO for an unseeded wallet (honest control)', async () => {
    const transaction = receivedTransaction();
    const txid = transaction.getId();
    const wallet = await walletWatchingAddress('txid-control');
    await expect(countCaseInsensitive(wallet.id, txid)).resolves.toEqual({ transactions: 0, utxos: 0 });

    await syncAgainst(wallet.id, wireServing(transaction, txid));

    await expect(countCaseInsensitive(wallet.id, txid)).resolves.toEqual({ transactions: 1, utxos: 1 });
  });
});
