/**
 * Observability Module
 *
 * Centralized observability infrastructure.
 *
 * @module observability
 */

export {
  metricsService,
  httpRequestDuration,
  httpRequestsTotal,
  httpRequestSize,
  httpResponseSize,
  websocketConnections,
  websocketMessagesTotal,
  walletSyncsTotal,
  walletSyncDuration,
  transactionBroadcastsTotal,
  activeWallets,
  activeUsers,
  circuitBreakerState,
  rateLimitHitsTotal,
  cacheOperationsTotal,
  jobQueueDepth,
  jobProcessingDuration,
  notificationJobResultsTotal,
  dbQueryDuration,
  dbConnectionPool,
  // Electrum pool metrics
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
  // Helper functions
  normalizePath,
  recordCircuitBreakerState,
  recordCacheOperation,
  updateJobQueueMetrics,
  updateElectrumPoolMetrics,
} from './metrics';
