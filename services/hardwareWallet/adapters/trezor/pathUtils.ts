/**
 * Path Utilities
 *
 * BIP-32/44/48/84/86 path parsing, script type determination,
 * and address_n conversion for Trezor.
 */

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
export const getTrezorScriptType = (path: string): 'SPENDADDRESS' | 'SPENDP2SHWITNESS' | 'SPENDWITNESS' | 'SPENDTAPROOT' => {
  // Check for both apostrophe (') and h notation for hardened paths
  if (path.startsWith("m/44'") || path.startsWith("44'") ||
      path.startsWith("m/44h") || path.startsWith("44h")) {
    return 'SPENDADDRESS';
  }
  if (path.startsWith("m/49'") || path.startsWith("49'") ||
      path.startsWith("m/49h") || path.startsWith("49h")) {
    return 'SPENDP2SHWITNESS';
  }
  if (path.startsWith("m/84'") || path.startsWith("84'") ||
      path.startsWith("m/84h") || path.startsWith("84h")) {
    return 'SPENDWITNESS';
  }
  if (path.startsWith("m/86'") || path.startsWith("86'") ||
      path.startsWith("m/86h") || path.startsWith("86h")) {
    return 'SPENDTAPROOT';
  }
  // BIP-48 multisig paths
  if (path.startsWith("m/48'") || path.startsWith("48'") ||
      path.startsWith("m/48h") || path.startsWith("48h")) {
    // Check script type suffix: /1' or /1h = P2SH-P2WSH, /2' or /2h = P2WSH
    if (path.includes("/2'") || path.includes("/2h")) {
      return 'SPENDWITNESS'; // Native SegWit multisig (P2WSH)
    }
    return 'SPENDP2SHWITNESS'; // Nested SegWit multisig (P2SH-P2WSH)
  }
  return 'SPENDWITNESS';
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
  // Check for both apostrophe notation (') and h notation
  return path.startsWith("m/48'") || path.startsWith("48'") ||
         path.startsWith("m/48h") || path.startsWith("48h");
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
