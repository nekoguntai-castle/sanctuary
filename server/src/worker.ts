/**
 * Sanctuary Background Worker
 *
 * Dedicated process for background operations that run independently
 * of the main API server. This worker handles:
 *
 * - Persistent Electrum subscriptions for real-time transaction detection
 * - Wallet synchronization job processing
 * - Notification delivery (Telegram, Push) with retries
 * - Transaction confirmation updates
 *
 * Features:
 * - Automatic Electrum reconnection with exponential backoff
 * - BullMQ job queue with distributed locking
 * - Health check endpoint for container orchestration
 * - Graceful shutdown handling
 */

// Initialize OpenTelemetry tracing FIRST
import { initializeOpenTelemetry } from './utils/tracing/otel';
const otelPromise = initializeOpenTelemetry();

import os from 'node:os';
import {
  SYNC_PRIORITY_BULLMQ_PRIORITY,
  type SyncPriority,
} from '@sanctuary/shared/constants/sync';
import { getConfig } from './config';
import { createLogger } from './utils/logger';
import { getErrorMessage } from './utils/errors';
import { registerFatalProcessHandlers } from './utils/fatalProcessHandlers';
import { exitNow } from './utils/processExit';
// Initialize Prometheus metrics collection for the worker process
import { metricsService } from './observability/metrics/registry';
import { updateJobQueueMetrics } from './observability/metrics/helpers';
import { connectWithRetry, disconnect } from './models/prisma';
import {
  getDistributedEventBus,
  initializeDistributedLock,
  initializeRedis,
  isRedisConnected,
  shutdownDistributedLock,
  shutdownNotificationDispatcher,
  shutdownRedis,
} from './infrastructure';
import { WorkerJobQueue } from './worker/workerJobQueue';
import { ElectrumSubscriptionManager, type BitcoinNetwork } from './worker/electrumManager';
import { startHealthServer, type HealthServerHandle } from './worker/healthServer';
import { registerWorkerJobs } from './worker/jobs';
import { featureFlagService } from './services/featureFlagService';
import {
  RECURRING_SCHEDULE_RECONCILIATION_INTERVAL_MS,
  RecurringScheduleCoordinator,
  inspectRecurringScheduleHealth,
  type RecurringScheduleHealth,
} from './worker/recurringSchedules';

const log = createLogger('WORKER');

// =============================================================================
// Global State
// =============================================================================

let jobQueue: WorkerJobQueue | null = null;
let electrumManager: ElectrumSubscriptionManager | null = null;
let healthServer: HealthServerHandle | null = null;
let reconciliationTimer: NodeJS.Timeout | null = null;
let scheduleReconciliationTimer: NodeJS.Timeout | null = null;
let metricsTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let shutdownExitCode: 0 | 1 = 0;
let recurringScheduleCoordinator: RecurringScheduleCoordinator | null = null;
let workerStartedAt = 0;

// Reconciliation interval - clean up stale subscriptions every 15 minutes
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;

function toBullPriority(priority: SyncPriority): number {
  return SYNC_PRIORITY_BULLMQ_PRIORITY[priority];
}

// =============================================================================
// Worker Startup
// =============================================================================

async function startWorker(): Promise<void> {
  log.info('Starting Sanctuary Background Worker...');
  const config = getConfig();

  // Wait for OTEL initialization
  await otelPromise;

  // Connect to database
  log.info('Connecting to database...');
  await connectWithRetry();
  log.info('Database connected');

  // Initialize Redis (required for worker)
  log.info('Connecting to Redis...');
  await initializeRedis();
  if (!isRedisConnected()) {
    throw new Error('Redis is required for worker - check REDIS_URL');
  }
  initializeDistributedLock('redis-required');
  log.info('Redis connected');

  // Initialize job queue
  log.info('Initializing job queue...');
  const workerConcurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

  jobQueue = new WorkerJobQueue({
    concurrency: workerConcurrency,
    queues: ['sync', 'notifications', 'confirmations', 'maintenance'],
  });
  await jobQueue.initialize();

  // Register job handlers
  registerWorkerJobs(jobQueue);
  log.info('Job handlers registered', {
    jobs: jobQueue.getRegisteredJobs(),
  });

  // Initialize feature flag service (requires Redis + Prisma, both ready at this point)
  await featureFlagService.initialize();
  recurringScheduleCoordinator = new RecurringScheduleCoordinator(
    jobQueue,
    config,
    async () => ({
      autopilotEnabled: await featureFlagService.isEnabled('treasuryAutopilot'),
      intelligenceEnabled: await featureFlagService.isEnabled(
        'treasuryIntelligence',
      ),
    }),
  );

  // Subscribe to feature flag changes for dynamic job scheduling
  const bus = getDistributedEventBus();
  bus.on('system:featureFlag.changed', async ({ key }) => {
    if (!jobQueue) return;

    if (
      key === 'treasuryAutopilot' ||
      key === 'treasuryIntelligence'
    ) {
      await reconcileApplicableRecurringSchedules(false);
    }
  });

  // Initialize Electrum subscription manager
  log.info('Starting Electrum subscription manager...');
  electrumManager = new ElectrumSubscriptionManager({
    onNewBlock: handleNewBlock,
    onAddressActivity: handleAddressActivity,
  });
  await electrumManager.start();

  workerStartedAt = Date.now();
  setupStaleWalletHandler();
  await reconcileApplicableRecurringSchedules(true);

  // Start health server only after required schedules are present.
  const healthPort = parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);
  const workerHostname = os.hostname();
  healthServer = startHealthServer({
    port: healthPort,
    healthProvider: {
      getHealth: async () => {
        const scheduleHealth = await getRecurringScheduleHealth();
        const jobQueueHealthy =
          (jobQueue?.isHealthy() ?? false) && scheduleHealth.healthy;

        return {
          redis: isRedisConnected(),
          electrum: electrumManager?.isConnected() ?? false,
          jobQueue: jobQueueHealthy,
          recurringSchedules: scheduleHealth.healthy,
        };
      },
      getMetrics: async () => {
        const queueHealth = await jobQueue?.getHealth();
        const electrumMetrics = electrumManager?.getHealthMetrics();
        const scheduleHealth = await getRecurringScheduleHealth();

        return {
          worker: {
            hostname: workerHostname,
            pid: process.pid,
            startedAt: new Date(workerStartedAt).toISOString(),
            concurrency: workerConcurrency,
            electrumSubscriptionOwner: electrumMetrics?.isRunning ?? false,
          },
          queues: queueHealth?.queues ?? {},
          electrum: {
            isRunning: electrumMetrics?.isRunning ?? false,
            ownershipRetryActive: electrumMetrics?.ownershipRetryActive ?? false,
            subscribedAddresses: electrumMetrics?.totalSubscribedAddresses ?? 0,
            networks: electrumMetrics?.networks ?? {},
          },
          jobCompletions: jobQueue?.getJobCompletionTimes() ?? {},
          recurringSchedules: scheduleHealth,
        };
      },
    },
  });

  // Initialize Prometheus metrics service
  metricsService.initialize();

  // Periodically update job queue depth metrics for Prometheus
  metricsTimer = setInterval(async () => {
    if (isShuttingDown || !jobQueue) return;
    try {
      const health = await jobQueue.getHealth();
      for (const [queue, stats] of Object.entries(health.queues)) {
        updateJobQueueMetrics(queue, stats.waiting, stats.active, stats.delayed, stats.failed);
      }
    } catch (error) {
      log.debug('Metrics update failed (best-effort)', { error: getErrorMessage(error) });
    }
  }, 15_000);

  startScheduleReconciliationTimer();

  // Start periodic reconciliation of subscriptions
  // This cleans up addresses from deleted wallets and subscribes to new ones
  startReconciliationTimer();

  // Queue an immediate stale-wallet check to catch transactions that arrived
  // during the startup window before Electrum subscriptions were active
  await jobQueue.addJob('sync', 'check-stale-wallets', {
    maxWallets: config.sync.startupCatchUpBatchSize,
    priority: 'normal',
    staggerDelayMs: config.sync.startupCatchUpStaggerDelayMs,
    reason: 'startup-catch-up',
  }, {
    delay: config.sync.startupCatchUpDelayMs,
    jobId: `startup-catch-up:${Date.now()}`,
  });

  log.info('Sanctuary Background Worker started successfully', {
    healthPort,
    concurrency: workerConcurrency,
    network: config.bitcoin.network,
    reconciliationInterval: `${RECONCILIATION_INTERVAL_MS / 60000}m`,
  });
}

/**
 * Start the periodic reconciliation timer
 */
function startReconciliationTimer(): void {
  // Run reconciliation periodically
  reconciliationTimer = setInterval(async () => {
    if (isShuttingDown || !electrumManager) return;

    try {
      await electrumManager.reconcileSubscriptions();
    } catch (error) {
      log.error('Subscription reconciliation failed', {
        error: getErrorMessage(error),
      });
    }
  }, RECONCILIATION_INTERVAL_MS);

  log.info('Subscription reconciliation timer started', {
    interval: `${RECONCILIATION_INTERVAL_MS / 60000}m`,
  });
}

// =============================================================================
// Event Handlers
// =============================================================================

/**
 * Handle new block event from Electrum
 */
function handleNewBlock(network: BitcoinNetwork, height: number, hash: string): void {
  log.info(`New block on ${network}: ${height}`);

  // Queue confirmation update job
  jobQueue?.addJob('confirmations', 'update-confirmations', {
    height,
    hash,
  }, {
    priority: 1, // High priority
    jobId: `confirmations:${height}`, // Deduplicate by height
  }).catch(err => {
    log.error('Failed to queue confirmation update job', {
      error: getErrorMessage(err),
      height,
      network,
    });
  });
}

/**
 * Handle address activity event from Electrum
 */
function handleAddressActivity(network: BitcoinNetwork, walletId: string, address: string): void {
  log.info(`Address activity on ${network}: ${address} (wallet: ${walletId})`);

  // Queue high-priority sync job
  jobQueue?.addJob('sync', 'sync-wallet', {
    walletId,
    priority: 'high',
    reason: `address_activity:${address}`,
  }, {
    priority: 1, // High priority
    jobId: `sync:${walletId}:${Date.now()}`, // Allow multiple syncs
  }).catch(err => {
    log.error('Failed to queue sync job', {
      error: getErrorMessage(err),
      walletId,
      address,
      network,
    });
  });
}

// =============================================================================
// Scheduled Jobs
// =============================================================================

async function scheduleRecurringJobs(): Promise<void> {
  await reconcileApplicableRecurringSchedules(false);
}

// Test-only hook to exercise recurring job scheduling guard branches.
export async function __testOnlyScheduleRecurringJobs(): Promise<void> {
  await scheduleRecurringJobs();
}

async function reconcileApplicableRecurringSchedules(
  failStartup: boolean,
): Promise<void> {
  if (!recurringScheduleCoordinator) return;
  const result = await recurringScheduleCoordinator.reconcile();
  if (result.healthy) return;

  const failed = [
    ...failedScheduleIds(result.results),
    ...failedScheduleIds(result.removals),
  ];
  if (failStartup) {
    throw new Error(`Required recurring schedule reconciliation failed: ${failed.join(', ')}`);
  }
  log.error('Recurring schedule reconciliation failed', { failed });
}

function failedScheduleIds(
  results: Record<string, { status: string }>,
): string[] {
  return Object.entries(results)
    .filter(([, result]) => result.status === 'failed')
    .map(([schedulerId]) => schedulerId);
}

async function getRecurringScheduleHealth(): Promise<RecurringScheduleHealth> {
  if (!jobQueue || !recurringScheduleCoordinator) {
    return {
      healthy: false,
      missing: [],
      mismatched: [],
      stale: [],
      unexpected: [],
      inspectionFailures: [],
      reconciliationFailed: true,
    };
  }
  const state = recurringScheduleCoordinator.getState();
  return inspectRecurringScheduleHealth(
    jobQueue,
    state.desired,
    jobQueue.getJobCompletionTimes(),
    workerStartedAt,
    Date.now(),
    state.forbidden,
    state.reconciliationHealthy,
  );
}

function startScheduleReconciliationTimer(): void {
  scheduleReconciliationTimer = setInterval(() => {
    if (isShuttingDown) return;
    void reconcileApplicableRecurringSchedules(false).catch((error) => {
      log.error('Recurring schedule reconciliation failed', {
        error: getErrorMessage(error),
      });
    });
  }, RECURRING_SCHEDULE_RECONCILIATION_INTERVAL_MS);
}

/**
 * Set up handler for stale wallet check results.
 *
 * Listens for completed `check-stale-wallets` jobs and queues individual
 * `sync-wallet` jobs for each stale wallet returned.
 */
function setupStaleWalletHandler(): void {
  if (!jobQueue) return;

  jobQueue.onJobCompleted('sync', 'check-stale-wallets', async (returnvalue) => {
    if (isShuttingDown) return;

    const result = returnvalue as {
      staleWalletIds?: string[];
      queued?: number;
      priority?: SyncPriority;
      staggerDelayMs?: number;
      reason?: string;
    } | undefined;
    if (!result?.staleWalletIds?.length) return;

    log.info(`Queueing sync for ${result.staleWalletIds.length} stale wallets`);

    const config = getConfig();
    const priority = result.priority ?? 'low';
    const staggerDelayMs = result.staggerDelayMs ?? config.sync.syncStaggerDelayMs;
    const reason = result.reason ?? 'stale';
    await jobQueue!.addBulkJobs('sync', result.staleWalletIds.map((walletId, index) => ({
      name: 'sync-wallet',
      data: { walletId, priority, reason },
      options: {
        priority: toBullPriority(priority),
        jobId: `sync:stale:${walletId}:${Date.now()}`,
        delay: index * staggerDelayMs,
      },
    })));
  });
}

// =============================================================================
// Graceful Shutdown
// =============================================================================

async function shutdown(signal: string, exitCode: 0 | 1 = 0): Promise<void> {
  if (isShuttingDown) {
    if (exitCode === 1) {
      shutdownExitCode = 1;
    }
    return;
  }
  isShuttingDown = true;
  shutdownExitCode = exitCode;

  log.info(`${signal} received, shutting down worker...`);

  // Stop timers
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }
  if (scheduleReconciliationTimer) {
    clearInterval(scheduleReconciliationTimer);
    scheduleReconciliationTimer = null;
  }
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }

  // Stop health server first
  if (healthServer) {
    try {
      await healthServer.close();
    } catch (err) {
      log.error('Error closing health server', { error: getErrorMessage(err) });
    }
  }

  // Stop Electrum subscriptions
  if (electrumManager) {
    try {
      await electrumManager.stop();
    } catch (err) {
      log.error('Error stopping Electrum manager', { error: getErrorMessage(err) });
    }
  }

  // Drain job queue
  if (jobQueue) {
    try {
      await jobQueue.shutdown();
    } catch (err) {
      log.error('Error shutting down job queue', { error: getErrorMessage(err) });
    }
  }

  // Shutdown notification dispatcher queue
  try {
    await shutdownNotificationDispatcher();
  } catch (err) {
    log.error('Error shutting down notification dispatcher', { error: getErrorMessage(err) });
  }

  // Shutdown distributed locking
  shutdownDistributedLock();

  // Close Redis
  try {
    await shutdownRedis();
  } catch (err) {
    log.error('Error shutting down Redis', { error: getErrorMessage(err) });
  }

  // Close database
  try {
    await disconnect();
  } catch (err) {
    log.error('Error disconnecting database', { error: getErrorMessage(err) });
  }

  log.info('Worker shutdown complete');
  exitNow(shutdownExitCode);
}

// =============================================================================
// Main
// =============================================================================

// Start the worker
startWorker().catch((error) => {
  log.error('Worker startup failed', { error: error.message, stack: error.stack });
  exitNow(1);
});

// Graceful shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
registerFatalProcessHandlers({ log, shutdown, exitNow });
