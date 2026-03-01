/**
 * Bitcoin Infrastructure API Contract Types
 *
 * Types for sync, price, fee estimation, and transaction broadcast endpoints.
 */

// =============================================================================
// Sync API Contracts
// =============================================================================

/**
 * POST /sync/wallet/:id response
 */
export interface SyncWalletResponse {
  success: boolean;
  walletId: string;
  balance: string; // bigint as string
  unconfirmedBalance: string; // bigint as string
  transactionsFound: number;
  newAddressesGenerated: number;
  duration: number;
}

// =============================================================================
// Price API Contracts
// =============================================================================

/**
 * GET /price response
 */
export interface PriceResponse {
  price: number;
  currency: string;
  change24h: number;
  updatedAt: string; // ISO date string
}

// =============================================================================
// Fee & Broadcast API Contracts
// =============================================================================

/**
 * GET /bitcoin/fees response
 */
export interface FeeEstimatesResponse {
  fastest: number;
  fast: number;
  medium: number;
  slow: number;
  minimum: number;
  updatedAt: string; // ISO date string
}

/**
 * POST /bitcoin/broadcast request
 */
export interface BroadcastRequest {
  hex: string;
  walletId: string;
}

/**
 * POST /bitcoin/broadcast response
 */
export interface BroadcastResponse {
  success: boolean;
  txid: string;
}
