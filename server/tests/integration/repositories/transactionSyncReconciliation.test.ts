import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { transactionRepository } from '../../../src/repositories';
import { storeTransactionIO } from '../../../src/services/bitcoin/sync/phases/processTransactions/transactionIO';
import type { SyncContext } from '../../../src/services/bitcoin/sync/types';
import {
  createTestAddress,
  createTestUser,
  createTestWallet,
  generateTxid,
} from './setup';

const describeWithDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDatabase('address sync transaction reconciliation', () => {
  const userIds: string[] = [];
  const factoryClient = prisma as unknown as PrismaClient;

  afterEach(async () => {
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createWalletFixture() {
    const user = await createTestUser(factoryClient);
    userIds.push(user.id);
    const wallet = await createTestWallet(factoryClient, user.id);
    const address = await createTestAddress(factoryClient, wallet.id);
    return { wallet, address };
  }

  async function waitForAddressSyncIOLock(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const waiting = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT true AS "waiting"
        FROM pg_stat_activity
        WHERE "pid" <> pg_backend_pid()
          AND "datname" = current_database()
          AND "query" LIKE '%address-sync-io-lock%'
          AND "wait_event_type" = 'Lock'
        LIMIT 1
      `;
      if (waiting.length > 0) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for address-sync I/O row lock');
  }

  const candidate = (
    walletId: string,
    addressId: string,
    txid: string,
    type: 'received' | 'consolidation' | 'sent'
  ) => ({
    walletId,
    addressId,
    txid,
    type,
    amount: type === 'sent' ? BigInt(-9_000) : BigInt(10_000),
    fee: type === 'received' ? undefined : BigInt(1_000),
    confirmations: type === 'sent' ? 2 : 0,
    blockHeight: type === 'sent' ? 100 : null,
    rbfStatus: type === 'sent' ? 'confirmed' as const : 'active' as const,
  });

  it('converges concurrent candidates on the strongest classification', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();

    const outcomes = await Promise.all([
      transactionRepository.reconcileAddressSyncTransaction(
        candidate(wallet.id, address.id, txid, 'received')
      ),
      transactionRepository.reconcileAddressSyncTransaction(
        candidate(wallet.id, address.id, txid, 'sent')
      ),
    ]);

    const stored = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    });
    expect(outcomes).toContain('created');
    expect(stored).toMatchObject({
      type: 'sent',
      amount: BigInt(-9_000),
      fee: BigInt(1_000),
      confirmations: 2,
      blockHeight: 100,
      rbfStatus: 'confirmed',
    });
  });

  it('converges a primary batch insert racing an address-sync promotion', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();

    const [batchResults] = await Promise.all([
      transactionRepository.reconcileTransactionBatch([
        candidate(wallet.id, address.id, txid, 'received'),
      ]),
      transactionRepository.reconcileAddressSyncTransaction(
        candidate(wallet.id, address.id, txid, 'sent')
      ),
    ]);

    expect(batchResults).toHaveLength(1);
    expect(await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
      select: { type: true, amount: true, rbfStatus: true },
    })).toEqual({
      type: 'sent',
      amount: BigInt(-9_000),
      rbfStatus: 'confirmed',
    });
  });

  it('repairs weaker rows but never downgrades or overwrites a stronger row', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();

    expect(await transactionRepository.reconcileAddressSyncTransaction(
      candidate(wallet.id, address.id, txid, 'received')
    )).toBe('created');
    const receivedRow = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    });
    await prisma.transactionOutput.createMany({
      data: [
        {
          transactionId: receivedRow.id,
          outputIndex: 0,
          address: 'wallet-output',
          amount: BigInt(8_000),
          isOurs: true,
          outputType: 'recipient',
        },
        {
          transactionId: receivedRow.id,
          outputIndex: 1,
          address: 'external-output',
          amount: BigInt(1_000),
          isOurs: false,
          outputType: 'unknown',
        },
      ],
    });
    expect(await transactionRepository.reconcileAddressSyncTransaction(
      candidate(wallet.id, address.id, txid, 'sent')
    )).toBe('repaired');

    expect(await prisma.transactionOutput.findMany({
      where: { transactionId: receivedRow.id },
      orderBy: { outputIndex: 'asc' },
      select: { outputType: true },
    })).toEqual([
      { outputType: 'change' },
      { outputType: 'recipient' },
    ]);

    const before = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    });
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      amount: BigInt(77_777),
      confirmations: 0,
      blockHeight: null,
    })).toBe('unchanged');
    const after = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    });
    expect(after).toMatchObject({
      type: before.type,
      amount: before.amount,
      fee: before.fee,
      confirmations: before.confirmations,
      blockHeight: before.blockHeight,
    });
    expect(await prisma.transactionOutput.findMany({
      where: { transactionId: receivedRow.id },
      orderBy: { outputIndex: 'asc' },
      select: { outputType: true },
    })).toEqual([
      { outputType: 'change' },
      { outputType: 'recipient' },
    ]);
  });

  it('persists classification input completeness monotonically without changing same-type outcome', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();

    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: false,
    })).toBe('created');
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: true,
    })).toBe('unchanged');
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: false,
    })).toBe('unchanged');

    expect(await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
      select: { type: true, classificationInputsComplete: true },
    })).toEqual({ type: 'received', classificationInputsComplete: true });
  });

  it('advances the private classification cursor without changing public updatedAt', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    const incomplete = {
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: false,
    };

    expect(await transactionRepository.reconcileAddressSyncTransaction(incomplete)).toBe('created');
    const before = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
      select: {
        id: true,
        updatedAt: true,
        classificationLastAttemptAt: true,
        ioLastAttemptAt: true,
      },
    });
    expect(before.classificationLastAttemptAt).toBeNull();
    expect(before.ioLastAttemptAt).toBeNull();

    await transactionRepository.markClassificationRepairAttempts(wallet.id, [txid]);
    await transactionRepository.markIoRepairAttempts(wallet.id, [txid]);
    const after = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
      select: {
        updatedAt: true,
        classificationLastAttemptAt: true,
        ioLastAttemptAt: true,
        ioComplete: true,
      },
    });

    expect(after.classificationLastAttemptAt).toBeInstanceOf(Date);
    expect(after.ioLastAttemptAt).toBeInstanceOf(Date);
    expect(after.ioComplete).toBe(false);
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());

    await transactionRepository.persistAddressSyncIORows([], [], [before.id]);
    const completed = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
      select: { updatedAt: true, ioComplete: true },
    });
    expect(completed.ioComplete).toBe(true);
    expect(completed.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });

  it('selects durable incomplete I/O regardless of relation shape', async () => {
    const { wallet } = await createWalletFixture();
    const incompleteTxid = generateTxid();
    const completeEmptyTxid = generateTxid();
    const [incomplete] = await Promise.all([
      prisma.transaction.create({
        data: {
          walletId: wallet.id,
          txid: incompleteTxid,
          type: 'sent',
          amount: BigInt(-1),
          ioComplete: false,
        },
      }),
      prisma.transaction.create({
        data: {
          walletId: wallet.id,
          txid: completeEmptyTxid,
          type: 'received',
          amount: BigInt(1),
          ioComplete: true,
        },
      }),
    ]);
    await prisma.transactionInput.createMany({
      data: [{
        transactionId: incomplete.id,
        inputIndex: 0,
        txid: generateTxid(),
        vout: 0,
        address: 'input-address',
        amount: BigInt(2),
      }],
      skipDuplicates: true,
    });
    await prisma.transactionOutput.createMany({
      data: [{
        transactionId: incomplete.id,
        outputIndex: 0,
        address: 'output-address',
        amount: BigInt(2),
      }],
      skipDuplicates: true,
    });

    const repairable = await transactionRepository.findWithoutIO(
      wallet.id,
      [incompleteTxid, completeEmptyTxid]
    );

    expect(repairable.map(row => row.txid)).toEqual([incompleteTxid]);
  });

  it('classifies primary-sync I/O from the committed type after a concurrent promotion', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    await transactionRepository.reconcileAddressSyncTransaction(
      candidate(wallet.id, address.id, txid, 'received')
    );
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    });

    const primaryCandidate = {
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: false,
    };
    const context = {
      walletId: wallet.id,
      walletAddressSet: new Set(['wallet-output']),
      addressToDerivationPath: new Map(),
      txDetailsCache: new Map([[txid, {
        txid,
        vin: [],
        vout: [
          {
            n: 0,
            value: 0.00008,
            scriptPubKey: { address: 'wallet-output' },
          },
          {
            n: 1,
            value: 0.00001,
            scriptPubKey: { address: 'external-output' },
          },
        ],
      }]]),
    } as unknown as SyncContext;

    let persistPromise!: ReturnType<typeof storeTransactionIO>;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "transactions" WHERE "id" = ${transaction.id} FOR UPDATE`;
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          type: 'sent',
          amount: BigInt(-9_000),
          fee: BigInt(1_000),
        },
      });
      persistPromise = storeTransactionIO(context, [primaryCandidate]);
      await waitForAddressSyncIOLock();
    });
    await persistPromise;

    expect(await prisma.transactionOutput.findMany({
      where: { transactionId: transaction.id },
      orderBy: { outputIndex: 'asc' },
      select: { outputType: true },
    })).toEqual([
      { outputType: 'change' },
      { outputType: 'recipient' },
    ]);
  });
});
