/**
 * Path Utilities
 *
 * BIP-32/44/48/84/86 path parsing, script type determination,
 * and address_n conversion for Trezor.
 */

type TrezorScriptType = 'SPENDADDRESS' | 'SPENDP2SHWITNESS' | 'SPENDWITNESS' | 'SPENDTAPROOT';

const SCRIPT_TYPE_BY_PURPOSE: Record<string, TrezorScriptType> = {
  '44': 'SPENDADDRESS',
  '49': 'SPENDP2SHWITNESS',
  '84': 'SPENDWITNESS',
  '86': 'SPENDTAPROOT',
};

function getHardenedPurpose(path: string): string | null {
  const purposeMatch = path.replace(/^m\//, '').match(/^(\d+)(?:'|h)(?:\/|$)/);
  return purposeMatch?.[1] ?? null;
}

function getBip48ScriptType(path: string): TrezorScriptType {
  // BIP-48 script type suffix: /2' or /2h = native P2WSH; default = nested P2SH-P2WSH.
  return path.includes("/2'") || path.includes("/2h")
    ? 'SPENDWITNESS'
    : 'SPENDP2SHWITNESS';
}

/**
 * Validate and format a satoshi amount for Trezor.
 * Handles both number and BigInt types, validates range.
 * @internal Exported for testing
 */
export function validateSatoshiAmount(amount: number | bigint | undefined, context: string): string {
  if (amount === undefined || amount === null) {
    throw new Error(`${context}: amount is missing`);
  }
  // Handle both number and BigInt types
  const amountNum = typeof amount === 'bigint' ? Number(amount) : amount;
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    throw new Error(`${context}: invalid amount ${amount}`);
  }
  return amount.toString();
}

/**
 * Determine Trezor script type from BIP path.
 * @internal Exported for testing
 */
export const getTrezorScriptType = (path: string): TrezorScriptType => {
  const purpose = getHardenedPurpose(path);
  if (purpose === '48') {
    return getBip48ScriptType(path);
  }

  return purpose ? SCRIPT_TYPE_BY_PURPOSE[purpose] ?? 'SPENDWITNESS' : 'SPENDWITNESS';
};

/**
 * Check if a path is a BIP-48 multisig path.
 * BIP-48 paths (m/48'/...) are used for multisig wallets and are considered
 * "non-standard" by Trezor's safety checks.
 *
 * NOTE: TrezorConnect.unlockPath() does NOT work for BIP-48 paths - it was designed
 * for SLIP-26 (Cardano-style) derivation. BIP-48 multisig paths are validated through
 * the multisig structure provided in inputs/outputs, not through unlockPath.
 *
 * To sign with BIP-48 paths, users need to set Safety Checks to "Prompt" in Trezor Suite.
 * @internal Exported for testing
 */
export const isBip48MultisigPath = (path: string): boolean => {
  return getHardenedPurpose(path) === '48';
};

/**
 * Extract the account-level path prefix for unlocking.
 * e.g., "m/48'/0'/0'/2'/0/5" -> "m/48'/0'/0'/2'"
 *
 * NOTE: This differs from shared extractAccountPath — it returns 4 segments
 * AFTER m/ (purpose/coin/account/script), which is needed for BIP-48 paths
 * where the script type suffix is part of the account identity.
 * @internal Exported for testing
 */
export const getAccountPathPrefix = (path: string): string => {
  const parts = path.replace(/^m\//, '').split('/');
  // For BIP-48, the account path is the first 4 segments: purpose'/coin'/account'/script'
  const accountParts = parts.slice(0, 4);
  return 'm/' + accountParts.join('/');
};

/**
 * Convert path string to Trezor address_n array.
 * @internal Exported for testing (used by signPsbt)
 */
export const pathToAddressN = (path: string): number[] => {
  return path
    .replace(/^m\//, '')
    .split('/')
    .map(part => {
      const hardened = part.endsWith("'") || part.endsWith('h');
      const index = parseInt(part.replace(/['h]/g, ''), 10);
      return hardened ? index + 0x80000000 : index;
    });
};
