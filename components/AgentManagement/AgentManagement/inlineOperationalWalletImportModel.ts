import type { AgentOptionWallet } from '../../../src/api/admin';
import type { ValidateXpubRequest, ValidateXpubResponse, XpubScriptType } from '../../../src/api/wallets';
import { WalletScriptType, WalletType } from '@sanctuary/shared/constants/walletIdentity';

type SupportedXpubNetwork = NonNullable<ValidateXpubRequest['network']>;

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
  rawKeyScriptType: XpubScriptType;
  selectedFundingWallet?: AgentOptionWallet;
  validateXpub: (request: ValidateXpubRequest) => Promise<ValidateXpubResponse>;
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
const SUPPORTED_XPUB_NETWORKS: SupportedXpubNetwork[] = [
  'mainnet',
  'testnet3',
  'testnet4',
  'signet',
  'regtest',
];

export const RAW_KEY_SCRIPT_TYPE_OPTIONS: Array<{ value: XpubScriptType; label: string }> = [
  { value: WalletScriptType.NATIVE_SEGWIT, label: 'Native SegWit' },
  { value: WalletScriptType.NESTED_SEGWIT, label: 'Nested SegWit' },
  { value: WalletScriptType.TAPROOT, label: 'Taproot' },
  { value: WalletScriptType.LEGACY, label: 'Legacy' },
];

export const RAW_MULTISIG_OPERATIONAL_KEY_ERROR =
  'Operational agent wallets must use a single-sig xpub/ypub/zpub. Use the multisig wallet as the funding wallet instead.';

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
  rawKeyScriptType,
  selectedFundingWallet,
  validateXpub,
}: NormalizeOperationalImportDataInput): Promise<NormalizedOperationalImportData> {
  const trimmedData = importData.trim();
  const rawKey = detectRawOperationalKeyInput(trimmedData);

  if (rawKey.kind === 'none') {
    return { ok: true, data: trimmedData };
  }

  if (rawKey.kind === WalletType.MULTI_SIG) {
    return { ok: false, error: RAW_MULTISIG_OPERATIONAL_KEY_ERROR };
  }

  const network = getXpubValidationNetwork(selectedFundingWallet);
  if (!network) {
    return {
      ok: false,
      error: 'Raw extended public key import supports mainnet, testnet-family, signet, and regtest funding wallets. Use a descriptor or wallet export for this network.',
    };
  }

  const validation = await validateXpub({
    xpub: rawKey.key,
    scriptType: getRawKeyScriptType(rawKey, rawKeyScriptType),
    network,
    fingerprint: getRawKeyFallbackFingerprint(rawKey.key),
  });

  return { ok: true, data: validation.descriptor };
}

// FNV-1a is only a deterministic origin marker for raw-key imports, not a security boundary.
export function getRawKeyFallbackFingerprint(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getRawKeyDescription(rawKey: RawOperationalKeyInput): string | null {
  if (rawKey.kind !== WalletType.SINGLE_SIG || rawKey.requiresScriptTypeSelection) {
    return null;
  }

  const option = RAW_KEY_SCRIPT_TYPE_OPTIONS.find(({ value }) => value === rawKey.scriptType);
  return option ? `${option.label} extended public key detected.` : null;
}

function getRawKeyScriptType(
  rawKey: Extract<RawOperationalKeyInput, { kind: typeof WalletType.SINGLE_SIG }>,
  selectedScriptType: XpubScriptType
): XpubScriptType {
  return rawKey.requiresScriptTypeSelection ? selectedScriptType : rawKey.scriptType;
}

function getXpubValidationNetwork(selectedFundingWallet?: AgentOptionWallet): SupportedXpubNetwork | null {
  if (SUPPORTED_XPUB_NETWORKS.includes(selectedFundingWallet?.network as SupportedXpubNetwork)) {
    return selectedFundingWallet?.network as SupportedXpubNetwork;
  }

  return null;
}

function hasWhitespace(value: string): boolean {
  return /\s/.test(value);
}

function startsWithAny(value: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => value.startsWith(prefix));
}
