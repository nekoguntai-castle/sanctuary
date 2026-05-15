import type {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';

export type AccountPurpose = DeviceAccountPurpose;

export type AccountScriptType = WalletScriptType;

export interface ManualAccountData {
  purpose: AccountPurpose;
  scriptType: AccountScriptType;
  derivationPath: string;
  xpub: string;
}
