/**
 * Wallet Service Types
 *
 * Shared types and interfaces for the wallet service modules.
 */

import type { NetworkType } from "@sanctuary/shared/constants/bitcoin";
import type {
  WalletScriptType,
  WalletType,
} from "@sanctuary/shared/constants/walletIdentity";
import {
  WALLET_APPROVE_ROLE_VALUES,
  WALLET_EDIT_ROLE_VALUES,
  WALLET_ROLE_VALUES,
  WALLET_SHARE_ROLE_VALUES,
  canWalletRoleApprove,
  canWalletRoleEdit,
  canWalletRoleOwn,
  canWalletRoleView,
  isWalletRole,
  isWalletShareRole,
  parseWalletRole,
  parseWalletShareRole,
  type WalletRole,
  type WalletShareRole,
} from "@sanctuary/shared/constants/walletRoles";

export {
  WALLET_APPROVE_ROLE_VALUES,
  WALLET_EDIT_ROLE_VALUES,
  WALLET_ROLE_VALUES,
  WALLET_SHARE_ROLE_VALUES,
  canWalletRoleApprove,
  canWalletRoleEdit,
  canWalletRoleOwn,
  canWalletRoleView,
  isWalletRole,
  isWalletShareRole,
  parseWalletRole,
  parseWalletShareRole,
};

export type { WalletRole, WalletShareRole };
export type WalletNetwork = NetworkType;

export interface WalletSignerInput {
  deviceId: string;
  deviceAccountId: string;
  signerIndex: number;
}

export interface WalletSignerBinding extends WalletSignerInput {
  signerBindingVersion: 1;
  signerFingerprint: string;
  signerXpub: string;
  signerDerivationPath: string;
  signerPurpose: string;
  signerScriptType: string;
}

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
  type: WalletType;
  scriptType: WalletScriptType;
  network?: WalletNetwork;
  quorum?: number;
  totalSigners?: number;
  descriptor?: string;
  changeDescriptor?: string;
  fingerprint?: string;
  groupId?: string;
  signers?: WalletSignerInput[];
}

/** Roles that can edit wallet data (labels, etc.) */
export const EDIT_ROLES = WALLET_EDIT_ROLE_VALUES;

/** Roles that can approve transactions */
export const APPROVE_ROLES = WALLET_APPROVE_ROLE_VALUES;

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
  lastSyncError?: string | null;
  syncInProgress?: boolean;
  // Sharing info
  isShared: boolean;
  sharedWith?: {
    groupName?: string | null;
    userCount: number;
  };
  // User's role for this wallet (owner, approver, signer, viewer)
  userRole?: WalletRole;
  // Whether user can edit (owner or signer)
  canEdit?: boolean;
}
