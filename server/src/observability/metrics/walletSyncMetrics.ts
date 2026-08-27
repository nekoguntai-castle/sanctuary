/** Low-cardinality Prometheus metrics for wallet-sync execution and recovery. */

import { Counter, Gauge, Histogram } from 'prom-client';
import {
  SYNC_EXECUTION_STAGES,
  type SyncExecutionStage,
} from '@sanctuary/shared/schemas/syncProgress';
import { BITCOIN_NETWORKS, type NetworkType } from '@sanctuary/shared/constants/bitcoin';
import { registry } from './registry';

export const WALLET_SYNC_METRIC_STAGES = [...SYNC_EXECUTION_STAGES, 'other'] as const;
export const WALLET_SYNC_METRIC_MODES = ['incremental', 'full_resync', 'other'] as const;
export const WALLET_SYNC_METRIC_NETWORKS = [...BITCOIN_NETWORKS, 'other'] as const;
export const WALLET_SYNC_STAGE_OUTCOMES = [
  'completed',
  'failed',
  'budget_expired',
  'aborted',
] as const;
export const WALLET_SYNC_CANDIDATE_OUTCOMES = ['fetched', 'rejected'] as const;
export const WALLET_SYNC_TERMINAL_OUTCOMES = ['timeout', 'aborted'] as const;
export const WALLET_SYNC_LOCK_SCOPES = [
  'wallet_sync',
  'electrum_subscription',
  'worker_maintenance',
  'other',
] as const;
export const WALLET_SYNC_LOCK_LOSSES = ['renewal_lost', 'ownership_mismatch'] as const;
export const WALLET_SYNC_CLEANUP_OUTCOMES = [
  'flag_cleared',
  'intent_requeued',
  'lock_present_deferred',
  'no_change',
  'error',
] as const;

type MetricStage = typeof WALLET_SYNC_METRIC_STAGES[number];
type MetricMode = typeof WALLET_SYNC_METRIC_MODES[number];
type MetricNetwork = typeof WALLET_SYNC_METRIC_NETWORKS[number];
export type WalletSyncStageOutcome = typeof WALLET_SYNC_STAGE_OUTCOMES[number];
export type WalletSyncCandidateOutcome = typeof WALLET_SYNC_CANDIDATE_OUTCOMES[number];
export type WalletSyncTerminalOutcome = typeof WALLET_SYNC_TERMINAL_OUTCOMES[number];
export type WalletSyncLockScope = typeof WALLET_SYNC_LOCK_SCOPES[number];
export type WalletSyncLockLoss = typeof WALLET_SYNC_LOCK_LOSSES[number];
export type WalletSyncCleanupOutcome = typeof WALLET_SYNC_CLEANUP_OUTCOMES[number];

const stageDuration = new Histogram({
  name: 'sanctuary_wallet_sync_stage_duration_seconds',
  help: 'Wallet sync stage duration by fixed execution dimensions',
  labelNames: ['stage', 'mode', 'network', 'outcome'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300, 330, 600, 900, 1800, 1830],
  registers: [registry],
});

const activeStage = new Gauge({
  name: 'sanctuary_wallet_sync_active_stage',
  help: 'Active wallet sync executions by fixed stage dimensions',
  labelNames: ['stage', 'mode', 'network'],
  registers: [registry],
});

interface ActiveStageRecord {
  labels: { stage: MetricStage; mode: MetricMode; network: MetricNetwork };
  startedAtMs: number;
  now: () => number;
}

const activeStageRecords = new Map<symbol, ActiveStageRecord>();
const seenActiveStageDimensions = new Map<string, ActiveStageRecord['labels']>();

function dimensionKey(labels: ActiveStageRecord['labels']): string {
  return `${labels.stage}\0${labels.mode}\0${labels.network}`;
}

const activeStageOldest = new Gauge({
  name: 'sanctuary_wallet_sync_active_stage_oldest_seconds',
  help: 'Age of the oldest active wallet sync execution by fixed stage dimensions',
  labelNames: ['stage', 'mode', 'network'],
  registers: [registry],
  collect() {
    this.reset();
    const oldestByDimension = new Map<string, {
      labels: ActiveStageRecord['labels'];
      ageSeconds: number;
    }>();
    for (const [key, labels] of seenActiveStageDimensions) {
      oldestByDimension.set(key, { labels, ageSeconds: 0 });
    }
    for (const record of activeStageRecords.values()) {
      const key = dimensionKey(record.labels);
      const ageSeconds = elapsedSeconds(record.startedAtMs, record.now);
      const current = oldestByDimension.get(key);
      if (!current || ageSeconds > current.ageSeconds) {
        oldestByDimension.set(key, { labels: record.labels, ageSeconds });
      }
    }
    for (const { labels, ageSeconds } of oldestByDimension.values()) {
      this.set(labels, ageSeconds);
    }
  },
});

const fallbackTotal = new Counter({
  name: 'sanctuary_wallet_sync_fallback_total',
  help: 'Wallet sync fallback transitions by fixed stage dimensions',
  labelNames: ['stage', 'mode', 'network'],
  registers: [registry],
});

const budgetExpiryTotal = new Counter({
  name: 'sanctuary_wallet_sync_budget_expiry_total',
  help: 'Wallet sync stage budget expirations by fixed stage dimensions',
  labelNames: ['stage', 'mode', 'network'],
  registers: [registry],
});

const candidatesTotal = new Counter({
  name: 'sanctuary_wallet_sync_candidates_total',
  help: 'Wallet sync transaction candidates by fixed outcome',
  labelNames: ['outcome'],
  registers: [registry],
});

const terminalTotal = new Counter({
  name: 'sanctuary_wallet_sync_terminal_total',
  help: 'Wallet sync timeout and abort terminal outcomes',
  labelNames: ['outcome'],
  registers: [registry],
});

const abortGraceExhaustedTotal = new Counter({
  name: 'sanctuary_wallet_sync_abort_grace_exhausted_total',
  help: 'Wallet sync attempts that did not settle inside abort grace',
  registers: [registry],
});

const lockLossTotal = new Counter({
  name: 'sanctuary_wallet_sync_lock_loss_total',
  help: 'Distributed lock ownership losses by fixed scope and loss class',
  labelNames: ['scope', 'loss'],
  registers: [registry],
});

const cleanupTotal = new Counter({
  name: 'sanctuary_wallet_sync_cleanup_total',
  help: 'Stale wallet sync reconciliation decisions by fixed outcome',
  labelNames: ['outcome'],
  registers: [registry],
});

interface StageDimensions {
  stage: unknown;
  mode: unknown;
  network: unknown;
}

export interface EnterWalletSyncStageOptions extends StageDimensions {
  startedAtMs?: number;
  now?: () => number;
}

function includes<T extends string>(domain: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && domain.includes(value as T);
}

function normalizeStage(value: unknown): MetricStage {
  return includes<SyncExecutionStage>(SYNC_EXECUTION_STAGES, value) ? value : 'other';
}

function normalizeMode(value: unknown): MetricMode {
  return includes(WALLET_SYNC_METRIC_MODES, value) ? value : 'other';
}

function normalizeNetwork(value: unknown): MetricNetwork {
  return includes<NetworkType>(BITCOIN_NETWORKS, value) ? value : 'other';
}

function normalizeDimensions(input: StageDimensions): {
  stage: MetricStage;
  mode: MetricMode;
  network: MetricNetwork;
} {
  return {
    stage: normalizeStage(input.stage),
    mode: normalizeMode(input.mode),
    network: normalizeNetwork(input.network),
  };
}

function elapsedSeconds(startedAtMs: number, now: () => number): number {
  const endedAtMs = now();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) return 0;
  return Math.max(0, endedAtMs - startedAtMs) / 1_000;
}

/**
 * Increment an active-stage gauge and return an idempotent terminal callback.
 * The callback both decrements the gauge and records the stage duration.
 */
export function enterWalletSyncStage(options: EnterWalletSyncStageOptions): (
  outcome: WalletSyncStageOutcome,
  finishedAtMs?: number,
) => void {
  const labels = normalizeDimensions(options);
  const now = options.now ?? Date.now;
  const initialNow = now();
  const startedAtMs = Number.isFinite(options.startedAtMs)
    ? options.startedAtMs as number
    : Number.isFinite(initialNow) ? initialNow : 0;
  const handle = Symbol('wallet-sync-stage');
  let finished = false;
  activeStageRecords.set(handle, { labels, startedAtMs, now });
  seenActiveStageDimensions.set(dimensionKey(labels), labels);
  activeStage.inc(labels);
  return (outcome, finishedAtMs): void => {
    if (finished) return;
    finished = true;
    activeStageRecords.delete(handle);
    activeStage.dec(labels);
    const safeOutcome = includes(WALLET_SYNC_STAGE_OUTCOMES, outcome) ? outcome : 'failed';
    stageDuration.observe(
      { ...labels, outcome: safeOutcome },
      elapsedSeconds(startedAtMs, () => finishedAtMs ?? now()),
    );
  };
}

export function recordWalletSyncFallback(input: StageDimensions): void {
  fallbackTotal.inc(normalizeDimensions(input));
}

export function recordWalletSyncBudgetExpiry(input: StageDimensions): void {
  budgetExpiryTotal.inc(normalizeDimensions(input));
}

function isValidIncrement(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function recordWalletSyncCandidateOutcome(
  outcome: unknown,
  count = 1,
): boolean {
  if (!includes(WALLET_SYNC_CANDIDATE_OUTCOMES, outcome) || !isValidIncrement(count)) {
    return false;
  }
  candidatesTotal.inc({ outcome }, count);
  return true;
}

export function recordWalletSyncTerminalOutcome(outcome: unknown): boolean {
  if (!includes(WALLET_SYNC_TERMINAL_OUTCOMES, outcome)) return false;
  terminalTotal.inc({ outcome });
  return true;
}

export function recordWalletSyncAbortGraceExhaustion(): void {
  abortGraceExhaustedTotal.inc();
}

export function classifyDistributedLockScope(lockKey: unknown): WalletSyncLockScope {
  if (typeof lockKey !== 'string') return 'other';
  if (lockKey.startsWith('sync:wallet:')) return 'wallet_sync';
  if (lockKey === 'electrum:subscriptions') return 'electrum_subscription';
  if (lockKey.startsWith('maintenance:')) return 'worker_maintenance';
  return 'other';
}

export function recordWalletSyncLockLoss(scope: unknown, loss: unknown): boolean {
  if (!includes(WALLET_SYNC_LOCK_LOSSES, loss)) return false;
  const safeScope = includes(WALLET_SYNC_LOCK_SCOPES, scope) ? scope : 'other';
  lockLossTotal.inc({ scope: safeScope, loss });
  return true;
}

export function recordWalletSyncCleanupOutcome(outcome: unknown, count = 1): boolean {
  if (!includes(WALLET_SYNC_CLEANUP_OUTCOMES, outcome) || !isValidIncrement(count)) {
    return false;
  }
  cleanupTotal.inc({ outcome }, count);
  return true;
}
