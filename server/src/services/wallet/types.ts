/**
 * Wallet Service Types
 *
 * Shared types and interfaces for the wallet service modules.
 */

/**
 * User's role for a specific wallet
 */
export const WALLET_ROLE_VALUES = ['owner', 'approver', 'signer', 'viewer'] as const;
export const WALLET_SHARE_ROLE_VALUES = ['viewer', 'signer', 'approver'] as const;

export type WalletRole = (typeof WALLET_ROLE_VALUES)[number] | null;
export type WalletShareRole = (typeof WALLET_SHARE_ROLE_VALUES)[number];

/**
 * Result of checking wallet access with edit permission
 */
export interface WalletAccessCheckResult {
  hasAccess: boolean;
  canEdit: boolean;
  role: WalletRole;
}

export interface CreateWalletInput {
  name: string;
  type: 'single_sig' | 'multi_sig';
  scriptType: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  network?: 'mainnet' | 'testnet' | 'regtest';
  quorum?: number;
  totalSigners?: number;
  descriptor?: string;
  fingerprint?: string;
  groupId?: string;
  deviceIds?: string[]; // New: array of device IDs to include
}

/** Roles that can edit wallet data (labels, etc.) */
export const EDIT_ROLES: string[] = ['owner', 'signer'];

/** Roles that can approve transactions */
export const APPROVE_ROLES: string[] = ['owner', 'approver'];

export interface WalletWithBalance {
  id: string;
  name: string;
  type: string;
  scriptType: string;
  network: string;
  quorum?: number | null;
  totalSigners?: number | null;
  descriptor?: string | null;
  fingerprint?: string | null;
  createdAt: Date;
  balance: number;
  deviceCount: number;
  addressCount: number;
  // Sync metadata
  lastSyncedAt?: Date | null;
  lastSyncStatus?: string | null;
  syncInProgress?: boolean;
  // Sharing info
  isShared: boolean;
  sharedWith?: {
    groupName?: string | null;
    userCount: number;
  };
  // User's role for this wallet (owner, signer, viewer)
  userRole?: WalletRole;
  // Whether user can edit (owner or signer)
  canEdit?: boolean;
}
