import {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';
import type { AccountPurpose, AccountScriptType } from './types';

const MULTISIG_SCRIPT_SUFFIX_BY_TYPE: Record<AccountScriptType, string> = {
  [WalletScriptType.NATIVE_SEGWIT]: '2',
  [WalletScriptType.NESTED_SEGWIT]: '1',
  [WalletScriptType.TAPROOT]: '2',
  [WalletScriptType.LEGACY]: '2',
};

const SINGLE_SIG_BIP_BY_TYPE: Record<AccountScriptType, string> = {
  [WalletScriptType.NATIVE_SEGWIT]: '84',
  [WalletScriptType.NESTED_SEGWIT]: '49',
  [WalletScriptType.TAPROOT]: '86',
  [WalletScriptType.LEGACY]: '44',
};

export function getDefaultDerivationPath(
  purpose: AccountPurpose,
  scriptType: AccountScriptType,
): string {
  if (purpose === DeviceAccountPurpose.MULTISIG) {
    return `m/48'/0'/0'/${MULTISIG_SCRIPT_SUFFIX_BY_TYPE[scriptType]}'`;
  }

  return `m/${SINGLE_SIG_BIP_BY_TYPE[scriptType]}'/0'/0'`;
}
