import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';

const fakeNode = vi.hoisted(() => {
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
    getAddressHistory: vi.fn(async () => []),
    getAddressBalance: vi.fn(async () => ({ confirmed: 0, unconfirmed: 0 })),
    getAddressUTXOs: vi.fn(async () => []),
    getTransaction: vi.fn(async (txid: string) => transactionDetails.get(txid) ?? null),
    broadcastTransaction: vi.fn(async () => 'txid'),
    estimateFee: vi.fn(async () => 0.00001),
    subscribeAddress: vi.fn(async () => null),
    subscribeAddressBatch: vi.fn(async (addresses: string[]) => (
      new Map(addresses.map(address => [address, null]))
    )),
    getAddressHistoryBatch: vi.fn(async (addresses: string[]) => {
      reachedCalls++;
      if (reachedCalls === expectedCalls) reportReached?.();
      await networkGate;
      return new Map(addresses.map(address => [address, []]));
    }),
    getAddressUTXOsBatch: vi.fn(async (addresses: string[]) => (
      new Map(addresses.map(address => [address, []]))
    )),
    getTransactionsBatch: vi.fn(async () => new Map()),
  };

  return {
    client,
    resetSlowHistory,
    waitUntilAllReached: () => allReached,
    release: () => releaseNetwork?.(),
    setTransactionDetails: (txid: string, details: unknown) => {
      transactionDetails.set(txid, details);
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

import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { syncWallet } from '../../../src/services/bitcoin/blockchain/syncWallet';
import { populateMissingTransactionFields } from '../../../src/services/bitcoin/sync/confirmations';
import {
  claimIncrementalSync,
  requestIncrementalSync,
} from '../../../src/repositories/syncIntentRepository';
import {
  createTestAddress,
  createTestTransaction,
  createTestUser,
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

describeWithDatabase('production wallet sync network transaction boundaries', () => {
  const factoryClient = prisma as unknown as PrismaClient;
  const userIds: string[] = [];
  const walletIds: string[] = [];

  afterEach(async () => {
    await prisma.wallet.deleteMany({ where: { id: { in: walletIds.splice(0) } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
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
    const transaction = await createTestTransaction(factoryClient, wallet.id);
    fakeNode.setTransactionDetails(transaction.txid, {
      txid: transaction.txid,
      confirmations: 6,
      blockheight: 100_000,
      time: Math.floor(Date.now() / 1000),
      vin: [],
      vout: [{
        n: 0,
        value: 0.001,
        scriptPubKey: {
          address: address.address,
          addresses: [address.address],
          hex: '00140000000000000000000000000000000000000000',
        },
      }],
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
});
