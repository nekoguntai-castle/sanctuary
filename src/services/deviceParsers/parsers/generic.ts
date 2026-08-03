/**
 * Generic Format Parsers
 *
 * Handles various simple/generic JSON formats and plain xpub strings.
 * These are lower priority fallbacks when no specific format is detected.
 */

import type { DeviceParser, DeviceParseResult, FormatDetectionResult } from '../types';

// Regex patterns for xpub extraction
const XPUB_REGEX = /^[xyztuv]pub[a-zA-Z0-9]{100,}$/i;
const XPUB_EXTRACT_REGEX = /([xyztuv]pub[a-zA-Z0-9]{100,})/i;

/**
 * Generic JSON Parser
 * Handles various field names for xpub, fingerprint, derivation path
 */
export const genericJsonParser: DeviceParser = {
  id: 'generic-json',
  name: 'Generic JSON',
  description: 'JSON with common xpub/fingerprint/derivation fields',
  priority: 30, // Low priority - fallback

  canParse(data: unknown): FormatDetectionResult {
    if (typeof data !== 'object' || data === null) {
      return { detected: false, confidence: 0 };
    }

    const obj = data as Record<string, unknown>;

    // Look for any xpub-like field
    const xpubFields = ['xpub', 'zpub', 'ypub', 'Xpub', 'Zpub', 'Ypub', 'ExtPubKey', 'extPubKey', 'p2wpkh'];
    const hasXpub = xpubFields.some((field) => {
      const value = obj[field];
      return typeof value === 'string' && value.length > 50;
    });

    if (!hasXpub) {
      return { detected: false, confidence: 0 };
    }

    return {
      detected: true,
      confidence: 50,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const obj = data as Record<string, unknown>;

    // Extract xpub from various field names
    const xpubFields = ['xpub', 'zpub', 'ypub', 'Xpub', 'Zpub', 'Ypub', 'ExtPubKey', 'extPubKey', 'p2wpkh'];
    let xpub = '';
    for (const field of xpubFields) {
      const value = obj[field];
      if (typeof value === 'string' && value.length > 50) {
        xpub = value;
        break;
      }
    }

    // Extract fingerprint from various field names
    const fingerprintFields = ['xfp', 'fingerprint', 'master_fingerprint', 'masterFingerprint', 'MasterFingerprint', 'root_fingerprint'];
    let fingerprint = '';
    for (const field of fingerprintFields) {
      const value = obj[field];
      if (typeof value === 'string' && value.length === 8) {
        fingerprint = value;
        break;
      }
    }

    // Extract derivation path from various field names
    const pathFields = ['deriv', 'derivation', 'path', 'derivationPath', 'hdPath', 'keypath', 'AccountKeyPath', 'accountKeyPath'];
    let derivationPath = '';
    for (const field of pathFields) {
      const value = obj[field];
      if (typeof value === 'string' && value.length > 0) {
        derivationPath = value;
        break;
      }
    }

    // Extract label from various field names
    const labelFields = ['label', 'name', 'walletName', 'wallet_name'];
    let label = '';
    for (const field of labelFields) {
      const value = obj[field];
      if (typeof value === 'string' && value.length > 0) {
        label = value;
        break;
      }
    }

    return {
      xpub,
      fingerprint,
      derivationPath,
      label,
    };
  },
};

/**
 * Plain Xpub String Parser
 * Handles raw xpub/ypub/zpub strings
 */
export const plainXpubParser: DeviceParser = {
  id: 'plain-xpub',
  name: 'Plain Xpub',
  description: 'Plain xpub/ypub/zpub string',
  priority: 10, // Lowest priority - ultimate fallback

  canParse(data: unknown): FormatDetectionResult {
    if (typeof data !== 'string') {
      return { detected: false, confidence: 0 };
    }

    const trimmed = data.trim();

    // Check if it's a pure xpub string
    if (XPUB_REGEX.test(trimmed)) {
      return {
        detected: true,
        confidence: 60,
      };
    }

    // Check if we can extract an xpub from the string
    if (XPUB_EXTRACT_REGEX.test(trimmed)) {
      return {
        detected: true,
        confidence: 40,
      };
    }

    return { detected: false, confidence: 0 };
  },

  parse(data: unknown): DeviceParseResult {
    if (typeof data !== 'string') return {};

    const trimmed = data.trim();

    // Try to extract xpub
    const match = trimmed.match(XPUB_EXTRACT_REGEX);
    if (match) {
      return {
        xpub: match[1],
      };
    }

    return {};
  },
};

/**
 * Simple Coldcard/Passport JSON Parser
 * { "xfp": "...", "xpub": "...", "deriv": "..." }
 */
export const simpleColdcardParser: DeviceParser = {
  id: 'simple-coldcard',
  name: 'Simple Coldcard/Passport',
  description: 'Simple JSON with xfp, xpub, deriv fields',
  priority: 84,

  canParse(data: unknown): FormatDetectionResult {
    if (typeof data !== 'object' || data === null) {
      return { detected: false, confidence: 0 };
    }

    const obj = data as Record<string, unknown>;

    // Must have xpub and xfp (fingerprint)
    if (
      typeof obj.xpub === 'string' &&
      obj.xpub.length > 50 &&
      typeof obj.xfp === 'string' &&
      obj.xfp.length === 8
    ) {
      return {
        detected: true,
        confidence: 88,
      };
    }

    return { detected: false, confidence: 0 };
  },

  parse(data: unknown): DeviceParseResult {
    const obj = data as Record<string, unknown>;

    return {
      xpub: (obj.xpub as string) || '',
      fingerprint: (obj.xfp as string) || '',
      derivationPath: (obj.deriv as string) || '',
      label: (obj.name as string) || '',
    };
  },
};
