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
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from './constants/walletSyncActivation';
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
import { initializeRedisBridge, shutdownRedisBridge } from './websocket/redisBridge';
import {
  createProductionWalletSyncRecoveryRuntime,
  type WalletSyncRecoveryRuntime,
} from './worker/walletSyncRecoveryRuntime';
import { resolvePersistedBitcoinNetwork } from './services/bitcoin/networks';
import { addressToScriptHash } from './services/bitcoin/electrum/methods';
import {
  createProductionSubscriptionCheckpointRuntime,
  type SubscriptionCheckpointRuntime,
} from './worker/subscriptionCheckpointRuntime';
import {
  createProductionNetworkHeaderReconciliationRuntime,
  type NetworkHeaderReconciliationRuntime,
} from './worker/networkHeaderReconciliationRuntime';
import { completeWalletSubscriptionEnrollment } from './worker/walletSubscriptionEnrollment';
import { schedulerRetirementCutover } from './services/sync/schedulerRetirementCutover';
import { readSchedulerRetirementReadiness } from './services/sync/schedulerRetirementReadiness';
import {
  enqueueStaleWalletStartupCompatibility,
  isStaleWalletScheduleForbidden,
  registerStaleWalletCompletionCompatibility,
  withStaleWalletRetirementLock,
} from './worker/staleWalletScheduleCompatibility';

const log = createLogger('WORKER');

// =============================================================================
// Global State
// =============================================================================

let jobQueue: WorkerJobQueue | null = null;
let electrumManager: ElectrumSubscriptionManager | null = null;
let healthServer: HealthServerHandle | null = null;
let reconciliationTimer: NodeJS.Timeout | null = null;
let scheduleReconciliationTimer: NodeJS.Timeout | null = null;
let schedulerRetirementReconciliation: Promise<void> | null = null;
let metricsTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let shutdownExitCode: 0 | 1 = 0;
let recurringScheduleCoordinator: RecurringScheduleCoordinator | null = null;
let workerStartedAt = 0;
let diagnosticHeartbeat: WorkerHeartbeatWriter | null = null;
let walletSyncRecoveryRuntime: WalletSyncRecoveryRuntime | null = null;
let subscriptionCheckpointRuntime: SubscriptionCheckpointRuntime | null = null;
let subscriptionCheckpointTimer: NodeJS.Timeout | null = null;
let subscriptionStatusRefreshTimer: NodeJS.Timeout | null = null;
let subscriptionCheckpointInFlight = false;
let subscriptionStatusRefreshInFlight = false;
let networkHeaderReconciliationRuntime: NetworkHeaderReconciliationRuntime | null = null;
let networkHeaderReconciliationTimer: NodeJS.Timeout | null = null;
let subscriptionCheckpointNetworkIndex = 0;
let subscriptionStatusRefreshNetworkIndex = 0;
const subscriptionCheckpointCursors = new Map<BitcoinNetwork, string>();
const subscriptionStatusRefreshCursors = new Map<BitcoinNetwork, string>();
const subscriptionStatusTails = new Map<string, Promise<void>>();
let subscriptionCheckpointMutationTail: Promise<void> = Promise.resolve();
let stopUiEventBridge: (() => Promise<void>) | null = null;

// Reconciliation interval - clean up stale subscriptions every 15 minutes
const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
const SUBSCRIPTION_CHECKPOINT_INTERVAL_MS = 1_000;
const SUBSCRIPTION_STATUS_REFRESH_INTERVAL_MS = 60_000;
const SUBSCRIPTION_CHECKPOINT_PAGE_SIZE = 200;
const NETWORK_HEADER_RECONCILIATION_INTERVAL_MS = 5_000;

/**
 * Start publishing this process's WebSocket events onto the Redis bridge.
 *
 * The worker serves no WebSocket clients, so every broadcast it makes - sync
 * status, wallet logs, transaction and balance updates - would otherwise be
 * dropped. Publishing onto the bridge hands them to the API process, which fans
 * them out to the browsers connected to it.
 *
 * Best-effort: losing the UI channel costs visibility, never the background
 * work itself, so it must never fail startup.
 */
async function startUiEventBridge(): Promise<void> {
  try {
    await initializeRedisBridge({ publishOnly: true });
    stopUiEventBridge = shutdownRedisBridge;
  } catch (error) {
    log.error('WebSocket bridge unavailable, worker events will not reach the UI', {
      error: getErrorMessage(error),
    });
  }
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

function activeSubscriptionCheckpointRuntime(): SubscriptionCheckpointRuntime {
  if (!subscriptionCheckpointRuntime) {
    throw new Error('Subscription checkpoint runtime is not initialized');
  }
  return subscriptionCheckpointRuntime;
}

function logCheckpointDispatchFailures(
  context: string,
  result: {
    unavailable: number;
    dispatch: { publicationFailed: number; wakeUnavailable: number };
  },
): void {
  if (result.unavailable === 0
    && result.dispatch.publicationFailed === 0
    && result.dispatch.wakeUnavailable === 0) {
    return;
  }
  log.warn('Subscription checkpoint work remains durable for recovery', {
    context,
    unavailable: result.unavailable,
    publicationFailed: result.dispatch.publicationFailed,
    wakeUnavailable: result.dispatch.wakeUnavailable,
  });
}

function serializeSubscriptionCheckpointMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = subscriptionCheckpointMutationTail
    .catch(() => undefined)
    .then(operation);
  subscriptionCheckpointMutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function enrollPendingSubscriptionPage(
  network: BitcoinNetwork,
): Promise<void> {
  if (!electrumManager?.isSubscriptionOwner()) return;
  const cursor = subscriptionCheckpointCursors.get(network);
  const result = await serializeSubscriptionCheckpointMutation(() => (
    activeSubscriptionCheckpointRuntime().enrollPendingPage({
      network,
      ...(cursor !== undefined ? { cursor } : {}),
      limit: SUBSCRIPTION_CHECKPOINT_PAGE_SIZE,
    })
  ));
  logCheckpointDispatchFailures(`network:${network}`, result);
  if (result.scanned === SUBSCRIPTION_CHECKPOINT_PAGE_SIZE && result.nextCursor) {
    subscriptionCheckpointCursors.set(network, result.nextCursor);
  } else {
    subscriptionCheckpointCursors.delete(network);
  }
}

async function enrollWalletSubscriptions(
  walletId: string,
  walletNetwork: string,
  signal: AbortSignal,
): Promise<void> {
  const network = resolvePersistedBitcoinNetwork(walletNetwork);
  const runtime = activeSubscriptionCheckpointRuntime();
  await completeWalletSubscriptionEnrollment({ walletId, network, signal }, {
    runtime,
    isSubscriptionOwner: () => electrumManager?.isSubscriptionOwner() ?? false,
    ensureNetworkConnected: async (targetNetwork) => {
      if (!electrumManager) throw new Error('Electrum subscription manager is not initialized');
      await electrumManager.ensureNetworkConnected(targetNetwork);
    },
    serializeMutation: operation => serializeSubscriptionCheckpointMutation(operation),
    onPageResult: result => logCheckpointDispatchFailures(`wallet:${walletId}`, result),
  });
}

async function recordSubscriptionStatuses(
  network: BitcoinNetwork,
  statuses: Map<string, string | null>,
): Promise<void> {
  for (const [address, status] of statuses) {
    await recordSubscriptionStatus(
      network,
      addressToScriptHash(address, network),
      status,
    );
  }
}

async function recordSubscriptionStatus(
  network: BitcoinNetwork,
  scriptHash: string,
  observedStatus: string | null,
): Promise<void> {
  const key = `${network}:${scriptHash}`;
  const previous = subscriptionStatusTails.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => (
    recordSubscriptionStatusPages(network, scriptHash, observedStatus)
  ));
  subscriptionStatusTails.set(key, current);
  try {
    await current;
  } finally {
    if (subscriptionStatusTails.get(key) === current) {
      subscriptionStatusTails.delete(key);
    }
  }
}

async function recordSubscriptionStatusPages(
  network: BitcoinNetwork,
  scriptHash: string,
  observedStatus: string | null,
): Promise<void> {
  let cursor: string | undefined;
  do {
    if (!electrumManager?.isSubscriptionOwner()) return;
    const result = await serializeSubscriptionCheckpointMutation(() => (
      activeSubscriptionCheckpointRuntime().recordStatusPage({
        network,
        scriptHash,
        observedStatus,
        ...(cursor !== undefined ? { cursor } : {}),
        limit: SUBSCRIPTION_CHECKPOINT_PAGE_SIZE,
      })
    ));
    logCheckpointDispatchFailures(`status:${network}:${scriptHash}`, result);
    cursor = result.scanned === SUBSCRIPTION_CHECKPOINT_PAGE_SIZE
      ? result.nextCursor
      : undefined;
  } while (cursor !== undefined);
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

  const uiEventBridgeStarted = startUiEventBridge();
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
  registerWorkerJobs(jobQueue, { enrollWalletSubscriptions });
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
      staleWalletScheduleForbidden: await isStaleWalletScheduleForbidden(),
    }),
    withStaleWalletRetirementLock,
  );
  // Worker acknowledgement follows snapshot installation and schedule convergence.
  featureFlagService.configureRuntime(
    'worker',
    reconcileApplicableRecurringSchedules,
  );
  registerStaleWalletCompletionCompatibility(jobQueue, () => isShuttingDown);
  await featureFlagService.initialize();
  // Retained jobs can execute only after the durable feature snapshot is
  // installed, conditional schedules converge, the worker acknowledges it,
  // their progress has somewhere to be reported, and the elected subscription
  // runtime can enroll every address before a sync commits current state.
  await uiEventBridgeStarted;

  // Initialize Electrum subscription manager
  log.info('Starting Electrum subscription manager...');
  networkHeaderReconciliationRuntime = createProductionNetworkHeaderReconciliationRuntime(
    () => isShuttingDown
      ? null
      : (electrumManager?.getSubscriptionOwnershipEpoch() ?? null),
  );
  electrumManager = new ElectrumSubscriptionManager({
    onHeaderObservation: (network, observation, fetchHeaders) => (
      networkHeaderReconciliationRuntime!.observe(network, observation, fetchHeaders)
    ),
    onAddressActivity: handleAddressActivity,
    onNetworkReady: enrollPendingSubscriptionPage,
    onSubscriptionStatuses: recordSubscriptionStatuses,
  });
  subscriptionCheckpointRuntime = createProductionSubscriptionCheckpointRuntime(
    ({ network, addresses }) => {
      if (!electrumManager) {
        throw new Error('Electrum subscription manager is not initialized');
      }
      return electrumManager.subscribeCheckpointAddresses(network, addresses);
    },
    () => electrumManager?.isSubscriptionOwner() ?? false,
  );
  await electrumManager.start();
  await networkHeaderReconciliationRuntime.recoverDue();
  // The activation gate must observe this boot before deciding whether the
  // fleet is capable of the irreversible scheduler cutover. Consumers remain
  // stopped until cutover and queue purge complete.
  diagnosticHeartbeat = new WorkerHeartbeatWriter(
    () => getWorkerDiagnosticsSnapshot(workerConcurrency),
  );
  await diagnosticHeartbeat.write();
  diagnosticHeartbeat.start();
  await reconcileStaleWalletSchedulerRetirement();
  startNetworkHeaderReconciliationTimer();
  startSubscriptionCheckpointTimer();
  startSubscriptionStatusRefreshTimer();
  jobQueue.startConsumers();

  workerStartedAt = Date.now();

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
          walletSyncActivation: walletSyncRecoveryRuntime?.getActivationState() ?? {
            status: 'dormant',
            requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
          },
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
          walletSyncActivation: walletSyncRecoveryRuntime?.getActivationState() ?? {
            status: 'dormant',
            requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
          },
        };
      },
    },
  });
  walletSyncRecoveryRuntime = createProductionWalletSyncRecoveryRuntime();
  await walletSyncRecoveryRuntime.start();

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

  // Queue the compatibility catch-up only while the durable retirement marker
  // remains absent. A strict read failure aborts startup rather than recreating
  // work after cutover.
  await enqueueStaleWalletStartupCompatibility(jobQueue, config);

  log.info('Sanctuary Background Worker started successfully', {
    healthPort,
    concurrency: workerConcurrency,
    network: config.bitcoin.network,
    reconciliationInterval: `${RECONCILIATION_INTERVAL_MS / 60000}m`,
  });
}

async function attemptStaleWalletSchedulerRetirement(): Promise<void> {
  const result = await schedulerRetirementCutover.attempt();
  if (result.status === 'legacy_enabled') {
    await reconcileApplicableRecurringSchedules();
    log.info('Retaining stale-wallet compatibility scheduler', {
      reason: result.reason,
    });
    return;
  }

  // The queue was created with autorun:false. Reconcile the durable marker to
  // Redis, then recheck exact DB readiness before any retained job can run.
  await reconcileApplicableRecurringSchedules();
  const readiness = result.newlyForbidden
    ? await readSchedulerRetirementReadiness()
    : null;
  if (readiness !== null && readiness.status !== 'ready') {
    throw new Error('Scheduler retirement readiness changed after queue purge');
  }
  log.info('Stale-wallet scheduler retirement is active', {
    newlyForbidden: result.newlyForbidden,
    forbiddenAt: result.tombstone.forbiddenAt,
    networks: readiness?.status === 'ready' ? readiness.networks.length : undefined,
  });
}

function reconcileStaleWalletSchedulerRetirement(): Promise<void> {
  if (schedulerRetirementReconciliation) return schedulerRetirementReconciliation;
  const operation = attemptStaleWalletSchedulerRetirement().finally(() => {
    if (schedulerRetirementReconciliation === operation) {
      schedulerRetirementReconciliation = null;
    }
  });
  schedulerRetirementReconciliation = operation;
  return operation;
}

/**
 * Start the periodic reconciliation timer
 */
function startReconciliationTimer(): void {
  // Run reconciliation periodically
  reconciliationTimer = setInterval(async () => {
    if (isShuttingDown || !electrumManager) return;

    try {
      const network = getConfig().bitcoin.network as BitcoinNetwork;
      await enrollPendingSubscriptionPage(network);
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

function startSubscriptionStatusRefreshTimer(): void {
  subscriptionStatusRefreshTimer = setInterval(() => {
    if (isShuttingDown || !electrumManager?.isSubscriptionOwner()) {
      subscriptionStatusRefreshCursors.clear();
      return;
    }
    if (subscriptionStatusRefreshInFlight) return;
    const networks = electrumManager.getManagedNetworks();
    const network = networks[subscriptionStatusRefreshNetworkIndex % networks.length];
    if (!network) return;
    subscriptionStatusRefreshInFlight = true;
    const cursor = subscriptionStatusRefreshCursors.get(network);
    return electrumManager.refreshSubscriptionStatusPage(network, {
      ...(cursor !== undefined ? { cursor } : {}),
      limit: SUBSCRIPTION_CHECKPOINT_PAGE_SIZE,
    }).then((result) => {
      if (result.scanned === SUBSCRIPTION_CHECKPOINT_PAGE_SIZE && result.nextCursor) {
        subscriptionStatusRefreshCursors.set(network, result.nextCursor);
      } else {
        subscriptionStatusRefreshCursors.delete(network);
      }
    }).catch((error) => {
      log.error('Subscription status refresh failed', {
        error: getErrorMessage(error),
        network,
      });
    }).finally(() => {
      subscriptionStatusRefreshInFlight = false;
      subscriptionStatusRefreshNetworkIndex += 1;
    });
  }, SUBSCRIPTION_STATUS_REFRESH_INTERVAL_MS);
  subscriptionStatusRefreshTimer.unref?.();
}

function startSubscriptionCheckpointTimer(): void {
  subscriptionCheckpointTimer = setInterval(() => {
    if (isShuttingDown || !electrumManager?.isSubscriptionOwner()) {
      subscriptionCheckpointCursors.clear();
      return;
    }
    if (subscriptionCheckpointInFlight) return;
    const networks = electrumManager.getManagedNetworks();
    const network = networks[subscriptionCheckpointNetworkIndex % networks.length];
    if (!network) return;
    subscriptionCheckpointInFlight = true;
    return enrollPendingSubscriptionPage(network)
      .catch((error) => {
        log.error('Subscription checkpoint recovery failed', {
          error: getErrorMessage(error),
          network,
        });
      })
      .finally(() => {
        subscriptionCheckpointInFlight = false;
        subscriptionCheckpointNetworkIndex += 1;
      });
  }, SUBSCRIPTION_CHECKPOINT_INTERVAL_MS);
  subscriptionCheckpointTimer.unref?.();
}

// =============================================================================
// Event Handlers
// =============================================================================

function startNetworkHeaderReconciliationTimer(): void {
  networkHeaderReconciliationTimer = setInterval(() => {
    if (isShuttingDown || !networkHeaderReconciliationRuntime) return;
    void networkHeaderReconciliationRuntime.recoverDue().catch((error) => {
      log.error('Durable network-header recovery scan failed', {
        error: getErrorMessage(error),
      });
    });
  }, NETWORK_HEADER_RECONCILIATION_INTERVAL_MS);
  networkHeaderReconciliationTimer.unref?.();
}

/**
 * Handle address activity event from Electrum
 */
function handleAddressActivity(
  network: BitcoinNetwork,
  scriptHash: string,
  status: string | null,
): void {
  void recordSubscriptionStatus(network, scriptHash, status).catch(error => {
    log.error('Failed to persist address activity checkpoint', {
      error: getErrorMessage(error),
      network,
      scriptHash,
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
    void reconcileStaleWalletSchedulerRetirement().catch((error) => {
      log.error('Recurring schedule and retirement reconciliation failed', {
        error: getErrorMessage(error),
      });
    });
  }, RECURRING_SCHEDULE_RECONCILIATION_INTERVAL_MS);
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
  if (subscriptionCheckpointTimer) {
    clearInterval(subscriptionCheckpointTimer);
    subscriptionCheckpointTimer = null;
  }
  if (subscriptionStatusRefreshTimer) {
    clearInterval(subscriptionStatusRefreshTimer);
    subscriptionStatusRefreshTimer = null;
  }
  if (networkHeaderReconciliationTimer) {
    clearInterval(networkHeaderReconciliationTimer);
    networkHeaderReconciliationTimer = null;
  }
  if (networkHeaderReconciliationRuntime) {
    try {
      await networkHeaderReconciliationRuntime.stop();
    } catch (err) {
      log.error('Error stopping network-header reconciliation', {
        error: getErrorMessage(err),
      });
    }
    networkHeaderReconciliationRuntime = null;
  }
  subscriptionCheckpointCursors.clear();
  subscriptionStatusRefreshCursors.clear();
  subscriptionCheckpointInFlight = false;
  subscriptionStatusRefreshInFlight = false;
  subscriptionStatusTails.clear();
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

  if (walletSyncRecoveryRuntime) {
    try {
      await walletSyncRecoveryRuntime.stop();
    } catch (err) {
      log.error('Error stopping wallet-sync recovery', { error: getErrorMessage(err) });
    }
    walletSyncRecoveryRuntime = null;
  }

  // Stop Electrum subscriptions
  if (electrumManager) {
    try {
      await electrumManager.stop();
    } catch (err) {
      log.error('Error stopping Electrum manager', { error: getErrorMessage(err) });
    }
    electrumManager = null;
  }
  subscriptionCheckpointRuntime = null;

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

  // Stop publishing WebSocket events before the shared Redis client closes
  if (stopUiEventBridge) {
    try {
      await stopUiEventBridge();
    } catch (err) {
      log.error('Error shutting down Redis WebSocket bridge', { error: getErrorMessage(err) });
    }
    stopUiEventBridge = null;
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
