/**
 * WebSocket Event Versioning
 *
 * Provides backward-compatible event evolution with version negotiation.
 * Allows clients to receive events in their preferred format version.
 *
 * Version Strategy:
 * - Major version: Breaking changes (field removals, type changes)
 * - Events include version metadata for client interpretation
 * - Transformers convert between versions for compatibility
 */

import { createLogger } from '../utils/logger';

const log = createLogger('WS:VERSION');

export type EventVersion = 'v1' | 'v2';

export const CURRENT_VERSION: EventVersion = 'v2';
export const SUPPORTED_VERSIONS: EventVersion[] = ['v1', 'v2'];

/**
 * Base event envelope with version metadata
 */
export interface VersionedEvent<T = unknown> {
  /** Event type identifier */
  type: string;
  /** Event version */
  version: EventVersion;
  /** Event payload */
  data: T;
  /** Timestamp of event creation */
  timestamp: string;
  /** Optional correlation ID for request tracking */
  correlationId?: string;
}

/**
 * Event transformer function signature
 */
export type EventTransformer = (event: VersionedEvent<unknown>) => VersionedEvent<unknown>;

/**
 * Version-specific event data types
 */
export namespace EventDataV1 {
  export interface WalletSynced {
    walletId: string;
    balance: number;
  }

  export interface TransactionConfirmed {
    txid: string;
    confirmations: number;
  }

  export interface TransactionReceived {
    txid: string;
    amount: number;
    walletId: string;
  }

  export interface AddressUsed {
    address: string;
    walletId: string;
  }

  export interface PriceUpdated {
    btcUsd: number;
  }

  export interface SystemNotification {
    message: string;
    level: 'info' | 'warn' | 'error';
  }

  export interface SyncStarted {
    walletId: string;
  }

  export interface SyncFailed {
    walletId: string;
    error: string;
  }
}

export namespace EventDataV2 {
  export interface WalletSynced {
    walletId: string;
    balanceSats: bigint;
    /** New in v2: breakdown of balance */
    confirmedSats: bigint;
    unconfirmedSats: bigint;
    utxoCount: number;
    syncDurationMs: number;
  }

  export interface TransactionConfirmed {
    txid: string;
    confirmations: number;
    /** New in v2: block info */
    blockHeight: number;
    blockHash: string;
    walletId: string;
  }

  export interface TransactionReceived {
    txid: string;
    amountSats: bigint;
    walletId: string;
    /** New in v2: address that received */
    receivingAddress: string;
    isChange: boolean;
  }

  export interface AddressUsed {
    address: string;
    walletId: string;
    /** New in v2: usage context */
    txid: string;
    isReceive: boolean;
  }

  export interface PriceUpdated {
    btcUsd: number;
    /** New in v2: additional currencies */
    btcEur?: number;
    btcGbp?: number;
    source: string;
    updatedAt: string;
  }

  export interface SystemNotification {
    message: string;
    level: 'info' | 'warn' | 'error';
    /** New in v2: structured notification */
    code?: string;
    action?: string;
    dismissable: boolean;
  }

  export interface SyncStarted {
    walletId: string;
    /** New in v2: sync metadata */
    isFullResync: boolean;
    estimatedDuration?: number;
  }

  export interface SyncFailed {
    walletId: string;
    error: string;
    /** New in v2: error details */
    errorCode: string;
    retriable: boolean;
    nextRetryAt?: string;
  }
}

/**
 * Transformers from v2 (current) to v1 (legacy)
 */
const v2ToV1Transformers: Record<string, EventTransformer> = {
  'wallet:synced': (event) => {
    const data = event.data as EventDataV2.WalletSynced;
    return {
      type: event.type,
      version: 'v1' as EventVersion,
      data: {
        walletId: data.walletId,
        balance: Number(data.balanceSats) / 100_000_000,
      } as EventDataV1.WalletSynced,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
    };
  },

  'transaction:confirmed': (event) => {
    const data = event.data as EventDataV2.TransactionConfirmed;
    return {
      type: event.type,
      version: 'v1' as EventVersion,
      data: {
        txid: data.txid,
        confirmations: data.confirmations,
      } as EventDataV1.TransactionConfirmed,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
    };
  },

  'transaction:received': (event) => {
    const data = event.data as EventDataV2.TransactionReceived;
    return {
      type: event.type,
      version: 'v1' as EventVersion,
      data: {
        txid: data.txid,
        amount: Number(data.amountSats) / 100_000_000,
        walletId: data.walletId,
      } as EventDataV1.TransactionReceived,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
    };
  },

  'address:used': (event) => {
    const data = event.data as EventDataV2.AddressUsed;
    return {
      type: event.type,
      version: 'v1' as EventVersion,
      data: {
        address: data.address,
        walletId: data.walletId,
      } as EventDataV1.AddressUsed,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
    };
  },

  'price:updated': (event) => {
    const data = event.data as EventDataV2.PriceUpdated;
    return {
      type: event.type,
      version: 'v1' as EventVersion,
      data: {
        btcUsd: data.btcUsd,
      } as EventDataV1.PriceUpdated,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
    };
  },

  'system:notification': (event) => {
    const data = event.data as EventDataV2.SystemNotification;
    return {
      type: event.type,
      version: 'v1' as EventVersion,
      data: {
        message: data.message,
        level: data.level,
      } as EventDataV1.SystemNotification,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
    };
  },

  'wallet:sync_started': (event) => {
    const data = event.data as EventDataV2.SyncStarted;
    return {
      type: event.type,
      version: 'v1' as EventVersion,
      data: {
        walletId: data.walletId,
      } as EventDataV1.SyncStarted,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
    };
  },

  'wallet:sync_failed': (event) => {
    const data = event.data as EventDataV2.SyncFailed;
    return {
      type: event.type,
      version: 'v1' as EventVersion,
      data: {
        walletId: data.walletId,
        error: data.error,
      } as EventDataV1.SyncFailed,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
    };
  },
};

export const MAX_CLIENT_VERSIONS = 10_000;

/**
 * Event Version Manager
 *
 * Handles version negotiation and event transformation for clients.
 */
export class EventVersionManager {
  private clientVersions = new Map<string, EventVersion>();
  private readonly maxClients: number;

  constructor(maxClients: number = MAX_CLIENT_VERSIONS) {
    this.maxClients = Math.max(1, maxClients);
  }

  /**
   * Register a client's preferred version
   */
  setClientVersion(clientId: string, version: EventVersion): void {
    if (!SUPPORTED_VERSIONS.includes(version)) {
      log.warn(`Client ${clientId} requested unsupported version ${version}, defaulting to ${CURRENT_VERSION}`);
      version = CURRENT_VERSION;
    }
    if (!this.clientVersions.has(clientId) && this.clientVersions.size >= this.maxClients) {
      // Reaching capacity guarantees a first entry because maxClients is at least one.
      const oldestClientId = this.clientVersions.keys().next().value!;
      this.clientVersions.delete(oldestClientId);
    }
    this.clientVersions.set(clientId, version);
    log.debug(`Client ${clientId} set to version ${version}`);
  }

  /**
   * Get a client's preferred version
   */
  getClientVersion(clientId: string): EventVersion {
    return this.clientVersions.get(clientId) ?? CURRENT_VERSION;
  }

  /**
   * Remove a client's version preference
   */
  removeClient(clientId: string): void {
    this.clientVersions.delete(clientId);
  }

  /**
   * Transform an event to a specific version
   */
  transformEvent<T>(event: VersionedEvent<T>, targetVersion: EventVersion): VersionedEvent<unknown> {
    if (event.version === targetVersion) {
      return event;
    }

    // Currently only support v2 -> v1 transformation
    if (event.version === 'v2' && targetVersion === 'v1') {
      const transformer = v2ToV1Transformers[event.type];
      if (transformer) {
        return transformer(event as VersionedEvent<unknown>);
      }
      // No transformer available, return as-is with version tag
      log.warn(`No transformer for event type ${event.type} from v2 to v1`);
      return { ...event, version: targetVersion };
    }

    // Unknown transformation path
    log.warn(`Cannot transform from ${event.version} to ${targetVersion}`);
    return event;
  }

  /**
   * Get event formatted for a specific client
   */
  getEventForClient<T>(clientId: string, event: VersionedEvent<T>): VersionedEvent<unknown> {
    const targetVersion = this.getClientVersion(clientId);
    return this.transformEvent(event, targetVersion);
  }

  /**
   * Get statistics about version usage
   */
  getStats(): { total: number; byVersion: Record<EventVersion, number> } {
    const byVersion: Record<EventVersion, number> = { v1: 0, v2: 0 };
    for (const version of this.clientVersions.values()) {
      byVersion[version]++;
    }
    return {
      total: this.clientVersions.size,
      byVersion,
    };
  }
}

/**
 * Create a versioned event helper
 */
export function createVersionedEvent<T>(
  type: string,
  data: T,
  options?: { correlationId?: string }
): VersionedEvent<T> {
  return {
    type,
    version: CURRENT_VERSION,
    data,
    timestamp: new Date().toISOString(),
    correlationId: options?.correlationId,
  };
}

/**
 * Type guards for event data
 */
export function isV2Event(event: VersionedEvent<unknown>): event is VersionedEvent<unknown> & { version: 'v2' } {
  return event.version === 'v2';
}

export function isV1Event(event: VersionedEvent<unknown>): event is VersionedEvent<unknown> & { version: 'v1' } {
  return event.version === 'v1';
}

// Singleton instance
export const eventVersionManager = new EventVersionManager();

/**
 * Version negotiation message types
 */
export interface VersionNegotiationRequest {
  type: 'version:negotiate';
  preferredVersion: EventVersion;
  supportedVersions: EventVersion[];
}

export interface VersionNegotiationResponse {
  type: 'version:negotiated';
  version: EventVersion;
  serverVersion: EventVersion;
  supportedVersions: EventVersion[];
}

/**
 * Handle version negotiation from client
 */
export function negotiateVersion(
  clientId: string,
  request: VersionNegotiationRequest
): VersionNegotiationResponse {
  // Find best matching version
  let negotiatedVersion = CURRENT_VERSION;

  // Check if preferred version is supported
  if (SUPPORTED_VERSIONS.includes(request.preferredVersion)) {
    negotiatedVersion = request.preferredVersion;
  } else {
    // Find highest mutually supported version
    const mutualVersions = request.supportedVersions.filter(v =>
      SUPPORTED_VERSIONS.includes(v)
    );
    if (mutualVersions.length > 0) {
      // Sort by version and take highest
      mutualVersions.sort((a, b) => b.localeCompare(a));
      negotiatedVersion = mutualVersions[0];
    }
  }

  eventVersionManager.setClientVersion(clientId, negotiatedVersion);

  return {
    type: 'version:negotiated',
    version: negotiatedVersion,
    serverVersion: CURRENT_VERSION,
    supportedVersions: SUPPORTED_VERSIONS,
  };
}
