/**
 * UR Device Decoder Utilities
 *
 * Extract xpub, fingerprint, and derivation path data from UR (Uniform Resources)
 * format QR codes used by hardware wallets like Keystone, Foundation Passport,
 * and SeedSigner.
 *
 * Supports:
 * - CryptoHDKey (single key export)
 * - CryptoOutput (output descriptor with key)
 * - CryptoAccount (multi-account export)
 * - ur:bytes (Foundation Passport JSON format)
 */

import { CryptoOutput, CryptoHDKey, CryptoAccount } from '@keystonehq/bc-ur-registry';
import { parseDeviceJson } from '../services/deviceParsers';
import { createLogger } from './logger';

const log = createLogger('urDeviceDecoder');

/** Result of extracting device data from UR format */
export interface UrExtractResult {
  xpub: string;
  fingerprint: string;
  path: string;
}

/**
 * Extract fingerprint from CryptoHDKey with fallbacks
 *
 * Attempts to get fingerprint in order of preference:
 * 1. Source fingerprint from origin (master fingerprint)
 * 2. Parent fingerprint (fallback, not ideal but better than nothing)
 */
export function extractFingerprintFromHdKey(hdKey: CryptoHDKey): string {
  // Try 1: Get from origin's source fingerprint (master fingerprint)
  const origin = hdKey.getOrigin();
  if (origin) {
    const sourceFingerprint = origin.getSourceFingerprint();
    if (sourceFingerprint && sourceFingerprint.length > 0) {
      return sourceFingerprint.toString('hex');
    }
  }

  // Try 2: Get parent fingerprint (not ideal, but better than nothing)
  // This is the fingerprint of the key one level up in derivation
  try {
    const parentFp = hdKey.getParentFingerprint();
    if (parentFp && parentFp.length > 0) {
      log.debug('Using parent fingerprint as fallback');
      return parentFp.toString('hex');
    }
  } catch (error) {
    log.debug('Parent fingerprint fallback failed', { error });
    // getParentFingerprint might not exist or fail
  }

  return '';
}

/**
 * Extract derivation path from CryptoHDKey origin
 */
function extractPathFromOrigin(origin: ReturnType<CryptoHDKey['getOrigin']>): string {
  if (!origin) return '';

  const pathComponents = origin.getComponents() || [];
  if (pathComponents.length === 0) return '';

  return 'm/' + pathComponents
    .map((c: { getIndex: () => number; isHardened: () => boolean }) =>
      `${c.getIndex()}${c.isHardened() ? "'" : ''}`
    )
    .join('/');
}

/**
 * Try to extract xpub data from UR registry result
 *
 * Handles various UR types:
 * - CryptoHDKey: Single key export
 * - CryptoOutput: Output descriptor containing a key
 * - CryptoAccount: Multi-account export (returns first BIP84 or first available)
 * - ur:bytes: Raw bytes that may contain JSON/text wallet data
 */
export function extractFromUrResult(registryType: unknown): UrExtractResult | null {
  try {
    // Handle CryptoHDKey
    if (registryType instanceof CryptoHDKey) {
      const hdKey = registryType;
      const xpub = hdKey.getBip32Key();
      const fingerprint = extractFingerprintFromHdKey(hdKey);
      const path = extractPathFromOrigin(hdKey.getOrigin());

      log.debug('Extracted from CryptoHDKey', { hasXpub: !!xpub, fingerprint, path });
      return { xpub, fingerprint, path };
    }

    // Handle CryptoOutput (output descriptor)
    if (registryType instanceof CryptoOutput) {
      const output = registryType;
      const hdKey = output.getHDKey();
      if (hdKey) {
        const xpub = hdKey.getBip32Key();
        const fingerprint = extractFingerprintFromHdKey(hdKey);
        const path = extractPathFromOrigin(hdKey.getOrigin());

        log.debug('Extracted from CryptoOutput', { hasXpub: !!xpub, fingerprint, path });
        return { xpub, fingerprint, path };
      }
    }

    // Handle CryptoAccount (multi-account format)
    if (registryType instanceof CryptoAccount) {
      const account = registryType;
      const masterFingerprint = account.getMasterFingerprint()?.toString('hex') || '';
      const outputs = account.getOutputDescriptors();

      // Find a suitable output (prefer native segwit BIP84)
      for (const output of outputs) {
        const hdKey = output.getHDKey();
        if (hdKey) {
          const xpub = hdKey.getBip32Key();
          const path = extractPathFromOrigin(hdKey.getOrigin());

          // Return the first valid one with 84' in path for native segwit
          if (path.includes("84'")) {
            return { xpub, fingerprint: masterFingerprint, path };
          }
        }
      }

      // Fall back to first output if no BIP84 found
      if (outputs.length > 0) {
        const hdKey = outputs[0].getHDKey();
        if (hdKey) {
          const xpub = hdKey.getBip32Key();
          const path = extractPathFromOrigin(hdKey.getOrigin());
          return { xpub, fingerprint: masterFingerprint, path };
        }
      }
    }

    // Handle ur:bytes format (Foundation Passport Sparrow export, etc.)
    // The bytes may contain text/JSON wallet descriptor data
    if (registryType && typeof registryType === 'object' && 'bytes' in registryType) {
      const obj = registryType as { bytes: unknown };
      if (obj.bytes instanceof Uint8Array) {
        log.debug('Detected ur:bytes format, attempting to decode...');

        // Try to decode as UTF-8 text (could be JSON or text descriptor)
        try {
          const textDecoder = new TextDecoder('utf-8');
          const textContent = textDecoder.decode(obj.bytes);
          log.debug('Decoded bytes as text', { preview: textContent.substring(0, 200) });

          // Use the device parser registry to parse the content
          const result = parseDeviceJson(textContent);
          if (result && result.xpub) {
            log.debug('Extracted from ur:bytes', {
              format: result.format,
              xpubPreview: result.xpub.substring(0, 20) + '...',
              fingerprint: result.fingerprint || '',
              path: result.derivationPath || ''
            });
            return {
              xpub: result.xpub,
              fingerprint: result.fingerprint || '',
              path: result.derivationPath || ''
            };
          }
        } catch (decodeErr) {
          log.error('Failed to decode ur:bytes as text', { error: decodeErr });
        }
      }
    }

    return null;
  } catch (err) {
    log.error('Failed to extract from UR result', { error: err });
    return null;
  }
}

/**
 * Extract xpub data from ur:bytes text content (Foundation Passport format)
 *
 * The ur:bytes typically contains JSON with wallet descriptor information.
 * Uses the device parser registry to handle various JSON formats.
 */
export function extractFromUrBytesContent(textContent: string): UrExtractResult | null {
  // Use the device parser registry to parse the text content
  const result = parseDeviceJson(textContent);

  if (result && result.xpub) {
    log.debug('Extracted from ur:bytes text', {
      format: result.format,
      xpubPreview: result.xpub.substring(0, 20) + '...',
      fingerprint: result.fingerprint || '',
      path: result.derivationPath || ''
    });
    return {
      xpub: result.xpub,
      fingerprint: result.fingerprint || '',
      path: result.derivationPath || ''
    };
  }

  return null;
}

/**
 * Check if a string is UR format
 */
export function isUrFormat(content: string): boolean {
  return content.toLowerCase().startsWith('ur:');
}

/**
 * Extract UR type from a UR string
 *
 * @example
 * getUrType('ur:crypto-hdkey/...') // => 'crypto-hdkey'
 * getUrType('ur:bytes/...') // => 'bytes'
 */
export function getUrType(urString: string): string | null {
  const match = urString.toLowerCase().match(/^ur:([a-z0-9-]+)/);
  return match ? match[1] : null;
}
