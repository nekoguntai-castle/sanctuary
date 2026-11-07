/**
 * Low-cardinality Prometheus metrics for the Electrum subscription status
 * backstop: where status observations come from, whether the periodic refresh is
 * running, and when each network last completed a full pass.
 *
 * Labels are fixed string unions. Addresses, script hashes and wallet identities
 * never appear here.
 */

import { Counter, Gauge } from '@prometheus-io/client';
import { BITCOIN_NETWORKS, type NetworkType } from '@sanctuary/shared/constants/bitcoin';
import { registry } from './registry';

/** Where an authoritative subscription status observation came from. */
export const SUBSCRIPTION_STATUS_SOURCES = [
  'notification',
  'subscribe',
  'reconnect',
  'refresh',
] as const;
export const SUBSCRIPTION_STATUS_REFRESH_OUTCOMES = [
  'refreshed',
  'skipped_disconnected',
  'skipped_not_owner',
  'failed',
] as const;

export type SubscriptionStatusSource = typeof SUBSCRIPTION_STATUS_SOURCES[number];
export type SubscriptionStatusRefreshOutcome =
  typeof SUBSCRIPTION_STATUS_REFRESH_OUTCOMES[number];

const mismatchesTotal = new Counter({
  name: 'sanctuary_subscription_status_mismatches_total',
  help: 'Subscription status observations that raised sync intent, by observation source',
  labelNames: ['network', 'source'],
  registers: [registry],
});

const refreshPagesTotal = new Counter({
  name: 'sanctuary_subscription_status_refresh_pages_total',
  help: 'Subscription status refresh pages by fixed outcome',
  labelNames: ['network', 'outcome'],
  registers: [registry],
});

const refreshCycleCompleted = new Gauge({
  name: 'sanctuary_subscription_status_refresh_cycle_completed_timestamp_seconds',
  help: 'Unix time a network last completed a full subscription status refresh pass',
  labelNames: ['network'],
  registers: [registry],
});

function normalizeNetwork(value: unknown): NetworkType | 'other' {
  return typeof value === 'string' && (BITCOIN_NETWORKS as readonly string[]).includes(value)
    ? value as NetworkType
    : 'other';
}

function includes<T extends string>(domain: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && domain.includes(value as T);
}

/** Count completions that raised sync intent. Unknown sources and non-positive counts are ignored. */
export function recordSubscriptionStatusMismatch(
  network: unknown,
  source: unknown,
  count = 1,
): boolean {
  if (!includes(SUBSCRIPTION_STATUS_SOURCES, source)) return false;
  if (!Number.isSafeInteger(count) || count < 1) return false;
  mismatchesTotal.inc({ network: normalizeNetwork(network), source }, count);
  return true;
}

export function recordSubscriptionStatusRefreshPage(
  network: unknown,
  outcome: unknown,
): boolean {
  if (!includes(SUBSCRIPTION_STATUS_REFRESH_OUTCOMES, outcome)) return false;
  refreshPagesTotal.inc({ network: normalizeNetwork(network), outcome });
  return true;
}

export function recordSubscriptionStatusRefreshCycleCompleted(
  network: unknown,
  completedAtMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(completedAtMs)) return false;
  refreshCycleCompleted.set({ network: normalizeNetwork(network) }, completedAtMs / 1_000);
  return true;
}

