/**
 * Metrics Helper Functions
 *
 * Convenience functions for recording common metric patterns.
 */

import { circuitBreakerState, cacheOperationsTotal, jobQueueDepth } from './infrastructureMetrics';
import { activeUsers, activeWallets } from './businessMetrics';
import {
  electrumPoolConnections,
  electrumPoolWaitingRequests,
  electrumCircuitBreakerState,
  electrumServerHealth,
  electrumServerConnections,
  electrumServerBackoffLevel,
  electrumServerWeight,
} from './electrumMetrics';

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const BITCOIN_ADDRESS_SEGMENT = /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}$/;
const TXID_SEGMENT = /^[a-f0-9]{64}$/i;

/**
 * A short safe token: printable ASCII letters/digits and a small set of URL
 * path punctuation, bounded in length. Anything outside this shape (percent
 * encoding, unicode, whitespace, or an over-long segment) is not a
 * recognizable route template piece and is collapsed to `:other` below.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]{1,64}$/;

/**
 * Normalizes one path segment for metrics labels: known dynamic shapes
 * (UUID, numeric id, Bitcoin address, tx hash) become their placeholder;
 * any other segment that isn't a short safe token collapses to `:other` so
 * it cannot mint unbounded label cardinality.
 */
function normalizeSegment(segment: string): string {
  if (segment === '') {
    return segment;
  }
  if (UUID_SEGMENT.test(segment) || NUMERIC_SEGMENT.test(segment)) {
    return ':id';
  }
  // A 64-hex segment is a transaction id even when it happens to start with
  // an address prefix (e.g. `bc1…`), so the txid check runs first.
  if (TXID_SEGMENT.test(segment)) {
    return ':txid';
  }
  if (BITCOIN_ADDRESS_SEGMENT.test(segment)) {
    return ':address';
  }
  if (SAFE_SEGMENT.test(segment)) {
    return segment;
  }
  return ':other';
}

/**
 * Normalize path for metrics labels
 * Replaces dynamic path segments with placeholders, and bounds any other
 * segment that is not a short safe token to `:other` (see normalizeSegment).
 */
export function normalizePath(path: string): string {
  return path.split('/').map(normalizeSegment).join('/');
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
 * Update active users and wallets gauges from database counts
 */
export function updateActiveStatsMetrics(userCount: number, walletCount: number): void {
  activeUsers.set(userCount);
  activeWallets.set(walletCount);
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
