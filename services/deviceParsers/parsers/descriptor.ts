/**
 * Descriptor Format Parser
 *
 * Handles output descriptor formats from Sparrow, Specter, Coldcard wallet export:
 * { descriptor: "wpkh([fingerprint/84h/0h/0h]xpub.../0/*)#checksum", label: "..." }
 *
 * Also handles plain descriptor strings.
 */

import type { DeviceParser, DeviceParseResult, FormatDetectionResult } from '../types';
import { normalizeDerivationPath } from '../../../shared/utils/bitcoin';

interface DescriptorJsonFormat {
  descriptor?: string;
  label?: string;
  name?: string;
}

// Regex to extract fingerprint, path, and xpub from descriptor
// Matches: [fingerprint/path]xpub
const DESCRIPTOR_REGEX = /\[([a-fA-F0-9]{8})\/?([^\]]*)\]([xyztuv]pub[a-zA-Z0-9]+)/i;

function isDescriptorJsonFormat(data: unknown): data is DescriptorJsonFormat {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as DescriptorJsonFormat;
  return typeof d.descriptor === 'string' && d.descriptor.length > 0;
}

function parseDescriptorString(descriptor: string): DeviceParseResult | null {
  const match = descriptor.match(DESCRIPTOR_REGEX);
  if (!match) return null;

  const [, fingerprint, pathPart, xpub] = match;
  const derivationPath = pathPart ? normalizeDerivationPath(pathPart) : '';

  return {
    xpub,
    fingerprint,
    derivationPath,
  };
}

/**
 * Descriptor JSON Format Parser
 * { descriptor: "wpkh([fingerprint/path]xpub...)#checksum" }
 */
export const descriptorJsonParser: DeviceParser = {
  id: 'descriptor-json',
  name: 'Output Descriptor (JSON)',
  description: 'JSON with descriptor field (Sparrow, Specter, Coldcard wallet export)',
  priority: 92,

  canParse(data: unknown): FormatDetectionResult {
    if (!isDescriptorJsonFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    const d = data as DescriptorJsonFormat;
    const parsed = parseDescriptorString(d.descriptor);

    if (!parsed?.xpub) {
      return { detected: false, confidence: 0 };
    }

    return {
      detected: true,
      confidence: 95,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const d = data as DescriptorJsonFormat;
    const result = parseDescriptorString(d.descriptor || '') || {};

    return {
      ...result,
      label: d.label || d.name || '',
    };
  },
};

/**
 * Plain Descriptor String Parser
 * "wpkh([fingerprint/path]xpub...)#checksum" or "[fingerprint/path]xpub..."
 */
export const descriptorStringParser: DeviceParser = {
  id: 'descriptor-string',
  name: 'Output Descriptor (Plain)',
  description: 'Plain output descriptor string',
  priority: 20, // Low priority - fallback

  canParse(data: unknown): FormatDetectionResult {
    if (typeof data !== 'string') {
      return { detected: false, confidence: 0 };
    }

    const parsed = parseDescriptorString(data);
    if (!parsed?.xpub) {
      return { detected: false, confidence: 0 };
    }

    return {
      detected: true,
      confidence: 70,
    };
  },

  parse(data: unknown): DeviceParseResult {
    if (typeof data !== 'string') return {};
    return parseDescriptorString(data) || {};
  },
};
