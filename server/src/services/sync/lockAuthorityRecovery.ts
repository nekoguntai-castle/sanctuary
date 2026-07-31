import { LockAuthorityUnavailableError } from '../../infrastructure';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import type { SyncResult, SyncState } from './types';

const log = createLogger('SYNC:LOCK_AUTHORITY');
const WALLET_AUTHORITY_RETRY_MS = 1000;
const SUBSCRIPTION_AUTHORITY_RETRY_MS = 15_000;

export function scheduleWalletLockAuthorityRetry(
  state: SyncState,
  walletId: string,
  retryCount: number,
  executeSyncJob: (
    walletId: string,
    retryCount?: number,
  ) => Promise<SyncResult>,
): SyncResult {
  if (!state.pendingRetries.has(walletId)) {
    const retryTimer = setTimeout(() => {
      state.pendingRetries.delete(walletId);
      if (!state.isRunning) return;
      executeSyncJob(walletId, retryCount).catch((error) => {
        log.error(`[SYNC] Lock-authority retry failed for wallet ${walletId}`, {
          error: getErrorMessage(error),
        });
      });
    }, WALLET_AUTHORITY_RETRY_MS);
    retryTimer.unref?.();
    state.pendingRetries.set(walletId, retryTimer);
  }

  log.warn(`[SYNC] Lock authority unavailable for wallet ${walletId}; retry scheduled`, {
    delayMs: WALLET_AUTHORITY_RETRY_MS,
  });
  return {
    success: false,
    addresses: 0,
    transactions: 0,
    utxos: 0,
    error: 'Lock authority unavailable - retrying...',
  };
}

interface SubscriptionAuthorityRetryDependencies {
  isRunning: () => boolean;
  getOwnership: () => SyncState['subscriptionOwnership'];
  setup: () => Promise<void>;
  teardown: () => Promise<void>;
  release: () => Promise<void>;
}

export class SubscriptionAuthorityRetryController {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private generation = 0;
  private attemptGeneration: number | null = null;
  private restartRequested = false;

  constructor(
    private readonly dependencies: SubscriptionAuthorityRetryDependencies,
  ) {}

  start(): void {
    if (this.inFlight) {
      if (this.attemptGeneration !== this.generation) {
        this.restartRequested = true;
      }
      return;
    }
    if (this.timer) return;
    this.runAttempt(this.generation);
  }

  stop(): void {
    this.generation += 1;
    this.restartRequested = false;
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runAttempt(this.generation);
    }, SUBSCRIPTION_AUTHORITY_RETRY_MS);
    this.timer.unref?.();
  }

  private runAttempt(generation: number): void {
    if (!this.dependencies.isRunning() || this.inFlight) return;
    this.inFlight = true;
    this.attemptGeneration = generation;
    void this.dependencies.setup()
      .then(() => this.cleanupStaleSetup(generation))
      .catch((error) => this.handleRetryError(error))
      .finally(() => {
        this.inFlight = false;
        this.attemptGeneration = null;
        if (this.restartRequested && this.dependencies.isRunning()) {
          this.restartRequested = false;
          this.runAttempt(this.generation);
          return;
        }
        if (
          generation === this.generation &&
          this.dependencies.isRunning() &&
          this.dependencies.getOwnership() === 'unavailable'
        ) {
          this.schedule();
        }
      });
  }

  private async cleanupStaleSetup(generation: number): Promise<void> {
    if (
      generation === this.generation &&
      this.dependencies.isRunning()
    ) {
      return;
    }
    await this.dependencies.teardown();
    await this.dependencies.release();
  }

  private handleRetryError(error: unknown): void {
    if (error instanceof LockAuthorityUnavailableError) return;
    log.error('[SYNC] Failed to retry real-time subscriptions', {
      error: getErrorMessage(error),
    });
  }
}
