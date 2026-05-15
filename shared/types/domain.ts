/**
 * Shared Domain Types & Enums
 *
 * Domain-level types that represent core Bitcoin wallet concepts.
 * These are the canonical definitions used across frontend, server, and gateway.
 *
 * IMPORTANT: This file must not import from any package-specific code
 * (no Prisma, no React, no Express). Only pure TypeScript types.
 */

import type { NetworkType } from '../constants/bitcoin';

/**
 * User's role on a wallet. Re-exported from ../constants/walletRoles so values,
 * guards, and capability helpers stay in sync across frontend, server, and OpenAPI.
 */
export type {
  WalletRole,
  WalletRoleValue,
  WalletShareRole,
} from '../constants/walletRoles';

// =============================================================================
// Wallet Enums
// =============================================================================

/**
 * Wallet type - single signature or multisig
 */
export enum WalletType {
  SINGLE_SIG = 'single_sig',
  MULTI_SIG = 'multi_sig',
}

/**
 * Script type for wallet address derivation
 */
export type WalletScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';

/**
 * Bitcoin network
 */
export type WalletNetwork = NetworkType;

/**
 * User's role on a device
 */
export type DeviceRole = 'owner' | 'viewer' | null;

// =============================================================================
// Transaction Enums
// =============================================================================

/**
 * Transaction type classification
 */
export type TransactionType = 'sent' | 'received' | 'consolidation' | 'receive';

/**
 * Transaction output classification
 */
export type TransactionOutputType =
  | 'recipient'
  | 'change'
  | 'decoy'
  | 'consolidation'
  | 'op_return'
  | 'unknown';

/**
 * RBF status of a transaction
 */
export type RbfStatus = 'active' | 'replaced' | 'confirmed';

/**
 * UTXO selection strategy for transaction building
 * - privacy: Minimize address linking and metadata leakage
 * - efficiency: Minimize fees and optimize transaction size
 * - oldest_first: Select oldest UTXOs first (useful for coin age)
 * - largest_first: Select largest UTXOs first (consolidation)
 * - smallest_first: Select smallest UTXOs first (dust cleanup)
 */
export type SelectionStrategy =
  | 'privacy'
  | 'efficiency'
  | 'oldest_first'
  | 'largest_first'
  | 'smallest_first';

/**
 * Draft transaction signing status
 */
export type DraftStatus = 'unsigned' | 'partial' | 'signed';

// =============================================================================
// Transfer Enums
// =============================================================================

/**
 * Ownership transfer status
 */
export type TransferStatus = 'pending' | 'accepted' | 'confirmed' | 'cancelled' | 'declined' | 'expired';

/**
 * Resource type for ownership transfers
 */
export type TransferResourceType = 'wallet' | 'device';

// =============================================================================
// Sync Enums
// =============================================================================

/**
 * Wallet sync status
 */
export type SyncStatus = 'success' | 'failed' | 'partial' | 'retrying';

/**
 * Sync priority
 */
export type SyncPriority = 'high' | 'normal' | 'low';

// =============================================================================
// Node Configuration Enums
// =============================================================================

/**
 * Electrum connection mode
 */
export type ConnectionMode = 'singleton' | 'pool';

/**
 * Load balancing strategy for connection pools
 */
export type LoadBalancingStrategy = 'round_robin' | 'least_connections' | 'failover_only';

// =============================================================================
// Privacy Enums
// =============================================================================

/**
 * Privacy score grade
 */
export type PrivacyGrade = 'excellent' | 'good' | 'fair' | 'poor';

// =============================================================================
// Health Check Enums
// =============================================================================

/**
 * Service health status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

// =============================================================================
// Quorum Type
// =============================================================================

/**
 * Multisig quorum definition (m-of-n)
 */
export interface Quorum {
  m: number;
  n: number;
}
