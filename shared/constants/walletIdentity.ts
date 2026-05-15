/**
 * Canonical wallet/account identity values.
 *
 * Keep this module pure: it is imported by frontend, server, gateway,
 * OpenAPI schemas, and tests. Behavior metadata such as labels,
 * derivation paths, descriptor wrappers, and multisig support stays in the
 * runtime modules that own that behavior.
 */

export const WalletType = {
  SINGLE_SIG: 'single_sig',
  MULTI_SIG: 'multi_sig',
} as const;

export const WALLET_TYPE_VALUES = [
  WalletType.SINGLE_SIG,
  WalletType.MULTI_SIG,
] as const;

export type WalletType = (typeof WALLET_TYPE_VALUES)[number];
export type WalletTypeValue = WalletType;

export const WalletScriptType = {
  NATIVE_SEGWIT: 'native_segwit',
  NESTED_SEGWIT: 'nested_segwit',
  TAPROOT: 'taproot',
  LEGACY: 'legacy',
} as const;

export const WALLET_SCRIPT_TYPE_VALUES = [
  WalletScriptType.LEGACY,
  WalletScriptType.NESTED_SEGWIT,
  WalletScriptType.NATIVE_SEGWIT,
  WalletScriptType.TAPROOT,
] as const;

export type WalletScriptType = (typeof WALLET_SCRIPT_TYPE_VALUES)[number];

export const DeviceAccountPurpose = {
  SINGLE_SIG: 'single_sig',
  MULTISIG: 'multisig',
} as const;

export const DEVICE_ACCOUNT_PURPOSE_VALUES = [
  DeviceAccountPurpose.SINGLE_SIG,
  DeviceAccountPurpose.MULTISIG,
] as const;

export type DeviceAccountPurpose = (typeof DEVICE_ACCOUNT_PURPOSE_VALUES)[number];

export const WALLET_TYPE_TO_ACCOUNT_PURPOSE = {
  [WalletType.SINGLE_SIG]: DeviceAccountPurpose.SINGLE_SIG,
  [WalletType.MULTI_SIG]: DeviceAccountPurpose.MULTISIG,
} as const satisfies Record<WalletType, DeviceAccountPurpose>;

function includesString<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isWalletType(value: unknown): value is WalletType {
  return includesString(WALLET_TYPE_VALUES, value);
}

export function parseWalletType(value: unknown): WalletType | null {
  return isWalletType(value) ? value : null;
}

export function isWalletScriptType(value: unknown): value is WalletScriptType {
  return includesString(WALLET_SCRIPT_TYPE_VALUES, value);
}

export function parseWalletScriptType(value: unknown): WalletScriptType | null {
  return isWalletScriptType(value) ? value : null;
}

export function isDeviceAccountPurpose(value: unknown): value is DeviceAccountPurpose {
  return includesString(DEVICE_ACCOUNT_PURPOSE_VALUES, value);
}

export function parseDeviceAccountPurpose(value: unknown): DeviceAccountPurpose | null {
  return isDeviceAccountPurpose(value) ? value : null;
}

export function accountPurposeForWalletType(walletType: WalletType): DeviceAccountPurpose {
  return WALLET_TYPE_TO_ACCOUNT_PURPOSE[walletType];
}
