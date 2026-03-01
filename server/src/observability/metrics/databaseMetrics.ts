/**
 * Database Metrics
 *
 * Prometheus metrics for database query and connection pool tracking.
 */

import { Counter, Gauge, Histogram } from 'prom-client';
import { registry } from './registry';

/**
 * Database query duration histogram
 */
export const dbQueryDuration = new Histogram({
  name: 'sanctuary_db_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation'], // 'select', 'insert', 'update', 'delete'
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

/**
 * Database connection pool gauge
 */
export const dbConnectionPool = new Gauge({
  name: 'sanctuary_db_connection_pool',
  help: 'Database connection pool status',
  labelNames: ['state'], // 'active', 'idle', 'waiting'
  registers: [registry],
});

/**
 * Database pool health status gauge
 * Values: 0 = healthy, 1 = degraded, 2 = unhealthy
 */
export const dbPoolHealth = new Gauge({
  name: 'sanctuary_db_pool_health',
  help: 'Database pool health status (0=healthy, 1=degraded, 2=unhealthy)',
  registers: [registry],
});

/**
 * Database query latency summary for pool health watchdog
 */
export const dbPoolLatency = new Gauge({
  name: 'sanctuary_db_pool_latency_ms',
  help: 'Database pool average query latency in milliseconds',
  labelNames: ['type'], // 'avg', 'max'
  registers: [registry],
});

/**
 * Database slow query counter
 */
export const dbSlowQueriesTotal = new Counter({
  name: 'sanctuary_db_slow_queries_total',
  help: 'Total number of slow database queries',
  registers: [registry],
});
