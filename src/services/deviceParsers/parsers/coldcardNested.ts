/**
 * Coldcard Nested Format Parser
 *
 * Handles the standard Coldcard JSON export with nested BIP sections:
 * { xfp: "...", bip84: { xpub: "...", _pub: "zpub...", deriv: "m/84'/0'/0'" }, ... }
 *
 * Returns ALL available accounts (single-sig and multisig) for multi-account import.
 */

import {
  DeviceAccountPurpose,
  WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';
import type { DeviceParser, DeviceParseResult, DeviceAccount, FormatDetectionResult } from '../types';

type SingleSigSection = { xpub?: string; _pub?: string; deriv?: string };
type MultisigSection = { xpub?: string; deriv?: string };

interface ColdcardNestedFormat {
  xfp?: string;
  bip44?: SingleSigSection;
  bip49?: SingleSigSection;
  bip84?: SingleSigSection;
  bip86?: SingleSigSection;
  bip48_1?: MultisigSection; // Nested segwit multisig (P2SH-P2WSH)
  bip48_2?: MultisigSection; // Native segwit multisig (P2WSH)
  name?: string;
  label?: string;
}

function isColdcardNestedFormat(data: unknown): data is ColdcardNestedFormat {
  if (typeof data !== 'object' || data === null) return false;
  const cc = data as ColdcardNestedFormat;
  return (
    cc.bip44 !== undefined ||
    cc.bip49 !== undefined ||
    cc.bip84 !== undefined ||
    cc.bip86 !== undefined ||
    cc.bip48_1 !== undefined ||
    cc.bip48_2 !== undefined
  );
}

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const createSingleSigAccount = (
  section: SingleSigSection | undefined,
  fallbackPath: string,
  scriptType: DeviceAccount['scriptType']
): DeviceAccount | undefined => {
  const xpub = section?._pub || section?.xpub || '';
  if (!xpub) return undefined;

  return {
    xpub,
    derivationPath: section?.deriv || fallbackPath,
    purpose: DeviceAccountPurpose.SINGLE_SIG,
    scriptType,
  };
};

const createMultisigAccount = (
  section: MultisigSection | undefined,
  fallbackPath: string,
  scriptType: DeviceAccount['scriptType']
): DeviceAccount | undefined => {
  const xpub = section?.xpub || '';
  if (!xpub) return undefined;

  return {
    xpub,
    derivationPath: section?.deriv || fallbackPath,
    purpose: DeviceAccountPurpose.MULTISIG,
    scriptType,
  };
};

const getColdcardAccounts = (cc: ColdcardNestedFormat): DeviceAccount[] => [
  createSingleSigAccount(cc.bip84, "m/84'/0'/0'", WalletScriptType.NATIVE_SEGWIT),
  createSingleSigAccount(cc.bip86, "m/86'/0'/0'", WalletScriptType.TAPROOT),
  createSingleSigAccount(cc.bip49, "m/49'/0'/0'", WalletScriptType.NESTED_SEGWIT),
  createSingleSigAccount(cc.bip44, "m/44'/0'/0'", WalletScriptType.LEGACY),
  createMultisigAccount(cc.bip48_2, "m/48'/0'/0'/2'", WalletScriptType.NATIVE_SEGWIT),
  createMultisigAccount(cc.bip48_1, "m/48'/0'/0'/1'", WalletScriptType.NESTED_SEGWIT),
].filter(isDefined);

const getPrimaryAccount = (accounts: DeviceAccount[]): DeviceAccount | undefined =>
  accounts.find(
    (account) =>
      account.purpose === DeviceAccountPurpose.SINGLE_SIG &&
      account.scriptType === WalletScriptType.NATIVE_SEGWIT,
  )
  || accounts.find((account) => account.purpose === DeviceAccountPurpose.SINGLE_SIG)
  || accounts[0];

export const coldcardNestedParser: DeviceParser = {
  id: 'coldcard-nested',
  name: 'Coldcard Standard Export',
  description: 'Coldcard JSON export with bip44/bip49/bip84/bip86 sections',
  priority: 90,

  canParse(data: unknown): FormatDetectionResult {
    if (!isColdcardNestedFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    // Higher confidence if it has xfp (fingerprint)
    const cc = data as ColdcardNestedFormat;
    const hasXfp = typeof cc.xfp === 'string' && cc.xfp.length === 8;

    return {
      detected: true,
      confidence: hasXfp ? 95 : 85,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const cc = data as ColdcardNestedFormat;
    const accounts = getColdcardAccounts(cc);
    const primaryAccount = getPrimaryAccount(accounts);

    return {
      xpub: primaryAccount?.xpub || '',
      fingerprint: cc.xfp || '',
      derivationPath: primaryAccount?.derivationPath || '',
      label: cc.name || cc.label || '',
      accounts: accounts.length > 0 ? accounts : undefined,
    };
  },
};
