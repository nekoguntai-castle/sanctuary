import prisma, { type PrismaTxClient } from '../../models/prisma';
import { Prisma } from '../../generated/prisma/client';
import { CURRENT_TRANSACTION_CLASSIFICATION_VERSION } from '../../constants/transactionClassification';
import { ADDRESS_SYNC_IO_UPSERT_MAX_ROWS } from '../../constants/addressSyncPersistence';
import { LIVE_TRANSACTION_WHERE } from './visibility';
import { queueWalletBalanceRepair } from './balanceRepair';
import { executeTransactionFieldPatch } from './fieldPatches';

export {
  ADDRESS_SYNC_INPUT_UPSERT_BIND_COLUMNS,
  ADDRESS_SYNC_IO_UPSERT_MAX_BINDS,
  ADDRESS_SYNC_IO_UPSERT_MAX_ROWS,
  ADDRESS_SYNC_OUTPUT_UPSERT_BIND_COLUMNS,
} from '../../constants/addressSyncPersistence';
export {
  findWalletRbfReplacements,
  reconcilePendingRbfForConfirmedTransactions,
  reconcileWalletRbfReplacement,
  type WalletRbfCleanupTarget,
} from './syncRbf';

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

const getAuthoritativeClassificationData = (
  data: AddressSyncTransactionInput,
  existingRbfStatus: string,
) => ({
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
  // Unconfirmed history may repair classification evidence but cannot undo a
  // recorded replacement. Confirmed chain evidence may revive the mined row,
  // and clearing its stale replacement pointer keeps the revived row internally
  // consistent with its authoritative confirmed status.
  rbfStatus: existingRbfStatus === 'replaced' && data.rbfStatus === 'active'
    ? 'replaced'
    : data.rbfStatus,
  ...(existingRbfStatus === 'replaced' && data.rbfStatus === 'confirmed'
    ? { replacedByTxid: null }
    : {}),
});

/**
 * Advances the private fair-repair cursor before raw transaction fetching.
 * Raw SQL intentionally bypasses Prisma's automatic Transaction.updatedAt write.
 */
export async function markClassificationRepairAttempts(
  walletId: string,
  txids: string[],
  client: PrismaTxClient = prisma
): Promise<void> {
  if (txids.length === 0) return;
  await client.$executeRaw(Prisma.sql`
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
  targetAddressCount: number,
  client?: PrismaTxClient
): Promise<void> {
  if (txids.length === 0) return;
  const markRepair = async (tx: PrismaTxClient): Promise<void> => {
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
  };
  if (client) return markRepair(client);
  await prisma.$transaction(markRepair, { timeout: 60_000 });
}

export async function findOwnershipRepairTargets(
  walletId: string,
  txids: string[],
  client: PrismaTxClient = prisma
): Promise<Array<{ txid: string; targetAddressCount: number }>> {
  if (txids.length === 0) return [];
  return client.transactionOwnershipRepair.findMany({
    where: { walletId, txid: { in: txids } },
    select: { txid: true, targetAddressCount: true },
  });
}

/**
 * Detects a durable repair marker or a legacy replaced row whose persisted
 * running balance predates replacement-aware accounting. Recalculation clears
 * both conditions by deleting markers and nulling replaced-row balances.
 */
export async function hasPendingBalanceRecalculation(
  walletId: string,
  client: PrismaTxClient = prisma
): Promise<boolean> {
  const pending = await client.$queryRaw<Array<{ pending: boolean }>>(Prisma.sql`
    SELECT true AS "pending" FROM (
      SELECT 1
      FROM "wallet_balance_repairs"
      WHERE "walletId" = ${walletId}
      UNION ALL
      SELECT 1
      FROM "transactions"
      WHERE "walletId" = ${walletId}
        AND "rbfStatus" = 'replaced'
        AND "balanceAfter" IS NOT NULL
    ) pending_repairs
    LIMIT 1
  `);
  return pending.length > 0;
}

/** Advances the private I/O repair cursor without mutating public updatedAt. */
export async function markIoRepairAttempts(
  walletId: string,
  txids: string[],
  client: PrismaTxClient = prisma
): Promise<void> {
  if (txids.length === 0) return;
  await client.$executeRaw(Prisma.sql`
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

const forEachEligibleChunk = async <T extends { transactionId: string }>(
  rows: readonly T[],
  eligibleTransactionIds: ReadonlySet<string>,
  callback: (chunk: T[]) => Promise<void>
): Promise<void> => {
  let chunk: T[] = [];
  for (const row of rows) {
    if (!eligibleTransactionIds.has(row.transactionId)) continue;
    chunk.push(row);
    if (chunk.length < ADDRESS_SYNC_IO_UPSERT_MAX_ROWS) continue;
    await callback(chunk);
    chunk = [];
  }
  if (chunk.length > 0) await callback(chunk);
};

const deduplicateChunk = <T>(
  rows: readonly T[],
  keyFor: (row: T) => string
): T[] => {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(keyFor(row), row);
  return [...byKey.values()];
};

const reconcileAddressSyncOutputRows = async (
  tx: PrismaTxClient,
  outputs: AddressSyncOutputRow[],
  typesById: ReadonlyMap<string, string>
): Promise<void> => {
  const classified = deduplicateChunk(
    outputs.map(output => ({
      ...output,
      outputType: getAddressSyncOutputType(
        typesById.get(output.transactionId) ?? 'unknown',
        output.isOurs
      ),
    })),
    output => `${output.transactionId}\0${output.outputIndex}`
  );
  await tx.transactionOutput.createMany({ data: classified, skipDuplicates: true });
  const values = classified.map(output => Prisma.sql`(
    ${output.transactionId}::text,
    ${output.outputIndex}::integer,
    ${output.address}::text,
    ${output.amount}::bigint,
    ${output.scriptPubKey ?? null}::text,
    ${output.scriptPubKey !== undefined}::boolean,
    ${output.isOurs}::boolean,
    ${output.outputType}::text
  )`);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "transaction_outputs" AS stored
    SET "address" = incoming."address",
        "amount" = incoming."amount",
        "scriptPubKey" = CASE
          WHEN incoming."hasScriptPubKey" THEN incoming."scriptPubKey"
          ELSE stored."scriptPubKey"
        END,
        "isOurs" = incoming."isOurs",
        "outputType" = incoming."outputType"
    FROM (VALUES ${Prisma.join(values)}) AS incoming(
      "transactionId", "outputIndex", "address", "amount", "scriptPubKey",
      "hasScriptPubKey", "isOurs", "outputType"
    )
    WHERE stored."transactionId" = incoming."transactionId"
      AND stored."outputIndex" = incoming."outputIndex"
  `);
};

const reconcileAddressSyncInputRows = async (
  tx: PrismaTxClient,
  inputs: AddressSyncInputRow[]
): Promise<void> => {
  const deduplicated = deduplicateChunk(
    inputs,
    input => `${input.transactionId}\0${input.inputIndex}`
  );
  await tx.transactionInput.createMany({ data: deduplicated, skipDuplicates: true });
  const values = deduplicated.map(input => Prisma.sql`(
    ${input.transactionId}::text,
    ${input.inputIndex}::integer,
    ${input.txid}::text,
    ${input.vout}::integer,
    ${input.address}::text,
    ${input.amount}::bigint,
    ${input.derivationPath ?? null}::text,
    ${input.derivationPath !== undefined}::boolean
  )`);
  await tx.$executeRaw(Prisma.sql`
    UPDATE "transaction_inputs" AS stored
    SET "txid" = incoming."txid",
        "vout" = incoming."vout",
        "address" = incoming."address",
        "amount" = incoming."amount",
        "derivationPath" = CASE
          WHEN incoming."hasDerivationPath" THEN incoming."derivationPath"
          ELSE stored."derivationPath"
        END
    FROM (VALUES ${Prisma.join(values)}) AS incoming(
      "transactionId", "inputIndex", "txid", "vout", "address", "amount",
      "derivationPath", "hasDerivationPath"
    )
    WHERE stored."transactionId" = incoming."transactionId"
      AND stored."inputIndex" = incoming."inputIndex"
  `);
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
  classificationAddressCount?: number,
  client?: PrismaTxClient
): Promise<void> {
  const transactionIds = [...new Set([
    ...inputs.map(input => input.transactionId),
    ...outputs.map(output => output.transactionId),
    ...completeTransactionIds,
  ])].sort();
  if (transactionIds.length === 0) return;

  const persist = async (tx: PrismaTxClient): Promise<void> => {
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
    const eligibleCompleteIds = completeTransactionIds.filter(id => eligibleTransactionIds.has(id));
    const typesById = new Map(transactions.map(transaction => [
      transaction.id,
      transaction.type,
    ]));

    await forEachEligibleChunk(inputs, eligibleTransactionIds, chunk =>
      reconcileAddressSyncInputRows(tx, chunk)
    );
    await forEachEligibleChunk(outputs, eligibleTransactionIds, chunk =>
      reconcileAddressSyncOutputRows(tx, chunk, typesById)
    );
    if (eligibleCompleteIds.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "transactions"
        SET "ioComplete" = true
        WHERE "id" IN (${Prisma.join(eligibleCompleteIds)})
          AND "ioComplete" = false
      `);
    }
  };
  if (client) return persist(client);
  await prisma.$transaction(persist, { timeout: 60_000 });
}

type OwnershipRepairRow = {
  id: string;
  targetAddressCount: number;
};

type ExistingClassificationRow = {
  id: string;
  rbfStatus: string;
  replacedByTxid: string | null;
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
    SELECT "id", "rbfStatus", "replacedByTxid",
           "classificationInputsComplete", "classificationVersion",
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
  // Complete input evidence at the same algorithm and at least the same
  // wallet-address horizon is authoritative. A confirmed observation means
  // the transaction is mined in the authoritative chain and may revive a row
  // previously hidden by BIP 125 replacement detection. An unconfirmed
  // mempool/history echo does not prove that reversal and cannot revive it.
  existing.classificationInputsComplete
  && existing.classificationVersion === data.classificationVersion
  && existing.classificationAddressCount >= candidateAddressCount
  && (existing.rbfStatus !== 'replaced' || data.rbfStatus !== 'confirmed')
);

/** A rollback worker cannot reinterpret evidence written by a newer algorithm. */
const hasNewerCompleteClassification = (
  existing: ExistingClassificationRow,
  data: AddressSyncTransactionInput,
): boolean => (
  existing.classificationInputsComplete
  && existing.classificationVersion > data.classificationVersion
);

/** Hide the linked loser when fresh confirmed evidence proves its original won. */
const retireLosingReplacement = async (
  tx: PrismaTxClient,
  walletId: string,
  winnerTxid: string,
  replacementTxid: string | null,
): Promise<void> => {
  if (!replacementTxid) return;
  await tx.transaction.updateMany({
    where: {
      walletId,
      txid: replacementTxid,
      rbfStatus: { not: 'replaced' },
    },
    data: { rbfStatus: 'replaced', replacedByTxid: winnerTxid },
  });
};

/**
 * Inserts a missing address-sync transaction or promotes an existing weaker
 * classification. Returns `created` or `repaired` for changed work and
 * `unchanged` for duplicate, same-strength, or downgrade candidates.
 */
export async function reconcileAddressSyncTransaction(
  data: AddressSyncTransactionInput,
  client?: PrismaTxClient
): Promise<AddressSyncReconcileOutcome> {
  const reconcile = async (tx: PrismaTxClient): Promise<AddressSyncReconcileOutcome> => {
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
    // A rollback worker cannot safely reinterpret or clear a wider-horizon
    // repair target written for a newer classification algorithm.
    if (hasNewerCompleteClassification(existing, data)) return 'unchanged';
    if (candidateAddressCount < existing.classificationAddressCount) return 'unchanged';
    if (isAtLeastAsAuthoritative(existing, data, candidateAddressCount)) {
      await clearOwnershipRepair(tx, ownershipRepair);
      return 'unchanged';
    }

    await tx.transaction.update({
      where: { id: existing.id },
      data: getAuthoritativeClassificationData(data, existing.rbfStatus),
    });
    if (existing.rbfStatus === 'replaced' && data.rbfStatus === 'confirmed') {
      await retireLosingReplacement(
        tx,
        data.walletId,
        data.txid,
        existing.replacedByTxid,
      );
      await queueWalletBalanceRepair(data.walletId, tx);
    }
    await reconcileClassificationOutputTypes(tx, data);
    await clearOwnershipRepair(tx, ownershipRepair);
    return 'repaired';
  };
  if (client) return reconcile(client);
  return prisma.$transaction(reconcile, { timeout: 60_000 });
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
  if (
    !existing
    || hasNewerCompleteClassification(existing, transaction)
    || candidateAddressCount < existing.classificationAddressCount
  ) {
    return 'unchanged';
  }
  if (isAtLeastAsAuthoritative(existing, transaction, candidateAddressCount)) {
    await clearOwnershipRepair(tx, ownershipRepair);
    return 'unchanged';
  }
  await tx.transaction.update({
    where: { id: existing.id },
    data: getAuthoritativeClassificationData(transaction, existing.rbfStatus),
  });
  if (existing.rbfStatus === 'replaced' && transaction.rbfStatus === 'confirmed') {
    await retireLosingReplacement(
      tx,
      transaction.walletId,
      transaction.txid,
      existing.replacedByTxid,
    );
    await queueWalletBalanceRepair(transaction.walletId, tx);
  }
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
  data: AddressSyncTransactionInput[],
  client?: PrismaTxClient
): Promise<TransactionReconcileResult[]> {
  if (data.length === 0) return [];

  const reconcile = async (tx: PrismaTxClient): Promise<TransactionReconcileResult[]> => {
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
  };
  if (client) return reconcile(client);
  return prisma.$transaction(reconcile, { timeout: 60_000 });
}

export async function findByWalletIdAndTxids<T extends Prisma.TransactionSelect>(
  walletId: string,
  txids: string[],
  select: T,
  client: PrismaTxClient = prisma
): Promise<Prisma.TransactionGetPayload<{ select: T }>[]> {
  return client.transaction.findMany<{ select: T; where: Prisma.TransactionWhereInput }>({
    where: { walletId, txid: { in: txids } },
    select,
  });
}

export async function createManyTransactionLabels(
  data: Array<{ transactionId: string; labelId: string }>,
  options?: { skipDuplicates?: boolean },
  client: PrismaTxClient = prisma
): Promise<{ count: number }> {
  return client.transactionLabel.createMany({
    data,
    skipDuplicates: options?.skipDuplicates,
  });
}

export async function findAddressLabelsByAddressIds(
  addressIds: string[],
  client: PrismaTxClient = prisma
) {
  return client.addressLabel.findMany({
    where: { addressId: { in: addressIds } },
  });
}

export async function findWithoutIO(
  walletId: string,
  txids: string[],
  client: PrismaTxClient = prisma
) {
  // Durable completion, rather than relation shape, distinguishes partial writes
  // from valid coinbase/no-address transactions with intentionally empty sides.
  return client.transaction.findMany({
    where: {
      walletId,
      txid: { in: txids },
      ioComplete: false,
    },
    select: { id: true, txid: true, type: true },
  });
}

export async function findSentWithOutputs(
  walletId: string,
  client: PrismaTxClient = prisma
) {
  return client.transaction.findMany({
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
export async function recalculateBalancesAtomically(
  walletId: string,
  client?: PrismaTxClient
): Promise<number> {
  const recalculate = async (tx: PrismaTxClient): Promise<number> => {
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
               -- The outer CASE writes the NULL sentinel consumed by
               -- hasPendingBalanceRecalculation; the inner CASE also removes
               -- replaced value from every subsequent live sum.
               CASE WHEN "rbfStatus" = 'replaced' THEN NULL
                    ELSE SUM(
                      CASE WHEN "rbfStatus" = 'replaced' THEN 0 ELSE "amount" END
                    ) OVER (
                      ORDER BY "blockTime" ASC, "createdAt" ASC, "id" ASC
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    )
               END AS "balanceAfter"
        FROM "transactions"
        WHERE "walletId" = ${walletId}
      )
      UPDATE "transactions" transaction
      SET "balanceAfter" = running_balances."balanceAfter"
      FROM running_balances
      WHERE transaction."id" = running_balances."id"
        AND transaction."balanceAfter" IS DISTINCT FROM running_balances."balanceAfter"
    `);
  };
  if (client) return recalculate(client);
  return prisma.$transaction(recalculate, { timeout: 60_000 });
}

export async function findBelowConfirmationThreshold(
  walletId: string,
  threshold: number,
  client: PrismaTxClient = prisma
) {
  return client.transaction.findMany({
    where: {
      walletId,
      confirmations: { lt: threshold },
      blockHeight: { not: null },
      ...LIVE_TRANSACTION_WHERE,
    },
    select: { id: true, txid: true, blockHeight: true, confirmations: true },
  });
}

/**
 * Select rows pending at either tip. At height H, a block at H-threshold+1 has
 * exactly `threshold` confirmations, so only strictly newer heights can fall
 * back below the notification threshold after a lower-tip reconciliation.
 */
export async function findRequiringConfirmationUpdateAtHeight(
  walletId: string,
  threshold: number,
  authoritativeHeight: number,
  client: PrismaTxClient = prisma,
) {
  return client.transaction.findMany({
    where: {
      walletId,
      blockHeight: { not: null },
      ...LIVE_TRANSACTION_WHERE,
      OR: [
        { confirmations: { lt: threshold } },
        { blockHeight: { gt: authoritativeHeight - threshold + 1 } },
      ],
    },
    select: { id: true, txid: true, blockHeight: true, confirmations: true },
  });
}

export async function findWithMissingFields(
  walletId: string,
  client: PrismaTxClient = prisma
) {
  return client.transaction.findMany({
    where: {
      walletId,
      OR: [
        { blockHeight: null },
        {
          addressId: null,
          type: { in: ['sent', 'send', 'received', 'receive'] },
        },
        { blockTime: null },
        {
          fee: null,
          type: { in: ['sent', 'send', 'consolidation'] },
        },
        {
          counterpartyAddress: null,
          type: { in: ['sent', 'send', 'received', 'receive'] },
        },
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

/**
 * Applies heterogeneous patches in bounded chunks. Each clientless chunk gets
 * its own 60-second transaction so an RBF membership change and its balance
 * repair marker commit atomically without making all chunks one long unit.
 */
export async function batchUpdateByIds(
  updates: Array<{ id: string; data: Record<string, unknown> }>,
  batchSize: number,
  client?: PrismaTxClient
): Promise<void> {
  for (let i = 0; i < updates.length; i += batchSize) {
    const chunk = mergeTransactionFieldPatches(updates.slice(i, i + batchSize));
    if (client) {
      await executeTransactionFieldPatch(chunk, client);
      continue;
    }
    await prisma.$transaction(
      tx => executeTransactionFieldPatch(chunk, tx),
      { timeout: 60_000 },
    );
  }
}

/** Merge duplicate ids in input order, preserving sequential last-write wins. */
function mergeTransactionFieldPatches(
  updates: Array<{ id: string; data: Record<string, unknown> }>,
): Array<{ id: string; data: Record<string, unknown> }> {
  const merged = new Map<string, { id: string; data: Record<string, unknown> }>();
  for (const update of updates) {
    const prior = merged.get(update.id);
    merged.set(update.id, {
      ...prior,
      ...update,
      data: { ...prior?.data, ...update.data },
    });
  }
  return [...merged.values()];
}
