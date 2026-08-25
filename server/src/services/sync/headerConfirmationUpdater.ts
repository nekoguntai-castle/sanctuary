import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import { transactionRepository } from '../../repositories';
import {
  HEADER_CONFIRMATION_PAGE_SIZE,
  HEADER_CONFIRMATION_PAGE_TIMEOUT_MS,
  assertAuthoritativeHeight,
  raceConfirmationAbort,
  refreshPendingConfirmationWallets,
  refreshWalletConfirmationsAtHeight,
  type PendingConfirmationPageResult,
  type PendingConfirmationRefreshResult,
} from './confirmationUpdater';

const CONFIRMATION_THRESHOLD = 6;
const QUERY_TIMEOUT_MS = HEADER_CONFIRMATION_PAGE_TIMEOUT_MS - 1_000;
const OWNERSHIP_POLL_MS = 25;

async function withinHeaderConfirmationDeadline<T>(
  isActive: () => boolean,
  timeoutMessage: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!isActive()) throw new Error('Network header reconciliation ownership is not active');
  const controller = new AbortController();
  const ownershipTimer = setInterval(() => {
    if (!isActive()) {
      controller.abort(new Error('Network header reconciliation ownership was lost'));
    }
  }, OWNERSHIP_POLL_MS);
  ownershipTimer.unref?.();
  const deadlineTimer = setTimeout(() => {
    controller.abort(new Error(timeoutMessage));
  }, HEADER_CONFIRMATION_PAGE_TIMEOUT_MS);
  deadlineTimer.unref?.();
  try {
    return await operation(controller.signal);
  } finally {
    clearInterval(ownershipTimer);
    clearTimeout(deadlineTimer);
  }
}

/** Enumerate and refresh one bounded candidate page at an immutable height. */
export async function refreshPendingConfirmationsAtHeight(
  network: NetworkType,
  authoritativeHeight: number,
  isActive: () => boolean = () => true,
  afterWalletId: string | null = null,
  pageSize = HEADER_CONFIRMATION_PAGE_SIZE,
): Promise<PendingConfirmationPageResult> {
  assertAuthoritativeHeight(authoritativeHeight);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > HEADER_CONFIRMATION_PAGE_SIZE) {
    throw new Error('Header confirmation page size is invalid');
  }
  return withinHeaderConfirmationDeadline(
    isActive,
    'Network header confirmation page timed out',
    async (signal) => {
      const candidates = await raceConfirmationAbort(
        signal,
        transactionRepository.findWalletIdsRequiringConfirmationUpdateAtHeight(
          CONFIRMATION_THRESHOLD,
          network,
          authoritativeHeight,
          afterWalletId,
          pageSize,
          QUERY_TIMEOUT_MS,
        ),
      );
      signal.throwIfAborted();
      const hasMore = candidates.length > pageSize;
      const pendingWalletIds = candidates.slice(0, pageSize);
      const result = await refreshPendingConfirmationWallets(
        pendingWalletIds,
        walletId => refreshWalletConfirmationsAtHeight(
          walletId,
          authoritativeHeight,
          0,
          signal,
        ),
        signal,
      );
      return {
        ...result,
        // Preserve the database collation used to derive the resume cursor.
        // refreshPendingConfirmationWallets sorts processing order in JavaScript,
        // which is not guaranteed to match PostgreSQL for restored legacy IDs.
        walletIds: pendingWalletIds,
        nextCursor: pendingWalletIds.length > 0
          ? pendingWalletIds[pendingWalletIds.length - 1]
          : afterWalletId,
        enumerationComplete: !hasMore,
      };
    },
  );
}

/** Retry an exact durable wallet set without re-enumerating candidates. */
export async function refreshConfirmationRetryWalletsAtHeight(
  walletIds: string[],
  authoritativeHeight: number,
  isActive: () => boolean = () => true,
): Promise<PendingConfirmationRefreshResult> {
  assertAuthoritativeHeight(authoritativeHeight);
  if (walletIds.length < 1 || walletIds.length > HEADER_CONFIRMATION_PAGE_SIZE) {
    throw new Error('Header confirmation retry page size is invalid');
  }
  return withinHeaderConfirmationDeadline(
    isActive,
    'Network header confirmation retry page timed out',
    signal => refreshPendingConfirmationWallets(
      walletIds,
      walletId => refreshWalletConfirmationsAtHeight(walletId, authoritativeHeight, 0, signal),
      signal,
    ),
  );
}
