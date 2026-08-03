/**
 * BitBox Format Parser
 *
 * Handles BitBox02 format:
 * { keypath: "m/84'/0'/0'", xpub: "zpub..." }
 */

import type { DeviceParser, DeviceParseResult, FormatDetectionResult } from '../types';

interface BitBoxFormat {
  keypath?: string;
  xpub?: string;
}

function isBitBoxFormat(data: unknown): data is BitBoxFormat {
  if (typeof data !== 'object' || data === null) return false;
  const b = data as BitBoxFormat;
  return (
    typeof b.keypath === 'string' &&
    b.keypath.length > 0 &&
    typeof b.xpub === 'string' &&
    b.xpub.length > 0
  );
}

export const bitboxParser: DeviceParser = {
  id: 'bitbox',
  name: 'BitBox02 Export',
  description: 'BitBox02 format with keypath and xpub',
  priority: 82,

  canParse(data: unknown): FormatDetectionResult {
    if (!isBitBoxFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    return {
      detected: true,
      confidence: 88,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const b = data as BitBoxFormat;

    return {
      xpub: b.xpub || '',
      derivationPath: b.keypath || '',
    };
  },
};
