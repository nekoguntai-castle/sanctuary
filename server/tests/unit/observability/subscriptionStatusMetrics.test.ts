import { beforeEach, describe, expect, it } from 'vitest';

import {
  metricsService,
  recordSubscriptionStatusMismatch,
  recordSubscriptionStatusRefreshCycleCompleted,
  recordSubscriptionStatusRefreshPage,
  SUBSCRIPTION_STATUS_REFRESH_OUTCOMES,
  SUBSCRIPTION_STATUS_SOURCES,
} from '../../../src/observability/metrics';

describe('subscription status metrics', () => {
  beforeEach(() => {
    metricsService.reset();
  });

  it('counts intent-raising observations by fixed network and source labels', async () => {
    for (const source of SUBSCRIPTION_STATUS_SOURCES) {
      expect(recordSubscriptionStatusMismatch('mainnet', source)).toBe(true);
    }
    expect(recordSubscriptionStatusMismatch('mainnet', 'refresh', 2)).toBe(true);

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'sanctuary_subscription_status_mismatches_total{network="mainnet",source="refresh"} 3',
    );
    expect(metrics).toContain(
      'sanctuary_subscription_status_mismatches_total{network="mainnet",source="notification"} 1',
    );
  });

  it('rejects unknown sources and invalid counts, and folds unknown networks into other', async () => {
    expect(recordSubscriptionStatusMismatch('mainnet', 'bc1qaddress')).toBe(false);
    expect(recordSubscriptionStatusMismatch('mainnet', 'refresh', 0)).toBe(false);
    expect(recordSubscriptionStatusMismatch('mainnet', 'refresh', -1)).toBe(false);
    expect(recordSubscriptionStatusMismatch('mainnet', 'refresh', 1.5)).toBe(false);
    expect(recordSubscriptionStatusMismatch(undefined, 'refresh')).toBe(true);
    expect(recordSubscriptionStatusMismatch('wallet-123', 'refresh')).toBe(true);

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'sanctuary_subscription_status_mismatches_total{network="other",source="refresh"} 2',
    );
    expect(metrics).not.toContain('wallet-123');
    expect(metrics).not.toContain('bc1qaddress');
  });

  it('counts every refresh page outcome and rejects unknown outcomes', async () => {
    for (const outcome of SUBSCRIPTION_STATUS_REFRESH_OUTCOMES) {
      expect(recordSubscriptionStatusRefreshPage('testnet4', outcome)).toBe(true);
    }
    expect(recordSubscriptionStatusRefreshPage('testnet4', 'exploded')).toBe(false);

    const metrics = await metricsService.getMetrics();
    for (const outcome of SUBSCRIPTION_STATUS_REFRESH_OUTCOMES) {
      expect(metrics).toContain(
        `sanctuary_subscription_status_refresh_pages_total{network="testnet4",outcome="${outcome}"} 1`,
      );
    }
    expect(metrics).not.toContain('exploded');
  });

  it('sets the cycle-completed timestamp in seconds and ignores non-finite times', async () => {
    expect(recordSubscriptionStatusRefreshCycleCompleted('mainnet', 1_700_000_000_500)).toBe(true);
    expect(recordSubscriptionStatusRefreshCycleCompleted('mainnet', Number.NaN)).toBe(false);
    expect(recordSubscriptionStatusRefreshCycleCompleted('mainnet')).toBe(true);

    const metrics = await metricsService.getMetrics();
    const match = metrics.match(
      /sanctuary_subscription_status_refresh_cycle_completed_timestamp_seconds\{network="mainnet"\} (\S+)/,
    );
    expect(Number(match?.[1])).toBeGreaterThan(1_700_000_000);
  });
});
