/**
 * Coldcard Nested Format Parser
 *
 * Handles the standard Coldcard JSON export with nested BIP sections:
 * { xfp: "...", bip84: { xpub: "...", _pub: "zpub...", deriv: "m/84'/0'/0'" }, ... }
 *
 * Returns ALL available accounts (single-sig and multisig) for multi-account import.
 */

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
    purpose: 'single_sig',
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
    purpose: 'multisig',
    scriptType,
  };
};

const getColdcardAccounts = (cc: ColdcardNestedFormat): DeviceAccount[] => [
  createSingleSigAccount(cc.bip84, "m/84'/0'/0'", 'native_segwit'),
  createSingleSigAccount(cc.bip86, "m/86'/0'/0'", 'taproot'),
  createSingleSigAccount(cc.bip49, "m/49'/0'/0'", 'nested_segwit'),
  createSingleSigAccount(cc.bip44, "m/44'/0'/0'", 'legacy'),
  createMultisigAccount(cc.bip48_2, "m/48'/0'/0'/2'", 'native_segwit'),
  createMultisigAccount(cc.bip48_1, "m/48'/0'/0'/1'", 'nested_segwit'),
].filter(isDefined);

const getPrimaryAccount = (accounts: DeviceAccount[]): DeviceAccount | undefined =>
  accounts.find((account) => account.purpose === 'single_sig' && account.scriptType === 'native_segwit')
  || accounts.find((account) => account.purpose === 'single_sig')
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
