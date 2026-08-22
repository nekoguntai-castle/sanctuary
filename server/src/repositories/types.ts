/**
 * Repository Types
 *
 * Common interfaces for repository pattern implementation.
 */

import type { Wallet, Address, Transaction, User, UTXO } from '../generated/prisma/client';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import type {
  SyncExecutionOwner,
  WalletSyncFailureClass,
} from '@sanctuary/shared/constants/sync';
import type { TransactionFilterType } from '@sanctuary/shared/constants/transactions';

// Re-export Prisma types that repositories use
export type { Wallet, Address, Transaction, User, UTXO };

// Network type from shared Bitcoin contracts
export type { NetworkType };

// Wallet with includes
export interface WalletWithAddresses extends Wallet {
  addresses: Address[];
}

export interface WalletWithUsers extends Wallet {
  users: { userId: string }[];
  group?: { members: { userId: string }[] } | null;
}

// =============================================================================
// Cursor-Based Pagination Types
// =============================================================================

/**
 * Cursor-based pagination options
 * More efficient than offset-based for large datasets
 */
export interface CursorPaginationOptions {
  /** Maximum number of items to return (default: 50, max: 200) */
  limit?: number;
  /** Cursor for the next page (ID of the last item from previous page) */
  cursor?: string;
  /** Direction of pagination */
  direction?: 'forward' | 'backward';
}

/**
 * Result of a cursor-paginated query
 */
export interface CursorPaginatedResult<T> {
  /** The items for this page */
  items: T[];
  /** Cursor to fetch the next page (null if no more items) */
  nextCursor: string | null;
  /** Whether there are more items after this page */
  hasMore: boolean;
  /** Total count (only included if requested, expensive for large tables) */
  totalCount?: number;
}

/**
 * Transaction-specific cursor using (blockTime, id) for stable ordering
 */
export interface TransactionCursor {
  blockTime: Date;
  id: string;
}

/**
 * Transaction pagination options with compound cursor
 */
export interface TransactionPaginationOptions {
  limit?: number;
  cursor?: TransactionCursor;
  direction?: 'forward' | 'backward';
  /** Include total count (expensive, use sparingly) */
  includeCount?: boolean;
}

/**
 * Result of a transaction pagination query
 */
export interface TransactionPaginatedResult {
  items: Transaction[];
  nextCursor: TransactionCursor | null;
  hasMore: boolean;
  totalCount?: number;
}

// =============================================================================
// Legacy Offset-Based Pagination (for backwards compatibility)
// =============================================================================

// Pagination options
export interface PaginationOptions {
  skip?: number;
  take?: number;
}

// Sort options
export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

// Generic repository interface
export interface BaseRepository<T, CreateInput, UpdateInput> {
  findById(id: string): Promise<T | null>;
  create(data: CreateInput): Promise<T>;
  update(id: string, data: UpdateInput): Promise<T>;
  delete(id: string): Promise<void>;
}

// Wallet repository specific types
export interface WalletAccessFilter {
  walletId: string;
  userId: string;
}

export interface WalletNetworkFilter {
  userId: string;
  network: NetworkType;
}

export interface WalletSyncState {
  syncInProgress: boolean;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncFailureClass: WalletSyncFailureClass | null;
  syncExecutionOwner: SyncExecutionOwner | null;
  syncRetryCount: number;
  syncNextRetryAt: Date | null;
  syncStartedAt: Date | null;
  syncStateVersion: number;
}

export interface IncrementalSyncIntentState {
  id: string;
  requestedIncrementalSyncGeneration: number;
  claimedIncrementalSyncGeneration: number;
  processedIncrementalSyncGeneration: number;
  incrementalSyncLeaseToken: string | null;
  incrementalSyncClaimedAt: Date | null;
  incrementalSyncLeaseExpiresAt: Date | null;
  syncRetryCount: number;
  syncNextRetryAt: Date | null;
  syncActionRequiredAt: Date | null;
  requestedFullResyncGeneration: number;
  preparedFullResyncGeneration: number;
  processedFullResyncGeneration: number;
}

export interface SubscriptionCheckpointState {
  addressId: string;
  network: string;
  scriptHash: string | null;
  statusKnown: boolean;
  observedStatus: string | null;
  lastObservedAt: Date | null;
  requestedEnrollmentGeneration: number;
  processedEnrollmentGeneration: number;
}

export interface SubscriptionEnrollmentCandidate extends SubscriptionCheckpointState {
  walletId: string;
  address: string;
  checkpointMissing: boolean;
}

/** Repository-managed patches; callers cannot set the monotonic version. */
export type WalletSyncStatePatch = Partial<Omit<WalletSyncState, 'syncStateVersion'>>;

// Transaction repository specific types
export interface TransactionFilter {
  walletId?: string;
  walletIds?: string[];
  confirmed?: boolean;
  type?: TransactionFilterType;
}

// Address repository specific types
export interface AddressFilter {
  walletId: string;
  used?: boolean;
}
