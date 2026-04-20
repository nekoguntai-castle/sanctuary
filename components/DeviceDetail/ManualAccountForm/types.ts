export type AccountPurpose = 'single_sig' | 'multisig';

export type AccountScriptType =
  | 'native_segwit'
  | 'nested_segwit'
  | 'taproot'
  | 'legacy';

export interface ManualAccountData {
  purpose: AccountPurpose;
  scriptType: AccountScriptType;
  derivationPath: string;
  xpub: string;
}
