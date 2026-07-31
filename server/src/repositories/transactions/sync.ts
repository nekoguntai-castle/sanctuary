import prisma, { type PrismaTxClient } from '../../models/prisma';
import { Prisma } from '../../generated/prisma/client';

export type AddressSyncTransactionType = 'received' | 'consolidation' | 'sent';
export type AddressSyncReconcileOutcome = 'created' | 'repaired' | 'unchanged';

export type TransactionReconcileResult = {
  transaction: AddressSyncTransactionInput;
  outcome: AddressSyncReconcileOutcome;
};

export type AddressSyncTransactionInput = Prisma.TransactionUncheckedCreateInput & {
  type: AddressSyncTransactionType;
  rbfStatus: 'active' | 'confirmed';
};

/** Input shape accepted by the address-sync I/O persistence boundary. */
export type AddressSyncInputRow = Prisma.TransactionInputCreateManyInput;
/**
 * Output shape accepted by address sync. `outputType` is derived only after
 * locking and reading the parent transaction's committed classification.
 */
export type AddressSyncOutputRow = Omit<
  Prisma.TransactionOutputCreateManyInput,
  'outputType'
> & { isOurs: boolean };

// Classification evidence is monotonic: owned inputs outrank output-only evidence,
// and a positively identified external output distinguishes sent from consolidation.
const promotionSources: Record<AddressSyncTransactionType, AddressSyncTransactionType[]> = {
  received: [],
  consolidation: ['received'],
  sent: ['received', 'consolidation'],
};

const getPromotionData = (data: AddressSyncTransactionInput) => ({
  type: data.type,
  amount: data.amount,
  fee: data.fee,
  confirmations: data.confirmations,
  blockHeight: data.blockHeight,
  blockTime: data.blockTime,
  addressId: data.addressId,
  rbfStatus: data.rbfStatus,
});

const persistClassificationAttempt = async (
  tx: PrismaTxClient,
  data: AddressSyncTransactionInput
): Promise<void> => {
  if (!data.classificationInputsComplete) return;
  await tx.transaction.updateMany({
    where: {
      txid: data.txid,
      walletId: data.walletId,
      classificationInputsComplete: false,
    },
    data: { classificationInputsComplete: true },
  });
};

/**
 * Advances the private fair-repair cursor before raw transaction fetching.
 * Raw SQL intentionally bypasses Prisma's automatic Transaction.updatedAt write.
 */
export async function markClassificationRepairAttempts(
  walletId: string,
  txids: string[]
): Promise<void> {
  if (txids.length === 0) return;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "transactions"
    SET "classificationLastAttemptAt" = CURRENT_TIMESTAMP
    WHERE "walletId" = ${walletId}
      AND "txid" IN (${Prisma.join(txids)})
      AND "type" <> 'sent'
      AND "classificationInputsComplete" = false
  `);
}

/** Advances the private I/O repair cursor without mutating public updatedAt. */
export async function markIoRepairAttempts(
  walletId: string,
  txids: string[]
): Promise<void> {
  if (txids.length === 0) return;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "transactions"
    SET "ioLastAttemptAt" = CURRENT_TIMESTAMP
    WHERE "walletId" = ${walletId}
      AND "txid" IN (${Prisma.join(txids)})
      AND "ioComplete" = false
  `);
}

const reconcilePromotedOutputTypes = async (
  tx: PrismaTxClient,
  data: AddressSyncTransactionInput
): Promise<void> => {
  const transaction = {
    is: { txid: data.txid, walletId: data.walletId },
  };

  if (data.type === 'consolidation') {
    await tx.transactionOutput.updateMany({
      where: { transaction },
      data: { outputType: 'consolidation' },
    });
    return;
  }

  await tx.transactionOutput.updateMany({
    where: { transaction, isOurs: true },
    data: { outputType: 'change' },
  });
  await tx.transactionOutput.updateMany({
    where: { transaction, isOurs: false },
    data: { outputType: 'recipient' },
  });
};

const getAddressSyncOutputType = (transactionType: string, isOurs: boolean): string => {
  if (transactionType === 'sent') return isOurs ? 'change' : 'recipient';
  if (transactionType === 'received') return isOurs ? 'recipient' : 'unknown';
  if (transactionType === 'consolidation') return 'consolidation';
  return 'unknown';
};

/**
 * Atomically persists address-sync I/O using the current scalar transaction type.
 * The ordered parent-row locks serialize deferred inserts with concurrent type
 * promotion, preventing stale received roles from landing after a sent repair.
 */
export async function persistAddressSyncIORows(
  inputs: AddressSyncInputRow[],
  outputs: AddressSyncOutputRow[],
  completeTransactionIds: string[] = []
): Promise<void> {
  const transactionIds = [...new Set([
    ...inputs.map(input => input.transactionId),
    ...outputs.map(output => output.transactionId),
    ...completeTransactionIds,
  ])].sort();
  if (transactionIds.length === 0) return;

  await prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`
      /* address-sync-io-lock */
      SELECT "id"
      FROM "transactions"
      WHERE "id" IN (${Prisma.join(transactionIds)})
      ORDER BY "id"
      FOR UPDATE
    `);
    const transactions = await tx.transaction.findMany({
      where: { id: { in: transactionIds } },
      select: { id: true, txid: true, type: true },
    });
    const typesById = new Map(transactions.map(transaction => [
      transaction.id,
      transaction.type,
    ]));

    if (inputs.length > 0) {
      await tx.transactionInput.createMany({
        data: inputs,
        skipDuplicates: true,
      });
    }
    if (outputs.length > 0) {
      await tx.transactionOutput.createMany({
        data: outputs.map(output => ({
          ...output,
          outputType: getAddressSyncOutputType(
            typesById.get(output.transactionId) ?? 'unknown',
            output.isOurs
          ),
        })),
        skipDuplicates: true,
      });
    }
    if (completeTransactionIds.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "transactions"
        SET "ioComplete" = true
        WHERE "id" IN (${Prisma.join(completeTransactionIds)})
          AND "ioComplete" = false
      `);
    }
  });
}

/**
 * Inserts a missing address-sync transaction or promotes an existing weaker
 * classification. Returns `created` or `repaired` for changed work and
 * `unchanged` for duplicate, same-strength, or downgrade candidates.
 */
export async function reconcileAddressSyncTransaction(
  data: AddressSyncTransactionInput
): Promise<AddressSyncReconcileOutcome> {
  return prisma.$transaction(async tx => {
    const inserted = await tx.transaction.createMany({
      data: [data],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return 'created';

    await persistClassificationAttempt(tx, data);

    const weakerTypes = promotionSources[data.type];
    if (weakerTypes.length === 0) return 'unchanged';

    const promoted = await tx.transaction.updateMany({
      where: {
        txid: data.txid,
        walletId: data.walletId,
        type: { in: weakerTypes },
      },
      data: getPromotionData(data),
    });
    if (promoted.count === 0) return 'unchanged';

    await reconcilePromotedOutputTypes(tx, data);
    return 'repaired';
  });
}

/**
 * Batch-inserts genuinely new classifications and monotonically reconciles
 * txids that already exist. createManyAndReturn preserves exact outcome
 * ownership under concurrent wallet/address sync without per-row inserts.
 */
export async function reconcileTransactionBatch(
  data: AddressSyncTransactionInput[]
): Promise<TransactionReconcileResult[]> {
  if (data.length === 0) return [];

  const inserted = await prisma.transaction.createManyAndReturn({
    data,
    skipDuplicates: true,
    select: { txid: true },
  });
  const createdTxids = new Set(inserted.map(transaction => transaction.txid));
  const results: TransactionReconcileResult[] = [];

  for (const transaction of data) {
    const outcome = createdTxids.has(transaction.txid)
      ? 'created'
      : await reconcileAddressSyncTransaction(transaction);
    results.push({ transaction, outcome });
  }

  return results;
}

export async function findByWalletIdAndTxids<T extends Prisma.TransactionSelect>(
  walletId: string,
  txids: string[],
  select: T
) {
  return prisma.transaction.findMany({
    where: { walletId, txid: { in: txids } },
    select,
  });
}

export async function findPendingWithInputs(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: { some: {} },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

export async function findConfirmedWithSharedInputs(
  walletId: string,
  inputPatterns: Array<{ txid: string; vout: number }>
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { gt: 0 },
      inputs: {
        some: {
          OR: inputPatterns.map(i => ({ txid: i.txid, vout: i.vout })),
        },
      },
    },
    select: {
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

export async function updateRbfStatus(
  id: string,
  data: { rbfStatus?: string; replacedByTxid?: string | null }
): Promise<void> {
  await prisma.transaction.update({
    where: { id },
    data,
  });
}

export async function findPendingWithSharedInputs(
  walletId: string,
  inputPatterns: Array<{ txid: string; vout: number }>
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: {
        some: {
          OR: inputPatterns.map(p => ({ txid: p.txid, vout: p.vout })),
        },
      },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

export async function findUnlinkedReplaced(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      rbfStatus: 'replaced',
      replacedByTxid: null,
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });
}

export async function createManyTransactionLabels(
  data: Array<{ transactionId: string; labelId: string }>,
  options?: { skipDuplicates?: boolean }
): Promise<{ count: number }> {
  return prisma.transactionLabel.createMany({
    data,
    skipDuplicates: options?.skipDuplicates,
  });
}

export async function findAddressLabelsByAddressIds(addressIds: string[]) {
  return prisma.addressLabel.findMany({
    where: { addressId: { in: addressIds } },
  });
}

export async function findWithoutIO(
  walletId: string,
  txids: string[]
) {
  // Durable completion, rather than relation shape, distinguishes partial writes
  // from valid coinbase/no-address transactions with intentionally empty sides.
  return prisma.transaction.findMany({
    where: {
      walletId,
      txid: { in: txids },
      ioComplete: false,
    },
    select: { id: true, txid: true, type: true },
  });
}

export async function batchUpdateRbfStatus(
  updates: Array<{ id: string; rbfStatus: string; replacedByTxid: string }>
): Promise<void> {
  /* v8 ignore next -- sync pipeline avoids empty RBF update batches */
  if (updates.length === 0) return;
  await prisma.$transaction(
    updates.map(u =>
      prisma.transaction.update({
        where: { id: u.id },
        data: { rbfStatus: u.rbfStatus, replacedByTxid: u.replacedByTxid },
      })
    )
  );
}

export async function findSentWithOutputs(walletId: string) {
  return prisma.transaction.findMany({
    where: { walletId, type: 'sent' },
    include: {
      outputs: {
        select: { id: true, address: true, isOurs: true },
      },
    },
  });
}

export async function findForBalanceRecalculation(walletId: string) {
  return prisma.transaction.findMany({
    where: { walletId },
    orderBy: [
      { blockTime: 'asc' },
      { createdAt: 'asc' },
    ],
    select: { id: true, amount: true },
  });
}

export async function batchUpdateBalances(
  updates: Array<{ id: string; balanceAfter: bigint }>,
  batchSize: number = 500
): Promise<void> {
  await batchUpdateByIds(
    updates.map(u => ({ id: u.id, data: { balanceAfter: u.balanceAfter } })),
    batchSize
  );
}

export async function findBelowConfirmationThreshold(
  walletId: string,
  threshold: number
) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: { lt: threshold },
      blockHeight: { not: null },
    },
    select: { id: true, txid: true, blockHeight: true, confirmations: true },
  });
}

export async function findWithMissingFields(walletId: string) {
  return prisma.transaction.findMany({
    where: {
      walletId,
      OR: [
        { blockHeight: null },
        { addressId: null },
        { blockTime: null },
        { fee: null },
        { counterpartyAddress: null },
      ],
    },
    select: {
      id: true,
      txid: true,
      type: true,
      amount: true,
      fee: true,
      blockHeight: true,
      blockTime: true,
      confirmations: true,
      addressId: true,
      counterpartyAddress: true,
    },
  });
}

export async function batchUpdateByIds(
  updates: Array<{ id: string; data: Record<string, unknown> }>,
  batchSize: number
): Promise<void> {
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = updates.slice(i, i + batchSize);
    await prisma.$transaction(
      chunk.map(u =>
        prisma.transaction.update({
          where: { id: u.id },
          data: u.data,
        })
      )
    );
  }
}
