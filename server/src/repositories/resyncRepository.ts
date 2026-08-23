import prisma, { type PrismaTxClient } from '../models/prisma';
import { Prisma } from '../generated/prisma/client';
import {
  FULL_RESYNC_GENERATION_MAX,
  isFullResyncGeneration,
} from '../constants/fullResync';
import type {
  IncrementalSyncLifecycleState,
  WalletSyncMutationFence,
} from './types';
import { withWalletSyncMutationFence } from './syncIntentRepository';

export interface FullResyncResetResult {
  deletedTransactions: number;
  resetPerformed: boolean;
}

export interface FullResyncCompletionResult {
  completionRecorded: boolean;
  syncState?: IncrementalSyncLifecycleState;
}

export type FencedFullResyncCompletionResult =
  | { completionRecorded: false }
  | { completionRecorded: true; syncState: IncrementalSyncLifecycleState };

export type FullResyncRequestResult =
  | {
    status: 'requested' | 'merged';
    generation: number;
    incrementalGeneration: number;
    state: IncrementalSyncLifecycleState;
  }
  | { status: 'generation_exhausted' | 'not_found' };

interface FullResyncRequestRow extends IncrementalSyncLifecycleState {
  previousRequestedGeneration: number;
}

export interface FullResyncSuccessInput {
  syncedAt: Date;
  lastSyncedBlockHeight: number;
}

interface FullResyncGenerationState {
  requestedFullResyncGeneration: number;
  preparedFullResyncGeneration: number;
  processedFullResyncGeneration: number;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
  syncInProgress: boolean;
}

/** A wallet whose requested full resync was never carried out. */
export interface StrandedFullResyncWallet {
  id: string;
  name: string;
  requestedFullResyncGeneration: number;
  requestedIncrementalSyncGeneration: number;
  processedFullResyncGeneration: number;
}

/**
 * Cap on one reconciliation pass, so a corrupted table cannot flood the queue.
 */
const MAX_STRANDED_FULL_RESYNCS = 25;

/**
 * Wallets carrying a full-resync generation that was reserved but never
 * processed.
 *
 * Nothing else in the server reads `requested > processed`; only the support
 * collector reports it. A generation whose job is lost - dropped from the
 * queue, exhausted its attempts, or never enqueued after the reservation
 * committed - therefore strands forever, and the wallet keeps a healthy badge
 * while the operator's "Full resync" click silently did nothing.
 */
export async function findStrandedFullResyncWallets(): Promise<StrandedFullResyncWallet[]> {
  // One raw query, not a raw id lookup followed by a findMany. Prisma cannot
  // compare two columns in a plain filter, and issuing a second `wallet.findMany`
  // here would also interleave with the stale sweep's own queries.
  return prisma.$queryRaw<StrandedFullResyncWallet[]>(Prisma.sql`
    SELECT "id",
           "name",
           "requestedFullResyncGeneration",
           "requestedIncrementalSyncGeneration",
           "processedFullResyncGeneration"
    FROM "wallets"
    WHERE "requestedFullResyncGeneration" > "processedFullResyncGeneration"
      AND "syncActionRequiredAt" IS NULL
    ORDER BY "updatedAt" ASC
    LIMIT ${MAX_STRANDED_FULL_RESYNCS}
  `);
}

/** Read one stable keyset page for the dormant bounded recovery coordinator. */
export async function findStrandedFullResyncWalletsPage(
  cursor?: string,
): Promise<StrandedFullResyncWallet[]> {
  return prisma.$queryRaw<StrandedFullResyncWallet[]>(Prisma.sql`
    SELECT "id",
           "name",
           "requestedFullResyncGeneration",
           "requestedIncrementalSyncGeneration",
           "processedFullResyncGeneration"
    FROM "wallets"
    WHERE "requestedFullResyncGeneration" > "processedFullResyncGeneration"
      AND "syncActionRequiredAt" IS NULL
      ${cursor ? Prisma.sql`AND "id" > ${cursor}` : Prisma.empty}
    ORDER BY "id" ASC
    LIMIT ${MAX_STRANDED_FULL_RESYNCS}
  `);
}

/** Atomically allocates the next durable full-resync generation for a wallet. */
export async function reserveFullResyncGeneration(walletId: string): Promise<number> {
  const wallet = await prisma.wallet.update({
    where: { id: walletId },
    data: { requestedFullResyncGeneration: { increment: 1 } },
    select: { requestedFullResyncGeneration: true },
  });
  return wallet.requestedFullResyncGeneration;
}

/** Confirm that durable wallet state, not a terminal queue record, proves completion. */
export async function isFullResyncGenerationProcessed(
  walletId: string,
  generation: number,
): Promise<boolean> {
  if (!isFullResyncGeneration(generation)) return false;
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { processedFullResyncGeneration: true },
  });
  return wallet !== null && wallet.processedFullResyncGeneration >= generation;
}

/** Revalidate the exact paired generations before recovery mutates the queue. */
export async function isExactFullResyncPending(
  walletId: string,
  generation: number,
  incrementalGeneration: number,
): Promise<boolean> {
  if (!isFullResyncGeneration(generation) || !isFullResyncGeneration(incrementalGeneration)) {
    return false;
  }
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: {
      requestedFullResyncGeneration: true,
      processedFullResyncGeneration: true,
      requestedIncrementalSyncGeneration: true,
      syncActionRequiredAt: true,
    },
  });
  return wallet !== null
    && wallet.requestedFullResyncGeneration === generation
    && wallet.processedFullResyncGeneration < generation
    && wallet.requestedIncrementalSyncGeneration === incrementalGeneration
    && wallet.syncActionRequiredAt === null;
}

/**
 * Persist one coalesced full-resync request. An already outstanding rebuild
 * retains its exact generation; only a wallet with no pending full resync
 * advances to the next generation.
 */
export async function requestFullResyncGeneration(
  walletId: string,
): Promise<FullResyncRequestResult> {
  const rows = await prisma.$queryRaw<FullResyncRequestRow[]>(Prisma.sql`
    WITH current AS (
      SELECT "id",
             "requestedFullResyncGeneration",
             "processedFullResyncGeneration",
             "requestedIncrementalSyncGeneration",
             "claimedIncrementalSyncGeneration",
             "processedIncrementalSyncGeneration",
             "syncActionRequiredAt",
             "syncNextRetryAt",
             "syncRetryCount"
      FROM "wallets"
      WHERE "id" = ${walletId}
      FOR UPDATE
    )
    UPDATE "wallets" AS wallet
    SET "requestedFullResyncGeneration" = CASE
          WHEN current."requestedFullResyncGeneration"
             = current."processedFullResyncGeneration"
          THEN current."requestedFullResyncGeneration" + 1
          ELSE current."requestedFullResyncGeneration"
        END,
        "requestedIncrementalSyncGeneration" = CASE
          WHEN current."requestedFullResyncGeneration"
                 > current."processedFullResyncGeneration"
            AND current."requestedIncrementalSyncGeneration"
                 > current."processedIncrementalSyncGeneration"
          THEN current."requestedIncrementalSyncGeneration"
          ELSE GREATEST(
            current."requestedIncrementalSyncGeneration"::BIGINT,
            current."claimedIncrementalSyncGeneration"::BIGINT + 1
          )::INTEGER
        END,
        "syncActionRequiredAt" = NULL,
        "syncNextRetryAt" = NULL,
        "syncRetryCount" = 0,
        "syncStateVersion" = wallet."syncStateVersion" + CASE
          WHEN current."requestedFullResyncGeneration"
                 = current."processedFullResyncGeneration"
            OR NOT (
              current."requestedFullResyncGeneration"
                > current."processedFullResyncGeneration"
              AND current."requestedIncrementalSyncGeneration"
                > current."processedIncrementalSyncGeneration"
            )
            OR current."syncActionRequiredAt" IS NOT NULL
            OR current."syncNextRetryAt" IS NOT NULL
            OR current."syncRetryCount" <> 0
          THEN 1
          ELSE 0
        END,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM current
    WHERE wallet."id" = current."id"
      AND (
        current."requestedFullResyncGeneration"
          > current."processedFullResyncGeneration"
        OR current."requestedFullResyncGeneration" < ${FULL_RESYNC_GENERATION_MAX}
      )
      AND (
        current."requestedIncrementalSyncGeneration"
          > current."processedIncrementalSyncGeneration"
        OR GREATEST(
          current."requestedIncrementalSyncGeneration"::BIGINT,
          current."claimedIncrementalSyncGeneration"::BIGINT + 1
        ) <= ${FULL_RESYNC_GENERATION_MAX}
      )
    RETURNING
      wallet."id",
      wallet."requestedIncrementalSyncGeneration",
      wallet."claimedIncrementalSyncGeneration",
      wallet."processedIncrementalSyncGeneration",
      wallet."incrementalSyncLeaseToken",
      wallet."incrementalSyncClaimedAt",
      wallet."incrementalSyncLeaseExpiresAt",
      wallet."syncRetryCount",
      wallet."syncNextRetryAt",
      wallet."syncActionRequiredAt",
      wallet."requestedFullResyncGeneration",
      wallet."preparedFullResyncGeneration",
      wallet."processedFullResyncGeneration",
      wallet."syncInProgress",
      wallet."lastSyncedAt",
      wallet."lastSyncedBlockHeight",
      wallet."lastSyncStatus",
      wallet."lastSyncError",
      wallet."lastSyncFailureClass",
      wallet."syncExecutionOwner",
      wallet."syncStartedAt",
      wallet."syncStateVersion",
      current."requestedFullResyncGeneration" AS "previousRequestedGeneration"
  `);
  const row = rows[0];
  if (!row) {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { requestedFullResyncGeneration: true },
    });
    return wallet ? { status: 'generation_exhausted' } : { status: 'not_found' };
  }
  const { previousRequestedGeneration, ...state } = row;
  return {
    status: row.requestedFullResyncGeneration > row.previousRequestedGeneration
      ? 'requested'
      : 'merged',
    generation: row.requestedFullResyncGeneration,
    incrementalGeneration: row.requestedIncrementalSyncGeneration,
    state,
  };
}

/**
 * Clears wallet sync-derived state exactly once for one full-resync attempt.
 * The generation remains stable even when an ordinary sync changes status.
 */
export async function resetWalletForFullResync(
  walletId: string,
  fullResyncGeneration: number,
  mutationFence?: WalletSyncMutationFence,
): Promise<FullResyncResetResult> {
  if (!isFullResyncGeneration(fullResyncGeneration)) {
    throw new Error('Full resync generation is outside the supported range');
  }

  const reset = async (tx: PrismaTxClient): Promise<FullResyncResetResult> => {
    const [wallet] = await tx.$queryRaw<FullResyncGenerationState[]>(Prisma.sql`
      /* full-resync-wallet-lock */
      SELECT "requestedFullResyncGeneration",
             "preparedFullResyncGeneration",
             "processedFullResyncGeneration",
             "lastSyncedAt",
             "lastSyncStatus",
             "syncInProgress"
      FROM "wallets"
      WHERE "id" = ${walletId}
      FOR UPDATE
    `);
    if (!wallet) {
      throw new Error('Wallet not found');
    }
    if (fullResyncGeneration > wallet.requestedFullResyncGeneration) {
      throw new Error('Full resync generation was not reserved');
    }
    const resetHighWaterMark = Math.max(
      wallet.preparedFullResyncGeneration,
      wallet.processedFullResyncGeneration,
    );
    if (fullResyncGeneration <= resetHighWaterMark) {
      return { deletedTransactions: 0, resetPerformed: false };
    }

    const deleted = await tx.transaction.deleteMany({ where: { walletId } });
    await tx.address.updateMany({
      where: { walletId },
      data: { used: false },
    });
    await tx.wallet.update({
      where: { id: walletId },
      data: {
        syncInProgress: true,
        lastSyncedAt: null,
        lastSyncStatus: 'resyncing',
        lastSyncError: null,
        lastSyncFailureClass: null,
        syncExecutionOwner: 'worker',
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: new Date(),
        syncStateVersion: { increment: 1 },
        preparedFullResyncGeneration: fullResyncGeneration,
      },
    });

    return {
      deletedTransactions: deleted.count,
      resetPerformed: true,
    };
  };
  if (mutationFence) {
    if (mutationFence.walletId !== walletId) {
      throw new Error('Full resync mutation fence belongs to another wallet');
    }
    return withWalletSyncMutationFence(mutationFence, reset);
  }
  return prisma.$transaction(reset);
}

/** Complete one canonical full resync and its mutation lease atomically. */
export async function completeFencedWalletFullResync(
  walletId: string,
  fullResyncGeneration: number,
  mutationFence: WalletSyncMutationFence,
  input: FullResyncSuccessInput,
): Promise<FencedFullResyncCompletionResult> {
  if (!isFullResyncGeneration(fullResyncGeneration)) {
    throw new Error('Full resync generation is outside the supported range');
  }
  if (mutationFence.walletId !== walletId) {
    throw new Error('Full resync mutation fence belongs to another wallet');
  }
  return withWalletSyncMutationFence(mutationFence, async tx => {
    const [wallet] = await tx.$queryRaw<FullResyncGenerationState[]>(Prisma.sql`
      SELECT "requestedFullResyncGeneration",
             "preparedFullResyncGeneration",
             "processedFullResyncGeneration",
             "lastSyncedAt",
             "lastSyncStatus",
             "syncInProgress"
      FROM "wallets"
      WHERE "id" = ${walletId}
      FOR UPDATE
    `);
    if (!wallet
      || wallet.requestedFullResyncGeneration !== fullResyncGeneration
      || wallet.preparedFullResyncGeneration < fullResyncGeneration
      || wallet.processedFullResyncGeneration >= fullResyncGeneration) {
      return { completionRecorded: false };
    }
    const syncState = await tx.wallet.update({
      where: { id: walletId },
      data: {
        processedIncrementalSyncGeneration: mutationFence.generation,
        incrementalSyncLeaseToken: null,
        incrementalSyncClaimedAt: null,
        incrementalSyncLeaseExpiresAt: null,
        processedFullResyncGeneration: fullResyncGeneration,
        lastSyncedAt: input.syncedAt,
        lastSyncedBlockHeight: input.lastSyncedBlockHeight,
        lastSyncStatus: 'success',
        lastSyncError: null,
        lastSyncFailureClass: null,
        syncInProgress: false,
        syncExecutionOwner: null,
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncActionRequiredAt: null,
        syncStartedAt: null,
        syncStateVersion: { increment: 1 },
      },
    });
    return {
      completionRecorded: true,
      syncState: syncState as IncrementalSyncLifecycleState,
    };
  });
}

/**
 * Mark one prepared full-resync generation complete after its rebuild succeeds.
 *
 * The row lock keeps the generation fence and successful lifecycle write in one
 * transaction. A late completion for an older generation is an idempotent no-op;
 * it must not overwrite the state established by a newer destructive reset.
 */
export async function completeWalletFullResync(
  walletId: string,
  fullResyncGeneration: number,
  input: FullResyncSuccessInput,
): Promise<FullResyncCompletionResult> {
  if (!isFullResyncGeneration(fullResyncGeneration)) {
    throw new Error('Full resync generation is outside the supported range');
  }

  return prisma.$transaction(async tx => {
    const [wallet] = await tx.$queryRaw<FullResyncGenerationState[]>(Prisma.sql`
      /* full-resync-wallet-lock */
      SELECT "requestedFullResyncGeneration",
             "preparedFullResyncGeneration",
             "processedFullResyncGeneration",
             "lastSyncedAt",
             "lastSyncStatus",
             "syncInProgress"
      FROM "wallets"
      WHERE "id" = ${walletId}
      FOR UPDATE
    `);
    if (!wallet) {
      throw new Error('Wallet not found');
    }
    if (fullResyncGeneration > wallet.requestedFullResyncGeneration) {
      throw new Error('Full resync generation was not reserved');
    }
    if (
      fullResyncGeneration < wallet.processedFullResyncGeneration
      || fullResyncGeneration < wallet.preparedFullResyncGeneration
    ) {
      return { completionRecorded: false };
    }
    const legacyPreparationAlreadyProcessed =
      fullResyncGeneration === wallet.processedFullResyncGeneration;
    if (
      fullResyncGeneration > wallet.preparedFullResyncGeneration
      && !legacyPreparationAlreadyProcessed
    ) {
      throw new Error('Full resync generation was not prepared');
    }
    if (
      legacyPreparationAlreadyProcessed
      && wallet.lastSyncStatus === 'success'
      && wallet.syncInProgress === false
      && wallet.lastSyncedAt !== null
    ) {
      return { completionRecorded: false };
    }

    const syncState = await tx.wallet.update({
      where: { id: walletId },
      data: {
        lastSyncedAt: input.syncedAt,
        lastSyncedBlockHeight: input.lastSyncedBlockHeight,
        lastSyncStatus: 'success',
        lastSyncError: null,
        lastSyncFailureClass: null,
        syncInProgress: false,
        syncExecutionOwner: null,
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: null,
        syncStateVersion: { increment: 1 },
        processedFullResyncGeneration: fullResyncGeneration,
      },
    });

    return {
      completionRecorded: true,
      syncState: syncState as IncrementalSyncLifecycleState,
    };
  });
}

export const resyncRepository = {
  findStrandedFullResyncWallets,
  findStrandedFullResyncWalletsPage,
  requestFullResyncGeneration,
  reserveFullResyncGeneration,
  isFullResyncGenerationProcessed,
  isExactFullResyncPending,
  resetWalletForFullResync,
  completeWalletFullResync,
  completeFencedWalletFullResync,
};

export default resyncRepository;
