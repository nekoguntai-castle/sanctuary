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
import { getConfig } from './config';
import { createLogger } from './utils/logger';
import { getErrorMessage } from './utils/errors';
// Initialize Prometheus metrics collection for the worker process
import { metricsService } from './observability/metrics/registry';
import { updateJobQueueMetrics } from './observability/metrics/helpers';
import { connectWithRetry, disconnect } from './models/prisma';
import { initializeRedis, shutdownRedis, isRedisConnected, shutdownDistributedLock, getDistributedEventBus, shutdownNotificationDispatcher } from './infrastructure';
import { WorkerJobQueue } from './worker/workerJobQueue';
import { ElectrumSubscriptionManager, type BitcoinNetwork } from './worker/electrumManager';
import { startHealthServer, type HealthServerHandle } from './worker/healthServer';
import { registerWorkerJobs } from './worker/jobs';
import { featureFlagService } from './services/featureFlagService';

const log = createLogger('WORKER');

// =============================================================================
// Global State
// =============================================================================

let jobQueue: WorkerJobQueue | null = null;
let electrumManager: ElectrumSubscriptionManager | null = null;
let healthServer: HealthServerHandle | null = null;
let reconciliationTimer: NodeJS.Timeout | null = null;
let metricsTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;

// Reconciliation interval - clean up stale subscriptions every 15 minutes
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;

function toBullPriority(priority: 'high' | 'normal' | 'low'): number {
  switch (priority) {
    case 'high':
      return 1;
    case 'normal':
      return 2;
    case 'low':
    default:
      return 3;
  }
}

// =============================================================================
// Exception Handlers
// =============================================================================

process.on('uncaughtException', (error: Error) => {
  log.error('Uncaught exception - worker will exit', {
    error: error.message,
    stack: error.stack,
  });
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason: unknown) => {
  log.error('Unhandled promise rejection in worker', {
    reason: getErrorMessage(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

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

  // Subscribe to feature flag changes for dynamic job scheduling
  const bus = getDistributedEventBus();
  bus.on('system:featureFlag.changed', async ({ key, enabled }) => {
    if (!jobQueue) return;

    if (key === 'treasuryAutopilot') {
      if (enabled) {
        await scheduleAutopilotJobs();
      } else {
        await removeAutopilotJobs();
      }
    }

    if (key === 'treasuryIntelligence') {
      if (enabled) {
        await scheduleIntelligenceJobs();
      } else {
        await removeIntelligenceJobs();
      }
    }
  });

  // Initialize Electrum subscription manager
  log.info('Starting Electrum subscription manager...');
  electrumManager = new ElectrumSubscriptionManager({
    onNewBlock: handleNewBlock,
    onAddressActivity: handleAddressActivity,
  });
  await electrumManager.start();

  // Start health server
  const healthPort = parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);
  const workerStartedAt = Date.now();
  const workerHostname = os.hostname();
  healthServer = startHealthServer({
    port: healthPort,
    healthProvider: {
      getHealth: async () => {
        const syncIntervalMs = config.sync.intervalMs;
        const staleThresholdMs = syncIntervalMs * 2;
        const startupGraceMs = syncIntervalMs + 30_000; // Allow for startup delay + first run

        let jobQueueHealthy = jobQueue?.isHealthy() ?? false;

        // After the startup grace period, check that check-stale-wallets
        // has completed within 2x its expected interval
        if (jobQueueHealthy && Date.now() - workerStartedAt > startupGraceMs) {
          const completions = jobQueue?.getJobCompletionTimes() ?? {};
          const lastStaleCheck = completions['sync:check-stale-wallets'];
          if (lastStaleCheck !== undefined && Date.now() - lastStaleCheck > staleThresholdMs) {
            log.warn('check-stale-wallets job is stale', {
              lastCompletedAgo: `${Math.round((Date.now() - lastStaleCheck) / 1000)}s`,
              threshold: `${Math.round(staleThresholdMs / 1000)}s`,
            });
            jobQueueHealthy = false;
          }
        }

        return {
          redis: isRedisConnected(),
          electrum: electrumManager?.isConnected() ?? false,
          jobQueue: jobQueueHealthy,
        };
      },
      getMetrics: async () => {
        const queueHealth = await jobQueue?.getHealth();
        const electrumMetrics = electrumManager?.getHealthMetrics();

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

  // Schedule recurring jobs
  await scheduleRecurringJobs();

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
  if (!jobQueue) return;

  const config = getConfig();

  // Check for stale wallets every 5 minutes
  // Use config sync interval converted to cron
  const syncIntervalMs = config.sync.intervalMs;
  const syncIntervalMinutes = Math.max(1, Math.floor(syncIntervalMs / 60000));

  await jobQueue.scheduleRecurring(
    'sync',
    'check-stale-wallets',
    {},
    `*/${syncIntervalMinutes} * * * *` // Every N minutes
  );

  // Update confirmations every 2 minutes
  const confirmationIntervalMs = config.sync.confirmationUpdateIntervalMs;
  const confirmationIntervalMinutes = Math.max(1, Math.floor(confirmationIntervalMs / 60000));

  await jobQueue.scheduleRecurring(
    'confirmations',
    'update-all-confirmations',
    {},
    `*/${confirmationIntervalMinutes} * * * *` // Every N minutes
  );

  log.info('Recurring jobs scheduled', {
    staleCheckInterval: `${syncIntervalMinutes}m`,
    confirmationUpdateInterval: `${confirmationIntervalMinutes}m`,
  });

  // Maintenance jobs (cron-based)
  await jobQueue.scheduleRecurring(
    'maintenance',
    'cleanup:expired-drafts',
    {},
    '0 * * * *' // Hourly
  );

  await jobQueue.scheduleRecurring(
    'maintenance',
    'cleanup:expired-transfers',
    {},
    '30 * * * *' // Hourly, 30 minutes past
  );

  await jobQueue.scheduleRecurring(
    'maintenance',
    'cleanup:audit-logs',
    { retentionDays: config.maintenance.auditLogRetentionDays },
    '0 2 * * *' // Daily 2 AM
  );

  await jobQueue.scheduleRecurring(
    'maintenance',
    'cleanup:price-data',
    { retentionDays: config.maintenance.priceDataRetentionDays },
    '0 3 * * *' // Daily 3 AM
  );

  await jobQueue.scheduleRecurring(
    'maintenance',
    'cleanup:fee-estimates',
    { retentionDays: config.maintenance.feeEstimateRetentionDays },
    '0 4 * * *' // Daily 4 AM
  );

  await jobQueue.scheduleRecurring(
    'maintenance',
    'cleanup:expired-tokens',
    {},
    '0 5 * * *' // Daily 5 AM
  );

  await jobQueue.scheduleRecurring(
    'maintenance',
    'maintenance:weekly-vacuum',
    {},
    '0 3 * * 0' // Sunday 3 AM
  );

  await jobQueue.scheduleRecurring(
    'maintenance',
    'maintenance:monthly-cleanup',
    {},
    '0 4 1 * *' // 1st of month 4 AM
  );

  // Scheduled backup - daily at 1 AM (before cleanup jobs)
  await jobQueue.scheduleRecurring(
    'maintenance',
    'backup:scheduled',
    { retentionCount: 7 },
    '0 1 * * *' // Daily 1 AM
  );

  // Treasury Autopilot jobs (behind feature flag — uses DB-backed service for runtime toggling)
  const autopilotEnabled = await featureFlagService.isEnabled('treasuryAutopilot');
  if (autopilotEnabled) {
    await scheduleAutopilotJobs();
  } else {
    // Ensure no stale autopilot jobs remain from a previous run where the flag was enabled
    await removeAutopilotJobs();
  }

  // Treasury Intelligence jobs (behind feature flag)
  const intelligenceEnabled = await featureFlagService.isEnabled('treasuryIntelligence');
  if (intelligenceEnabled) {
    await scheduleIntelligenceJobs();
  } else {
    await removeIntelligenceJobs();
  }

  // Set up job result handler for stale wallet check
  // This queues individual sync jobs for each stale wallet
  setupStaleWalletHandler();
}

// Test-only hook to exercise recurring job scheduling guard branches.
export async function __testOnlyScheduleRecurringJobs(): Promise<void> {
  await scheduleRecurringJobs();
}

/**
 * Schedule Treasury Autopilot recurring jobs
 */
async function scheduleAutopilotJobs(): Promise<void> {
  if (!jobQueue) return;

  await jobQueue.scheduleRecurring(
    'maintenance',
    'autopilot:record-fees',
    {},
    '*/10 * * * *' // Every 10 minutes
  );

  await jobQueue.scheduleRecurring(
    'maintenance',
    'autopilot:evaluate',
    {},
    '5/10 * * * *' // Every 10 minutes, offset by 5
  );

  log.info('Treasury Autopilot jobs scheduled');
}

/**
 * Remove Treasury Autopilot recurring jobs and purge queued instances
 */
async function removeAutopilotJobs(): Promise<void> {
  if (!jobQueue) return;

  await jobQueue.removeRecurring('maintenance', 'autopilot:record-fees', { purgeQueued: true });
  await jobQueue.removeRecurring('maintenance', 'autopilot:evaluate', { purgeQueued: true });

  log.info('Treasury Autopilot jobs removed');
}

/**
 * Schedule Treasury Intelligence recurring jobs
 */
async function scheduleIntelligenceJobs(): Promise<void> {
  if (!jobQueue) return;

  await jobQueue.scheduleRecurring(
    'maintenance',
    'intelligence:analyze',
    {},
    '*/30 * * * *' // Every 30 minutes
  );

  await jobQueue.scheduleRecurring(
    'maintenance',
    'intelligence:cleanup',
    {},
    '0 6 * * *' // Daily at 6 AM
  );

  log.info('Treasury Intelligence jobs scheduled');
}

/**
 * Remove Treasury Intelligence recurring jobs and purge queued instances
 */
async function removeIntelligenceJobs(): Promise<void> {
  if (!jobQueue) return;

  await jobQueue.removeRecurring('maintenance', 'intelligence:analyze', { purgeQueued: true });
  await jobQueue.removeRecurring('maintenance', 'intelligence:cleanup', { purgeQueued: true });

  log.info('Treasury Intelligence jobs removed');
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
      priority?: 'high' | 'normal' | 'low';
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

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`${signal} received, shutting down worker...`);

  // Stop timers
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
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
  process.exit(0);
}

// =============================================================================
// Main
// =============================================================================

// Start the worker
startWorker().catch((error) => {
  log.error('Worker startup failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

// Graceful shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
