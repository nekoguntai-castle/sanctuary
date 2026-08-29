/**
 * Reconcile UTXOs Phase
 *
 * Applies authenticated UTXO state:
 * - Marks UTXOs spent only from authenticated raw transaction inputs
 * - Updates confirmations for existing UTXOs
 * - Invalidates draft transactions using spent UTXOs
 */

import { getConfig } from '../../../../config';
import { utxoRepository, draftLockRepository, draftRepository } from '../../../../repositories';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';
import type { PrismaTxClient } from '../../../../models/prisma';
import { runWalletSyncMutation } from '../mutationBoundary';

type DeferPostCommit = (effect: () => void | Promise<void>) => void;

const log = createLogger('BITCOIN:SVC_SYNC_RECONCILE');

type ExistingUtxo = Awaited<ReturnType<typeof utxoRepository.findByWalletIdWithSelect>>[number];
type UtxoUpdate = {
  id: string;
  confirmations: number;
  blockHeight: number | null;
  spent: false;
};
type ReconciliationChanges = {
  updates: UtxoUpdate[];
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

const createUtxoUpdate = (
  dbUtxo: ExistingUtxo,
  height: number,
  currentBlockHeight: number,
): UtxoUpdate | null => {
  const confirmations = height > 0
    ? Math.max(0, currentBlockHeight - height + 1)
    : 0;
  const blockHeight = height > 0 ? height : null;
  if (!dbUtxo.spent
    && dbUtxo.confirmations === confirmations
    && dbUtxo.blockHeight === blockHeight) return null;
  return { id: dbUtxo.id, confirmations, blockHeight, spent: false };
};

const collectReconciliationChanges = (
  ctx: SyncContext,
  existingUtxoMap: Map<string, ExistingUtxo>,
): ReconciliationChanges => {
  const changes: ReconciliationChanges = { updates: [], spentIds: [] };
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
    const update = createUtxoUpdate(dbUtxo, blockchainUtxo.utxo.height, ctx.currentBlockHeight);
    if (update) changes.updates.push(update);
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
        spent: update.spent,
      },
    })),
    getConfig().sync.transactionBatchSize,
    tx,
  );
  deferPostCommit(() => log.debug(`[SYNC] Updated confirmations for ${updates.length} UTXOs`));
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
  const changes = collectReconciliationChanges(ctx, existingUtxoMap);
  const batchSize = getConfig().sync.transactionBatchSize;
  await persistSpentChunks(ctx, changes.spentIds, batchSize);
  await persistUpdateChunks(ctx, changes.updates, batchSize);

  const newUtxoCount = Array.from(allUtxoKeys).filter(key => !existingUtxoMap.has(key)).length;
  log.debug(
    `[SYNC] Found ${newUtxoCount} new UTXOs (${existingUtxoMap.size} already exist, ${changes.spentIds.length} authenticated spends)`
  );

  return ctx;
}
