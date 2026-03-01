/**
 * Electrum Pool Metrics
 *
 * Prometheus metrics for Electrum connection pool tracking.
 */

import { Counter, Gauge, Histogram } from 'prom-client';
import { registry } from './registry';

/**
 * Electrum pool connections gauge
 */
export const electrumPoolConnections = new Gauge({
  name: 'sanctuary_electrum_pool_connections',
  help: 'Number of Electrum pool connections',
  labelNames: ['state', 'network'], // state: 'total', 'active', 'idle'
  registers: [registry],
});

/**
 * Electrum pool waiting requests gauge
 */
export const electrumPoolWaitingRequests = new Gauge({
  name: 'sanctuary_electrum_pool_waiting_requests',
  help: 'Number of waiting requests in Electrum pool queue',
  labelNames: ['network'],
  registers: [registry],
});

/**
 * Electrum pool acquisitions counter
 */
export const electrumPoolAcquisitionsTotal = new Counter({
  name: 'sanctuary_electrum_pool_acquisitions_total',
  help: 'Total connection acquisitions from Electrum pool',
  labelNames: ['network'],
  registers: [registry],
});

/**
 * Electrum pool acquisition duration histogram
 */
export const electrumPoolAcquisitionDuration = new Histogram({
  name: 'sanctuary_electrum_pool_acquisition_duration_seconds',
  help: 'Duration of Electrum pool connection acquisition in seconds',
  labelNames: ['network'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

/**
 * Electrum pool health check failures counter
 */
export const electrumPoolHealthCheckFailures = new Counter({
  name: 'sanctuary_electrum_pool_health_check_failures_total',
  help: 'Total health check failures in Electrum pool',
  labelNames: ['network'],
  registers: [registry],
});

/**
 * Electrum server health gauge (per-server)
 */
export const electrumServerHealth = new Gauge({
  name: 'sanctuary_electrum_server_healthy',
  help: 'Electrum server health status (1=healthy, 0=unhealthy)',
  labelNames: ['server', 'network'],
  registers: [registry],
});

/**
 * Electrum server connections gauge (per-server)
 */
export const electrumServerConnections = new Gauge({
  name: 'sanctuary_electrum_server_connections',
  help: 'Number of connections to Electrum server',
  labelNames: ['server', 'network'],
  registers: [registry],
});

/**
 * Electrum server backoff level gauge (per-server)
 */
export const electrumServerBackoffLevel = new Gauge({
  name: 'sanctuary_electrum_server_backoff_level',
  help: 'Electrum server backoff level (0=healthy, higher=more degraded)',
  labelNames: ['server', 'network'],
  registers: [registry],
});

/**
 * Electrum server weight gauge (per-server)
 */
export const electrumServerWeight = new Gauge({
  name: 'sanctuary_electrum_server_weight',
  help: 'Electrum server selection weight (0-1)',
  labelNames: ['server', 'network'],
  registers: [registry],
});

/**
 * Electrum pool circuit breaker state
 */
export const electrumCircuitBreakerState = new Gauge({
  name: 'sanctuary_electrum_circuit_breaker_state',
  help: 'Electrum pool circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['network'],
  registers: [registry],
});
