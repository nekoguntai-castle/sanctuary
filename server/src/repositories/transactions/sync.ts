import prisma, { type PrismaTxClient } from '../../models/prisma';
import { Prisma } from '../../generated/prisma/client';
import { CURRENT_TRANSACTION_CLASSIFICATION_VERSION } from '../../constants/transactionClassification';

export type AddressSyncTransactionType = 'received' | 'consolidation' | 'sent';
export type AddressSyncReconcileOutcome = 'created' | 'repaired' | 'unchanged';

export type TransactionReconcileResult = {
  transaction: AddressSyncTransactionInput;
  outcome: AddressSyncReconcileOutcome;
};

export type AddressSyncTransactionInput = Prisma.TransactionUncheckedCreateInput & {
  type: AddressSyncTransactionType;
  rbfStatus: 'active' | 'confirmed';
  classificationInputsComplete: boolean;
  classificationVersion: number;
  classificationAddressCount: number;
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

const getTransactionSyncKey = (walletId: string, txid: string): string =>
  `${walletId}:${txid}`;

const lockTransactionSyncKeys = async (
  tx: PrismaTxClient,
  keys: string[]
): Promise<void> => {
  const orderedKeys = [...new Set(keys)].sort();
  /* v8 ignore next -- public callers reject empty work before lock acquisition */
  if (orderedKeys.length === 0) return;
  // Salt 1 is the transaction-classification lock namespace. Sorting before
  // locking makes overlapping batches acquire keys in one deadlock-safe order.
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(ordered_key, 1))
    FROM (
      SELECT unnest(ARRAY[${Prisma.join(orderedKeys)}]::text[]) AS ordered_key
      ORDER BY ordered_key
    ) ordered_keys
  `);
};

const getAuthoritativeClassificationData = (data: AddressSyncTransactionInput) => ({
  // The migration trigger queues wallet_balance_repairs whenever these
  // balance-affecting fields change; application writes must not bypass it.
  type: data.type,
  classificationInputsComplete: true,
  classificationVersion: data.classificationVersion,
  classificationAddressCount: data.classificationAddressCount ?? 0,
  ioComplete: false,
  amount: data.amount,
  fee: data.fee,
  confirmations: data.confirmations,
  blockHeight: data.blockHeight,
  blockTime: data.blockTime,
  addressId: data.addressId,
  rbfStatus: data.rbfStatus,
});

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
      AND (
        "classificationVersion" < ${CURRENT_TRANSACTION_CLASSIFICATION_VERSION}
        OR "classificationInputsComplete" = false
        OR EXISTS (
          SELECT 1
          FROM "transaction_ownership_repairs" ownership_repair
          WHERE ownership_repair."walletId" = "transactions"."walletId"
            AND ownership_repair."txid" = "transactions"."txid"
        )
      )
  `);
}

/** Durably targets only transactions observed through newly discovered addresses. */
export async function markOwnershipRepairNeeded(
  walletId: string,
  txids: string[],
  targetAddressCount: number
): Promise<void> {
  if (txids.length === 0) return;
  await prisma.$transaction(async tx => {
    await lockTransactionSyncKeys(
      tx,
      txids.map(txid => getTransactionSyncKey(walletId, txid))
    );
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "transaction_ownership_repairs" (
        "id", "walletId", "txid", "targetAddressCount", "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid()::text, ${walletId}, target_txid,
             ${targetAddressCount}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM unnest(ARRAY[${Prisma.join(txids)}]::text[]) AS target_txid
      ON CONFLICT ("walletId", "txid") DO UPDATE
      SET "targetAddressCount" = GREATEST(
            "transaction_ownership_repairs"."targetAddressCount",
            EXCLUDED."targetAddressCount"
          ),
          "updatedAt" = CURRENT_TIMESTAMP
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "transactions"
      SET "ioComplete" = false
      WHERE "walletId" = ${walletId}
        AND "txid" IN (${Prisma.join(txids)})
        AND "ioComplete" = true
    `);
  }, { timeout: 60_000 });
}

export async function findOwnershipRepairTargets(
  walletId: string,
  txids: string[]
): Promise<Array<{ txid: string; targetAddressCount: number }>> {
  if (txids.length === 0) return [];
  return prisma.transactionOwnershipRepair.findMany({
    where: { walletId, txid: { in: txids } },
    select: { txid: true, targetAddressCount: true },
  });
}

/**
 * Detects the trigger-maintained durable wallet balance-repair marker.
 * Recalculation deletes existing markers before its read so racing mutations
 * append a marker that survives the in-flight pass.
 */
export async function hasPendingBalanceRecalculation(walletId: string): Promise<boolean> {
  const pending = await prisma.$queryRaw<Array<{ pending: boolean }>>(Prisma.sql`
    SELECT true AS "pending"
    FROM "wallet_balance_repairs"
    WHERE "walletId" = ${walletId}
    LIMIT 1
  `);
  return pending.length > 0;
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

const reconcileClassificationOutputTypes = async (
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
    data: {
      outputType: data.type === 'sent' ? 'change' : 'recipient',
    },
  });
  await tx.transactionOutput.updateMany({
    where: { transaction, isOurs: false },
    data: {
      outputType: data.type === 'sent' ? 'recipient' : 'unknown',
    },
  });
};

const getAddressSyncOutputType = (transactionType: string, isOurs: boolean): string => {
  if (transactionType === 'sent') return isOurs ? 'change' : 'recipient';
  if (transactionType === 'received') return isOurs ? 'recipient' : 'unknown';
  if (transactionType === 'consolidation') return 'consolidation';
  return 'unknown';
};

const reconcileAddressSyncOutputRows = async (
  tx: PrismaTxClient,
  outputs: AddressSyncOutputRow[],
  typesById: ReadonlyMap<string, string>
): Promise<void> => {
  for (const output of outputs) {
    await tx.transactionOutput.updateMany({
      where: {
        transactionId: output.transactionId,
        outputIndex: output.outputIndex,
      },
      data: {
        address: output.address,
        amount: output.amount,
        scriptPubKey: output.scriptPubKey,
        isOurs: output.isOurs,
        outputType: getAddressSyncOutputType(
          typesById.get(output.transactionId) ?? 'unknown',
          output.isOurs
        ),
      },
    });
  }
};

const reconcileAddressSyncInputRows = async (
  tx: PrismaTxClient,
  inputs: AddressSyncInputRow[]
): Promise<void> => {
  for (const input of inputs) {
    await tx.transactionInput.updateMany({
      where: {
        transactionId: input.transactionId,
        inputIndex: input.inputIndex,
      },
      data: {
        txid: input.txid,
        vout: input.vout,
        address: input.address,
        amount: input.amount,
        derivationPath: input.derivationPath,
      },
    });
  }
};

/**
 * Atomically persists address-sync I/O using the current scalar transaction type.
 * The ordered parent-row locks serialize deferred inserts with concurrent type
 * promotion, preventing stale received roles from landing after a sent repair.
 */
export async function persistAddressSyncIORows(
  inputs: AddressSyncInputRow[],
  outputs: AddressSyncOutputRow[],
  completeTransactionIds: string[] = [],
  classificationAddressCount?: number
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
      select: { id: true, txid: true, type: true, classificationAddressCount: true },
    });
    const transactionsById = new Map(transactions.map(transaction => [
      transaction.id,
      transaction,
    ]));
    const eligibleTransactionIds = new Set(transactionIds.filter(id => {
      const transaction = transactionsById.get(id);
      return !transaction
        || classificationAddressCount === undefined
        || (transaction.classificationAddressCount ?? 0) <= classificationAddressCount;
    }));
    const eligibleInputs = inputs.filter(input => eligibleTransactionIds.has(input.transactionId));
    const eligibleOutputs = outputs.filter(output => eligibleTransactionIds.has(output.transactionId));
    const eligibleCompleteIds = completeTransactionIds.filter(id => eligibleTransactionIds.has(id));
    const typesById = new Map(transactions.map(transaction => [
      transaction.id,
      transaction.type,
    ]));

    if (eligibleInputs.length > 0) {
      await tx.transactionInput.createMany({
        data: eligibleInputs,
        skipDuplicates: true,
      });
      await reconcileAddressSyncInputRows(tx, eligibleInputs);
    }
    if (eligibleOutputs.length > 0) {
      const classifiedOutputs = eligibleOutputs.map(output => ({
          ...output,
          outputType: getAddressSyncOutputType(
            typesById.get(output.transactionId) ?? 'unknown',
            output.isOurs
          ),
        }));
      await tx.transactionOutput.createMany({
        data: classifiedOutputs,
        skipDuplicates: true,
      });
      await reconcileAddressSyncOutputRows(tx, eligibleOutputs, typesById);
    }
    if (eligibleCompleteIds.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "transactions"
        SET "ioComplete" = true
        WHERE "id" IN (${Prisma.join(eligibleCompleteIds)})
          AND "ioComplete" = false
      `);
    }
  });
}

type OwnershipRepairRow = {
  id: string;
  targetAddressCount: number;
};

type ExistingClassificationRow = {
  id: string;
  classificationInputsComplete: boolean;
  classificationVersion: number;
  classificationAddressCount: number;
};

const lockOwnershipRepair = async (
  tx: PrismaTxClient,
  data: AddressSyncTransactionInput
): Promise<OwnershipRepairRow | undefined> => {
  const [row] = await tx.$queryRaw<OwnershipRepairRow[]>(Prisma.sql`
    SELECT "id", "targetAddressCount"
    FROM "transaction_ownership_repairs"
    WHERE "walletId" = ${data.walletId}
      AND "txid" = ${data.txid}
    FOR UPDATE
  `);
  return Number.isInteger(row?.targetAddressCount) ? row : undefined;
};

const lockExistingClassification = async (
  tx: PrismaTxClient,
  data: AddressSyncTransactionInput
): Promise<ExistingClassificationRow | undefined> => {
  const [existing] = await tx.$queryRaw<ExistingClassificationRow[]>(Prisma.sql`
    /* address-sync-classification-lock */
    SELECT "id", "classificationInputsComplete", "classificationVersion",
           "classificationAddressCount"
    FROM "transactions"
    WHERE "walletId" = ${data.walletId}
      AND "txid" = ${data.txid}
    FOR UPDATE
  `);
  return existing;
};

const clearOwnershipRepair = async (
  tx: PrismaTxClient,
  ownershipRepair: OwnershipRepairRow | undefined
): Promise<void> => {
  if (!ownershipRepair) return;
  await tx.transactionOwnershipRepair.delete({ where: { id: ownershipRepair.id } });
};

const isAtLeastAsAuthoritative = (
  existing: ExistingClassificationRow,
  data: AddressSyncTransactionInput,
  candidateAddressCount: number
): boolean => (
  // Complete input evidence at the current algorithm and at least the same
  // wallet-address horizon is authoritative; older/weaker observations cannot
  // overwrite it.
  existing.classificationInputsComplete
  && existing.classificationVersion >= data.classificationVersion
  && existing.classificationAddressCount >= candidateAddressCount
);

/**
 * Inserts a missing address-sync transaction or promotes an existing weaker
 * classification. Returns `created` or `repaired` for changed work and
 * `unchanged` for duplicate, same-strength, or downgrade candidates.
 */
export async function reconcileAddressSyncTransaction(
  data: AddressSyncTransactionInput
): Promise<AddressSyncReconcileOutcome> {
  return prisma.$transaction(async tx => {
    await lockTransactionSyncKeys(tx, [getTransactionSyncKey(data.walletId, data.txid)]);
    const ownershipRepair = await lockOwnershipRepair(tx, data);
    const targetAddressCount = ownershipRepair?.targetAddressCount ?? 0;
    const candidateAddressCount = data.classificationAddressCount ?? 0;
    if (ownershipRepair && candidateAddressCount < targetAddressCount) return 'unchanged';
    if (ownershipRepair && !data.classificationInputsComplete) return 'unchanged';
    const inserted = await tx.transaction.createMany({
      data: [data],
      skipDuplicates: true,
    });
    if (inserted.count === 1) {
      await clearOwnershipRepair(tx, ownershipRepair);
      return 'created';
    }
    if (!data.classificationInputsComplete) return 'unchanged';

    const existing = await lockExistingClassification(tx, data);
    if (!existing) return 'unchanged';
    if (candidateAddressCount < existing.classificationAddressCount) return 'unchanged';
    if (isAtLeastAsAuthoritative(existing, data, candidateAddressCount)) {
      await clearOwnershipRepair(tx, ownershipRepair);
      return 'unchanged';
    }

    await tx.transaction.update({
      where: { id: existing.id },
      data: getAuthoritativeClassificationData(data),
    });
    await reconcileClassificationOutputTypes(tx, data);
    await clearOwnershipRepair(tx, ownershipRepair);
    return 'repaired';
  }, { timeout: 60_000 });
}

type LockedBatchCandidate = {
  transaction: AddressSyncTransactionInput;
  ownershipRepair: OwnershipRepairRow | undefined;
  candidateAddressCount: number;
  blockedByRepair: boolean;
};

const getBatchCandidateKey = (transaction: AddressSyncTransactionInput): string =>
  `${transaction.walletId}\0${transaction.txid}`;

const lockBatchCandidates = async (
  tx: PrismaTxClient,
  data: AddressSyncTransactionInput[]
): Promise<LockedBatchCandidate[]> => {
  const repairsByKey = new Map<string, OwnershipRepairRow | undefined>();
  const ordered = [...data].sort((left, right) =>
    getBatchCandidateKey(left).localeCompare(getBatchCandidateKey(right))
  );
  await lockTransactionSyncKeys(
    tx,
    ordered.map(transaction =>
      getTransactionSyncKey(transaction.walletId, transaction.txid)
    )
  );
  for (const transaction of ordered) {
    const key = getBatchCandidateKey(transaction);
    if (repairsByKey.has(key)) continue;
    const ownershipRepair = await lockOwnershipRepair(tx, transaction);
    repairsByKey.set(key, ownershipRepair);
  }
  return data.map(transaction => {
    const ownershipRepair = repairsByKey.get(getBatchCandidateKey(transaction));
    const candidateAddressCount = transaction.classificationAddressCount;
    const blockedByRepair = ownershipRepair !== undefined && (
      !transaction.classificationInputsComplete
      || candidateAddressCount < ownershipRepair.targetAddressCount
    );
    return {
      transaction,
      ownershipRepair,
      candidateAddressCount,
      blockedByRepair,
    };
  });
};

const repairExistingBatchCandidate = async (
  tx: PrismaTxClient,
  candidate: LockedBatchCandidate
): Promise<AddressSyncReconcileOutcome> => {
  const { transaction, ownershipRepair, candidateAddressCount } = candidate;
  const existing = await lockExistingClassification(tx, transaction);
  if (!existing || candidateAddressCount < existing.classificationAddressCount) {
    return 'unchanged';
  }
  if (isAtLeastAsAuthoritative(existing, transaction, candidateAddressCount)) {
    await clearOwnershipRepair(tx, ownershipRepair);
    return 'unchanged';
  }
  await tx.transaction.update({
    where: { id: existing.id },
    data: getAuthoritativeClassificationData(transaction),
  });
  await reconcileClassificationOutputTypes(tx, transaction);
  await clearOwnershipRepair(tx, ownershipRepair);
  return 'repaired';
};

const reconcileLockedBatchCandidate = async (
  tx: PrismaTxClient,
  candidate: LockedBatchCandidate,
  createdTxids: ReadonlySet<string>
): Promise<AddressSyncReconcileOutcome> => {
  const { transaction, ownershipRepair } = candidate;
  if (candidate.blockedByRepair) return 'unchanged';
  if (createdTxids.has(transaction.txid)) {
    await clearOwnershipRepair(tx, ownershipRepair);
    return 'created';
  }
  if (!transaction.classificationInputsComplete) return 'unchanged';
  return repairExistingBatchCandidate(tx, candidate);
};

/**
 * Batch-inserts genuinely new classifications and monotonically reconciles
 * txids that already exist. createManyAndReturn preserves exact outcome
 * ownership under concurrent wallet/address sync without per-row inserts.
 */
export async function reconcileTransactionBatch(
  data: AddressSyncTransactionInput[]
): Promise<TransactionReconcileResult[]> {
  if (data.length === 0) return [];

  return prisma.$transaction(async tx => {
    const candidates = await lockBatchCandidates(tx, data);
    const eligible = candidates
      .filter(candidate => !candidate.blockedByRepair)
      .map(candidate => candidate.transaction);
    const inserted = await tx.transaction.createManyAndReturn({
      data: eligible,
      skipDuplicates: true,
      select: { txid: true },
    });
    const createdTxids = new Set(inserted.map(transaction => transaction.txid));
    const outcomes = new Map<string, AddressSyncReconcileOutcome>();
    const ordered = [...candidates].sort((left, right) =>
      getBatchCandidateKey(left.transaction).localeCompare(
        getBatchCandidateKey(right.transaction)
      )
    );
    for (const candidate of ordered) {
      const outcome = await reconcileLockedBatchCandidate(tx, candidate, createdTxids);
      outcomes.set(getBatchCandidateKey(candidate.transaction), outcome);
    }
    return data.map(transaction => ({
      transaction,
      outcome: outcomes.get(getBatchCandidateKey(transaction)) as AddressSyncReconcileOutcome,
    }));
  }, { timeout: 60_000 });
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

/**
 * Serializes the complete balance read/write pass for one wallet. The
 * transaction-scoped advisory lock prevents an older reader from overwriting a
 * newer repair's running balances after that repair has recalculated.
 */
export async function recalculateBalancesAtomically(walletId: string): Promise<number> {
  return prisma.$transaction(async tx => {
    // Salt 0 is the wallet-balance lock namespace. The SQL window/update keeps
    // the full recalculation database-side, avoiding wallet-sized application
    // memory and timestamp churn for rows whose balance is already correct.
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${walletId}, 0))
    `);
    // Clear before reading. A concurrent mutation that is not visible to the
    // window statement runs the trigger afterward and restores the marker.
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "wallet_balance_repairs"
      WHERE "walletId" = ${walletId}
    `);
    return tx.$executeRaw(Prisma.sql`
      WITH running_balances AS (
        SELECT "id",
               SUM("amount") OVER (
                 ORDER BY "blockTime" ASC, "createdAt" ASC, "id" ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS "balanceAfter"
        FROM "transactions"
        WHERE "walletId" = ${walletId}
      )
      UPDATE "transactions" transaction
      SET "balanceAfter" = running_balances."balanceAfter"
      FROM running_balances
      WHERE transaction."id" = running_balances."id"
        AND transaction."balanceAfter" IS DISTINCT FROM running_balances."balanceAfter"
    `);
  }, { timeout: 60_000 });
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
