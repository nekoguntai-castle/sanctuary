import { Prisma } from '../generated/prisma/client';
import prisma, { type PrismaTxClient } from '../models/prisma';
import {
  assertFence,
  databaseNow,
  lockState,
  parseState,
  requireFence,
} from './networkHeaderReconciliationPersistence';
import type {
  NetworkHeaderReconciliationState,
  ReconciliationFence,
} from './networkHeaderReconciliationTypes';

const MAX_PAGE_SIZE = 100;

function requireConfirmationCursor(value: string | null, description: string): void {
  if (value !== null && (value.length < 1 || value.length > 200)) {
    throw new Error(`Header reconciliation ${description} is invalid`);
  }
}

function requireWalletIds(walletIds: string[], description: string): void {
  if (walletIds.length > MAX_PAGE_SIZE || new Set(walletIds).size !== walletIds.length) {
    throw new Error(`Header reconciliation ${description} is invalid`);
  }
  walletIds.forEach(walletId => requireConfirmationCursor(walletId, description));
}

function clearedFailureState(now: Date) {
  return {
    lastFailureClass: null,
    consecutiveFailureCount: 0,
    retryEligibleAt: now,
  };
}

async function cursorAdvancesInDatabase(
  tx: PrismaTxClient,
  expectedCursor: string | null,
  cursor: string,
): Promise<boolean> {
  if (expectedCursor === null) return true;
  // Compare in PostgreSQL so cursor validation uses the same database collation
  // as the candidate and retry ORDER BY queries.
  const rows = await tx.$queryRaw<Array<{ advances: boolean }>>(Prisma.sql`
    SELECT (${cursor}::text > ${expectedCursor}::text) AS "advances"
  `);
  return rows[0]?.advances === true;
}

/** Persist one enumerated page and its failures under the active target fence. */
export async function recordNetworkHeaderConfirmationPage(input: ReconciliationFence & {
  expectedCursor: string | null;
  cursor: string | null;
  enumerationComplete: boolean;
  attemptedWalletIds: string[];
  failedWalletIds: string[];
}): Promise<NetworkHeaderReconciliationState> {
  requireFence(input);
  requireConfirmationCursor(input.expectedCursor, 'expected confirmation cursor');
  requireConfirmationCursor(input.cursor, 'confirmation cursor');
  requireWalletIds(input.attemptedWalletIds, 'attempted wallet IDs');
  requireWalletIds(input.failedWalletIds, 'failed wallet IDs');
  if (input.failedWalletIds.some(walletId => !input.attemptedWalletIds.includes(walletId))) {
    throw new Error('Header reconciliation confirmation page result is invalid');
  }
  if (typeof input.enumerationComplete !== 'boolean') {
    throw new Error('Header reconciliation confirmation page completion is invalid');
  }
  if (input.cursor === null && input.expectedCursor !== null) {
    throw new Error('Header reconciliation confirmation cursor cannot move backwards');
  }
  // The enumerator supplies IDs in PostgreSQL order, so its final attempted ID
  // must be the same identity persisted as the resume cursor. An empty terminal
  // page keeps the prior cursor while proving that enumeration is exhausted.
  const expectedPageCursor = input.attemptedWalletIds.length > 0
    ? input.attemptedWalletIds[input.attemptedWalletIds.length - 1]
    : input.expectedCursor;
  if (expectedPageCursor !== input.cursor) {
    throw new Error('Header reconciliation confirmation page cursor is invalid');
  }
  return prisma.$transaction(async (tx) => {
    const state = await lockState(tx, input.network);
    assertFence(state, input);
    if (state.confirmationEnumerationComplete) {
      throw new Error('Header reconciliation confirmation enumeration is already complete');
    }
    if (state.confirmationCursorWalletId !== input.expectedCursor) {
      throw new Error('Header reconciliation confirmation cursor changed');
    }
    if (input.cursor !== null
      && input.cursor !== input.expectedCursor
      && !await cursorAdvancesInDatabase(tx, input.expectedCursor, input.cursor)) {
      throw new Error('Header reconciliation confirmation cursor must advance');
    }
    if (!input.enumerationComplete && input.cursor === input.expectedCursor) {
      throw new Error('Header reconciliation incomplete page did not advance');
    }
    if (input.failedWalletIds.length > 0) {
      await tx.networkHeaderConfirmationRetry.createMany({
        data: input.failedWalletIds.map(walletId => ({ network: input.network, walletId })),
        skipDuplicates: true,
      });
    }
    const now = await databaseNow(tx);
    const entireAttemptedPageFailed = input.attemptedWalletIds.length > 0
      && input.failedWalletIds.length === input.attemptedWalletIds.length;
    const failureState = entireAttemptedPageFailed ? {} : clearedFailureState(now);
    const updated = await tx.networkHeaderReconciliation.update({
      where: { network: input.network },
      data: {
        confirmationCursorWalletId: input.cursor,
        confirmationEnumerationComplete: input.enumerationComplete,
        lastAttemptAt: now,
        // Partial success is durable population progress; complete page failure
        // preserves the series so the reconciler's recordFailure escalates it.
        // An empty terminal page also clears stale backoff because exhaustion is
        // successful progress and there is no wallet failure left to record.
        ...failureState,
      },
    });
    return parseState(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Return a bounded database-ordered retry page under the exact active fence. */
export async function findNetworkHeaderConfirmationRetries(
  fence: ReconciliationFence,
  limit = MAX_PAGE_SIZE,
): Promise<string[]> {
  requireFence(fence);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error('Header confirmation retry page limit is invalid');
  }
  return prisma.$transaction(async (tx) => {
    const state = await lockState(tx, fence.network);
    assertFence(state, fence);
    if (!state.confirmationEnumerationComplete) {
      throw new Error('Header confirmation retries require completed enumeration');
    }
    const rows = await tx.networkHeaderConfirmationRetry.findMany({
      where: { network: fence.network },
      orderBy: { walletId: 'asc' },
      take: limit,
      select: { walletId: true },
    });
    return rows.map(row => row.walletId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Delete successful retries while retaining failures as durable blockers. */
export async function recordNetworkHeaderConfirmationRetryResult(
  input: ReconciliationFence & {
    attemptedWalletIds: string[];
    failedWalletIds: string[];
  },
): Promise<NetworkHeaderReconciliationState> {
  requireFence(input);
  requireWalletIds(input.attemptedWalletIds, 'attempted retry wallet IDs');
  requireWalletIds(input.failedWalletIds, 'failed retry wallet IDs');
  if (input.attemptedWalletIds.length < 1
    || input.failedWalletIds.some(walletId => !input.attemptedWalletIds.includes(walletId))) {
    throw new Error('Header confirmation retry result is invalid');
  }
  return prisma.$transaction(async (tx) => {
    const state = await lockState(tx, input.network);
    assertFence(state, input);
    const successful = input.attemptedWalletIds.filter(
      walletId => !input.failedWalletIds.includes(walletId),
    );
    if (successful.length > 0) {
      await tx.networkHeaderConfirmationRetry.deleteMany({
        where: { network: input.network, walletId: { in: successful } },
      });
    }
    const now = await databaseNow(tx);
    // Recovered retry rows are durable progress and start a fresh failure
    // series. Preserve state only when the entire attempted page still fails,
    // allowing the reconciler's following recordFailure call to escalate it.
    const failureState = successful.length > 0 ? clearedFailureState(now) : {};
    const updated = await tx.networkHeaderReconciliation.update({
      where: { network: input.network },
      data: {
        lastAttemptAt: now,
        ...failureState,
      },
    });
    return parseState(updated);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
