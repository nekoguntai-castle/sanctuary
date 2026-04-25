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
} from '../../../src/observability/metrics';

describe('observability/metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metricsService.reset();
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
});
