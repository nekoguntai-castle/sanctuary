/**
 * Wallet Import - Type Definitions
 *
 * Shared types and interfaces for the wallet import service modules.
 */

import type { Network } from '../bitcoin/descriptorParser';
import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import {
  WALLET_SCRIPT_TYPE_VALUES,
  WALLET_TYPE_VALUES,
  type WalletScriptType,
  type WalletType,
} from '@sanctuary/shared/constants/walletIdentity';

export const WALLET_IMPORT_FORMAT_VALUES = [
  'descriptor',
  'json',
  'wallet_export',
  'bluewallet_text',
  'coldcard',
] as const;
export const WALLET_IMPORT_WALLET_TYPE_VALUES = WALLET_TYPE_VALUES;
export const WALLET_IMPORT_SCRIPT_TYPE_VALUES = WALLET_SCRIPT_TYPE_VALUES;
export const WALLET_IMPORT_NETWORK_VALUES = BITCOIN_NETWORKS;

export interface DeviceResolution {
  fingerprint: string;
  xpub: string;
  derivationPath: string;
  existingDeviceId: string | null;
  existingDeviceLabel: string | null;
  willCreate: boolean;
  suggestedLabel?: string;
  originalType?: string;
  existingType?: string;
  existingModel?: { slug?: string | null; name?: string | null } | null;
}

export interface ImportValidationResult {
  valid: boolean;
  error?: string;
  format: (typeof WALLET_IMPORT_FORMAT_VALUES)[number];
  walletType: WalletType;
  scriptType: WalletScriptType;
  network: Network;
  quorum?: number;
  totalSigners?: number;
  devices: DeviceResolution[];
  suggestedName?: string;
}

export interface ImportWalletResult {
  wallet: {
    id: string;
    name: string;
    type: string;
    scriptType: string;
    network: string;
    quorum?: number | null;
    totalSigners?: number | null;
    descriptor?: string | null;
  };
  devicesCreated: number;
  devicesReused: number;
  createdDeviceIds: string[];
  reusedDeviceIds: string[];
}

/** Info tracked per device during import for building the descriptor */
export interface ImportedDeviceInfo {
  deviceId: string;
  deviceAccountId: string;
  fingerprint: string;
  xpub: string;
  derivationPath: string;
  purpose: string;
  scriptType: string;
}
