/**
 * CreateWallet Component Types
 *
 * Shared types and interfaces used across CreateWallet subcomponents.
 */

import type { Device, WalletType, DeviceAccount } from '../../types';
import type { TabNetwork } from '../../app/networks';
import type { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';

export type ScriptType = WalletScriptType;
export type Network = TabNetwork;
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
  type: WalletType;
  scriptType: ScriptType;
  network: Network;
  quorum?: number;
  totalSigners?: number;
  deviceIds: string[];
}

// Re-export types that subcomponents need
export type { Device, WalletType, DeviceAccount };
