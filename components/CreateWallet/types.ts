/**
 * CreateWallet Component Types
 *
 * Shared types and interfaces used across CreateWallet subcomponents.
 */

import type { Device, WalletType, DeviceAccount } from '../../types';

export type ScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
export type Network = 'mainnet' | 'testnet' | 'signet' | 'regtest';
export type CreateWalletStep = 1 | 2 | 3 | 4;

export interface CreateWalletState {
  walletType: WalletType | null;
  selectedDeviceIds: Set<string>;
  walletName: string;
  scriptType: ScriptType;
  network: Network;
  quorumM: number;
}

export interface CreateWalletPayload {
  name: string;
  type: 'single_sig' | 'multi_sig';
  scriptType: ScriptType;
  network: Network;
  quorum?: number;
  totalSigners?: number;
  deviceIds: string[];
}

// Re-export types that subcomponents need
export type { Device, WalletType, DeviceAccount };
