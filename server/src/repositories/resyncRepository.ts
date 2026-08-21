import prisma from '../models/prisma';
import { Prisma } from '../generated/prisma/client';
import { isFullResyncGeneration } from '../constants/fullResync';

export interface FullResyncResetResult {
  deletedTransactions: number;
  resetPerformed: boolean;
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
    const [wallet] = await tx.$queryRaw<Array<{
      requestedFullResyncGeneration: number;
      processedFullResyncGeneration: number;
    }>>(Prisma.sql`
      /* full-resync-wallet-lock */
      SELECT "requestedFullResyncGeneration", "processedFullResyncGeneration"
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
    if (fullResyncGeneration <= wallet.processedFullResyncGeneration) {
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
        processedFullResyncGeneration: fullResyncGeneration,
      },
    });

    return {
      deletedTransactions: deleted.count,
      resetPerformed: true,
    };
  });
}

export const resyncRepository = {
  reserveFullResyncGeneration,
  resetWalletForFullResync,
  findStrandedFullResyncWallets,
};

export default resyncRepository;
