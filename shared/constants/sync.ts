/**
 * Canonical wallet sync priority values.
 *
 * HTTP sync routes, frontend API helpers, in-memory sync queues, and BullMQ
 * worker queues all use this same priority vocabulary.
 */

export const SYNC_PRIORITY_VALUES = ['high', 'normal', 'low'] as const;
export type SyncPriority = (typeof SYNC_PRIORITY_VALUES)[number];

/** Adapter that owns the current persisted sync attempt. */
export const SYNC_EXECUTION_OWNER_VALUES = ['inline', 'worker'] as const;
export type SyncExecutionOwner = (typeof SYNC_EXECUTION_OWNER_VALUES)[number];

/** Persisted lifecycle transitions that may be published to sync observers. */
export const SYNC_LIFECYCLE_TRANSITION_VALUES = [
  'requested',
  'started',
  'succeeded',
  'retrying',
  'failed',
  'cleared',
] as const;
export type SyncLifecycleTransitionKind =
  (typeof SYNC_LIFECYCLE_TRANSITION_VALUES)[number];

/**
 * Privacy-safe failure taxonomy persisted with wallet sync state.
 *
 * Free-form diagnostic detail remains in `lastSyncError`; only these bounded
 * values are suitable for control flow and aggregate support diagnostics.
 */
export const WALLET_SYNC_FAILURE_CLASS_VALUES = [
  'electrum_unavailable',
  'node_rpc_unavailable',
  'descriptor_policy_missing',
  'canonical_evidence_missing',
  'evidence_authentication_failed',
  'lock_contention',
  'timeout',
  'sync_cancelled',
  'database_unavailable',
  'other',
] as const;
export type WalletSyncFailureClass = (typeof WALLET_SYNC_FAILURE_CLASS_VALUES)[number];

export const DEFAULT_SYNC_PRIORITY: SyncPriority = 'normal';

export const SYNC_PRIORITY_SORT_ORDER: Record<SyncPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export const SYNC_PRIORITY_BULLMQ_PRIORITY: Record<SyncPriority, number> = {
  high: 1,
  normal: 2,
  low: 3,
};

export function isSyncPriority(value: unknown): value is SyncPriority {
  return typeof value === 'string' && (SYNC_PRIORITY_VALUES as readonly string[]).includes(value);
}

export function isSyncExecutionOwner(value: unknown): value is SyncExecutionOwner {
  return typeof value === 'string'
    && (SYNC_EXECUTION_OWNER_VALUES as readonly string[]).includes(value);
}

export function isWalletSyncFailureClass(value: unknown): value is WalletSyncFailureClass {
  return typeof value === 'string'
    && (WALLET_SYNC_FAILURE_CLASS_VALUES as readonly string[]).includes(value);
}
