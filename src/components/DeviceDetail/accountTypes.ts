/**
 * Account Type Configuration
 *
 * Shared configuration for device account types.
 * Extensible for future BIP standards.
 */

import {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';
import type { DeviceAccount } from '../../types';

export interface AccountTypeInfo {
  title: string;
  description: string;
  addressPrefix: string;
  recommended?: boolean;
}

/**
 * Configuration for all supported account types
 * Key format: `${purpose}:${scriptType}`
 */
export const ACCOUNT_TYPE_CONFIG: Record<string, AccountTypeInfo> = {
  // Single-sig accounts
  [`${DeviceAccountPurpose.SINGLE_SIG}:${WalletScriptType.NATIVE_SEGWIT}`]: {
    title: 'Native SegWit (BIP-84)',
    description: 'Most common modern address type. Lower fees than legacy.',
    addressPrefix: 'bc1q...',
    recommended: true,
  },
  [`${DeviceAccountPurpose.SINGLE_SIG}:${WalletScriptType.TAPROOT}`]: {
    title: 'Taproot (BIP-86)',
    description: 'Latest address type with enhanced privacy and smart contract capabilities.',
    addressPrefix: 'bc1p...',
  },
  [`${DeviceAccountPurpose.SINGLE_SIG}:${WalletScriptType.NESTED_SEGWIT}`]: {
    title: 'Nested SegWit (BIP-49)',
    description: 'SegWit wrapped in legacy format for compatibility with older software.',
    addressPrefix: '3...',
  },
  [`${DeviceAccountPurpose.SINGLE_SIG}:${WalletScriptType.LEGACY}`]: {
    title: 'Legacy (BIP-44)',
    description: 'Original Bitcoin address format. Higher fees but maximum compatibility.',
    addressPrefix: '1...',
  },
  // Multisig accounts
  [`${DeviceAccountPurpose.MULTISIG}:${WalletScriptType.NATIVE_SEGWIT}`]: {
    title: 'Multisig Native SegWit (BIP-48)',
    description: 'For multi-signature wallets. Most efficient fee-wise.',
    addressPrefix: 'bc1q...',
    recommended: true,
  },
  [`${DeviceAccountPurpose.MULTISIG}:${WalletScriptType.NESTED_SEGWIT}`]: {
    title: 'Multisig Nested SegWit (BIP-48)',
    description: 'For multi-signature wallets with better legacy software compatibility.',
    addressPrefix: '3...',
  },
};

/**
 * Get human-readable info for an account type
 */
export function getAccountTypeInfo(account: DeviceAccount): AccountTypeInfo {
  const key = `${account.purpose}:${account.scriptType}`;
  return (
    ACCOUNT_TYPE_CONFIG[key] || {
      title: 'Unknown Format',
      description: account.derivationPath,
      addressPrefix: '?',
    }
  );
}
