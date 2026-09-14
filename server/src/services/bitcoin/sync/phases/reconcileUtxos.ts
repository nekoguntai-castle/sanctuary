/**
 * Reconcile UTXOs Phase
 *
 * Applies authenticated UTXO state:
 * - Marks UTXOs spent only from authenticated raw transaction inputs
 * - Updates confirmations for existing UTXOs
 * - Invalidates draft transactions using spent UTXOs
 */

import { getConfig } from '../../../../config';
import {
  utxoRepository,
  draftLockRepository,
  draftRepository,
  transactionRepository,
} from '../../../../repositories';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';
import type { PrismaTxClient } from '../../../../models/prisma';
import { runWalletSyncMutation } from '../mutationBoundary';

type DeferPostCommit = (effect: () => void | Promise<void>) => void;

const log = createLogger('BITCOIN:SVC_SYNC_RECONCILE');

type ExistingUtxo = Awaited<ReturnType<typeof utxoRepository.findByWalletIdWithSelect>>[number];
// A confirmation-only refresh never carries a `spent` key (so it cannot
// clobber a concurrent spend); the only explicit-spent outcome an ordinary
// update may carry is `spent: true` (a coin the server or the wallet still
// treats as spent). Restoring a coin to unspent is not an ordinary update —
// see UtxoRestore below, which goes through a guarded repository write.
type UtxoUpdate = {
  id: string;
  confirmations: number;
  blockHeight: number | null;
  spent?: true;
};
type UtxoRestore = {
  id: string;
  confirmations: number;
  blockHeight: number | null;
};
type SpentUtxoOutcome =
  | { kind: 'update'; value: UtxoUpdate }
  | { kind: 'restore'; value: UtxoRestore }
  | null;
type ReconciliationChanges = {
  updates: UtxoUpdate[];
  restores: UtxoRestore[];
  spentIds: string[];
};

const evidenceMatchesExistingUtxo = (
  ctx: SyncContext,
  dbUtxo: ExistingUtxo,
  blockchainUtxo: SyncContext['utxoDataMap'] extends Map<string, infer T> ? T : never,
): boolean => {
  const authenticatedOutput = ctx.authenticatedOutpointEvidence.get(
    `${blockchainUtxo.utxo.tx_hash}:${blockchainUtxo.utxo.tx_pos}`,
  );
  return authenticatedOutput !== undefined
    && authenticatedOutput.valueSats === dbUtxo.amount
    && authenticatedOutput.scriptHex === dbUtxo.scriptPubKey.toLowerCase()
    && blockchainUtxo.address === dbUtxo.address;
};

/**
 * A locally spent coin that the server still lists never gets un-spent by the
 * listing alone. Absence from this round's authenticated history is absence
 * of evidence, not evidence the spend is gone — a server that simply has not
 * yet seen our broadcast reports the same "not spent this round" shape as a
 * spend that truly vanished. So it is restored only when BOTH hold: this
 * outpoint is outside this round's authenticated spends, AND the wallet has
 * no locally recorded (live, non-replaced) spender for it either. Otherwise
 * the listing is ignored and only confirmations/blockHeight are refreshed.
 */
const resolveSpentUtxoUpdate = (
  ctx: SyncContext,
  key: string,
  dbUtxo: ExistingUtxo,
  confirmations: number,
  blockHeight: number | null,
  locallySpentKeys: ReadonlySet<string>,
): SpentUtxoOutcome => {
  const stillAuthenticatedThisRound = ctx.authenticatedSpentOutpointKeys.has(key);
  const spendEvidenceVanished = !stillAuthenticatedThisRound && !locallySpentKeys.has(key);
  if (spendEvidenceVanished) {
    // A restore is not an ordinary update: it is written through a repository
    // call guarded to `where spent: true`, so it can never resurrect a coin a
    // concurrent writer (e.g. a broadcast spend committed after the
    // reconciliation snapshot) has already spent.
    return { kind: 'restore', value: { id: dbUtxo.id, confirmations, blockHeight } };
  }
  // Distinguish the two keep-spent reasons so a coin stuck on a dropped local
  // spend (no server evidence, but a still-live local TransactionInput row)
  // is diagnosable separately from one the server itself still authenticates.
  log.debug('[SYNC] Ignored listing for a locally spent UTXO', {
    reason: stillAuthenticatedThisRound ? 'spend_still_authenticated' : 'local_spender_recorded',
    utxoId: dbUtxo.id,
  });
  if (dbUtxo.confirmations === confirmations && dbUtxo.blockHeight === blockHeight) return null;
  return { kind: 'update', value: { id: dbUtxo.id, confirmations, blockHeight, spent: true } };
};

const createUtxoUpdate = (
  ctx: SyncContext,
  key: string,
  dbUtxo: ExistingUtxo,
  height: number,
  currentBlockHeight: number,
  locallySpentKeys: ReadonlySet<string>,
): SpentUtxoOutcome => {
  const confirmations = height > 0
    ? Math.max(0, currentBlockHeight - height + 1)
    : 0;
  const blockHeight = height > 0 ? height : null;
  if (dbUtxo.spent) {
    return resolveSpentUtxoUpdate(ctx, key, dbUtxo, confirmations, blockHeight, locallySpentKeys);
  }
  if (dbUtxo.confirmations === confirmations && dbUtxo.blockHeight === blockHeight) return null;
  // Confirmation-only refresh of an unspent-at-snapshot coin: never carries a
  // `spent` key, so it cannot clobber a spend committed after the snapshot.
  return { kind: 'update', value: { id: dbUtxo.id, confirmations, blockHeight } };
};

/**
 * Listed, locally spent outpoints whose fate this round's authenticated
 * history alone cannot decide (not among this round's authenticated
 * spends) — the only candidates that need a locally-recorded-spender lookup.
 */
const collectAmbiguousSpentKeys = (
  ctx: SyncContext,
  existingUtxoMap: Map<string, ExistingUtxo>,
): string[] => {
  const keys: string[] = [];
  for (const [key, dbUtxo] of existingUtxoMap) {
    if (!dbUtxo.spent || ctx.authenticatedSpentOutpointKeys.has(key)) continue;
    const blockchainUtxo = ctx.utxoDataMap.get(key);
    if (!blockchainUtxo || !evidenceMatchesExistingUtxo(ctx, dbUtxo, blockchainUtxo)) continue;
    keys.push(key);
  }
  return keys;
};

const collectReconciliationChanges = (
  ctx: SyncContext,
  existingUtxoMap: Map<string, ExistingUtxo>,
  locallySpentKeys: ReadonlySet<string>,
): ReconciliationChanges => {
  const changes: ReconciliationChanges = { updates: [], restores: [], spentIds: [] };
  for (const [key, dbUtxo] of existingUtxoMap) {
    const blockchainUtxo = ctx.utxoDataMap.get(key);
    if (!blockchainUtxo) {
      if (!dbUtxo.spent && ctx.authenticatedSpentOutpointKeys.has(key)) changes.spentIds.push(dbUtxo.id);
      continue;
    }
    if (!evidenceMatchesExistingUtxo(ctx, dbUtxo, blockchainUtxo)) {
      log.warn('[SYNC] Preserved conflicting existing UTXO evidence', {
        reason: 'existing_evidence_mismatch',
        count: 1,
      });
      continue;
    }
    const outcome = createUtxoUpdate(
      ctx, key, dbUtxo, blockchainUtxo.utxo.height, ctx.currentBlockHeight, locallySpentKeys,
    );
    if (outcome?.kind === 'update') changes.updates.push(outcome.value);
    else if (outcome?.kind === 'restore') changes.restores.push(outcome.value);
  }
  return changes;
};

const markSpentAndInvalidateDrafts = async (
  ctx: SyncContext,
  spentIds: string[],
  tx: PrismaTxClient | undefined,
  deferPostCommit: DeferPostCommit,
): Promise<void> => {
  // Callers pass only non-empty configured-size chunks.
  await utxoRepository.markManyAsSpent(spentIds, tx);
  deferPostCommit(() => {
    ctx.stats.utxosMarkedSpent += spentIds.length;
  });
  const locks = await draftLockRepository.findLocksByUtxoIdsWithDraftInfo(spentIds, tx);
  if (locks.length === 0) return;
  const draftIds = [...new Set(locks.map(lock => lock.draftId))];
  await draftRepository.deleteManyByIds(draftIds, tx);
  deferPostCommit(() => walletLog(
    ctx.walletId,
    'info',
    'DRAFT',
    `Invalidated ${draftIds.length} draft(s) after authenticated UTXO spend evidence`,
  ));
};

const persistUtxoUpdates = async (
  updates: UtxoUpdate[],
  tx: PrismaTxClient | undefined,
  deferPostCommit: DeferPostCommit,
): Promise<void> => {
  await utxoRepository.batchUpdateByIds(
    updates.map(update => ({
      id: update.id,
      data: {
        confirmations: update.confirmations,
        blockHeight: update.blockHeight,
        // Omitted entirely for a confirmation-only refresh — only the
        // explicit kept-spent outcome carries `spent: true` here.
        ...(update.spent !== undefined ? { spent: update.spent } : {}),
      },
    })),
    getConfig().sync.transactionBatchSize,
    tx,
  );
  deferPostCommit(() => log.debug(`[SYNC] Updated confirmations for ${updates.length} UTXOs`));
};

const persistUtxoRestores = async (
  restores: UtxoRestore[],
  tx: PrismaTxClient | undefined,
  deferPostCommit: DeferPostCommit,
): Promise<void> => {
  // Guarded restore: only writes rows still `spent: true`, so a concurrent
  // spend committed after the reconciliation snapshot is never clobbered
  // back to unspent by this round's listing.
  await utxoRepository.restoreUnspentByIds(restores, getConfig().sync.transactionBatchSize, tx);
  deferPostCommit(() => log.debug(`[SYNC] Restored ${restores.length} UTXOs to unspent (spend evidence vanished)`));
};

function chunksOf<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
}

async function persistSpentChunks(ctx: SyncContext, spentIds: string[], batchSize: number) {
  for (const chunk of chunksOf(spentIds, batchSize)) {
    await runWalletSyncMutation(ctx, 'utxo_reconciliation', async (tx, deferPostCommit) => {
      await markSpentAndInvalidateDrafts(ctx, chunk, tx, deferPostCommit);
    });
  }
}

async function persistUpdateChunks(ctx: SyncContext, updates: UtxoUpdate[], batchSize: number) {
  for (const chunk of chunksOf(updates, batchSize)) {
    await runWalletSyncMutation(ctx, 'utxo_reconciliation', async (tx, deferPostCommit) => {
      await persistUtxoUpdates(chunk, tx, deferPostCommit);
    });
  }
}

async function persistRestoreChunks(ctx: SyncContext, restores: UtxoRestore[], batchSize: number) {
  for (const chunk of chunksOf(restores, batchSize)) {
    await runWalletSyncMutation(ctx, 'utxo_reconciliation', async (tx, deferPostCommit) => {
      await persistUtxoRestores(chunk, tx, deferPostCommit);
    });
  }
}

/**
 * Execute reconcile UTXOs phase
 *
 * Compares database UTXOs against authenticated remote evidence:
 * 1. Authenticated inputs consume wallet UTXOs → mark as spent
 * 2. UTXOs with changed confirmations → update
 * 3. Draft transactions using spent UTXOs → invalidate
 */
export async function reconcileUtxosPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId, allUtxoKeys } = ctx;

  walletLog(walletId, 'info', 'SYNC', `Reconciling ${allUtxoKeys.size} UTXOs with database...`);

  // Read and compare outside a transaction. Each bounded write chunk validates
  // the fence afresh, so reclaim can rotate authority between commits.
  const existingUtxos = await utxoRepository.findByWalletIdWithSelect(walletId, {
    id: true,
    txid: true,
    vout: true,
    spent: true,
    confirmations: true,
    blockHeight: true,
    address: true,
    amount: true,
    scriptPubKey: true,
  });
  const existingUtxoMap = new Map(existingUtxos.map(utxo => [`${utxo.txid}:${utxo.vout}`, utxo]));
  const ambiguousSpentKeys = collectAmbiguousSpentKeys(ctx, existingUtxoMap);
  const locallySpentKeys = await transactionRepository.findLocallySpentOutpointKeys(
    walletId, ambiguousSpentKeys,
  );
  const changes = collectReconciliationChanges(ctx, existingUtxoMap, locallySpentKeys);
  const batchSize = getConfig().sync.transactionBatchSize;
  await persistSpentChunks(ctx, changes.spentIds, batchSize);
  await persistUpdateChunks(ctx, changes.updates, batchSize);
  await persistRestoreChunks(ctx, changes.restores, batchSize);

  const newUtxoCount = Array.from(allUtxoKeys).filter(key => !existingUtxoMap.has(key)).length;
  log.debug(
    `[SYNC] Found ${newUtxoCount} new UTXOs (${existingUtxoMap.size} already exist, ${changes.spentIds.length} authenticated spends)`
  );

  return ctx;
}
