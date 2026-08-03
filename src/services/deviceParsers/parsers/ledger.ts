/**
 * Ledger Format Parser
 *
 * Handles Ledger Live Advanced Logs format:
 * { xpub: "xpub...", freshAddressPath: "44'/0'/0'/0/0", name: "..." }
 */

import type { DeviceParser, DeviceParseResult, FormatDetectionResult } from '../types';

interface LedgerFormat {
  xpub?: string;
  freshAddressPath?: string;
  name?: string;
}

function isLedgerFormat(data: unknown): data is LedgerFormat {
  if (typeof data !== 'object' || data === null) return false;
  const l = data as LedgerFormat;
  return (
    typeof l.xpub === 'string' &&
    l.xpub.length > 0 &&
    typeof l.freshAddressPath === 'string'
  );
}

export const ledgerParser: DeviceParser = {
  id: 'ledger',
  name: 'Ledger Live Export',
  description: 'Ledger Live Advanced Logs format with xpub and freshAddressPath',
  priority: 80,

  canParse(data: unknown): FormatDetectionResult {
    if (!isLedgerFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    return {
      detected: true,
      confidence: 88,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const l = data as LedgerFormat;

    // Extract account path from freshAddressPath (remove last two components: /0/0)
    // "44'/0'/0'/0/0" -> "m/44'/0'/0'"
    let derivationPath = '';
    const pathMatch = l.freshAddressPath?.match(/^(\d+)'\/(\d+)'\/(\d+)'/);
    if (pathMatch) {
      derivationPath = `m/${pathMatch[1]}'/${pathMatch[2]}'/${pathMatch[3]}'`;
    }

    return {
      xpub: l.xpub || '',
      derivationPath,
      label: l.name || '',
    };
  },
};
