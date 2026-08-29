import prisma from '../../../src/models/prisma';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { transactionRepository } from '../../../src/repositories';
import { storeTransactionIO } from '../../../src/services/bitcoin/sync/phases/processTransactions/transactionIO';
import { recalculateWalletBalances } from '../../../src/services/bitcoin/utils/balanceCalculation';
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
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_classification_role_trigger ON "transaction_outputs"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS test_fail_classification_role_update()',
    );
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_middle_io_chunk_trigger ON "transaction_outputs"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS test_fail_middle_io_chunk()',
    );
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_pause_ownership_target_trigger ON "transaction_ownership_repairs"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS test_pause_ownership_target()',
    );
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_pause_balance_update_trigger ON "transactions"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS test_pause_balance_update()',
    );
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

  async function waitForBalanceAdvisoryLock(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const waiting = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT true AS "waiting"
        FROM pg_stat_activity
        WHERE "pid" <> pg_backend_pid()
          AND "datname" = current_database()
          AND "query" LIKE '%pg_advisory_xact_lock(hashtextextended%'
          AND "wait_event_type" = 'Lock'
        LIMIT 1
      `;
      if (waiting.length > 0) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for wallet balance advisory lock');
  }

  async function waitForAdvisoryLockQuery(fragment: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const waiting = await prisma.$queryRaw<Array<{ query: string }>>`
        SELECT "query"
        FROM pg_stat_activity
        WHERE "pid" <> pg_backend_pid()
          AND "datname" = current_database()
          AND "wait_event_type" = 'Lock'
      `;
      if (waiting.some(row => row.query.includes(fragment))) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for advisory lock query: ${fragment}`);
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
    classificationInputsComplete: true,
    classificationVersion: 2,
    classificationAddressCount: 1,
    amount: type === 'sent' ? BigInt(-9_000) : BigInt(10_000),
    fee: type === 'received' ? undefined : BigInt(1_000),
    confirmations: type === 'sent' ? 2 : 0,
    blockHeight: type === 'sent' ? 100 : null,
    blockTime: type === 'sent' ? new Date('2026-01-01T00:00:00.000Z') : null,
    rbfStatus: type === 'sent' ? 'confirmed' as const : 'active' as const,
  });

  it('durably marks every balance-affecting mutation until recalculation succeeds', async () => {
    const { wallet, address } = await createWalletFixture();
    const transaction = await prisma.transaction.create({
      data: candidate(wallet.id, address.id, generateTxid(), 'received'),
    });

    await expect(transactionRepository.hasPendingBalanceRecalculation(wallet.id))
      .resolves.toBe(true);

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { amount: BigInt(21_000) },
    });
    const [{ markerCount }] = await prisma.$queryRaw<Array<{ markerCount: bigint }>>`
      SELECT COUNT(*) AS "markerCount"
      FROM "wallet_balance_repairs"
      WHERE "walletId" = ${wallet.id}
    `;
    expect(markerCount).toBe(BigInt(1));

    await recalculateWalletBalances(wallet.id);
    await expect(transactionRepository.hasPendingBalanceRecalculation(wallet.id))
      .resolves.toBe(false);

    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        amount: BigInt(20_000),
        blockTime: new Date('2026-07-31T12:00:00.000Z'),
      },
    });
    await expect(transactionRepository.hasPendingBalanceRecalculation(wallet.id))
      .resolves.toBe(true);

    await recalculateWalletBalances(wallet.id);
    await prisma.transaction.delete({ where: { id: transaction.id } });
    await expect(transactionRepository.hasPendingBalanceRecalculation(wallet.id))
      .resolves.toBe(true);
  });

  it('keeps the first complete current-version classification under concurrency', async () => {
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
    expect(outcomes.sort()).toEqual(['created', 'unchanged']);
    expect(['received', 'sent']).toContain(stored.type);
  });

  it('retains an absent-row ownership target until a new-enough candidate arrives', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    await transactionRepository.markOwnershipRepairNeeded(
      wallet.id,
      [txid],
      2
    );

    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 1,
    })).toBe('unchanged');
    await expect(prisma.transaction.findUnique({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    })).resolves.toBeNull();
    await expect(prisma.transactionOwnershipRepair.findUnique({
      where: { walletId_txid: { walletId: wallet.id, txid } },
      select: { targetAddressCount: true },
    })).resolves.toEqual({ targetAddressCount: 2 });

    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 2,
    })).toBe('created');
    await expect(prisma.transactionOwnershipRepair.findUnique({
      where: { walletId_txid: { walletId: wallet.id, txid } },
    })).resolves.toBeNull();
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
    expect(['received', 'sent']).toContain((await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
      select: { type: true },
    })).type);
  });

  it('converges classification, balance, and output ownership after address discovery grows', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    expect(await transactionRepository.reconcileAddressSyncTransaction(
      candidate(wallet.id, address.id, txid, 'received')
    )).toBe('created');
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    });
    await prisma.transactionOutput.create({
      data: {
        transactionId: transaction.id,
        outputIndex: 0,
        address: 'newly-discovered-wallet-output',
        amount: BigInt(9_000),
        isOurs: false,
        outputType: 'unknown',
      },
    });

    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'consolidation'),
      classificationAddressCount: 2,
      amount: BigInt(-1_000),
    })).toBe('repaired');
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 1,
      amount: BigInt(99_000),
    })).toBe('unchanged');
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_classification_role_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced ownership repair failure';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_classification_role_trigger
      BEFORE UPDATE ON "transaction_outputs"
      FOR EACH ROW EXECUTE FUNCTION test_fail_classification_role_update()
    `);
    await expect(transactionRepository.persistAddressSyncIORows([], [{
      transactionId: transaction.id,
      outputIndex: 0,
      address: 'newly-discovered-wallet-output',
      amount: BigInt(9_000),
      isOurs: true,
    }], [transaction.id], 2)).rejects.toThrow('forced ownership repair failure');
    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      select: { ioComplete: true },
    })).resolves.toEqual({ ioComplete: false });
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER test_fail_classification_role_trigger ON "transaction_outputs"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION test_fail_classification_role_update()',
    );
    await transactionRepository.persistAddressSyncIORows([], [{
      transactionId: transaction.id,
      outputIndex: 0,
      address: 'newly-discovered-wallet-output',
      amount: BigInt(9_000),
      isOurs: true,
    }], [transaction.id], 2);
    await recalculateWalletBalances(wallet.id);

    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      select: {
        type: true,
        amount: true,
        balanceAfter: true,
        classificationAddressCount: true,
      },
    })).resolves.toEqual({
      type: 'consolidation',
      amount: BigInt(-1_000),
      balanceAfter: BigInt(-1_000),
      classificationAddressCount: 2,
    });
    await expect(prisma.transactionOutput.findUniqueOrThrow({
      where: {
        transactionId_outputIndex: {
          transactionId: transaction.id,
          outputIndex: 0,
        },
      },
      select: { isOurs: true, outputType: true },
    })).resolves.toEqual({
      isOurs: true,
      outputType: 'consolidation',
    });
  });

  it('reconciles conflicting I/O without replacing IDs or user metadata', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    const transaction = await prisma.transaction.create({
      data: candidate(wallet.id, address.id, txid, 'sent'),
    });
    const input = await prisma.transactionInput.create({
      data: {
        transactionId: transaction.id,
        inputIndex: 0,
        txid: generateTxid(),
        vout: 1,
        address: 'old-input-address',
        amount: BigInt(100),
        derivationPath: "m/84'/1'/0'/0/0",
      },
    });
    const output = await prisma.transactionOutput.create({
      data: {
        transactionId: transaction.id,
        outputIndex: 0,
        address: 'old-output-address',
        amount: BigInt(200),
        scriptPubKey: '0014old',
        isOurs: false,
        outputType: 'recipient',
        label: 'preserve me',
      },
    });

    const replacementInputTxid = generateTxid();
    await transactionRepository.persistAddressSyncIORows([{
      transactionId: transaction.id,
      inputIndex: 0,
      txid: replacementInputTxid,
      vout: 2,
      address: 'new-input-address',
      amount: BigInt(300),
    }], [{
      transactionId: transaction.id,
      outputIndex: 0,
      address: 'new-output-address',
      amount: BigInt(400),
      isOurs: true,
    }], [transaction.id], 1);

    await expect(prisma.transactionInput.findUniqueOrThrow({
      where: {
        transactionId_inputIndex: {
          transactionId: transaction.id,
          inputIndex: 0,
        },
      },
    })).resolves.toMatchObject({
      id: input.id,
      txid: replacementInputTxid,
      vout: 2,
      address: 'new-input-address',
      amount: BigInt(300),
      derivationPath: "m/84'/1'/0'/0/0",
    });
    await expect(prisma.transactionOutput.findUniqueOrThrow({
      where: {
        transactionId_outputIndex: {
          transactionId: transaction.id,
          outputIndex: 0,
        },
      },
    })).resolves.toMatchObject({
      id: output.id,
      address: 'new-output-address',
      amount: BigInt(400),
      scriptPubKey: '0014old',
      isOurs: true,
      outputType: 'change',
      label: 'preserve me',
    });
    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      select: { ioComplete: true },
    })).resolves.toEqual({ ioComplete: true });
  });

  it('uses fresh confirmed evidence for atomic RBF reconciliation and idempotent retry', async () => {
    const { wallet, address } = await createWalletFixture();
    const sharedInputTxid = generateTxid();
    const confirmed = await prisma.transaction.create({
      data: {
        ...candidate(wallet.id, address.id, generateTxid(), 'sent'),
        confirmations: 0,
        blockHeight: null,
        blockTime: null,
        rbfStatus: 'active',
      },
    });
    const pending = await prisma.transaction.create({
      data: candidate(wallet.id, address.id, generateTxid(), 'received'),
    });
    await prisma.transactionInput.createMany({
      data: [confirmed, pending].map((transaction, inputIndex) => ({
        transactionId: transaction.id,
        inputIndex,
        txid: sharedInputTxid,
        vout: 7,
        address: `input-address-${inputIndex}`,
        amount: BigInt(10_000),
      })),
    });

    const rollback = new Error('rollback RBF reconciliation');
    await expect(prisma.$transaction(async tx => {
      await expect(transactionRepository.reconcilePendingRbfForConfirmedTransactions(
        wallet.id,
        [{ id: confirmed.id, txid: confirmed.txid }],
        tx,
      )).resolves.toBe(1);
      await expect(tx.transaction.findUniqueOrThrow({
        where: { id: pending.id },
        select: { rbfStatus: true, replacedByTxid: true },
      })).resolves.toEqual({
        rbfStatus: 'replaced',
        replacedByTxid: confirmed.txid,
      });
      throw rollback;
    })).rejects.toBe(rollback);

    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: pending.id },
      select: { rbfStatus: true, replacedByTxid: true },
    })).resolves.toEqual({ rbfStatus: 'active', replacedByTxid: null });

    await expect(transactionRepository.reconcilePendingRbfForConfirmedTransactions(
      wallet.id,
      [{ id: confirmed.id, txid: confirmed.txid }],
    )).resolves.toBe(1);
    await expect(transactionRepository.reconcilePendingRbfForConfirmedTransactions(
      wallet.id,
      [{ id: confirmed.id, txid: confirmed.txid }],
    )).resolves.toBe(0);
    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: pending.id },
      select: { rbfStatus: true, replacedByTxid: true },
    })).resolves.toEqual({
      rbfStatus: 'replaced',
      replacedByTxid: confirmed.txid,
    });
  });

  it('finds bounded active and unlinked cleanup replacements database-side', async () => {
    const { wallet, address } = await createWalletFixture();
    const sharedInputTxid = generateTxid();
    const confirmed = await prisma.transaction.create({
      data: candidate(wallet.id, address.id, generateTxid(), 'sent'),
    });
    const active = await prisma.transaction.create({
      data: candidate(wallet.id, address.id, generateTxid(), 'received'),
    });
    const unlinked = await prisma.transaction.create({
      data: {
        ...candidate(wallet.id, address.id, generateTxid(), 'received'),
        rbfStatus: 'replaced',
        replacedByTxid: null,
      },
    });
    await prisma.transactionInput.createMany({
      data: [confirmed, active, unlinked].map((transaction, inputIndex) => ({
        transactionId: transaction.id,
        inputIndex,
        txid: sharedInputTxid,
        vout: 3,
        address: `cleanup-input-${inputIndex}`,
        amount: BigInt(5_000),
      })),
    });

    await expect(transactionRepository.findWalletRbfReplacements(
      wallet.id,
      'active',
    )).resolves.toEqual([{
      id: active.id,
      txid: active.txid,
      replacementTxid: confirmed.txid,
    }]);
    await expect(transactionRepository.findWalletRbfReplacements(
      wallet.id,
      'unlinked',
    )).resolves.toEqual([{
      id: unlinked.id,
      txid: unlinked.txid,
      replacementTxid: confirmed.txid,
    }]);
    await expect(transactionRepository.reconcileWalletRbfReplacement(
      wallet.id,
      active.id,
      confirmed.txid,
      'active',
    )).resolves.toBe(true);
    await expect(transactionRepository.reconcileWalletRbfReplacement(
      wallet.id,
      unlinked.id,
      confirmed.txid,
      'unlinked',
    )).resolves.toBe(true);
  });

  it('rejects stale RBF cleanup decisions after target or replacement state changes', async () => {
    const { wallet, address } = await createWalletFixture();
    const sharedInputTxid = generateTxid();
    const confirmed = await prisma.transaction.create({
      data: candidate(wallet.id, address.id, generateTxid(), 'sent'),
    });
    const active = await prisma.transaction.create({
      data: candidate(wallet.id, address.id, generateTxid(), 'received'),
    });
    const unlinked = await prisma.transaction.create({
      data: {
        ...candidate(wallet.id, address.id, generateTxid(), 'received'),
        rbfStatus: 'replaced',
        replacedByTxid: null,
      },
    });
    await prisma.transactionInput.createMany({
      data: [confirmed, active, unlinked].map((transaction, inputIndex) => ({
        transactionId: transaction.id,
        inputIndex,
        txid: sharedInputTxid,
        vout: 9,
        address: `stale-cleanup-input-${inputIndex}`,
        amount: BigInt(8_000),
      })),
    });

    await prisma.transaction.update({
      where: { id: active.id },
      data: { confirmations: 1, rbfStatus: 'confirmed' },
    });
    await prisma.transaction.update({
      where: { id: unlinked.id },
      data: { replacedByTxid: 'already-linked' },
    });
    await expect(transactionRepository.reconcileWalletRbfReplacement(
      wallet.id, active.id, confirmed.txid, 'active'
    )).resolves.toBe(false);
    await expect(transactionRepository.reconcileWalletRbfReplacement(
      wallet.id, unlinked.id, confirmed.txid, 'unlinked'
    )).resolves.toBe(false);

    await prisma.transaction.update({
      where: { id: unlinked.id },
      data: { replacedByTxid: null },
    });
    await prisma.transaction.update({
      where: { id: confirmed.id },
      data: { confirmations: 0, rbfStatus: 'active' },
    });
    await expect(transactionRepository.reconcileWalletRbfReplacement(
      wallet.id, unlinked.id, confirmed.txid, 'unlinked'
    )).resolves.toBe(false);

    await expect(prisma.transaction.findMany({
      where: { id: { in: [active.id, unlinked.id] } },
      orderBy: { id: 'asc' },
      select: { id: true, rbfStatus: true, replacedByTxid: true },
    })).resolves.toEqual([
      { id: active.id, rbfStatus: 'confirmed', replacedByTxid: null },
      { id: unlinked.id, rbfStatus: 'replaced', replacedByTxid: null },
    ].sort((left, right) => left.id.localeCompare(right.id)));
  });

  it('rolls back a real 2,792-output transaction when a middle chunk fails, then retries idempotently', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    const transaction = await prisma.transaction.create({
      data: { ...candidate(wallet.id, address.id, txid, 'received'), ioComplete: false },
    });
    const context = {
      walletId: wallet.id,
      walletAddressSet: new Set<string>([address.address]),
      walletScriptToAddress: new Map<string, string>(),
      addressToDerivationPath: new Map<string, string>(),
      txDetailsCache: new Map([[txid, {
        txid,
        vin: [{ coinbase: '03abcdef' }],
        vout: Array.from({ length: 2_792 }, (_, outputIndex) => ({
          n: outputIndex,
          value: 0.00000001,
          scriptPubKey: { address: `middle-chunk-output-${outputIndex}` },
        })),
      }]]),
    } as unknown as SyncContext;
    const candidateTransaction = [{ txid, confirmations: 0 }] as never;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_middle_io_chunk() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced middle I/O chunk failure';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_middle_io_chunk_trigger
      BEFORE INSERT OR UPDATE ON "transaction_outputs"
      FOR EACH ROW WHEN (NEW."outputIndex" = 512)
      EXECUTE FUNCTION test_fail_middle_io_chunk()
    `);

    await expect(prisma.$transaction(tx => storeTransactionIO(
      context,
      candidateTransaction,
      tx,
    ))).rejects.toThrow('forced middle I/O chunk failure');
    await expect(prisma.transactionOutput.count({
      where: { transactionId: transaction.id },
    })).resolves.toBe(0);
    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      select: { ioComplete: true },
    })).resolves.toEqual({ ioComplete: false });

    await prisma.$executeRawUnsafe(
      'DROP TRIGGER test_fail_middle_io_chunk_trigger ON "transaction_outputs"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION test_fail_middle_io_chunk()');
    await prisma.$transaction(tx => storeTransactionIO(context, candidateTransaction, tx));
    await prisma.$transaction(tx => storeTransactionIO(context, candidateTransaction, tx));

    await expect(prisma.transactionOutput.count({
      where: { transactionId: transaction.id },
    })).resolves.toBe(2_792);
    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      select: { ioComplete: true },
    })).resolves.toEqual({ ioComplete: true });
  });

  it('rolls back a real 2,792-output transaction when the attempt aborts after a persisted chunk', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    const transaction = await prisma.transaction.create({
      data: { ...candidate(wallet.id, address.id, txid, 'received'), ioComplete: false },
    });
    const controller = new AbortController();
    const context = {
      walletId: wallet.id,
      walletAddressSet: new Set<string>([address.address]),
      walletScriptToAddress: new Map<string, string>(),
      addressToDerivationPath: new Map<string, string>(),
      attemptRuntime: { signal: controller.signal, deadlineAt: Date.now() + 60_000 },
      txDetailsCache: new Map([[txid, {
        txid,
        vin: [{ coinbase: '03abcdef' }],
        vout: Array.from({ length: 2_792 }, (_, outputIndex) => ({
          n: outputIndex,
          value: 0.00000001,
          scriptPubKey: { address: `aborted-chunk-output-${outputIndex}` },
        })),
      }]]),
    } as unknown as SyncContext;
    const persistRows = transactionRepository.persistAddressSyncIORows;
    let persistedChunks = 0;
    const persistence = vi.spyOn(transactionRepository, 'persistAddressSyncIORows')
      .mockImplementation(async (...args) => {
        await persistRows(...args);
        persistedChunks++;
        if (persistedChunks === 1) {
          controller.abort(new Error('attempt lease expired after I/O chunk'));
        }
      });

    try {
      await expect(prisma.$transaction(tx => storeTransactionIO(
        context,
        [{ txid, confirmations: 0 }] as never,
        tx,
      ))).rejects.toThrow('attempt lease expired after I/O chunk');
    } finally {
      persistence.mockRestore();
    }

    expect(persistedChunks).toBe(1);
    await expect(prisma.transactionOutput.count({
      where: { transactionId: transaction.id },
    })).resolves.toBe(0);
    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      select: { ioComplete: true },
    })).resolves.toEqual({ ioComplete: false });
  });

  it('repairs weaker rows but never downgrades or overwrites a stronger row', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();

    expect(await transactionRepository.reconcileAddressSyncTransaction(
      {
        ...candidate(wallet.id, address.id, txid, 'received'),
        classificationVersion: 1,
      }
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

  it('authoritatively repairs incomplete same-type scalar data once', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();

    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: false,
    })).toBe('created');
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: true,
      amount: BigInt(30_000),
    })).toBe('repaired');
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: false,
    })).toBe('unchanged');

    expect(await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
      select: {
        type: true,
        amount: true,
        classificationInputsComplete: true,
        classificationVersion: true,
      },
    })).toEqual({
      type: 'received',
      amount: BigInt(30_000),
      classificationInputsComplete: true,
      classificationVersion: 2,
    });
  });

  it('never consumes ownership targets or downgrades address evidence', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: false,
      classificationAddressCount: 2,
    })).toBe('created');
    await transactionRepository.markOwnershipRepairNeeded(wallet.id, [txid], 3);

    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationInputsComplete: false,
      classificationAddressCount: 3,
    })).toBe('unchanged');
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 2,
    })).toBe('unchanged');
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 3,
    })).toBe('repaired');
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 2,
      amount: BigInt(99_000),
    })).toBe('unchanged');

    await expect(prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
      select: { classificationAddressCount: true, classificationInputsComplete: true },
    })).resolves.toEqual({
      classificationAddressCount: 3,
      classificationInputsComplete: true,
    });
    await expect(prisma.transactionOwnershipRepair.count({
      where: { walletId: wallet.id, txid },
    })).resolves.toBe(0);
  });

  it('fences absent-row batch insertion with the durable ownership target', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    await transactionRepository.markOwnershipRepairNeeded(wallet.id, [txid], 2);

    await expect(transactionRepository.reconcileTransactionBatch([{
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 1,
    }])).resolves.toEqual([expect.objectContaining({ outcome: 'unchanged' })]);
    await expect(prisma.transaction.count({
      where: { walletId: wallet.id, txid },
    })).resolves.toBe(0);

    await expect(transactionRepository.reconcileTransactionBatch([{
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 2,
    }])).resolves.toEqual([expect.objectContaining({ outcome: 'created' })]);
    await expect(prisma.transaction.count({
      where: { walletId: wallet.id, txid },
    })).resolves.toBe(1);
    await expect(prisma.transactionOwnershipRepair.count({
      where: { walletId: wallet.id, txid },
    })).resolves.toBe(0);
  });

  it('serializes concurrent target creation ahead of absent-row batch insertion', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    const pauseKey = 72_310_001;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_pause_ownership_target() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(${pauseKey});
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_pause_ownership_target_trigger
      AFTER INSERT ON "transaction_ownership_repairs"
      FOR EACH ROW EXECUTE FUNCTION test_pause_ownership_target()
    `);
    let releasePause = (): void => {};
    let signalPauseHeld = (): void => {};
    const pauseReleased = new Promise<void>(resolve => {
      releasePause = resolve;
    });
    const pauseHeld = new Promise<void>(resolve => {
      signalPauseHeld = resolve;
    });
    const blocker = prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${pauseKey})`);
      signalPauseHeld();
      await pauseReleased;
    }, { timeout: 30_000 });
    await pauseHeld;

    const targetCreation = transactionRepository.markOwnershipRepairNeeded(
      wallet.id,
      [txid],
      2
    );
    await waitForAdvisoryLockQuery('transaction_ownership_repairs');
    let insertionFinished = false;
    const insertion = transactionRepository.reconcileTransactionBatch([{
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 1,
    }]).then(result => {
      insertionFinished = true;
      return result;
    });
    await waitForAdvisoryLockQuery('hashtextextended');
    expect(insertionFinished).toBe(false);

    releasePause();
    await blocker;
    await targetCreation;
    await expect(insertion).resolves.toEqual([
      expect.objectContaining({ outcome: 'unchanged' }),
    ]);
    await expect(prisma.transaction.count({
      where: { walletId: wallet.id, txid },
    })).resolves.toBe(0);
  });

  it('uses canonical lock order for reversed concurrent batches', async () => {
    const { wallet, address } = await createWalletFixture();
    const firstTxid = generateTxid();
    const secondTxid = generateTxid();
    const first = candidate(wallet.id, address.id, firstTxid, 'received');
    const second = candidate(wallet.id, address.id, secondTxid, 'received');

    await Promise.all([
      transactionRepository.reconcileTransactionBatch([first, second]),
      transactionRepository.reconcileTransactionBatch([second, first]),
    ]);

    await expect(prisma.transaction.count({
      where: { walletId: wallet.id, txid: { in: [firstTxid, secondTxid] } },
    })).resolves.toBe(2);
  });

  it('cascades durable ownership targets when their wallet is deleted', async () => {
    const { wallet } = await createWalletFixture();
    const txid = generateTxid();
    await transactionRepository.markOwnershipRepairNeeded(wallet.id, [txid], 2);

    await prisma.wallet.delete({ where: { id: wallet.id } });

    await expect(prisma.transactionOwnershipRepair.count({
      where: { walletId: wallet.id },
    })).resolves.toBe(0);
  });

  it('reads and writes balances only after acquiring the wallet advisory lock', async () => {
    const { wallet, address } = await createWalletFixture();
    const transaction = await prisma.transaction.create({
      data: candidate(wallet.id, address.id, generateTxid(), 'received'),
    });
    let releaseLock = (): void => {};
    let signalAcquired = (): void => {};
    const lockReleased = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    const lockAcquired = new Promise<void>(resolve => {
      signalAcquired = resolve;
    });
    const blocker = prisma.$transaction(async tx => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${wallet.id}, 0))
      `;
      signalAcquired();
      await lockReleased;
    }, { timeout: 30_000 });
    await lockAcquired;

    let recalculationFinished = false;
    const recalculation = recalculateWalletBalances(wallet.id).then(() => {
      recalculationFinished = true;
    });
    await waitForBalanceAdvisoryLock();
    expect(recalculationFinished).toBe(false);
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { amount: BigInt(20_000) },
    });
    releaseLock();
    await blocker;
    await recalculation;

    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      select: { amount: true, balanceAfter: true },
    })).resolves.toEqual({
      amount: BigInt(20_000),
      balanceAfter: BigInt(20_000),
    });
  });

  it('lets the repaired recalculation win after a stale reader resumes', async () => {
    const { wallet, address } = await createWalletFixture();
    const first = await prisma.transaction.create({
      data: {
        ...candidate(wallet.id, address.id, generateTxid(), 'received'),
        id: 'balance-race-a',
      },
    });
    const second = await prisma.transaction.create({
      data: {
        ...candidate(wallet.id, address.id, generateTxid(), 'received'),
        id: 'balance-race-b',
      },
    });
    const pauseKey = 72_310_002;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_pause_balance_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."id" = '${first.id}' THEN
          PERFORM pg_advisory_xact_lock(${pauseKey});
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_pause_balance_update_trigger
      BEFORE UPDATE OF "balanceAfter" ON "transactions"
      FOR EACH ROW EXECUTE FUNCTION test_pause_balance_update()
    `);
    let releasePause = (): void => {};
    let signalPauseHeld = (): void => {};
    const pauseReleased = new Promise<void>(resolve => {
      releasePause = resolve;
    });
    const pauseHeld = new Promise<void>(resolve => {
      signalPauseHeld = resolve;
    });
    const blocker = prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${pauseKey})`);
      signalPauseHeld();
      await pauseReleased;
    }, { timeout: 30_000 });
    await pauseHeld;

    const staleRecalculation = recalculateWalletBalances(wallet.id);
    await waitForAdvisoryLockQuery('balanceAfter');
    await prisma.transaction.update({
      where: { id: second.id },
      data: { amount: BigInt(20_000) },
    });
    const repairedRecalculation = recalculateWalletBalances(wallet.id);
    await waitForBalanceAdvisoryLock();
    releasePause();
    await blocker;
    await staleRecalculation;
    await repairedRecalculation;

    await expect(prisma.transaction.findMany({
      where: { walletId: wallet.id },
      orderBy: [{ blockTime: 'asc' }, { createdAt: 'asc' }],
      select: { amount: true, balanceAfter: true },
    })).resolves.toEqual([
      { amount: BigInt(10_000), balanceAfter: BigInt(10_000) },
      { amount: BigInt(20_000), balanceAfter: BigInt(30_000) },
    ]);
  });

  it('fences stale I/O ownership writes below the committed address watermark', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    expect(await transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'received'),
      classificationAddressCount: 2,
    })).toBe('created');
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    });
    await prisma.transactionOutput.create({
      data: {
        transactionId: transaction.id,
        outputIndex: 0,
        address: address.address,
        amount: BigInt(10_000),
        isOurs: true,
        outputType: 'recipient',
      },
    });

    await transactionRepository.persistAddressSyncIORows([], [{
      transactionId: transaction.id,
      outputIndex: 0,
      address: address.address,
      amount: BigInt(10_000),
      isOurs: false,
    }], [transaction.id], 1);

    await expect(prisma.transactionOutput.findFirstOrThrow({
      where: { transactionId: transaction.id, outputIndex: 0 },
      select: { isOurs: true, outputType: true },
    })).resolves.toEqual({ isOurs: true, outputType: 'recipient' });
    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      select: { ioComplete: true },
    })).resolves.toEqual({ ioComplete: false });
  });

  it('rolls back authoritative scalar repair when output-role correction fails', async () => {
    const { wallet, address } = await createWalletFixture();
    const txid = generateTxid();
    await prisma.transaction.create({
      data: {
        ...candidate(wallet.id, address.id, txid, 'received'),
        classificationVersion: 1,
        amount: BigInt(10_000),
      },
    });
    const transaction = await prisma.transaction.findUniqueOrThrow({
      where: { txid_walletId: { txid, walletId: wallet.id } },
    });
    await prisma.transactionOutput.create({
      data: {
        transactionId: transaction.id,
        outputIndex: 0,
        address: address.address,
        amount: BigInt(10_000),
        isOurs: true,
        outputType: 'recipient',
      },
    });
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_classification_role_update() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced classification role failure';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_classification_role_trigger
      BEFORE UPDATE ON "transaction_outputs"
      FOR EACH ROW EXECUTE FUNCTION test_fail_classification_role_update()
    `);

    await expect(transactionRepository.reconcileAddressSyncTransaction({
      ...candidate(wallet.id, address.id, txid, 'sent'),
      amount: BigInt(-9_000),
    })).rejects.toThrow('forced classification role failure');

    await expect(prisma.transaction.findUniqueOrThrow({
      where: { id: transaction.id },
      select: { type: true, amount: true, classificationVersion: true },
    })).resolves.toEqual({
      type: 'received',
      amount: BigInt(10_000),
      classificationVersion: 1,
    });
    await expect(prisma.transactionOutput.findFirstOrThrow({
      where: { transactionId: transaction.id },
      select: { outputType: true },
    })).resolves.toEqual({ outputType: 'recipient' });
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
