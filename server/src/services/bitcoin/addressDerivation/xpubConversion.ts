/**
 * Extended Public Key Conversion
 *
 * Handles conversion between different xpub formats (SLIP-132):
 * zpub, ypub, Zpub, Ypub, vpub, upub, Vpub, Upub -> xpub/tpub
 * and reverse conversions to specific formats.
 */

import bs58check from 'bs58check';

/**
 * Version bytes for different extended key formats (SLIP-132)
 * These are the 4-byte prefixes that determine the key format
 */
const XPUB_VERSIONS: Record<string, { prefix: string; targetPrefix: string; targetVersion: Buffer }> = {
  // Mainnet
  'xpub': { prefix: 'xpub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) },
  'ypub': { prefix: 'ypub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) }, // BIP49 nested segwit
  'zpub': { prefix: 'zpub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) }, // BIP84 native segwit
  'Ypub': { prefix: 'Ypub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) }, // Multisig nested segwit
  'Zpub': { prefix: 'Zpub', targetPrefix: 'xpub', targetVersion: Buffer.from([0x04, 0x88, 0xB2, 0x1E]) }, // Multisig native segwit
  // Testnet
  'tpub': { prefix: 'tpub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) },
  'upub': { prefix: 'upub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) }, // BIP49 nested segwit
  'vpub': { prefix: 'vpub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) }, // BIP84 native segwit
  'Upub': { prefix: 'Upub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) }, // Multisig nested segwit
  'Vpub': { prefix: 'Vpub', targetPrefix: 'tpub', targetVersion: Buffer.from([0x04, 0x35, 0x87, 0xCF]) }, // Multisig native segwit
};

/**
 * Version bytes for converting TO specific formats (reverse of XPUB_VERSIONS)
 */
const XPUB_TARGET_VERSIONS: Record<string, Buffer> = {
  'xpub': Buffer.from([0x04, 0x88, 0xB2, 0x1E]),
  'tpub': Buffer.from([0x04, 0x35, 0x87, 0xCF]),
  'Zpub': Buffer.from([0x02, 0xAA, 0x7E, 0xD3]), // P2WSH multisig mainnet
  'Vpub': Buffer.from([0x02, 0x57, 0x54, 0x83]), // P2WSH multisig testnet
  'Ypub': Buffer.from([0x02, 0x95, 0xB4, 0x3F]), // P2SH-P2WSH multisig mainnet
  'Upub': Buffer.from([0x02, 0x42, 0x89, 0xEF]), // P2SH-P2WSH multisig testnet
};

/**
 * Convert extended public key to standard xpub/tpub format
 * This handles zpub, ypub, Zpub, Ypub, vpub, upub, Vpub, Upub formats
 * which use different version bytes but contain the same key material
 */
export function convertToStandardXpub(extendedKey: string): string {
  // Detect the prefix (first 4 characters)
  const prefix = extendedKey.slice(0, 4);
  const versionInfo = XPUB_VERSIONS[prefix];

  // If already standard format or unknown, return as-is
  if (!versionInfo || prefix === versionInfo.targetPrefix) {
    return extendedKey;
  }

  try {
    // Decode the base58check encoded key
    const decoded = bs58check.decode(extendedKey);

    // Replace the version bytes (first 4 bytes) with target version
    const converted = Buffer.concat([
      versionInfo.targetVersion,
      decoded.slice(4)
    ]);

    // Re-encode with base58check
    return bs58check.encode(converted);
  } catch (error) {
    // If conversion fails, return original and let downstream handle the error
    return extendedKey;
  }
}

/**
 * Convert extended public key to a specific format (e.g., xpub -> Zpub)
 * Used for exports that require consistent xpub format (like Coldcard)
 */
export function convertXpubToFormat(extendedKey: string, targetFormat: 'xpub' | 'tpub' | 'Zpub' | 'Vpub' | 'Ypub' | 'Upub'): string {
  const prefix = extendedKey.slice(0, 4);

  // If already in target format, return as-is
  if (prefix === targetFormat) {
    return extendedKey;
  }

  const targetVersion = XPUB_TARGET_VERSIONS[targetFormat];
  if (!targetVersion) {
    return extendedKey;
  }

  try {
    // Decode the base58check encoded key
    const decoded = bs58check.decode(extendedKey);

    // Replace the version bytes (first 4 bytes) with target version
    const converted = Buffer.concat([
      targetVersion,
      decoded.slice(4)
    ]);

    // Re-encode with base58check
    return bs58check.encode(converted);
  } catch (error) {
    // If conversion fails, return original
    return extendedKey;
  }
}
