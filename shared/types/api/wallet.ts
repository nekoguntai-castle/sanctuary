/**
 * Wallet API Contract Types
 *
 * Types for wallet CRUD operations and wallet statistics.
 */

/**
 * Wallet type enum value
 */
export type ApiWalletType = 'single_sig' | 'multi_sig';

/**
 * Script type enum value
 */
export type ApiScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';

/**
 * Network enum value
 */
export type ApiNetwork = 'mainnet' | 'testnet' | 'regtest' | 'signet';

/**
 * Wallet role enum value
 */
export type ApiWalletRole = 'owner' | 'signer' | 'viewer';

/**
 * Sync status enum value
 */
export type ApiSyncStatus = 'synced' | 'syncing' | 'error' | 'pending' | 'never';

/**
 * GET /wallets/:id response
 * GET /wallets (array of these)
 */
export interface WalletResponse {
  id: string;
  name: string;
  type: ApiWalletType;
  scriptType: ApiScriptType;
  network: ApiNetwork;
  quorum: number | null;
  totalSigners: number | null;
  descriptor: string | null;
  balance: string; // bigint as string
  unconfirmedBalance: string; // bigint as string
  lastSynced: string | null; // ISO date string
  syncStatus: ApiSyncStatus;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  role: ApiWalletRole;
  deviceCount: number;
  isShared: boolean;
  pendingConsolidation: boolean;
  pendingReceive: boolean;
  pendingSend: boolean;
  hasPendingDraft: boolean;
  group: {
    id: string;
    name: string;
  } | null;
}

/**
 * POST /wallets request
 */
export interface CreateWalletRequest {
  name: string;
  type: ApiWalletType;
  scriptType: ApiScriptType;
  network?: ApiNetwork;
  quorum?: number;
  totalSigners?: number;
  descriptor?: string;
  fingerprint?: string;
  groupId?: string;
  deviceIds?: string[];
}

/**
 * PATCH /wallets/:id request
 */
export interface UpdateWalletRequest {
  name?: string;
  descriptor?: string;
}

/**
 * GET /wallets/:id/stats response
 */
export interface WalletStatsResponse {
  balance: number;
  received: number;
  sent: number;
  transactionCount: number;
  utxoCount: number;
  addressCount: number;
}
