import { BITCOIN_NETWORKS, type NetworkType } from './bitcoin';
import {
  DeviceAccountPurpose,
  WalletScriptType,
  WalletType,
  type DeviceAccountPurpose as DeviceAccountPurposeValue,
  type WalletScriptType as WalletScriptTypeValue,
  type WalletType as WalletTypeValue,
} from './walletIdentity';

/**
 * Versioned source of truth for supported BIP44/49/84/86 single-sig and
 * BIP48 /1' and /2' sorted-multisig account policies. Bump the version when a
 * row's path or descriptor meaning changes so persisted evidence fails closed.
 */
export const WALLET_POLICY_REGISTRY_VERSION = 1 as const;
export const WALLET_POLICY_MANIFEST_ID = 'sanctuary-wallet-policy-v1' as const;
export const CANONICAL_ADDRESS_COORDINATE_VERSION = 1 as const;
export const MAX_BIP32_CHILD_INDEX = 0x7fffffff;

export const DERIVATION_NETWORK_FAMILIES = ['mainnet', 'testnet'] as const;
export type DerivationNetworkFamily = (typeof DERIVATION_NETWORK_FAMILIES)[number];
export type WalletAddressBranch = 0 | 1;
export type DescriptorWrapper =
  | 'pkh'
  | 'sh(wpkh)'
  | 'wpkh'
  | 'tr'
  | 'sh(wsh(sortedmulti))'
  | 'wsh(sortedmulti)';

const DESCRIPTOR_WRAPPER_RENDERERS: Record<DescriptorWrapper, (expression: string) => string> = {
  pkh: (expression) => `pkh(${expression})`,
  'sh(wpkh)': (expression) => `sh(wpkh(${expression}))`,
  wpkh: (expression) => `wpkh(${expression})`,
  tr: (expression) => `tr(${expression})`,
  'sh(wsh(sortedmulti))': (expression) => `sh(wsh(${expression}))`,
  'wsh(sortedmulti)': (expression) => `wsh(${expression})`,
};

export function renderDescriptorWrapper(
  wrapper: DescriptorWrapper,
  expression: string,
): string {
  return DESCRIPTOR_WRAPPER_RENDERERS[wrapper](expression);
}

export interface WalletPolicyRow {
  readonly id: string;
  readonly version: typeof WALLET_POLICY_REGISTRY_VERSION;
  readonly walletType: WalletTypeValue;
  readonly accountPurpose: DeviceAccountPurposeValue;
  readonly scriptType: WalletScriptTypeValue;
  readonly purpose: 44 | 48 | 49 | 84 | 86;
  readonly bip48ScriptType: 1 | 2 | null;
  readonly descriptorWrapper: DescriptorWrapper;
  readonly displayName: string;
  readonly hardwareDiscoveryOrder: number;
}

const policyRow = (row: Omit<WalletPolicyRow, 'version'>): WalletPolicyRow => Object.freeze({
  ...row,
  version: WALLET_POLICY_REGISTRY_VERSION,
});

/** Canonical policy rows used by both browser and server derivation producers. */
export const WALLET_POLICY_REGISTRY = Object.freeze([
  policyRow({ id: 'single-sig-legacy-bip44-v1', walletType: WalletType.SINGLE_SIG, accountPurpose: DeviceAccountPurpose.SINGLE_SIG, scriptType: WalletScriptType.LEGACY, purpose: 44, bip48ScriptType: null, descriptorWrapper: 'pkh', displayName: 'Legacy (BIP-44)', hardwareDiscoveryOrder: 3 }),
  policyRow({ id: 'single-sig-nested-segwit-bip49-v1', walletType: WalletType.SINGLE_SIG, accountPurpose: DeviceAccountPurpose.SINGLE_SIG, scriptType: WalletScriptType.NESTED_SEGWIT, purpose: 49, bip48ScriptType: null, descriptorWrapper: 'sh(wpkh)', displayName: 'Nested SegWit (BIP-49)', hardwareDiscoveryOrder: 2 }),
  policyRow({ id: 'single-sig-native-segwit-bip84-v1', walletType: WalletType.SINGLE_SIG, accountPurpose: DeviceAccountPurpose.SINGLE_SIG, scriptType: WalletScriptType.NATIVE_SEGWIT, purpose: 84, bip48ScriptType: null, descriptorWrapper: 'wpkh', displayName: 'Native SegWit (BIP-84)', hardwareDiscoveryOrder: 0 }),
  policyRow({ id: 'single-sig-taproot-bip86-v1', walletType: WalletType.SINGLE_SIG, accountPurpose: DeviceAccountPurpose.SINGLE_SIG, scriptType: WalletScriptType.TAPROOT, purpose: 86, bip48ScriptType: null, descriptorWrapper: 'tr', displayName: 'Taproot (BIP-86)', hardwareDiscoveryOrder: 1 }),
  policyRow({ id: 'multisig-nested-segwit-bip48-1-v1', walletType: WalletType.MULTI_SIG, accountPurpose: DeviceAccountPurpose.MULTISIG, scriptType: WalletScriptType.NESTED_SEGWIT, purpose: 48, bip48ScriptType: 1, descriptorWrapper: 'sh(wsh(sortedmulti))', displayName: 'Multisig Nested SegWit (BIP-48)', hardwareDiscoveryOrder: 5 }),
  policyRow({ id: 'multisig-native-segwit-bip48-2-v1', walletType: WalletType.MULTI_SIG, accountPurpose: DeviceAccountPurpose.MULTISIG, scriptType: WalletScriptType.NATIVE_SEGWIT, purpose: 48, bip48ScriptType: 2, descriptorWrapper: 'wsh(sortedmulti)', displayName: 'Multisig Native SegWit (BIP-48)', hardwareDiscoveryOrder: 4 }),
] as const satisfies readonly WalletPolicyRow[]);

export interface CanonicalAccountPath {
  readonly path: string;
  readonly policyId: string;
  readonly policy: WalletPolicyRow;
  readonly derivationFamily: DerivationNetworkFamily;
  readonly coinType: 0 | 1;
  readonly account: number;
}

export interface CanonicalAddressPath extends CanonicalAccountPath {
  readonly accountPath: string;
  readonly branch: WalletAddressBranch;
  readonly index: number;
}

export interface WalletPolicyExpectation {
  readonly walletType: WalletTypeValue;
  readonly scriptType: WalletScriptTypeValue;
  readonly chainEnvironment?: NetworkType;
  readonly derivationFamily?: DerivationNetworkFamily;
}

export function chainEnvironmentToDerivationFamily(
  network: unknown,
): DerivationNetworkFamily | null {
  if (network === 'mainnet') return 'mainnet';
  if (typeof network === 'string' && BITCOIN_NETWORKS.includes(network as NetworkType)) {
    return 'testnet';
  }
  return null;
}

export function coinTypeForDerivationFamily(family: DerivationNetworkFamily): 0 | 1 {
  if (family === 'mainnet') return 0;
  if (family === 'testnet') return 1;
  throw new Error('Unknown derivation network family');
}

export function findWalletPolicy(
  walletType: WalletTypeValue,
  scriptType: WalletScriptTypeValue,
): WalletPolicyRow | null {
  return WALLET_POLICY_REGISTRY.find(
    row => row.walletType === walletType && row.scriptType === scriptType,
  ) ?? null;
}

export function isValidBip32ChildIndex(index: unknown): index is number {
  return Number.isInteger(index) && Number(index) >= 0 && Number(index) <= MAX_BIP32_CHILD_INDEX;
}

const canonicalIndex = (value: string): number | null => {
  const index = Number(value);
  return isValidBip32ChildIndex(index) ? index : null;
};

const policyForPath = (
  purpose: number,
  bip48ScriptType: number | null,
): WalletPolicyRow | null => WALLET_POLICY_REGISTRY.find(
  row => row.purpose === purpose && row.bip48ScriptType === bip48ScriptType,
) ?? null;

export function buildCanonicalAccountPathForFamily(options: {
  walletType: WalletTypeValue;
  scriptType: WalletScriptTypeValue;
  derivationFamily: DerivationNetworkFamily;
  account: number;
}): string {
  // BIP48 appends a hardened script-type component: /1' for nested SegWit and
  // /2' for native SegWit. The single-sig BIPs end at the account component.
  const policy = findWalletPolicy(options.walletType, options.scriptType);
  if (!policy) throw new Error('Unsupported wallet policy');
  if (!isValidBip32ChildIndex(options.account)) throw new Error('Invalid BIP32 account index');
  const coinType = coinTypeForDerivationFamily(options.derivationFamily);
  const base = `m/${policy.purpose}'/${coinType}'/${options.account}'`;
  return policy.bip48ScriptType === null ? base : `${base}/${policy.bip48ScriptType}'`;
}

export function buildCanonicalAccountPath(options: {
  walletType: WalletTypeValue;
  scriptType: WalletScriptTypeValue;
  chainEnvironment: NetworkType;
  account: number;
}): string {
  const derivationFamily = chainEnvironmentToDerivationFamily(options.chainEnvironment);
  if (!derivationFamily) throw new Error('Unknown chain environment');
  return buildCanonicalAccountPathForFamily({ ...options, derivationFamily });
}

export function parseCanonicalAccountPath(path: unknown): CanonicalAccountPath | null {
  if (typeof path !== 'string') return null;
  const match = /^m\/(44|48|49|84|86)'\/(0|1)'\/(0|[1-9]\d*)'(?:\/(1|2)')?$/.exec(path);
  if (!match) return null;
  const purpose = Number(match[1]);
  const coinType = Number(match[2]) as 0 | 1;
  const account = canonicalIndex(match[3]);
  const bip48ScriptType = match[4] === undefined ? null : Number(match[4]);
  const policy = policyForPath(purpose, bip48ScriptType);
  if (account === null || !policy) return null;
  return { path, policyId: policy.id, policy, derivationFamily: coinType === 0 ? 'mainnet' : 'testnet', coinType, account };
}

export function accountPathMatchesWalletPolicy(
  path: unknown,
  expectation: WalletPolicyExpectation,
): boolean {
  const parsed = parseCanonicalAccountPath(path);
  if (!parsed) return false;
  // Omitting both network fields intentionally asks only whether the path's
  // purpose/script family matches; persistence and signing callers supply one.
  const expectedFamily = expectation.chainEnvironment === undefined
    ? expectation.derivationFamily
    : chainEnvironmentToDerivationFamily(expectation.chainEnvironment);
  return parsed.policy.walletType === expectation.walletType
    && parsed.policy.scriptType === expectation.scriptType
    && expectedFamily !== null
    && (expectedFamily === undefined || parsed.derivationFamily === expectedFamily);
}

export function buildCanonicalAddressPath(
  accountPath: string,
  branch: WalletAddressBranch,
  index: number,
): string {
  if (!parseCanonicalAccountPath(accountPath)) throw new Error('Invalid canonical account path');
  if (branch !== 0 && branch !== 1) throw new Error('Invalid wallet address branch');
  if (!isValidBip32ChildIndex(index)) throw new Error('Invalid BIP32 address index');
  return `${accountPath}/${branch}/${index}`;
}

export function parseCanonicalAddressPath(path: unknown): CanonicalAddressPath | null {
  if (typeof path !== 'string') return null;
  const match = /^(.*)\/(0|1)\/(0|[1-9]\d*)$/.exec(path);
  if (!match) return null;
  const account = parseCanonicalAccountPath(match[1]);
  const index = canonicalIndex(match[3]);
  if (!account || index === null) return null;
  return { ...account, path, accountPath: account.path, branch: Number(match[2]) as WalletAddressBranch, index };
}
