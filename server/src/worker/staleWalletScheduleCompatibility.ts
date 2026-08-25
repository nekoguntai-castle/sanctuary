import type { CombinedConfig } from '../config';
import {
  CHECK_STALE_WALLETS_JOB_NAME,
  SYNC_JOB_CONTRACT_VERSION,
  SYNC_QUEUE_NAME,
  hasSupportedSyncJobContractVersion,
  type CheckStaleWalletsJobData,
  type CheckStaleWalletsResult,
} from '../jobs/syncJobContract';
import {
  readStaleWalletSchedulePolicy,
  readStaleWalletSchedulePolicyWithClient,
} from '../repositories/walletSyncSchedulePolicyRepository';
import { withWalletSyncRetirementLock } from '../repositories/walletSyncRetirementLock';
import { syncIntentAdmission } from '../services/sync/syncIntentAdmission';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';
import type { WorkerJobQueue } from './workerJobQueue';
import type { RecurringScheduleDefinition } from './workerJobQueue';

const log = createLogger('WORKER:STALE_COMPAT');
const ADMISSION_CONCURRENCY = 5;

export type WithStaleWalletRetirementLock = <T>(
  operation: (forbidden: boolean) => Promise<T>,
) => Promise<T>;

export const withStaleWalletRetirementLock: WithStaleWalletRetirementLock = (
  operation,
) => withWalletSyncRetirementLock(async (tx) => {
  const policy = await readStaleWalletSchedulePolicyWithClient(tx);
  return operation(policy.mode === 'forbidden');
});

export function buildStaleWalletCompatibilitySchedule(
  config: CombinedConfig,
): RecurringScheduleDefinition<CheckStaleWalletsJobData> {
  const intervalMs = config.sync.intervalMs;
  const maxAgeMs = intervalMs * 2;
  const startupGraceMs = intervalMs + 30_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error('Recurring interval must be a safe integer of at least 1000ms');
  }
  if (!Number.isSafeInteger(maxAgeMs) || !Number.isSafeInteger(startupGraceMs)) {
    throw new Error('Recurring freshness interval exceeds the safe integer range');
  }
  return {
    schedulerId: `${SYNC_QUEUE_NAME}:${CHECK_STALE_WALLETS_JOB_NAME}`,
    queue: SYNC_QUEUE_NAME,
    name: CHECK_STALE_WALLETS_JOB_NAME,
    data: { version: SYNC_JOB_CONTRACT_VERSION },
    recurrence: { every: intervalMs },
    freshness: { maxAgeMs, startupGraceMs },
  };
}

export function requireStaleWalletCompatibilitySchedule(
  schedules: readonly RecurringScheduleDefinition[],
): RecurringScheduleDefinition {
  const expected = `${SYNC_QUEUE_NAME}:${CHECK_STALE_WALLETS_JOB_NAME}`;
  const schedule = schedules.find(({ schedulerId }) => schedulerId === expected);
  if (!schedule) throw new Error('Stale-wallet schedule definition is missing');
  return schedule;
}

export async function isStaleWalletScheduleForbidden(): Promise<boolean> {
  return (await readStaleWalletSchedulePolicy()).mode === 'forbidden';
}

export async function enqueueStaleWalletStartupCompatibility(
  queue: WorkerJobQueue,
  config: CombinedConfig,
  withRetirementLock: WithStaleWalletRetirementLock = withStaleWalletRetirementLock,
): Promise<void> {
  await withRetirementLock(async (forbidden) => {
    if (forbidden) return;
    await queue.addJob<CheckStaleWalletsJobData>(
      SYNC_QUEUE_NAME,
      CHECK_STALE_WALLETS_JOB_NAME,
      {
        version: SYNC_JOB_CONTRACT_VERSION,
        maxWallets: config.sync.startupCatchUpBatchSize,
        priority: 'normal',
        staggerDelayMs: config.sync.startupCatchUpStaggerDelayMs,
        reason: 'startup-catch-up',
      },
      {
        delay: config.sync.startupCatchUpDelayMs,
        jobId: `startup-catch-up:${Date.now()}`,
      },
    );
  });
}

async function admitRetainedStaleWallets(walletIds: string[]): Promise<void> {
  for (let offset = 0; offset < walletIds.length; offset += ADMISSION_CONCURRENCY) {
    if (await isStaleWalletScheduleForbidden()) return;
    const page = walletIds.slice(offset, offset + ADMISSION_CONCURRENCY);
    await Promise.all(page.map(async walletId => {
      try {
        const result = await syncIntentAdmission.requestRetainedStale(walletId);
        if (result.status === 'blocked'
          || (('wakeup' in result) && result.wakeup === 'unavailable')) {
          log.warn('Retained stale-wallet intent deferred to durable recovery', {
            walletId,
            status: result.status,
          });
        }
      } catch (error) {
        log.error('Failed to persist retained stale-wallet sync intent', {
          walletId,
          error: getErrorMessage(error),
        });
      }
    }));
  }
}

export function registerStaleWalletCompletionCompatibility(
  queue: WorkerJobQueue,
  isShuttingDown: () => boolean,
): void {
  queue.onJobCompleted(
    SYNC_QUEUE_NAME,
    CHECK_STALE_WALLETS_JOB_NAME,
    async (returnvalue) => {
      if (isShuttingDown()) return;
      if (!hasSupportedSyncJobContractVersion(returnvalue)) {
        log.warn('Ignoring check-stale-wallets result with an unsupported contract version');
        return;
      }
      const result = returnvalue as Partial<CheckStaleWalletsResult> | undefined;
      if (!result?.staleWalletIds?.length) return;
      if (await isStaleWalletScheduleForbidden()) {
        log.warn('Ignoring stale-wallet completion after durable scheduler retirement');
        return;
      }
      await admitRetainedStaleWallets(result.staleWalletIds);
    },
  );
}
