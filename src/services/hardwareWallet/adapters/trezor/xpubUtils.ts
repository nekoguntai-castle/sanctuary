/**
 * XPUB Utilities
 *
 * SLIP-132 to standard xpub/tpub conversion and version byte constants.
 */

import bs58check from 'bs58check';
import { createLogger } from '../../../../utils/logger';

const log = createLogger('TrezorAdapter');

// Standard BIP-32 xpub version bytes
const XPUB_VERSION = Buffer.from([0x04, 0x88, 0xb2, 0x1e]); // mainnet xpub
const TPUB_VERSION = Buffer.from([0x04, 0x35, 0x87, 0xcf]); // testnet tpub

// SLIP-132 extended public key version bytes (for detection)
// These are non-standard prefixes used by some wallets for script-type encoding
const SLIP132_VERSIONS: Record<string, { isTestnet: boolean }> = {
  // Mainnet P2WSH (native segwit multisig) - Zpub
  '02aa7ed3': { isTestnet: false },
  // Mainnet P2WPKH (native segwit) - zpub
  '04b24746': { isTestnet: false },
  // Mainnet P2SH-P2WPKH (nested segwit) - ypub
  '049d7cb2': { isTestnet: false },
  // Mainnet P2SH-P2WSH (nested segwit multisig) - Ypub
  '0295b43f': { isTestnet: false },
  // Testnet P2WSH - Vpub
  '02575483': { isTestnet: true },
  // Testnet P2WPKH - vpub
  '045f1cf6': { isTestnet: true },
  // Testnet P2SH-P2WPKH - upub
  '044a5262': { isTestnet: true },
  // Testnet P2SH-P2WSH - Upub
  '024289ef': { isTestnet: true },
};

/**
 * Convert SLIP-132 formatted extended public keys (Zpub, ypub, etc.) to standard xpub/tpub format.
 * Trezor only accepts standard BIP-32 xpub format, not SLIP-132 script-type specific formats.
 * @internal Exported for testing
 */
export function convertToStandardXpub(extendedPubKey: string): string {
  // If already standard xpub/tpub format, return as-is
  if (extendedPubKey.startsWith('xpub') || extendedPubKey.startsWith('tpub')) {
    return extendedPubKey;
  }

  try {
    // Decode base58check
    const data = bs58check.decode(extendedPubKey);

    // First 4 bytes are version
    const versionHex = data.slice(0, 4).toString('hex');
    const slip132Info = SLIP132_VERSIONS[versionHex];

    if (slip132Info) {
      // Replace version bytes with standard xpub/tpub version
      const newVersion = slip132Info.isTestnet ? TPUB_VERSION : XPUB_VERSION;
      const newData = Buffer.concat([newVersion, data.slice(4)]);
      const converted = bs58check.encode(newData);

      log.info('Converted SLIP-132 xpub to standard format', {
        original: extendedPubKey.substring(0, 10) + '...',
        converted: converted.substring(0, 10) + '...',
        versionHex,
        isTestnet: slip132Info.isTestnet,
      });

      return converted;
    }

    // Unknown version, return as-is (might be standard xpub with different prefix)
    log.debug('Unknown xpub version, returning as-is', { versionHex, prefix: extendedPubKey.substring(0, 4) });
    return extendedPubKey;
  } catch (error) {
    log.warn('Failed to convert xpub format, returning as-is', { error, prefix: extendedPubKey.substring(0, 4) });
    return extendedPubKey;
  }
}
