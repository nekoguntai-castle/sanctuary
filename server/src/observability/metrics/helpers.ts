/**
 * Metrics Helper Functions
 *
 * Convenience functions for recording common metric patterns.
 */

import { circuitBreakerState, cacheOperationsTotal, jobQueueDepth } from './infrastructureMetrics';
import {
  electrumPoolConnections,
  electrumPoolWaitingRequests,
  electrumCircuitBreakerState,
  electrumServerHealth,
  electrumServerConnections,
  electrumServerBackoffLevel,
  electrumServerWeight,
} from './electrumMetrics';

/**
 * Normalize path for metrics labels
 * Replaces dynamic path segments with placeholders
 */
export function normalizePath(path: string): string {
  return path
    // Replace UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    // Replace numeric IDs
    .replace(/\/\d+/g, '/:id')
    // Replace Bitcoin addresses (P2PKH, P2SH, Bech32)
    .replace(/\/(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}/g, '/:address')
    // Replace transaction hashes
    .replace(/\/[a-f0-9]{64}/gi, '/:txid');
}

/**
 * Record circuit breaker state change
 */
export function recordCircuitBreakerState(
  service: string,
  state: 'closed' | 'half-open' | 'open'
): void {
  const stateValue = state === 'closed' ? 0 : state === 'half-open' ? 1 : 2;
  circuitBreakerState.set({ service }, stateValue);
}

/**
 * Record cache operation
 */
export function recordCacheOperation(
  type: 'get' | 'set' | 'delete',
  result: 'hit' | 'miss' | 'success' | 'error'
): void {
  cacheOperationsTotal.inc({ type, result });
}

/**
 * Update job queue metrics
 */
export function updateJobQueueMetrics(
  queue: string,
  waiting: number,
  active: number,
  delayed: number,
  failed: number
): void {
  jobQueueDepth.set({ queue, state: 'waiting' }, waiting);
  jobQueueDepth.set({ queue, state: 'active' }, active);
  jobQueueDepth.set({ queue, state: 'delayed' }, delayed);
  jobQueueDepth.set({ queue, state: 'failed' }, failed);
}

/**
 * Update Electrum pool metrics from pool stats
 * Call this periodically to keep metrics current
 */
export function updateElectrumPoolMetrics(
  network: string,
  stats: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingRequests: number;
    totalAcquisitions: number;
    averageAcquisitionTimeMs: number;
    healthCheckFailures: number;
    servers: Array<{
      label: string;
      isHealthy: boolean;
      connectionCount: number;
      backoffLevel: number;
      weight: number;
    }>;
  },
  circuitState?: 'closed' | 'half-open' | 'open'
): void {
  // Pool-level metrics
  electrumPoolConnections.set({ state: 'total', network }, stats.totalConnections);
  electrumPoolConnections.set({ state: 'active', network }, stats.activeConnections);
  electrumPoolConnections.set({ state: 'idle', network }, stats.idleConnections);
  electrumPoolWaitingRequests.set({ network }, stats.waitingRequests);

  // Circuit breaker state
  if (circuitState) {
    const stateValue = circuitState === 'closed' ? 0 : circuitState === 'half-open' ? 1 : 2;
    electrumCircuitBreakerState.set({ network }, stateValue);
  }

  // Per-server metrics
  for (const server of stats.servers) {
    electrumServerHealth.set({ server: server.label, network }, server.isHealthy ? 1 : 0);
    electrumServerConnections.set({ server: server.label, network }, server.connectionCount);
    electrumServerBackoffLevel.set({ server: server.label, network }, server.backoffLevel);
    electrumServerWeight.set({ server: server.label, network }, server.weight);
  }
}
