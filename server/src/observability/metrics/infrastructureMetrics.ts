/**
 * Infrastructure Metrics
 *
 * Prometheus metrics for circuit breakers, rate limiting, caching, and job queues.
 */

import { Counter, Gauge, Histogram } from 'prom-client';
import { registry } from './registry';

/**
 * Circuit breaker state gauge
 * 0 = closed (healthy), 1 = half-open, 2 = open (failing)
 */
export const circuitBreakerState = new Gauge({
  name: 'sanctuary_circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
  labelNames: ['service'],
  registers: [registry],
});

/**
 * Rate limit hits counter
 */
export const rateLimitHitsTotal = new Counter({
  name: 'sanctuary_rate_limit_hits_total',
  help: 'Total rate limit hits',
  labelNames: ['policy'],
  registers: [registry],
});

/**
 * Cache operations counter
 */
export const cacheOperationsTotal = new Counter({
  name: 'sanctuary_cache_operations_total',
  help: 'Total cache operations',
  labelNames: ['type', 'result'], // type: 'get'|'set'|'delete', result: 'hit'|'miss'|'success'
  registers: [registry],
});

/**
 * Job queue depth gauge
 */
export const jobQueueDepth = new Gauge({
  name: 'sanctuary_job_queue_depth',
  help: 'Number of jobs in queue',
  labelNames: ['queue', 'state'], // state: 'waiting'|'active'|'delayed'|'failed'
  registers: [registry],
});

/**
 * Job processing duration histogram
 */
export const jobProcessingDuration = new Histogram({
  name: 'sanctuary_job_processing_duration_seconds',
  help: 'Duration of job processing in seconds',
  labelNames: ['job_name', 'status'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300],
  registers: [registry],
});

/**
 * Notification job result counter
 */
export const notificationJobResultsTotal = new Counter({
  name: 'sanctuary_notification_job_results_total',
  help: 'Total notification job outcomes by job and result',
  labelNames: ['job_name', 'result'],
  registers: [registry],
});
