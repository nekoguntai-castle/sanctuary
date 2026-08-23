import type {
  SyncExecutionOwner,
  WalletSyncFailureClass,
} from '@sanctuary/shared/constants/sync';
import type { WebSocketSyncData } from '../types';

/**
 * Public sync snapshot carried by the live WebSocket event.
 *
 * Reuse the frontend's public WebSocket contract so every consumer and this
 * reducer evolve together.
 */
export type SyncSnapshotEvent = WebSocketSyncData;

export interface WalletSyncSnapshotFields {
  syncInProgress?: boolean;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
  lastSyncFailureClass?: WalletSyncFailureClass | null;
  syncExecutionOwner?: SyncExecutionOwner | null;
  syncRetryCount?: number;
  syncNextRetryAt?: string | null;
  syncStartedAt?: string | null;
  syncStateVersion?: number;
  lastSyncedAt?: string | null;
  requestedIncrementalSyncGeneration?: number;
  claimedIncrementalSyncGeneration?: number;
  processedIncrementalSyncGeneration?: number;
  incrementalSyncClaimedAt?: string | null;
  incrementalSyncLeaseExpiresAt?: string | null;
  syncActionRequiredAt?: string | null;
  requestedFullResyncGeneration?: number;
  preparedFullResyncGeneration?: number;
  processedFullResyncGeneration?: number;
}

const syncSnapshotFields = (
  wallet: WalletSyncSnapshotFields,
): WalletSyncSnapshotFields => ({
  syncInProgress: wallet.syncInProgress,
  lastSyncStatus: wallet.lastSyncStatus,
  lastSyncError: wallet.lastSyncError,
  lastSyncFailureClass: wallet.lastSyncFailureClass,
  syncExecutionOwner: wallet.syncExecutionOwner,
  syncRetryCount: wallet.syncRetryCount,
  syncNextRetryAt: wallet.syncNextRetryAt,
  syncStartedAt: wallet.syncStartedAt,
  syncStateVersion: wallet.syncStateVersion,
  lastSyncedAt: wallet.lastSyncedAt,
  requestedIncrementalSyncGeneration: wallet.requestedIncrementalSyncGeneration,
  claimedIncrementalSyncGeneration: wallet.claimedIncrementalSyncGeneration,
  processedIncrementalSyncGeneration: wallet.processedIncrementalSyncGeneration,
  incrementalSyncClaimedAt: wallet.incrementalSyncClaimedAt,
  incrementalSyncLeaseExpiresAt: wallet.incrementalSyncLeaseExpiresAt,
  syncActionRequiredAt: wallet.syncActionRequiredAt,
  requestedFullResyncGeneration: wallet.requestedFullResyncGeneration,
  preparedFullResyncGeneration: wallet.preparedFullResyncGeneration,
  processedFullResyncGeneration: wallet.processedFullResyncGeneration,
});

function isValidStateVersion(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0;
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasSnapshotValue(
  snapshot: SyncSnapshotEvent,
  key: string,
): boolean {
  // Versioned snapshots are authoritative; legacy partial events preserve
  // cache fields that were omitted from their older wire shape.
  const values = snapshot as unknown as Record<string, unknown>;
  return hasOwn(snapshot, key)
    && (snapshot.stateVersion !== undefined || values[key] !== undefined);
}

/**
 * A versioned cache is authoritative over versionless compatibility events.
 * Equal versions are duplicates, while lower versions arrived out of order.
 */
export function isApplicableSyncSnapshot(
  currentVersion: number | undefined,
  incomingVersion: number | undefined,
): boolean {
  if (
    incomingVersion !== undefined
    && (!Number.isSafeInteger(incomingVersion) || incomingVersion < 0)
  ) return false;
  if (
    currentVersion === undefined
    || !Number.isSafeInteger(currentVersion)
    || currentVersion < 0
  ) return true;
  if (incomingVersion === undefined) return false;
  return incomingVersion > currentVersion;
}

/**
 * Merge an HTTP wallet response without letting an older in-flight response
 * overwrite a newer WebSocket snapshot. Non-sync HTTP fields remain fresh.
 */
export function mergeWalletHttpSyncState<T extends WalletSyncSnapshotFields>(
  current: WalletSyncSnapshotFields | null | undefined,
  incoming: T,
): T {
  if (!current || !isValidStateVersion(current.syncStateVersion)) return incoming;
  const incomingVersion = incoming.syncStateVersion;
  if (isValidStateVersion(incomingVersion) && incomingVersion >= current.syncStateVersion) {
    return incoming;
  }
  return { ...incoming, ...syncSnapshotFields(current) };
}

export function mergeWalletListHttpSyncState<
  T extends WalletSyncSnapshotFields & { id: string },
>(current: T[] | undefined, incoming: T[]): T[] {
  if (!current) return incoming;
  const currentById = new Map(current.map(wallet => [wallet.id, wallet]));
  return incoming.map(wallet => mergeWalletHttpSyncState(currentById.get(wallet.id), wallet));
}

const coreSyncSnapshotPatch = (
  snapshot: SyncSnapshotEvent,
): WalletSyncSnapshotFields => {
  const patch: WalletSyncSnapshotFields = {};
  if (hasSnapshotValue(snapshot, 'inProgress')) patch.syncInProgress = snapshot.inProgress;
  if (hasSnapshotValue(snapshot, 'error')) patch.lastSyncError = snapshot.error;
  if (hasSnapshotValue(snapshot, 'failureClass')) patch.lastSyncFailureClass = snapshot.failureClass;
  if (hasSnapshotValue(snapshot, 'executionOwner')) patch.syncExecutionOwner = snapshot.executionOwner;
  if (hasSnapshotValue(snapshot, 'retryCount')) patch.syncRetryCount = snapshot.retryCount;
  if (hasSnapshotValue(snapshot, 'nextRetryAt')) patch.syncNextRetryAt = snapshot.nextRetryAt;
  if (hasSnapshotValue(snapshot, 'startedAt')) patch.syncStartedAt = snapshot.startedAt;
  if (hasSnapshotValue(snapshot, 'stateVersion')) patch.syncStateVersion = snapshot.stateVersion;
  return patch;
};

const incrementalIntentSnapshotPatch = (
  snapshot: SyncSnapshotEvent,
): WalletSyncSnapshotFields => {
  const patch: WalletSyncSnapshotFields = {};
  if (hasSnapshotValue(snapshot, 'requestedIncrementalSyncGeneration')) {
    patch.requestedIncrementalSyncGeneration = snapshot.requestedIncrementalSyncGeneration;
  }
  if (hasSnapshotValue(snapshot, 'claimedIncrementalSyncGeneration')) {
    patch.claimedIncrementalSyncGeneration = snapshot.claimedIncrementalSyncGeneration;
  }
  if (hasSnapshotValue(snapshot, 'processedIncrementalSyncGeneration')) {
    patch.processedIncrementalSyncGeneration = snapshot.processedIncrementalSyncGeneration;
  }
  if (hasSnapshotValue(snapshot, 'incrementalSyncClaimedAt')) {
    patch.incrementalSyncClaimedAt = snapshot.incrementalSyncClaimedAt;
  }
  if (hasSnapshotValue(snapshot, 'incrementalSyncLeaseExpiresAt')) {
    patch.incrementalSyncLeaseExpiresAt = snapshot.incrementalSyncLeaseExpiresAt;
  }
  if (hasSnapshotValue(snapshot, 'syncActionRequiredAt')) {
    patch.syncActionRequiredAt = snapshot.syncActionRequiredAt;
  }
  return patch;
};

const fullResyncSnapshotPatch = (
  snapshot: SyncSnapshotEvent,
): WalletSyncSnapshotFields => {
  const patch: WalletSyncSnapshotFields = {};
  if (hasSnapshotValue(snapshot, 'requestedFullResyncGeneration')) {
    patch.requestedFullResyncGeneration = snapshot.requestedFullResyncGeneration;
  }
  if (hasSnapshotValue(snapshot, 'preparedFullResyncGeneration')) {
    patch.preparedFullResyncGeneration = snapshot.preparedFullResyncGeneration;
  }
  if (hasSnapshotValue(snapshot, 'processedFullResyncGeneration')) {
    patch.processedFullResyncGeneration = snapshot.processedFullResyncGeneration;
  }
  return patch;
};

const directSyncSnapshotPatch = (
  snapshot: SyncSnapshotEvent,
): WalletSyncSnapshotFields => ({
  ...coreSyncSnapshotPatch(snapshot),
  ...incrementalIntentSnapshotPatch(snapshot),
  ...fullResyncSnapshotPatch(snapshot),
});

const syncStatusPatch = (snapshot: SyncSnapshotEvent): WalletSyncSnapshotFields => {
  if (hasSnapshotValue(snapshot, 'syncStatus')) {
    return { lastSyncStatus: snapshot.syncStatus };
  }
  if (
    hasSnapshotValue(snapshot, 'status')
    && !(snapshot.stateVersion === undefined && snapshot.status === '')
  ) {
    return { lastSyncStatus: snapshot.status };
  }
  return {};
};

const lastSyncedAtPatch = (snapshot: SyncSnapshotEvent): WalletSyncSnapshotFields => {
  if (hasSnapshotValue(snapshot, 'lastSyncedAt')) {
    return { lastSyncedAt: snapshot.lastSyncedAt };
  }
  if (
    snapshot.stateVersion === undefined
    && snapshot.inProgress === false
    && snapshot.status === 'success'
  ) {
    // Compatibility for pre-version publisher events, which omitted the
    // timestamp. Versioned snapshots must always use the persisted value.
    return { lastSyncedAt: new Date().toISOString() };
  }
  return {};
};

/** Apply one complete persisted snapshot without allowing cache regression. */
export function applyAuthoritativeSyncSnapshot<T extends object>(
  wallet: T,
  snapshot: SyncSnapshotEvent,
): T & WalletSyncSnapshotFields {
  const current = wallet as T & WalletSyncSnapshotFields;
  if (!isApplicableSyncSnapshot(current.syncStateVersion, snapshot.stateVersion)) {
    return current;
  }

  return {
    ...wallet,
    ...directSyncSnapshotPatch(snapshot),
    ...syncStatusPatch(snapshot),
    ...lastSyncedAtPatch(snapshot),
  };
}
