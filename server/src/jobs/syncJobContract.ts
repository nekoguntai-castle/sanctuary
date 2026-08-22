import type { JobsOptions } from 'bullmq';
import {
  isSyncPriority,
  type SyncPriority,
} from '@sanctuary/shared/constants/sync';
import { getConfig } from '../config';
import { isFullResyncGeneration } from '../constants/fullResync';

/**
 * Current Redis wire version. Bump only for an incompatible payload change;
 * consumers must reject unknown versions while continuing to accept the
 * unversioned legacy v1 shape until retained jobs have drained.
 */
export const SYNC_JOB_CONTRACT_VERSION = 1 as const;
export const SYNC_WALLET_JOB_READER_VERSION = 2 as const;
export const SYNC_QUEUE_NAME = 'sync' as const;
export const SYNC_WALLET_JOB_NAME = 'sync-wallet' as const;
export const CHECK_STALE_WALLETS_JOB_NAME = 'check-stale-wallets' as const;
export const CONFIRMATIONS_QUEUE_NAME = 'confirmations' as const;
export const UPDATE_CONFIRMATIONS_JOB_NAME = 'update-confirmations' as const;
export const UPDATE_ALL_CONFIRMATIONS_JOB_NAME = 'update-all-confirmations' as const;

/** Missing version denotes the original v1 wire shape retained in BullMQ. */
export interface VersionedSyncJobContract {
  version?: typeof SYNC_JOB_CONTRACT_VERSION;
}

export interface SyncWalletJobFields {
  walletId: string;
  priority?: SyncPriority;
  reason?: string;
  /** Reset sync-derived wallet state once after exclusive lock acquisition. */
  fullResync?: boolean;
  /** Durable monotonic generation for exactly-once reset preparation across retries. */
  fullResyncGeneration?: number;
}

export interface SyncWalletLockContention {
  firstLockContentionAt: number;
  attemptEpoch: number;
}

/** Missing version remains the retained v1 wire shape. */
export interface SyncWalletJobDataV1 extends SyncWalletJobFields {
  version?: typeof SYNC_JOB_CONTRACT_VERSION;
  lockContention?: never;
}

/**
 * Reader-only compatibility shape. Producers remain on v1 until the compatible
 * consumer release has fully deployed.
 */
export interface SyncWalletJobDataV2 extends SyncWalletJobFields {
  version: typeof SYNC_WALLET_JOB_READER_VERSION;
  lockContention?: SyncWalletLockContention;
}

export type SyncWalletJobData = SyncWalletJobDataV1 | SyncWalletJobDataV2;

/** Canonical, explicitly versioned in-process shape returned by the wire reader. */
export type NormalizedSyncWalletJobData =
  | (Omit<SyncWalletJobDataV1, 'version'> & { version: typeof SYNC_JOB_CONTRACT_VERSION })
  | SyncWalletJobDataV2;

export interface SyncWalletLockContractState {
  version: typeof SYNC_JOB_CONTRACT_VERSION | typeof SYNC_WALLET_JOB_READER_VERSION;
  lockContention?: SyncWalletLockContention;
}

export interface CheckStaleWalletsJobData extends VersionedSyncJobContract {
  staleThresholdMs?: number;
  maxWallets?: number;
  priority?: SyncPriority;
  staggerDelayMs?: number;
  reason?: string;
}

export interface UpdateConfirmationsJobData extends VersionedSyncJobContract {
  height?: number;
  hash?: string;
}

export interface SyncWalletJobResult extends VersionedSyncJobContract {
  success: boolean;
  duration: number;
  transactionsFound?: number;
  utxosUpdated?: number;
  error?: string;
}

export interface CheckStaleWalletsResult extends VersionedSyncJobContract {
  staleWalletIds: string[];
  queued: number;
  priority: SyncPriority;
  staggerDelayMs: number;
  reason: string;
  maxWallets: number;
}

export interface UpdateConfirmationsResult extends VersionedSyncJobContract {
  updated: number;
  notified: number;
}

export interface FullResyncRequeueResult {
  acceptedWalletIds: string[];
  deduplicatedWalletIds: string[];
  indeterminateWallets: Array<{ walletId: string }>;
}

/** Producer port injected into worker job definitions at the process boundary. */
export interface SyncJobDependencies {
  enqueueFullResyncBatch: (
    walletIds: string[],
    options: { reason: string; staggerDelayMs?: number },
  ) => Promise<FullResyncRequeueResult>;
}

export const SYNC_WALLET_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

export const FULL_RESYNC_LOCK_RETRY_DELAY_MS = 5_000;
export const ORDINARY_SYNC_LOCK_RETRY_DELAY_MS = 15_000;
export const ORDINARY_SYNC_LOCK_RETRY_WINDOW_MS = 4 * 60_000;

/** One full sync plus slack for every key fencing a single sync attempt. */
export function getSyncLockTtlMs(): number {
  return getConfig().sync.maxSyncDurationMs + 60_000;
}

export function getSyncLockKey(data: Pick<SyncWalletJobFields, 'walletId'>): string {
  return `sync:wallet:${data.walletId}`;
}

export function getSyncLockRetryDelayMs(data: SyncWalletJobData): number {
  return data.fullResync === true
    ? FULL_RESYNC_LOCK_RETRY_DELAY_MS
    : ORDINARY_SYNC_LOCK_RETRY_DELAY_MS;
}

export function getSyncLockRetryWindowMs(data: SyncWalletJobData): number {
  return data.fullResync === true
    ? getSyncLockTtlMs()
    : ORDINARY_SYNC_LOCK_RETRY_WINDOW_MS;
}

/**
 * Resolve BullMQ retry delay from `attemptsMade`, the zero-based count of
 * already-failed executions. The first exponential retry therefore uses the
 * configured base delay, the second uses twice the base, and so on.
 */
export function getSyncJobBackoffDelayMs(
  attemptsMade: number,
  configured: JobsOptions['backoff'] = SYNC_WALLET_JOB_OPTIONS.backoff,
): number {
  if (typeof configured === 'number') return configured;
  const delay = configured!.delay ?? 0;
  return configured!.type === 'exponential'
    ? delay * (2 ** attemptsMade)
    : delay;
}

interface UnknownRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const readLockContention = (
  value: unknown,
): SyncWalletLockContention | undefined | null => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const record = value as unknown as UnknownRecord;
  if (Object.keys(record).some((key) => !['firstLockContentionAt', 'attemptEpoch'].includes(key))) {
    return null;
  }
  const firstLockContentionAt = record.firstLockContentionAt;
  const attemptEpoch = record.attemptEpoch;
  if (typeof firstLockContentionAt !== 'number'
    || !Number.isSafeInteger(firstLockContentionAt)
    || firstLockContentionAt <= 0) {
    return null;
  }
  if (typeof attemptEpoch !== 'number'
    || !Number.isSafeInteger(attemptEpoch)
    || attemptEpoch < 0) return null;
  return {
    firstLockContentionAt,
    attemptEpoch,
  };
};

const readSyncWalletJobFields = (
  value: UnknownRecord,
): SyncWalletJobFields | null => {
  const priority = value.priority;
  const reason = value.reason;
  const fullResync = value.fullResync;
  const generation = value.fullResyncGeneration;
  if (typeof value.walletId !== 'string' || value.walletId.trim().length === 0) return null;
  if (priority !== undefined && !isSyncPriority(priority)) return null;
  if (reason !== undefined && typeof reason !== 'string') return null;
  if (fullResync !== undefined && typeof fullResync !== 'boolean') return null;
  if (fullResync === true ? !isFullResyncGeneration(generation) : generation !== undefined) {
    return null;
  }
  const fields: SyncWalletJobFields = {
    walletId: value.walletId,
  };
  if (priority !== undefined) fields.priority = priority;
  if (reason !== undefined) fields.reason = reason;
  if (fullResync !== undefined) fields.fullResync = fullResync;
  if (typeof generation === 'number') fields.fullResyncGeneration = generation;
  return fields;
};

/** Parse retained unversioned/v1 and additive v2 wallet jobs. */
export function readSyncWalletJobData(value: unknown): NormalizedSyncWalletJobData | null {
  if (!isRecord(value)) return null;
  const record = value as UnknownRecord;
  const fields = readSyncWalletJobFields(record);
  if (fields === null) return null;
  const wireVersion = record.version ?? SYNC_JOB_CONTRACT_VERSION;
  if (wireVersion === SYNC_JOB_CONTRACT_VERSION) {
    if (record.lockContention !== undefined) return null;
    return { version: SYNC_JOB_CONTRACT_VERSION, ...fields };
  }
  if (wireVersion !== SYNC_WALLET_JOB_READER_VERSION) return null;
  const lockContention = readLockContention(record.lockContention);
  if (lockContention === null) return null;
  return {
    version: SYNC_WALLET_JOB_READER_VERSION,
    ...fields,
    ...(lockContention === undefined ? {} : { lockContention }),
  };
}

/** Accept both retained unversioned/v1 jobs and compatible v2 wallet jobs. */
export function isSyncWalletJobData(value: unknown): value is SyncWalletJobData {
  return readSyncWalletJobData(value) !== null;
}

export function hasSupportedSyncJobContractVersion(
  value: unknown,
): value is VersionedSyncJobContract {
  if (!isRecord(value)) return false;
  const record = value as UnknownRecord;
  return record.version === undefined || record.version === SYNC_JOB_CONTRACT_VERSION;
}

/**
 * Pre-lock validation deliberately checks only identity and wire compatibility.
 * Full-resync generation errors stay inside the handler so its lifecycle code
 * can persist truthful retry/failure state, but malformed jobs can never share
 * a synthetic `sync:wallet:undefined` lock.
 */
export function isSyncWalletJobLockData(
  value: unknown,
): value is SyncWalletJobData {
  if (!isRecord(value)) return false;
  const record = value as UnknownRecord;
  const version = record.version ?? SYNC_JOB_CONTRACT_VERSION;
  if (version !== SYNC_JOB_CONTRACT_VERSION && version !== SYNC_WALLET_JOB_READER_VERSION) {
    return false;
  }
  const lockContention = readLockContention(record.lockContention);
  if (lockContention === null) return false;
  if (version === SYNC_JOB_CONTRACT_VERSION && lockContention !== undefined) return false;
  return typeof record.walletId === 'string' && record.walletId.trim().length > 0;
}

/** Read the versioned lock clock after `isSyncWalletJobLockData` succeeds. */
export function readSyncWalletLockContractState(
  value: unknown,
): SyncWalletLockContractState | null {
  if (!isSyncWalletJobLockData(value)) return null;
  const record = value as unknown as UnknownRecord;
  const version = (record.version ?? SYNC_JOB_CONTRACT_VERSION) as
    SyncWalletLockContractState['version'];
  const lockContention = record.lockContention as SyncWalletLockContention | undefined;
  return {
    version,
    ...(lockContention === undefined ? {} : { lockContention }),
  };
}

export function isCheckStaleWalletsJobData(
  value: unknown,
): value is CheckStaleWalletsJobData {
  if (!isRecord(value) || !hasSupportedSyncJobContractVersion(value)) return false;
  const data = value as Record<string, unknown>;
  return (data.staleThresholdMs === undefined || typeof data.staleThresholdMs === 'number')
    && (data.maxWallets === undefined || typeof data.maxWallets === 'number')
    && (data.priority === undefined || isSyncPriority(data.priority))
    && (data.staggerDelayMs === undefined || typeof data.staggerDelayMs === 'number')
    && (data.reason === undefined || typeof data.reason === 'string');
}

export function isUpdateConfirmationsJobData(
  value: unknown,
): value is UpdateConfirmationsJobData {
  if (!isRecord(value) || !hasSupportedSyncJobContractVersion(value)) return false;
  const data = value as Record<string, unknown>;
  return (data.height === undefined || typeof data.height === 'number')
    && (data.hash === undefined || typeof data.hash === 'string');
}
