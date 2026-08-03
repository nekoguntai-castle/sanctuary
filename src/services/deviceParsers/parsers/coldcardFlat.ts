/**
 * Coldcard Flat Format Parser
 *
 * Handles the Coldcard "Generic Multisig" JSON export with flat structure:
 * {
 *   xfp: "FA79B6AA",
 *   p2wsh: "Zpub...", p2wsh_deriv: "m/48'/0'/0'/2'",
 *   p2sh_p2wsh: "Ypub...", p2sh_p2wsh_deriv: "m/48'/0'/0'/1'",
 *   p2sh: "xpub...", p2sh_deriv: "m/45'",
 *   account: "0"
 * }
 */

import type { DeviceParser, DeviceParseResult, FormatDetectionResult } from '../types';

interface ColdcardFlatFormat {
  xfp?: string;
  account?: string | number;
  // Native SegWit multisig (Zpub)
  p2wsh?: string;
  p2wsh_deriv?: string;
  // Nested SegWit multisig (Ypub)
  p2sh_p2wsh?: string;
  p2sh_p2wsh_deriv?: string;
  // Legacy multisig (xpub)
  p2sh?: string;
  p2sh_deriv?: string;
}

function isColdcardFlatFormat(data: unknown): data is ColdcardFlatFormat {
  if (typeof data !== 'object' || data === null) return false;
  const cc = data as ColdcardFlatFormat;
  return (
    cc.p2wsh !== undefined ||
    cc.p2sh_p2wsh !== undefined ||
    cc.p2sh !== undefined
  );
}

export const coldcardFlatParser: DeviceParser = {
  id: 'coldcard-flat',
  name: 'Coldcard Generic Multisig Export',
  description: 'Coldcard JSON export with p2wsh/p2sh_p2wsh/p2sh fields',
  priority: 88, // Slightly lower than nested to prefer nested when both match

  canParse(data: unknown): FormatDetectionResult {
    if (!isColdcardFlatFormat(data)) {
      return { detected: false, confidence: 0 };
    }

    const cc = data as ColdcardFlatFormat;
    const hasXfp = typeof cc.xfp === 'string' && cc.xfp.length === 8;

    // Need at least one xpub with its derivation path
    const hasValidPair =
      (cc.p2wsh && cc.p2wsh_deriv) ||
      (cc.p2sh_p2wsh && cc.p2sh_p2wsh_deriv) ||
      (cc.p2sh && cc.p2sh_deriv);

    if (!hasValidPair) {
      return { detected: false, confidence: 0 };
    }

    return {
      detected: true,
      confidence: hasXfp ? 93 : 83,
    };
  },

  parse(data: unknown): DeviceParseResult {
    const cc = data as ColdcardFlatFormat;

    // Priority: p2wsh > p2sh_p2wsh > p2sh
    // (Native SegWit preferred for multisig)
    let xpub = '';
    let derivationPath = '';

    if (cc.p2wsh && cc.p2wsh_deriv) {
      xpub = cc.p2wsh;
      derivationPath = cc.p2wsh_deriv;
    } else if (cc.p2sh_p2wsh && cc.p2sh_p2wsh_deriv) {
      xpub = cc.p2sh_p2wsh;
      derivationPath = cc.p2sh_p2wsh_deriv;
    } else if (cc.p2sh && cc.p2sh_deriv) {
      xpub = cc.p2sh;
      derivationPath = cc.p2sh_deriv;
    }

    return {
      xpub,
      fingerprint: cc.xfp || '',
      derivationPath,
    };
  },
};
