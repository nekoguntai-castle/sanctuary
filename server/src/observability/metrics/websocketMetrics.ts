/**
 * WebSocket Metrics
 *
 * Prometheus metrics for WebSocket connection tracking.
 */

import { Counter, Gauge, Histogram } from 'prom-client';
import { registry } from './registry';

/**
 * Active WebSocket connections gauge
 */
export const websocketConnections = new Gauge({
  name: 'sanctuary_websocket_connections',
  help: 'Number of active WebSocket connections',
  labelNames: ['type'], // 'main' or 'gateway'
  registers: [registry],
});

/**
 * WebSocket messages total
 */
export const websocketMessagesTotal = new Counter({
  name: 'sanctuary_websocket_messages_total',
  help: 'Total WebSocket messages',
  labelNames: ['type', 'direction'], // direction: 'in' or 'out'
  registers: [registry],
});

/**
 * WebSocket rate limit hits counter
 */
export const websocketRateLimitHits = new Counter({
  name: 'sanctuary_websocket_rate_limit_hits_total',
  help: 'Total WebSocket rate limit hits',
  labelNames: ['reason'], // 'grace_period_exceeded', 'per_second_exceeded', 'subscription_limit'
  registers: [registry],
});

/**
 * WebSocket subscriptions gauge
 */
export const websocketSubscriptions = new Gauge({
  name: 'sanctuary_websocket_subscriptions',
  help: 'Number of active WebSocket subscriptions',
  registers: [registry],
});

/**
 * WebSocket connection duration histogram
 */
export const websocketConnectionDuration = new Histogram({
  name: 'sanctuary_websocket_connection_duration_seconds',
  help: 'Duration of WebSocket connections in seconds',
  labelNames: ['close_reason'], // 'normal', 'rate_limit', 'auth_timeout', 'error'
  buckets: [1, 5, 30, 60, 300, 600, 1800, 3600, 7200],
  registers: [registry],
});
