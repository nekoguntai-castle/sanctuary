/**
 * CreateWallet Component Types
 *
 * Shared types and interfaces used across CreateWallet subcomponents.
 */

import type { Device, WalletType, DeviceAccount } from '../../types';

export type ScriptType = 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
export type Network = 'mainnet' | 'testnet' | 'signet' | 'regtest';

export interface CreateWalletState {
  walletType: WalletType | null;
  selectedDeviceIds: Set<string>;
  walletName: string;
  scriptType: ScriptType;
  network: Network;
  quorumM: number;
}

// Re-export types that subcomponents need
export type { Device, WalletType, DeviceAccount };
