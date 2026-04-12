/**
 * Mobile Permissions Types
 *
 * Type definitions for the mobile permissions system.
 * Mobile permissions act as additional restrictions on top of wallet roles.
 */

import { MOBILE_ACTIONS, type MobileAction } from '../../../../shared/schemas/mobileApiRequests';

/**
 * Actions that can be controlled via mobile permissions
 */
export type { MobileAction };

/**
 * Wallet role types
 */
export type WalletRole = 'viewer' | 'signer' | 'approver' | 'owner';

/**
 * Mapping of mobile actions to database field names
 */
export const ACTION_TO_FIELD: Record<MobileAction, string> = {
  viewBalance: 'canViewBalance',
  viewTransactions: 'canViewTransactions',
  viewUtxos: 'canViewUtxos',
  createTransaction: 'canCreateTransaction',
  broadcast: 'canBroadcast',
  signPsbt: 'canSignPsbt',
  generateAddress: 'canGenerateAddress',
  manageLabels: 'canManageLabels',
  manageDevices: 'canManageDevices',
  shareWallet: 'canShareWallet',
  deleteWallet: 'canDeleteWallet',
  approveTransaction: 'canApproveTransaction',
  managePolicies: 'canManagePolicies',
};

/**
 * Role capabilities - defines maximum permissions for each wallet role
 * These are the hard limits that cannot be exceeded by mobile permissions
 */
export const ROLE_CAPABILITIES: Record<WalletRole, Record<MobileAction, boolean>> = {
  viewer: {
    viewBalance: true,
    viewTransactions: true,
    viewUtxos: true,
    createTransaction: false,
    broadcast: false,
    signPsbt: false,
    generateAddress: false,
    manageLabels: false,
    manageDevices: false,
    shareWallet: false,
    deleteWallet: false,
    approveTransaction: false,
    managePolicies: false,
  },
  signer: {
    viewBalance: true,
    viewTransactions: true,
    viewUtxos: true,
    createTransaction: true,
    broadcast: true,
    signPsbt: true,
    generateAddress: true,
    manageLabels: true,
    manageDevices: false,
    shareWallet: false,
    deleteWallet: false,
    approveTransaction: false,
    managePolicies: false,
  },
  approver: {
    viewBalance: true,
    viewTransactions: true,
    viewUtxos: true,
    createTransaction: false,
    broadcast: false,
    signPsbt: false,
    generateAddress: false,
    manageLabels: false,
    manageDevices: false,
    shareWallet: false,
    deleteWallet: false,
    approveTransaction: true,
    managePolicies: false,
  },
  owner: {
    viewBalance: true,
    viewTransactions: true,
    viewUtxos: true,
    createTransaction: true,
    broadcast: true,
    signPsbt: true,
    generateAddress: true,
    manageLabels: true,
    manageDevices: true,
    shareWallet: true,
    deleteWallet: true,
    approveTransaction: true,
    managePolicies: true,
  },
};

/**
 * All mobile actions list
 */
export const ALL_MOBILE_ACTIONS: MobileAction[] = [...MOBILE_ACTIONS];

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  role: WalletRole | null;
  effectivePermissions: Record<MobileAction, boolean>;
}

/**
 * Effective permissions for a user on a wallet
 */
export interface EffectivePermissions {
  walletId: string;
  userId: string;
  role: WalletRole;
  permissions: Record<MobileAction, boolean>;
  hasCustomRestrictions: boolean;
  hasOwnerRestrictions: boolean;
}

/**
 * Update permissions input
 */
export interface UpdatePermissionsInput {
  viewBalance?: boolean;
  viewTransactions?: boolean;
  viewUtxos?: boolean;
  createTransaction?: boolean;
  broadcast?: boolean;
  signPsbt?: boolean;
  generateAddress?: boolean;
  manageLabels?: boolean;
  manageDevices?: boolean;
  shareWallet?: boolean;
  deleteWallet?: boolean;
  approveTransaction?: boolean;
  managePolicies?: boolean;
}

/**
 * Owner max permissions input
 */
export interface OwnerMaxPermissionsInput {
  viewBalance?: boolean;
  viewTransactions?: boolean;
  viewUtxos?: boolean;
  createTransaction?: boolean;
  broadcast?: boolean;
  signPsbt?: boolean;
  generateAddress?: boolean;
  manageLabels?: boolean;
  manageDevices?: boolean;
  shareWallet?: boolean;
  deleteWallet?: boolean;
  approveTransaction?: boolean;
  managePolicies?: boolean;
}
