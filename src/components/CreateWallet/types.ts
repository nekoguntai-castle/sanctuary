/**
 * CreateWallet Component Types
 *
 * Shared types and interfaces used across CreateWallet subcomponents.
 */

import type { Device, WalletType, DeviceAccount } from '../../types';
import type { TabNetwork } from '../../app/networks';
import type { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import type { CreateWalletSignerRequest } from '../../api/wallets';

export type ScriptType = WalletScriptType;
export type Network = TabNetwork;
export type CreateWalletStep = 1 | 2 | 3 | 4;
export type SelectedSigner = Omit<CreateWalletSignerRequest, 'signerIndex'>;

export interface CreateWalletState {
  walletType: WalletType | null;
  selectedSigners: SelectedSigner[];
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
  signers: CreateWalletSignerRequest[];
}

// Re-export types that subcomponents need
export type { Device, WalletType, DeviceAccount };
