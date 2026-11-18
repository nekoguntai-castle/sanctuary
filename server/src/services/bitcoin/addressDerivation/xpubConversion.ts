/**
 * Extended Public Key Conversion
 *
 * Handles conversion between different xpub formats (SLIP-132):
 * zpub, ypub, Zpub, Ypub, vpub, upub, Vpub, Upub -> xpub/tpub
 * and reverse conversions to specific formats.
 */

import bs58check from 'bs58check';

const MAINNET_STANDARD_VERSION = Buffer.from([0x04, 0x88, 0xB2, 0x1E]); // xpub
const TESTNET_STANDARD_VERSION = Buffer.from([0x04, 0x35, 0x87, 0xCF]); // tpub

/**
 * SLIP-132 prefixes that carry standard key material under different version
 * bytes, mapped to the standard version they convert to. xpub and tpub are
 * absent on purpose: they are already standard and pass through unchanged.
 */
const SLIP132_STANDARD_VERSIONS: Record<string, Buffer> = {
  // Mainnet
  'ypub': MAINNET_STANDARD_VERSION, // BIP49 nested segwit
  'zpub': MAINNET_STANDARD_VERSION, // BIP84 native segwit
  'Ypub': MAINNET_STANDARD_VERSION, // Multisig nested segwit
  'Zpub': MAINNET_STANDARD_VERSION, // Multisig native segwit
  // Testnet
  'upub': TESTNET_STANDARD_VERSION, // BIP49 nested segwit
  'vpub': TESTNET_STANDARD_VERSION, // BIP84 native segwit
  'Upub': TESTNET_STANDARD_VERSION, // Multisig nested segwit
  'Vpub': TESTNET_STANDARD_VERSION, // Multisig native segwit
};

const PRIVATE_EXTENDED_KEY_PREFIXES = new Set([
  'xprv',
  'yprv',
  'zprv',
  'Yprv',
  'Zprv',
  'tprv',
  'uprv',
  'vprv',
  'Uprv',
  'Vprv',
]);

/**
 * Detect private extended keys before any version-byte conversion.
 *
 * The wallet import and descriptor paths must never accept xprv/yprv/zprv
 * material; converting those bytes would hide key custody risk behind an xpub
 * shaped string instead of preserving Sanctuary's watch-only boundary.
 */
export function isPrivateExtendedKey(extendedKey: string): boolean {
  return PRIVATE_EXTENDED_KEY_PREFIXES.has(extendedKey.slice(0, 4));
}

/**
 * Enforce that callers pass public extended keys only.
 */
export function assertPublicExtendedKey(extendedKey: string): void {
  if (isPrivateExtendedKey(extendedKey)) {
    throw new Error('Private extended keys are not allowed. Provide an extended public key instead.');
  }
}

/**
 * Version bytes for converting TO specific formats
 */
const XPUB_TARGET_VERSIONS: Record<string, Buffer> = {
  'xpub': MAINNET_STANDARD_VERSION,
  'tpub': TESTNET_STANDARD_VERSION,
  'Zpub': Buffer.from([0x02, 0xAA, 0x7E, 0xD3]), // P2WSH multisig mainnet
  'Vpub': Buffer.from([0x02, 0x57, 0x54, 0x83]), // P2WSH multisig testnet
  'Ypub': Buffer.from([0x02, 0x95, 0xB4, 0x3F]), // P2SH-P2WSH multisig mainnet
  'Upub': Buffer.from([0x02, 0x42, 0x89, 0xEF]), // P2SH-P2WSH multisig testnet
};

/**
 * Re-encode an extended key under different version bytes. The key material
 * after the 4-byte version is kept as it is.
 *
 * Callers pass a real version Buffer, so only the decode can fail, and only
 * the decode is guarded.
 */
function withVersionBytes(extendedKey: string, version: Buffer): string {
  let decoded: Uint8Array;
  try {
    decoded = bs58check.decode(extendedKey);
  } catch (error) {
    // Not valid base58check: return the key unchanged and let downstream
    // validation reject it.
    return extendedKey;
  }

  return bs58check.encode(Buffer.concat([version, decoded.slice(4)]));
}

/**
 * Convert extended public key to standard xpub/tpub format
 * This handles zpub, ypub, Zpub, Ypub, vpub, upub, Vpub, Upub formats
 * which use different version bytes but contain the same key material
 */
export function convertToStandardXpub(extendedKey: string): string {
  assertPublicExtendedKey(extendedKey);

  // The first 4 characters name the format. Standard and unknown prefixes
  // have no entry and are returned as they are.
  const standardVersion = SLIP132_STANDARD_VERSIONS[extendedKey.slice(0, 4)];
  if (!standardVersion) {
    return extendedKey;
  }

  return withVersionBytes(extendedKey, standardVersion);
}

/**
 * Convert extended public key to a specific format (e.g., xpub -> Zpub)
 * Used for exports that require consistent xpub format (like Coldcard)
 */
export function convertXpubToFormat(extendedKey: string, targetFormat: 'xpub' | 'tpub' | 'Zpub' | 'Vpub' | 'Ypub' | 'Upub'): string {
  assertPublicExtendedKey(extendedKey);

  // A key already in the target format is returned untouched, including its
  // exact version bytes.
  if (extendedKey.slice(0, 4) === targetFormat) {
    return extendedKey;
  }

  // Own keys only: an untyped caller passing 'constructor' must not reach an
  // inherited Object member.
  if (!Object.prototype.hasOwnProperty.call(XPUB_TARGET_VERSIONS, targetFormat)) {
    return extendedKey;
  }

  return withVersionBytes(extendedKey, XPUB_TARGET_VERSIONS[targetFormat]);
}
