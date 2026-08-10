import type { XpubScriptType } from '../../../api/wallets';
import { WalletScriptType, WalletType } from '@sanctuary/shared/constants/walletIdentity';

type RawOperationalKeyInput =
  | { kind: 'none' }
  | {
      kind: typeof WalletType.SINGLE_SIG;
      key: string;
      scriptType: XpubScriptType;
      requiresScriptTypeSelection: boolean;
    }
  | { kind: typeof WalletType.MULTI_SIG; key: string };

type NormalizeOperationalImportDataInput = {
  importData: string;
};

type NormalizedOperationalImportData =
  | { ok: true; data: string }
  | { ok: false; error: string };

const AMBIGUOUS_SINGLE_SIG_PREFIXES = ['xpub', 'tpub'];
// SLIP-132 prefixes encode the intended script family; uppercase variants are multisig exports.
const MULTISIG_PREFIXES = ['Ypub', 'Zpub', 'Upub', 'Vpub'];
const SCRIPTED_SINGLE_SIG_PREFIXES: Record<string, XpubScriptType> = {
  ypub: WalletScriptType.NESTED_SEGWIT,
  zpub: WalletScriptType.NATIVE_SEGWIT,
  upub: WalletScriptType.NESTED_SEGWIT,
  vpub: WalletScriptType.NATIVE_SEGWIT,
};
export const RAW_MULTISIG_OPERATIONAL_KEY_ERROR =
  'Operational agent wallets must use a single-sig xpub/ypub/zpub. Use the multisig wallet as the funding wallet instead.';
export const RAW_KEY_ORIGIN_REQUIRED_ERROR =
  'Raw extended public keys do not include verified master fingerprint and account-path evidence. Use a descriptor or wallet export with complete key-origin metadata.';

export function detectRawOperationalKeyInput(importData: string): RawOperationalKeyInput {
  const key = importData.trim();
  if (!key || hasWhitespace(key)) {
    return { kind: 'none' };
  }

  if (startsWithAny(key, MULTISIG_PREFIXES)) {
    return { kind: WalletType.MULTI_SIG, key };
  }

  if (startsWithAny(key, AMBIGUOUS_SINGLE_SIG_PREFIXES)) {
    return {
      kind: WalletType.SINGLE_SIG,
      key,
      scriptType: WalletScriptType.NATIVE_SEGWIT,
      requiresScriptTypeSelection: true,
    };
  }

  const scriptedPrefix = Object.keys(SCRIPTED_SINGLE_SIG_PREFIXES).find(prefix => key.startsWith(prefix));
  if (!scriptedPrefix) {
    // Non-raw inputs are descriptors or wallet exports and should continue through import validation unchanged.
    return { kind: 'none' };
  }

  return {
    kind: WalletType.SINGLE_SIG,
    key,
    scriptType: SCRIPTED_SINGLE_SIG_PREFIXES[scriptedPrefix],
    requiresScriptTypeSelection: false,
  };
}

export async function normalizeOperationalImportData({
  importData,
}: NormalizeOperationalImportDataInput): Promise<NormalizedOperationalImportData> {
  const trimmedData = importData.trim();
  const rawKey = detectRawOperationalKeyInput(trimmedData);

  if (rawKey.kind === 'none') {
    return { ok: true, data: trimmedData };
  }

  if (rawKey.kind === WalletType.MULTI_SIG) {
    return { ok: false, error: RAW_MULTISIG_OPERATIONAL_KEY_ERROR };
  }

  return { ok: false, error: RAW_KEY_ORIGIN_REQUIRED_ERROR };
}

export function getRawKeyDescription(rawKey: RawOperationalKeyInput): string | null {
  if (rawKey.kind !== WalletType.SINGLE_SIG) {
    return null;
  }
  return RAW_KEY_ORIGIN_REQUIRED_ERROR;
}

function hasWhitespace(value: string): boolean {
  return /\s/.test(value);
}

function startsWithAny(value: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => value.startsWith(prefix));
}
