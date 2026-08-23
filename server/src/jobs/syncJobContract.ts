import type { JobsOptions } from 'bullmq';
import {
  isSyncPriority,
  type SyncPriority,
} from '@sanctuary/shared/constants/sync';
import { getConfig } from '../config';
import {
  FULL_RESYNC_GENERATION_MAX,
  isFullResyncGeneration,
} from '../constants/fullResync';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../constants/walletSyncActivation';

/**
 * Current Redis wire version. Bump only for an incompatible payload change;
 * consumers must reject unknown versions while continuing to parse the
 * unversioned legacy v1 shape so retained work can be bridged to durable intent.
 */
export const SYNC_JOB_CONTRACT_VERSION = 1 as const;
export const SYNC_WALLET_JOB_READER_VERSION = 2 as const;
export const SYNC_WALLET_MUTATION_FENCE_JOB_VERSION = 3 as const;
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
  incrementalSyncGeneration?: never;
}

/**
 * Generation-aware compatibility shape retained for rolling-upgrade reads.
 */
interface SyncWalletJobDataV2Base {
  version: typeof SYNC_WALLET_JOB_READER_VERSION;
  lockContention?: SyncWalletLockContention;
}

export type SyncWalletJobDataV2 = SyncWalletJobDataV2Base & (
  | (SyncWalletJobFields & { incrementalSyncGeneration?: never })
  | (Omit<SyncWalletJobFields, 'fullResync' | 'fullResyncGeneration'> & {
      /** Durable incremental intent generation carried only by canonical wallet-v2 wake-ups. */
      incrementalSyncGeneration: number;
      fullResync?: never;
      fullResyncGeneration?: never;
    })
);

/**
 * Canonical wake-up emitted only after the mutation-fence rollout floor is
 * active. A pre-floor v2 reader rejects this version before acquiring a lock.
 */
interface SyncWalletJobDataV3Base {
  version: typeof SYNC_WALLET_MUTATION_FENCE_JOB_VERSION;
  incrementalSyncGeneration: number;
  requiredMutationFenceFloor: typeof WALLET_SYNC_MUTATION_FENCE_FLOOR;
  lockContention?: SyncWalletLockContention;
}

export type SyncWalletJobDataV3 = SyncWalletJobDataV3Base & (
  | (Omit<SyncWalletJobFields, 'fullResync' | 'fullResyncGeneration'> & {
      fullResync?: never;
      fullResyncGeneration?: never;
    })
  | (SyncWalletJobFields & {
      fullResync: true;
      fullResyncGeneration: number;
    })
);

export type SyncWalletJobData =
  | SyncWalletJobDataV1
  | SyncWalletJobDataV2
  | SyncWalletJobDataV3;

/** Canonical, explicitly versioned in-process shape returned by the wire reader. */
export type NormalizedSyncWalletJobData =
  | (Omit<SyncWalletJobDataV1, 'version'> & { version: typeof SYNC_JOB_CONTRACT_VERSION })
  | SyncWalletJobDataV2
  | SyncWalletJobDataV3;

export interface SyncWalletLockContractState {
  version:
    | typeof SYNC_JOB_CONTRACT_VERSION
    | typeof SYNC_WALLET_JOB_READER_VERSION
    | typeof SYNC_WALLET_MUTATION_FENCE_JOB_VERSION;
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

/** Producer port injected into worker job definitions at the process boundary. */
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

function isIncrementalSyncGeneration(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= FULL_RESYNC_GENERATION_MAX;
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

type ReadSyncWalletJobFields = SyncWalletJobFields & {
  incrementalSyncGeneration?: number;
};

const hasValidWalletJobBaseFields = (value: UnknownRecord): boolean => {
  return typeof value.walletId === 'string'
    && value.walletId.trim().length > 0
    && (value.priority === undefined || isSyncPriority(value.priority))
    && (value.reason === undefined || typeof value.reason === 'string');
};

const hasValidFullResyncFields = (value: UnknownRecord): boolean => {
  if (value.fullResync !== undefined && typeof value.fullResync !== 'boolean') return false;
  return value.fullResync === true
    ? isFullResyncGeneration(value.fullResyncGeneration)
    : value.fullResyncGeneration === undefined;
};

const hasValidIncrementalGeneration = (value: UnknownRecord): boolean => {
  if (value.incrementalSyncGeneration === undefined) return true;
  return isIncrementalSyncGeneration(value.incrementalSyncGeneration);
};

const buildSyncWalletJobFields = (value: UnknownRecord): ReadSyncWalletJobFields => {
  const fields: ReadSyncWalletJobFields = { walletId: value.walletId as string };
  if (value.priority !== undefined) fields.priority = value.priority as SyncPriority;
  if (typeof value.reason === 'string') fields.reason = value.reason;
  if (typeof value.fullResync === 'boolean') fields.fullResync = value.fullResync;
  if (typeof value.fullResyncGeneration === 'number') {
    fields.fullResyncGeneration = value.fullResyncGeneration;
  }
  if (typeof value.incrementalSyncGeneration === 'number') {
    fields.incrementalSyncGeneration = value.incrementalSyncGeneration;
  }
  return fields;
};

const readSyncWalletJobFields = (
  value: UnknownRecord,
): ReadSyncWalletJobFields | null => {
  if (!hasValidWalletJobBaseFields(value)
    || !hasValidFullResyncFields(value)
    || !hasValidIncrementalGeneration(value)) return null;
  return buildSyncWalletJobFields(value);
};

function buildVersionedSyncWalletJob(
  version:
    | typeof SYNC_WALLET_JOB_READER_VERSION
    | typeof SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
  fields: ReadSyncWalletJobFields,
  lockContention: SyncWalletLockContention | undefined,
): SyncWalletJobDataV2 | SyncWalletJobDataV3 | null {
  if (version === SYNC_WALLET_MUTATION_FENCE_JOB_VERSION) {
    if (fields.incrementalSyncGeneration === undefined) return null;
    if (fields.fullResync !== undefined && fields.fullResync !== true) return null;
    const commonV3 = {
      version,
      ...(lockContention === undefined ? {} : { lockContention }),
      walletId: fields.walletId,
      ...(fields.priority === undefined ? {} : { priority: fields.priority }),
      ...(fields.reason === undefined ? {} : { reason: fields.reason }),
      incrementalSyncGeneration: fields.incrementalSyncGeneration,
      requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    };
    if (fields.fullResync === true) {
      return {
        ...commonV3,
        fullResync: true,
        fullResyncGeneration: fields.fullResyncGeneration!,
      };
    }
    return commonV3;
  }
  if (fields.incrementalSyncGeneration !== undefined && fields.fullResync === true) return null;
  if (fields.incrementalSyncGeneration !== undefined && fields.fullResync !== undefined) return null;
  const commonV2 = {
    version,
    ...(lockContention === undefined ? {} : { lockContention }),
  };
  if (fields.incrementalSyncGeneration !== undefined) {
    const {
      incrementalSyncGeneration,
      fullResync: _fullResync,
      fullResyncGeneration: _fullResyncGeneration,
      ...ordinaryFields
    } = fields;
    return { ...commonV2, ...ordinaryFields, incrementalSyncGeneration };
  }
  const { incrementalSyncGeneration: _incrementalGeneration, ...legacyV2Fields } = fields;
  return { ...commonV2, ...legacyV2Fields };
}

/** Parse retained unversioned/v1, additive v2, and fenced canonical v3 jobs. */
export function readSyncWalletJobData(value: unknown): NormalizedSyncWalletJobData | null {
  if (!isRecord(value)) return null;
  const record = value as UnknownRecord;
  const fields = readSyncWalletJobFields(record);
  if (fields === null) return null;
  const wireVersion = record.version ?? SYNC_JOB_CONTRACT_VERSION;
  if (wireVersion === SYNC_JOB_CONTRACT_VERSION) {
    if (
      record.lockContention !== undefined
      || record.requiredMutationFenceFloor !== undefined
      || fields.incrementalSyncGeneration !== undefined
    ) {
      return null;
    }
    const { incrementalSyncGeneration: _v2Generation, ...v1Fields } = fields;
    return { version: SYNC_JOB_CONTRACT_VERSION, ...v1Fields };
  }
  if (
    wireVersion !== SYNC_WALLET_JOB_READER_VERSION
    && wireVersion !== SYNC_WALLET_MUTATION_FENCE_JOB_VERSION
  ) return null;
  const lockContention = readLockContention(record.lockContention);
  if (lockContention === null) return null;
  if (wireVersion === SYNC_WALLET_JOB_READER_VERSION) {
    if (record.requiredMutationFenceFloor !== undefined) return null;
    return buildVersionedSyncWalletJob(wireVersion, fields, lockContention);
  }
  if (record.requiredMutationFenceFloor !== WALLET_SYNC_MUTATION_FENCE_FLOOR) {
    return null;
  }
  return buildVersionedSyncWalletJob(wireVersion, fields, lockContention);
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

type SupportedSyncWalletJobVersion = SyncWalletLockContractState['version'];

function isSupportedSyncWalletJobVersion(
  version: unknown,
): version is SupportedSyncWalletJobVersion {
  return version === SYNC_JOB_CONTRACT_VERSION
    || version === SYNC_WALLET_JOB_READER_VERSION
    || version === SYNC_WALLET_MUTATION_FENCE_JOB_VERSION;
}

function hasValidMutationFenceFloor(
  record: UnknownRecord,
  version: SupportedSyncWalletJobVersion,
): boolean {
  if (version === SYNC_WALLET_MUTATION_FENCE_JOB_VERSION) {
    return record.requiredMutationFenceFloor === WALLET_SYNC_MUTATION_FENCE_FLOOR;
  }
  return record.requiredMutationFenceFloor === undefined;
}

function hasValidLockIncrementalGeneration(
  record: UnknownRecord,
  version: SupportedSyncWalletJobVersion,
): boolean {
  const generation = record.incrementalSyncGeneration;
  if (version === SYNC_WALLET_MUTATION_FENCE_JOB_VERSION && generation === undefined) {
    return false;
  }
  if (generation === undefined) return true;
  if (version === SYNC_JOB_CONTRACT_VERSION || !isIncrementalSyncGeneration(generation)) {
    return false;
  }
  if (version === SYNC_WALLET_MUTATION_FENCE_JOB_VERSION && record.fullResync === true) {
    return isFullResyncGeneration(record.fullResyncGeneration);
  }
  return record.fullResync === undefined && record.fullResyncGeneration === undefined;
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
  if (!isSupportedSyncWalletJobVersion(version)) return false;
  const lockContention = readLockContention(record.lockContention);
  if (lockContention === null) return false;
  if (version === SYNC_JOB_CONTRACT_VERSION && lockContention !== undefined) return false;
  return hasValidMutationFenceFloor(record, version)
    && hasValidLockIncrementalGeneration(record, version)
    && typeof record.walletId === 'string'
    && record.walletId.trim().length > 0;
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
