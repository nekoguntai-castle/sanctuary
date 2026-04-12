/**
 * Wallet Import - Type Definitions
 *
 * Shared types and interfaces for the wallet import service modules.
 */

import type { ScriptType, Network } from '../bitcoin/descriptorParser';

export const WALLET_IMPORT_FORMAT_VALUES = [
  'descriptor',
  'json',
  'wallet_export',
  'bluewallet_text',
  'coldcard',
] as const;
export const WALLET_IMPORT_WALLET_TYPE_VALUES = ['single_sig', 'multi_sig'] as const;
export const WALLET_IMPORT_SCRIPT_TYPE_VALUES = ['native_segwit', 'nested_segwit', 'taproot', 'legacy'] as const;
export const WALLET_IMPORT_NETWORK_VALUES = ['mainnet', 'testnet', 'regtest'] as const;

export interface DeviceResolution {
  fingerprint: string;
  xpub: string;
  derivationPath: string;
  existingDeviceId: string | null;
  existingDeviceLabel: string | null;
  willCreate: boolean;
  suggestedLabel?: string;
  originalType?: string;
}

export interface ImportValidationResult {
  valid: boolean;
  error?: string;
  format: (typeof WALLET_IMPORT_FORMAT_VALUES)[number];
  walletType: (typeof WALLET_IMPORT_WALLET_TYPE_VALUES)[number];
  scriptType: ScriptType;
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
  fingerprint: string;
  xpub: string;
  derivationPath: string;
}
