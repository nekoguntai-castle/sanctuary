import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { transactionRepository } from '../../../src/repositories';
import { persistAddressSyncIORows } from '../../../src/repositories/transactions/sync';
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

  it('selects both inputs-only and outputs-only rows for duplicate-safe I/O repair', async () => {
    const { wallet } = await createWalletFixture();
    const inputsOnlyTxid = generateTxid();
    const outputsOnlyTxid = generateTxid();
    const [inputsOnly, outputsOnly] = await Promise.all([
      prisma.transaction.create({
        data: { walletId: wallet.id, txid: inputsOnlyTxid, type: 'sent', amount: BigInt(-1) },
      }),
      prisma.transaction.create({
        data: { walletId: wallet.id, txid: outputsOnlyTxid, type: 'received', amount: BigInt(1) },
      }),
    ]);
    const existingInput = {
      transactionId: inputsOnly.id,
      inputIndex: 0,
      txid: generateTxid(),
      vout: 0,
      address: 'input-address',
      amount: BigInt(2),
    };
    const existingOutput = {
      transactionId: outputsOnly.id,
      outputIndex: 0,
      address: 'output-address',
      amount: BigInt(2),
    };
    await transactionRepository.createManyInputs([existingInput], { skipDuplicates: true });
    await transactionRepository.createManyOutputs([existingOutput], { skipDuplicates: true });

    const repairable = await transactionRepository.findWithoutIO(
      wallet.id,
      [inputsOnlyTxid, outputsOnlyTxid]
    );

    expect(repairable.map(row => row.txid).sort()).toEqual(
      [inputsOnlyTxid, outputsOnlyTxid].sort()
    );

    const inputRepair = await transactionRepository.createManyInputs([
      existingInput,
      {
        transactionId: outputsOnly.id,
        inputIndex: 0,
        txid: generateTxid(),
        vout: 1,
        address: 'recovered-input',
        amount: BigInt(3),
      },
    ], { skipDuplicates: true });
    const outputRepair = await transactionRepository.createManyOutputs([
      existingOutput,
      {
        transactionId: inputsOnly.id,
        outputIndex: 0,
        address: 'recovered-output',
        amount: BigInt(3),
      },
    ], { skipDuplicates: true });

    expect(inputRepair.count).toBe(1);
    expect(outputRepair.count).toBe(1);
    expect(await prisma.transactionInput.count({
      where: { transactionId: { in: [inputsOnly.id, outputsOnly.id] } },
    })).toBe(2);
    expect(await prisma.transactionOutput.count({
      where: { transactionId: { in: [inputsOnly.id, outputsOnly.id] } },
    })).toBe(2);
  });

  it('classifies deferred I/O from the committed type after a concurrent promotion', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    await transactionRepository.reconcileAddressSyncTransaction(
      candidate(wallet.id, address.id, txid, 'received')
    );
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    });

    let persistPromise!: ReturnType<typeof persistAddressSyncIORows>;
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
      persistPromise = persistAddressSyncIORows([], [
        {
          transactionId: transaction.id,
          outputIndex: 0,
          address: 'wallet-output',
          amount: BigInt(8_000),
          isOurs: true,
        },
        {
          transactionId: transaction.id,
          outputIndex: 1,
          address: 'external-output',
          amount: BigInt(1_000),
          isOurs: false,
        },
      ]);
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
