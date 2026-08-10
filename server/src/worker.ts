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
import {
  connectWithRetry,
  disconnect,
  getLastDatabaseHealth,
  startDatabaseHealthCheck,
  stopDatabaseHealthCheck,
} from './models/prisma';
import {
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
import { circuitBreakerRegistry } from './services/circuitBreaker';
import { buildWorkerDiagnosticsSnapshot } from './worker/diagnostics/snapshot';
import {
  RECURRING_SCHEDULE_RECONCILIATION_INTERVAL_MS,
  RecurringScheduleCoordinator,
  inspectRecurringScheduleHealth,
  type RecurringScheduleHealth,
} from './worker/recurringSchedules';
import {
  initializeNotificationTelemetry,
  getNotificationTelemetryLocalHealth,
  shutdownNotificationTelemetry,
} from './services/notifications/telemetry';
import { shutdownNotificationDeadLetterAggregateWriter } from './services/notifications/deadLetterAggregates';
import { getTelegramTransportDiagnostics } from './services/telegram/api';
import { WorkerHeartbeatWriter } from './services/workerHeartbeatRegistry';
import type { WorkerDiagnosticsResponse } from './internal/workerDiagnostics/protocol';
import { startCaptureParticipant, stopCaptureParticipant } from './services/supportPackage/captureRuntime';

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
let diagnosticHeartbeat: WorkerHeartbeatWriter | null = null;

// Reconciliation interval - clean up stale subscriptions every 15 minutes
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;

function toBullPriority(priority: SyncPriority): number {
  return SYNC_PRIORITY_BULLMQ_PRIORITY[priority];
}

function getWorkerDiagnosticsSnapshot(
  workerConcurrency: number,
): WorkerDiagnosticsResponse {
  const electrumMetrics = electrumManager?.getHealthMetrics();
  const telegramHealth = circuitBreakerRegistry.get('telegram')?.getHealth();
  const telegramTransport = getTelegramTransportDiagnostics();
  return buildWorkerDiagnosticsSnapshot({
    workerStartedAt,
    concurrency: workerConcurrency,
    redisConnected: isRedisConnected(),
    databaseConnected: getLastDatabaseHealth() ?? undefined,
    notificationTelemetryWriter: getNotificationTelemetryLocalHealth(),
    notificationConsumerRunning:
      jobQueue?.isQueueWorkerRunning('notifications') ?? false,
    transactionHandlerRegistered:
      jobQueue?.hasRegisteredHandler('notifications', 'transaction-notify') ?? false,
    electrum: {
      managerRunning: electrumMetrics?.isRunning ?? false,
      connected: electrumManager?.isConnected() ?? false,
      subscriptionOwner: electrumMetrics?.isRunning ?? false,
      subscribedAddresses: electrumMetrics?.totalSubscribedAddresses ?? 0,
    },
    telegramCircuit: telegramHealth
      ? {
          state: telegramHealth.state,
          failures: telegramHealth.failures,
          totalRequests: telegramHealth.totalRequests,
          lastFailure: telegramTransport.lastFailureAt,
          lastSuccess: telegramTransport.lastSuccessAt,
          lastFailureClass: telegramTransport.lastFailureClass,
        }
      : undefined,
  });
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
  startDatabaseHealthCheck();
  log.info('Database connected');

  // Initialize Redis (required for worker)
  log.info('Connecting to Redis...');
  await initializeRedis();
  if (!isRedisConnected()) {
    throw new Error('Redis is required for worker - check REDIS_URL');
  }
  initializeDistributedLock('redis-required');
  initializeNotificationTelemetry('worker');
  log.info('Redis connected');

  // Observe capture arms before BullMQ can consume any retained notification jobs.
  await startCaptureParticipant('notification-worker');

  // Initialize job queue
  log.info('Initializing job queue...');
  const workerConcurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

  jobQueue = new WorkerJobQueue({
    concurrency: workerConcurrency,
    queues: ['sync', 'notifications', 'confirmations', 'maintenance'],
    autorun: false,
  });

  // Register handlers before BullMQ workers start consuming retained jobs.
  registerWorkerJobs(jobQueue);
  await jobQueue.initialize();
  log.info('Job handlers registered', {
    jobs: jobQueue.getRegisteredJobs(),
  });

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
  // Worker acknowledgement follows snapshot installation and schedule convergence.
  featureFlagService.configureRuntime(
    'worker',
    reconcileApplicableRecurringSchedules,
  );
  await featureFlagService.initialize();
  // Retained jobs can execute only after the durable feature snapshot is
  // installed, conditional schedules converge, and the worker acknowledges it.
  jobQueue.startConsumers();

  // Initialize Electrum subscription manager
  log.info('Starting Electrum subscription manager...');
  electrumManager = new ElectrumSubscriptionManager({
    onNewBlock: handleNewBlock,
    onAddressActivity: handleAddressActivity,
  });
  await electrumManager.start();

  workerStartedAt = Date.now();
  setupStaleWalletHandler();

  // Start health server only after required schedules are present.
  const healthPort = parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);
  const workerHostname = os.hostname();
  healthServer = startHealthServer({
    port: healthPort,
    diagnostics: {
      secret: config.worker.diagnosticsSecret ?? '',
      timeoutMs: config.worker.diagnosticsTimeoutMs ?? 3000,
      maxBodyBytes: config.worker.diagnosticsMaxBodyBytes ?? 1024,
      maxConcurrentRequests: config.worker.diagnosticsMaxConcurrentRequests ?? 2,
      authWindowMs: config.worker.diagnosticsAuthWindowMs ?? 60_000,
      getSnapshot: () => getWorkerDiagnosticsSnapshot(workerConcurrency),
    },
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
          jobCompletions: scheduleHealth.completionTimes,
          recurringSchedules: scheduleHealth,
        };
      },
    },
  });
  diagnosticHeartbeat = new WorkerHeartbeatWriter(
    () => getWorkerDiagnosticsSnapshot(workerConcurrency),
  );
  diagnosticHeartbeat.start();

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
  await reconcileApplicableRecurringSchedules();
}

// Test-only hook to exercise recurring job scheduling guard branches.
export async function __testOnlyScheduleRecurringJobs(): Promise<void> {
  await scheduleRecurringJobs();
}

async function reconcileApplicableRecurringSchedules(): Promise<void> {
  if (!recurringScheduleCoordinator) return;
  const result = await recurringScheduleCoordinator.reconcile();
  if (result.healthy) return;

  const failed = [
    ...failedScheduleIds(result.results),
    ...failedScheduleIds(result.removals),
  ];
  throw new Error(
    `Required recurring schedule reconciliation failed: ${failed.join(', ') || 'unknown schedule'}`,
  );
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
      heartbeatHealthy: false,
      completionTimes: {},
    };
  }
  const state = recurringScheduleCoordinator.getState();
  return inspectRecurringScheduleHealth(
    jobQueue,
    state.desired,
    Date.now(),
    state.forbidden,
    state.reconciliationHealthy,
    workerStartedAt,
  );
}

function startScheduleReconciliationTimer(): void {
  scheduleReconciliationTimer = setInterval(() => {
    if (isShuttingDown) return;
    void reconcileApplicableRecurringSchedules().catch((error) => {
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
  try {
    await stopCaptureParticipant();
  } catch (err) {
    log.error('Error closing support capture participant', { error: getErrorMessage(err) });
  }

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

  if (diagnosticHeartbeat) {
    await diagnosticHeartbeat.stop();
    diagnosticHeartbeat = null;
  }

  // Close the isolated best-effort telemetry connection before shared Redis.
  await shutdownNotificationTelemetry();
  shutdownNotificationDeadLetterAggregateWriter();

  // Close Redis
  try {
    featureFlagService.shutdownRuntime();
    await shutdownRedis();
  } catch (err) {
    log.error('Error shutting down Redis', { error: getErrorMessage(err) });
  }

  // Close database
  try {
    stopDatabaseHealthCheck();
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
