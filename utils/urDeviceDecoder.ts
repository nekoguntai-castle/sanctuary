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

function extractFromHdKey(hdKey: CryptoHDKey, source: 'CryptoHDKey' | 'CryptoOutput'): UrExtractResult {
  const result = {
    xpub: hdKey.getBip32Key(),
    fingerprint: extractFingerprintFromHdKey(hdKey),
    path: extractPathFromOrigin(hdKey.getOrigin()),
  };

  log.debug(`Extracted from ${source}`, {
    hasXpub: !!result.xpub,
    fingerprint: result.fingerprint,
    path: result.path,
  });
  return result;
}

function extractFromCryptoOutput(output: CryptoOutput): UrExtractResult | null {
  const hdKey = output.getHDKey();
  return hdKey ? extractFromHdKey(hdKey, 'CryptoOutput') : null;
}

function extractFromAccountOutput(
  output: CryptoOutput,
  fingerprint: string
): UrExtractResult | null {
  const hdKey = output.getHDKey();
  if (!hdKey) return null;

  return {
    xpub: hdKey.getBip32Key(),
    fingerprint,
    path: extractPathFromOrigin(hdKey.getOrigin()),
  };
}

function extractFromCryptoAccount(account: CryptoAccount): UrExtractResult | null {
  const fingerprint = account.getMasterFingerprint()?.toString('hex') || '';
  const outputs = account.getOutputDescriptors();

  for (const output of outputs) {
    const result = extractFromAccountOutput(output, fingerprint);
    if (result?.path.includes("84'")) {
      return result;
    }
  }

  return outputs.length > 0 ? extractFromAccountOutput(outputs[0], fingerprint) : null;
}

function resultFromParsedDevice(
  result: ReturnType<typeof parseDeviceJson>
): UrExtractResult | null {
  if (!result?.xpub) return null;

  return {
    xpub: result.xpub,
    fingerprint: result.fingerprint || '',
    path: result.derivationPath || ''
  };
}

function extractFromUrBytes(registryType: unknown): UrExtractResult | null {
  if (!registryType || typeof registryType !== 'object' || !('bytes' in registryType)) {
    return null;
  }

  const obj = registryType as { bytes: unknown };
  if (!(obj.bytes instanceof Uint8Array)) return null;

  log.debug('Detected ur:bytes format, attempting to decode...');

  try {
    const textDecoder = new TextDecoder('utf-8');
    const textContent = textDecoder.decode(obj.bytes);
    log.debug('Decoded bytes as text', { preview: textContent.substring(0, 200) });

    const parsed = parseDeviceJson(textContent);
    const result = resultFromParsedDevice(parsed);
    if (result) {
      log.debug('Extracted from ur:bytes', {
        format: parsed?.format,
        xpubPreview: result.xpub.substring(0, 20) + '...',
        fingerprint: result.fingerprint,
        path: result.path
      });
    }
    return result;
  } catch (decodeErr) {
    log.error('Failed to decode ur:bytes as text', { error: decodeErr });
    return null;
  }
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
    if (registryType instanceof CryptoHDKey) {
      return extractFromHdKey(registryType, 'CryptoHDKey');
    }

    if (registryType instanceof CryptoOutput) {
      return extractFromCryptoOutput(registryType);
    }

    if (registryType instanceof CryptoAccount) {
      return extractFromCryptoAccount(registryType);
    }

    return extractFromUrBytes(registryType);
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
  const parsed = parseDeviceJson(textContent);
  const result = resultFromParsedDevice(parsed);
  if (result) {
    log.debug('Extracted from ur:bytes text', {
      format: parsed?.format,
      xpubPreview: result.xpub.substring(0, 20) + '...',
      fingerprint: result.fingerprint,
      path: result.path
    });
  }

  return result;
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
