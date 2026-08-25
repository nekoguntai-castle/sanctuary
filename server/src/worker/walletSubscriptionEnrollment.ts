import { setTimeout as delay } from 'node:timers/promises';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';

const WALLET_ENROLLMENT_PAGE_SIZE = 200;
const SUBSCRIPTION_OWNER_POLL_MS = 250;

interface WalletSubscriptionEnrollmentInput {
  walletId: string;
  network: NetworkType;
  signal: AbortSignal;
}

interface WalletSubscriptionEnrollmentPageResult {
  scanned: number;
  unavailable: number;
  nextCursor?: string;
  dispatch: {
    publicationFailed: number;
    wakeUnavailable: number;
  };
}

interface WalletSubscriptionEnrollmentRuntime {
  enrollPendingPage(options: {
    network: NetworkType;
    walletId: string;
    cursor?: string;
    limit: number;
  }): Promise<WalletSubscriptionEnrollmentPageResult>;
  hasPendingWalletEnrollment(options: {
    network: NetworkType;
    walletId: string;
  }): Promise<boolean>;
}

interface WalletSubscriptionEnrollmentDependencies {
  runtime: WalletSubscriptionEnrollmentRuntime;
  isSubscriptionOwner(): boolean;
  ensureNetworkConnected(network: NetworkType): Promise<void>;
  serializeMutation<T>(operation: () => Promise<T>): Promise<T>;
  onPageResult(result: WalletSubscriptionEnrollmentPageResult): void;
}

/**
 * Complete every pending checkpoint before the sync caller may record the
 * wallet generation as current. A non-owner waits for the elected owner;
 * the owner performs bounded, serialized enrollment pages itself.
 */
export async function completeWalletSubscriptionEnrollment(
  input: WalletSubscriptionEnrollmentInput,
  dependencies: WalletSubscriptionEnrollmentDependencies,
): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    input.signal.throwIfAborted();
    if (!dependencies.isSubscriptionOwner()) {
      const pending = await dependencies.runtime.hasPendingWalletEnrollment({
        network: input.network,
        walletId: input.walletId,
      });
      if (!pending) return;
      await delay(SUBSCRIPTION_OWNER_POLL_MS, undefined, { signal: input.signal });
      continue;
    }

    await dependencies.ensureNetworkConnected(input.network);
    const result = await dependencies.serializeMutation(() => (
      dependencies.runtime.enrollPendingPage({
        network: input.network,
        walletId: input.walletId,
        ...(cursor !== undefined ? { cursor } : {}),
        limit: WALLET_ENROLLMENT_PAGE_SIZE,
      })
    ));
    dependencies.onPageResult(result);
    if (result.unavailable > 0) {
      throw new Error(`Subscription enrollment remains incomplete for wallet ${input.walletId}`);
    }
    if (result.scanned !== WALLET_ENROLLMENT_PAGE_SIZE || !result.nextCursor) return;
    cursor = result.nextCursor;
  }
}
