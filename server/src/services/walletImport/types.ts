/**
 * Wallet Import - Type Definitions
 *
 * Shared types and interfaces for the wallet import service modules.
 */

import type { ScriptType, Network } from '../bitcoin/descriptorParser';

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
  format: 'descriptor' | 'json' | 'wallet_export' | 'bluewallet_text' | 'coldcard';
  walletType: 'single_sig' | 'multi_sig';
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
