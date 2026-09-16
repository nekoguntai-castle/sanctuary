import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

import {
  metricsService,
  normalizePath,
  recordCircuitBreakerState,
  recordCacheOperation,
  updateJobQueueMetrics,
  updateElectrumPoolMetrics,
  updateActiveStatsMetrics,
  notificationJobResultsTotal,
  authCsrfSessionStaleTotal,
} from '../../../src/observability/metrics';
import {
  metricsMiddleware,
  resetHttpPathLabelCache,
  MAX_DISTINCT_HTTP_PATH_LABELS,
} from '../../../src/middleware/metrics';

/**
 * Drives the metrics middleware directly against a synthetic request/response
 * pair (mirroring the pattern in tests/unit/middleware/metrics.test.ts) so
 * these tests exercise the real, unmocked observability/metrics registry.
 */
function driveRequest(
  middleware: ReturnType<typeof metricsMiddleware>,
  { method = 'GET', path, statusCode }: { method?: string; path: string; statusCode: number }
): void {
  const req = { method, path, headers: {} } as unknown as Parameters<typeof middleware>[0];
  const res = {
    statusCode,
    end(chunk?: unknown, encoding?: unknown, callback?: () => void) {
      if (typeof callback === 'function') callback();
      return this;
    },
  } as unknown as Parameters<typeof middleware>[1];
  const next = (() => {}) as Parameters<typeof middleware>[2];

  middleware(req, res, next);
  (res as unknown as { end: () => void }).end();
}

describe('observability/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricsService.reset();
    resetHttpPathLabelCache();
  });

  it('initializes once and exposes registry helpers', async () => {
    metricsService.initialize();
    metricsService.initialize(); // no-op second call

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith('Metrics service initialized');

    const contentType = metricsService.getContentType();
    expect(contentType).toContain('text/plain');

    const registry = metricsService.getRegistry();
    expect(registry).toBeDefined();
    expect(typeof registry.metrics).toBe('function');

    const resetSpy = vi.spyOn(registry, 'resetMetrics');
    metricsService.reset();
    expect(resetSpy).toHaveBeenCalled();

    await expect(metricsService.getMetrics()).resolves.toEqual(expect.any(String));
  });

  it('normalizes UUIDs, numeric IDs, bitcoin addresses, and txids', () => {
    const path =
      '/api/wallets/123e4567-e89b-12d3-a456-426614174000' +
      '/devices/42/address/bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' +
      '/tx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    expect(normalizePath(path)).toBe(
      '/api/wallets/:id/devices/:id/address/:address/tx/:txid'
    );
  });

  it('records circuit breaker, cache operations, and queue depth metrics', async () => {
    recordCircuitBreakerState('electrum', 'open');
    recordCacheOperation('get', 'hit');
    updateJobQueueMetrics('sync', 3, 2, 1, 4);

    const metricsText = await metricsService.getMetrics();

    expect(metricsText).toContain('sanctuary_circuit_breaker_state{service="electrum"} 2');
    expect(metricsText).toContain('sanctuary_cache_operations_total{type="get",result="hit"} 1');
    expect(metricsText).toContain('sanctuary_job_queue_depth{queue="sync",state="waiting"} 3');
    expect(metricsText).toContain('sanctuary_job_queue_depth{queue="sync",state="active"} 2');
    expect(metricsText).toContain('sanctuary_job_queue_depth{queue="sync",state="delayed"} 1');
    expect(metricsText).toContain('sanctuary_job_queue_depth{queue="sync",state="failed"} 4');
  });

  it('records notification job result metrics', async () => {
    notificationJobResultsTotal.inc({
      job_name: 'transaction-notify',
      result: 'no_channels',
    });

    const metricsText = await metricsService.getMetrics();

    expect(metricsText).toContain(
      'sanctuary_notification_job_results_total{job_name="transaction-notify",result="no_channels"} 1'
    );
  });

  it('records stale auth/CSRF pairs without token-bearing labels', async () => {
    authCsrfSessionStaleTotal.inc();

    const metricsText = await metricsService.getMetrics();
    expect(metricsText).toContain('sanctuary_auth_csrf_session_stale_total 1');
    expect(metricsText).not.toContain('sanctuary_auth_csrf_session_stale_total{');
  });

  it('updates active users and wallets gauges', async () => {
    updateActiveStatsMetrics(5, 12);

    const metricsText = await metricsService.getMetrics();

    expect(metricsText).toContain('sanctuary_active_users 5');
    expect(metricsText).toContain('sanctuary_active_wallets 12');
  });

  it('records all circuit breaker states and electrum pool server health branches', async () => {
    recordCircuitBreakerState('service-closed', 'closed');
    recordCircuitBreakerState('service-half', 'half-open');
    recordCircuitBreakerState('service-open', 'open');

    updateElectrumPoolMetrics(
      'testnet',
      {
        totalConnections: 4,
        activeConnections: 2,
        idleConnections: 2,
        waitingRequests: 3,
        totalAcquisitions: 10,
        averageAcquisitionTimeMs: 12,
        healthCheckFailures: 1,
        servers: [
          { label: 's1', isHealthy: true, connectionCount: 2, backoffLevel: 0, weight: 1 },
          { label: 's2', isHealthy: false, connectionCount: 0, backoffLevel: 2, weight: 1 },
        ],
      },
      'half-open'
    );

    updateElectrumPoolMetrics(
      'mainnet',
      {
        totalConnections: 1,
        activeConnections: 1,
        idleConnections: 0,
        waitingRequests: 0,
        totalAcquisitions: 1,
        averageAcquisitionTimeMs: 5,
        healthCheckFailures: 0,
        servers: [
          { label: 'm1', isHealthy: true, connectionCount: 1, backoffLevel: 0, weight: 1 },
        ],
      }
    );

    updateElectrumPoolMetrics(
      'signet',
      {
        totalConnections: 1,
        activeConnections: 1,
        idleConnections: 0,
        waitingRequests: 0,
        totalAcquisitions: 1,
        averageAcquisitionTimeMs: 5,
        healthCheckFailures: 0,
        servers: [
          { label: 'sg1', isHealthy: true, connectionCount: 1, backoffLevel: 0, weight: 1 },
        ],
      },
      'closed'
    );

    updateElectrumPoolMetrics(
      'regtest',
      {
        totalConnections: 1,
        activeConnections: 1,
        idleConnections: 0,
        waitingRequests: 0,
        totalAcquisitions: 1,
        averageAcquisitionTimeMs: 5,
        healthCheckFailures: 0,
        servers: [
          { label: 'rg1', isHealthy: true, connectionCount: 1, backoffLevel: 0, weight: 1 },
        ],
      },
      'open'
    );

    const metricsText = await metricsService.getMetrics();

    expect(metricsText).toContain('sanctuary_circuit_breaker_state{service="service-closed"} 0');
    expect(metricsText).toContain('sanctuary_circuit_breaker_state{service="service-half"} 1');
    expect(metricsText).toContain('sanctuary_circuit_breaker_state{service="service-open"} 2');

    expect(metricsText).toContain('sanctuary_electrum_circuit_breaker_state{network="testnet"} 1');
    expect(metricsText).toContain('sanctuary_electrum_circuit_breaker_state{network="signet"} 0');
    expect(metricsText).toContain('sanctuary_electrum_circuit_breaker_state{network="regtest"} 2');
    expect(metricsText).not.toContain('sanctuary_electrum_circuit_breaker_state{network="mainnet"}');
    expect(metricsText).toContain('sanctuary_electrum_server_healthy{server="s1",network="testnet"} 1');
    expect(metricsText).toContain('sanctuary_electrum_server_healthy{server="s2",network="testnet"} 0');
  });

  it('collapses unsafe or over-long path segments to :other', () => {
    const percentEncoded = '/api/v1/%E2%9C%93/x'.repeat(2);
    expect(normalizePath(percentEncoded)).toBe('/api/v1/:other/x/api/v1/:other/x');

    const overLongSegment = `/api/v1/${'a'.repeat(200)}`;
    expect(normalizePath(overLongSegment)).toBe('/api/v1/:other');

    // Recognized shapes are unaffected by the new segment-level bounding.
    expect(normalizePath('/api/v1/wallets/42/transactions')).toBe(
      '/api/v1/wallets/:id/transactions'
    );

    // A 64-hex segment is a txid even when it starts like a bech32 address.
    expect(normalizePath(`/api/v1/transactions/bc1${'a'.repeat(61)}`)).toBe(
      '/api/v1/transactions/:txid'
    );
    expect(normalizePath('/api/v1/addresses/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(
      '/api/v1/addresses/:address'
    );
  });

  it('never lets a 404 or another error response admit a new path label', async () => {
    const middleware = metricsMiddleware();

    // 404s collapse and consume no slot; rejected junk (version 400/410,
    // CSRF 403, rate limit 429, auth 401) collapses to /:other without
    // being admitted either.
    for (let i = 0; i < 50; i++) {
      driveRequest(middleware, { path: `/nope-${i}`, statusCode: 404 });
      driveRequest(middleware, { path: `/api/v99/junk-${i}`, statusCode: 400 });
    }
    driveRequest(middleware, { path: '/api/v1/never-served', statusCode: 401 });

    // The full cap is still available to real routes afterwards.
    for (let i = 0; i < MAX_DISTINCT_HTTP_PATH_LABELS; i++) {
      driveRequest(middleware, { path: `/served-${i}`, statusCode: 200 });
    }
    // An admitted path keeps its real label for error responses too.
    driveRequest(middleware, { path: '/served-0', statusCode: 401 });

    const metricsText = await metricsService.getMetrics();

    expect(metricsText).toContain(
      'sanctuary_http_requests_total{method="GET",path="/:unmatched",status="404"} 50'
    );
    expect(metricsText).toContain(
      'sanctuary_http_requests_total{method="GET",path="/:other",status="400"} 50'
    );
    expect(metricsText).toContain(
      'sanctuary_http_requests_total{method="GET",path="/:other",status="401"} 1'
    );
    expect(metricsText).toContain(
      'sanctuary_http_requests_total{method="GET",path="/served-0",status="401"} 1'
    );
    expect(metricsText).not.toContain('path="/:other",status="200"');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('admits a route on a server error so per-route 5xx visibility survives a restart', async () => {
    const middleware = metricsMiddleware();

    // Nothing has succeeded yet (e.g. the database is down after a restart),
    // but a 5xx proves the request reached a real route, so it keeps its label.
    driveRequest(middleware, { path: '/api/v1/wallets', statusCode: 503 });
    driveRequest(middleware, { path: '/api/v1/wallets', statusCode: 401 });

    const metricsText = await metricsService.getMetrics();

    expect(metricsText).toContain(
      'sanctuary_http_requests_total{method="GET",path="/api/v1/wallets",status="503"} 1'
    );
    expect(metricsText).toContain(
      'sanctuary_http_requests_total{method="GET",path="/api/v1/wallets",status="401"} 1'
    );
  });

  it('collapses every distinct unmatched path to a single /:unmatched series decided at response time', async () => {
    const middleware = metricsMiddleware();

    for (let i = 0; i < 50; i++) {
      driveRequest(middleware, {
        path: `/does-not-exist/${i}-${Math.random().toString(36).slice(2)}`,
        statusCode: 404,
      });
    }

    // A matched route still records its real normalized path and status.
    driveRequest(middleware, {
      path: '/api/v1/wallets/123e4567-e89b-12d3-a456-426614174000',
      statusCode: 200,
    });

    const metricsText = await metricsService.getMetrics();

    expect(metricsText).toContain(
      'sanctuary_http_requests_total{method="GET",path="/:unmatched",status="404"} 50'
    );
    expect(metricsText).toContain(
      'sanctuary_http_requests_total{method="GET",path="/api/v1/wallets/:id",status="200"} 1'
    );
  });

  it('bounds the distinct http path label cache to MAX_DISTINCT_HTTP_PATH_LABELS, overflowing to /:other with a single warning', async () => {
    const middleware = metricsMiddleware();

    for (let i = 0; i < MAX_DISTINCT_HTTP_PATH_LABELS; i++) {
      driveRequest(middleware, { path: `/cap-fill-${i}`, statusCode: 200 });
    }

    driveRequest(middleware, { path: '/cap-overflow-a', statusCode: 200 });
    driveRequest(middleware, { path: '/cap-overflow-b', statusCode: 200 });

    const metricsText = await metricsService.getMetrics();

    expect(metricsText).toContain(
      'sanctuary_http_requests_total{method="GET",path="/:other",status="200"} 2'
    );
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });
});
