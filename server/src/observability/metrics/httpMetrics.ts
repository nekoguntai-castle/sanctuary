/**
 * HTTP Metrics
 *
 * Prometheus metrics for HTTP request tracking.
 */

import { Counter, Histogram } from 'prom-client';
import { registry } from './registry';

/**
 * HTTP request duration histogram
 */
export const httpRequestDuration = new Histogram({
  name: 'sanctuary_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/**
 * HTTP requests total counter
 */
export const httpRequestsTotal = new Counter({
  name: 'sanctuary_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [registry],
});

/**
 * HTTP request size histogram
 */
export const httpRequestSize = new Histogram({
  name: 'sanctuary_http_request_size_bytes',
  help: 'Size of HTTP requests in bytes',
  labelNames: ['method', 'path'],
  buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
  registers: [registry],
});

/**
 * HTTP response size histogram
 */
export const httpResponseSize = new Histogram({
  name: 'sanctuary_http_response_size_bytes',
  help: 'Size of HTTP responses in bytes',
  labelNames: ['method', 'path', 'status'],
  buckets: [100, 1000, 10000, 100000, 1000000, 10000000],
  registers: [registry],
});
