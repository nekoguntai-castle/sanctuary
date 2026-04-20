import type { AccountPurpose, AccountScriptType } from './types';

const MULTISIG_SCRIPT_SUFFIX_BY_TYPE: Record<AccountScriptType, string> = {
  native_segwit: '2',
  nested_segwit: '1',
  taproot: '2',
  legacy: '2',
};

const SINGLE_SIG_BIP_BY_TYPE: Record<AccountScriptType, string> = {
  native_segwit: '84',
  nested_segwit: '49',
  taproot: '86',
  legacy: '44',
};

export function getDefaultDerivationPath(
  purpose: AccountPurpose,
  scriptType: AccountScriptType,
): string {
  if (purpose === 'multisig') {
    return `m/48'/0'/0'/${MULTISIG_SCRIPT_SUFFIX_BY_TYPE[scriptType]}'`;
  }

  return `m/${SINGLE_SIG_BIP_BY_TYPE[scriptType]}'/0'/0'`;
}
