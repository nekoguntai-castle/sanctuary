import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';

const pipeline = vi.hoisted(() => ({ execute: vi.fn() }));
const fakeNode = vi.hoisted(() => ({
  client: {
    subscribeAddressBatch: vi.fn(async (addresses: string[]) => (
      new Map(addresses.map(address => [address, 'history-status']))
    )),
    subscribeAddress: vi.fn(async () => 'history-status'),
    getAddressHistoryBatch: vi.fn(async (addresses: string[]) => (
      new Map(addresses.map(address => [address, [{ tx_hash: 'a'.repeat(64), height: 840_000 }]]))
    )),
  },
}));

vi.mock('../../../src/services/bitcoin/sync', () => ({
  defaultSyncPhases: [],
  executeSyncPipeline: pipeline.execute,
}));

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn(async () => fakeNode.client),
}));

import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { syncWallet } from '../../../src/services/bitcoin/blockchain/syncWallet';
import {
  claimIncrementalSync,
  requestIncrementalSync,
} from '../../../src/repositories/syncIntentRepository';
import {
  createTestAddress,
  createTestUser,
  createTestWallet,
} from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

function pipelineResult(newAddressesGenerated: number) {
  return {
    addresses: newAddressesGenerated,
    transactions: 0,
    utxos: 0,
    elapsedMs: 1,
    stats: {
      historiesFetched: 0,
      transactionsProcessed: 0,
      newTransactionsCreated: 0,
      utxosFetched: 0,
      utxosCreated: 0,
      utxosMarkedSpent: 0,
      addressesUpdated: 0,
      newAddressesGenerated,
      correctedConsolidations: 0,
    },
  };
}

describeWithDatabase('production recursive wallet-sync mutation fencing', () => {
  const factoryClient = prisma as unknown as PrismaClient;
  const userIds: string[] = [];
  const walletIds: string[] = [];

  afterEach(async () => {
    await prisma.wallet.deleteMany({ where: { id: { in: walletIds.splice(0) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reuses the immutable fence for ownership repair and the recursive sync pass', async () => {
    const identity = randomUUID();
    const user = await createTestUser(factoryClient, {
      username: `recursive-sync-${identity}`,
      email: `recursive-sync-${identity}@example.com`,
    });
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id, { network: 'testnet3' });
    walletIds.push(wallet.id);
    await createTestAddress(factoryClient, wallet.id, {
      address: 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
      index: 0,
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
    const fence = Object.freeze({ walletId: wallet.id, generation: 1, leaseToken });
    pipeline.execute
      .mockResolvedValueOnce(pipelineResult(1))
      .mockResolvedValueOnce(pipelineResult(0));

    await expect(syncWallet(wallet.id, 0, undefined, fence)).resolves.toEqual({
      addresses: 1,
      transactions: 0,
      utxos: 0,
    });
    expect(pipeline.execute).toHaveBeenCalledTimes(2);
    expect(pipeline.execute.mock.calls[1][2]).toMatchObject({ mutationFence: fence });
    await expect(prisma.transactionOwnershipRepair.findUnique({
      where: { walletId_txid: { walletId: wallet.id, txid: 'a'.repeat(64) } },
    })).resolves.toMatchObject({ targetAddressCount: 1 });
  });
});
