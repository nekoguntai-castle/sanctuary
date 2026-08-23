import prisma from '../models/prisma';
import { Prisma } from '../generated/prisma/client';
import { isFullResyncGeneration } from '../constants/fullResync';
import type { WalletSyncState } from './types';

export interface FullResyncResetResult {
  deletedTransactions: number;
  resetPerformed: boolean;
}

export interface FullResyncCompletionResult {
  completionRecorded: boolean;
  syncState?: WalletSyncState;
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
           "processedFullResyncGeneration"
    FROM "wallets"
    WHERE "requestedFullResyncGeneration" > "processedFullResyncGeneration"
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
           "processedFullResyncGeneration"
    FROM "wallets"
    WHERE "requestedFullResyncGeneration" > "processedFullResyncGeneration"
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

/**
 * Clears wallet sync-derived state exactly once for one full-resync attempt.
 * The generation remains stable even when an ordinary sync changes status.
 */
export async function resetWalletForFullResync(
  walletId: string,
  fullResyncGeneration: number,
): Promise<FullResyncResetResult> {
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
      syncState: syncState as WalletSyncState,
    };
  });
}

export const resyncRepository = {
  findStrandedFullResyncWallets,
  findStrandedFullResyncWalletsPage,
  reserveFullResyncGeneration,
  resetWalletForFullResync,
  completeWalletFullResync,
};

export default resyncRepository;
