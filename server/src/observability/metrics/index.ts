/**
 * Prometheus Metrics Service
 *
 * Centralized metrics collection and exposition for Prometheus.
 * Integrates with existing Grafana monitoring stack.
 *
 * ## Features
 *
 * - Default Node.js metrics (memory, CPU, event loop)
 * - HTTP request metrics (latency, count, errors)
 * - Custom business metrics (wallets, transactions, etc.)
 * - Circuit breaker state tracking
 * - Cache hit/miss ratios
 *
 * ## Usage
 *
 * ```typescript
 * import { metrics, httpRequestDuration } from './observability/metrics';
 *
 * // Record a metric
 * httpRequestDuration.observe({ method: 'GET', path: '/api/wallets', status: '200' }, 0.15);
 *
 * // Get all metrics for /metrics endpoint
 * const metricsOutput = await metrics.getMetrics();
 * ```
 */

// Registry and service
export { metricsService } from './registry';

// HTTP metrics
export {
  httpRequestDuration,
  httpRequestsTotal,
  httpRequestSize,
  httpResponseSize,
} from './httpMetrics';

// WebSocket metrics
export {
  websocketConnections,
  websocketMessagesTotal,
  websocketRateLimitHits,
  websocketSubscriptions,
  websocketConnectionDuration,
} from './websocketMetrics';

// Business metrics
export {
  walletSyncsTotal,
  walletSyncDuration,
  transactionBroadcastsTotal,
  activeWallets,
  activeUsers,
  syncPollingModeTransitions,
  authCsrfSessionStaleTotal,
} from './businessMetrics';

// Infrastructure metrics
export {
  circuitBreakerState,
  rateLimitHitsTotal,
  cacheOperationsTotal,
  jobQueueDepth,
  jobProcessingDuration,
  notificationJobResultsTotal,
} from './infrastructureMetrics';

// Wallet sync execution and lock-health metrics
export {
  WALLET_SYNC_METRIC_STAGES,
  WALLET_SYNC_METRIC_MODES,
  WALLET_SYNC_METRIC_NETWORKS,
  WALLET_SYNC_STAGE_OUTCOMES,
  WALLET_SYNC_CANDIDATE_OUTCOMES,
  WALLET_SYNC_TERMINAL_OUTCOMES,
  WALLET_SYNC_LOCK_SCOPES,
  WALLET_SYNC_LOCK_LOSSES,
  WALLET_SYNC_CLEANUP_OUTCOMES,
  enterWalletSyncStage,
  recordWalletSyncFallback,
  recordWalletSyncBudgetExpiry,
  recordWalletSyncCandidateOutcome,
  recordWalletSyncTerminalOutcome,
  recordWalletSyncAbortGraceExhaustion,
  classifyDistributedLockScope,
  recordWalletSyncLockLoss,
  recordWalletSyncCleanupOutcome,
  type EnterWalletSyncStageOptions,
  type WalletSyncStageOutcome,
  type WalletSyncCandidateOutcome,
  type WalletSyncTerminalOutcome,
  type WalletSyncLockScope,
  type WalletSyncLockLoss,
  type WalletSyncCleanupOutcome,
} from './walletSyncMetrics';

// Electrum pool metrics
export {
  electrumPoolConnections,
  electrumPoolWaitingRequests,
  electrumPoolAcquisitionsTotal,
  electrumPoolAcquisitionDuration,
  electrumPoolHealthCheckFailures,
  electrumServerHealth,
  electrumServerConnections,
  electrumServerBackoffLevel,
  electrumServerWeight,
  electrumCircuitBreakerState,
} from './electrumMetrics';

// Database metrics
export {
  dbQueryDuration,
  dbConnectionPool,
  dbPoolHealth,
  dbPoolLatency,
  dbSlowQueriesTotal,
} from './databaseMetrics';

// Helper functions
export {
  normalizePath,
  recordCircuitBreakerState,
  recordCacheOperation,
  updateJobQueueMetrics,
  updateElectrumPoolMetrics,
  updateActiveStatsMetrics,
} from './helpers';

// Default export
import { metricsService } from './registry';
export default metricsService;
