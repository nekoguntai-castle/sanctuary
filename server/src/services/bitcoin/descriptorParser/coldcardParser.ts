/**
 * Coldcard JSON Export Parser
 *
 * Parses Coldcard hardware wallet JSON exports into standard ParsedDescriptor format.
 * Supports both nested format (standard export) and flat format (generic multisig export).
 */

import { normalizeDerivationPath } from '../../../../../shared/utils/bitcoin';
import { ColdcardDetectionSchema } from '../../import/schemas';
import { detectNetwork } from './descriptorUtils';
import type { ParsedDevice, ParsedDescriptor, ScriptType, ColdcardJsonExport } from './types';

/**
 * Check if JSON is a Coldcard export format (has xfp and bip paths)
 * Delegates to Zod schema for consistent validation.
 */
export function isColdcardExportFormat(obj: unknown): obj is ColdcardJsonExport {
  return ColdcardDetectionSchema.safeParse(obj).success;
}

/**
 * Parse Coldcard JSON export into ParsedDescriptor
 * Coldcard exports contain multiple derivation paths - we need to pick one based on priority
 * Priority: bip84/p2wsh (native segwit) > bip49/p2sh_p2wsh (nested segwit) > bip44/p2sh (legacy)
 *
 * Supports both:
 * - Nested format: bip44/bip49/bip84/bip48_1/bip48_2 objects
 * - Flat format: p2sh/p2sh_p2wsh/p2wsh with separate _deriv keys (generic multisig export)
 */
export function parseColdcardExport(cc: ColdcardJsonExport): { parsed: ParsedDescriptor; availablePaths: Array<{ scriptType: ScriptType; path: string }> } {
  const fingerprint = cc.xfp.toLowerCase();
  const availablePaths: Array<{ scriptType: ScriptType; path: string }> = [];

  // Check if this is the flat format (generic multisig export)
  const isFlatFormat = cc.p2wsh !== undefined || cc.p2sh_p2wsh !== undefined || cc.p2sh !== undefined;

  if (isFlatFormat) {
    // Handle flat format (generic multisig export from Coldcard)
    // Collect all available paths
    if (cc.p2wsh && cc.p2wsh_deriv) {
      availablePaths.push({ scriptType: 'native_segwit', path: cc.p2wsh_deriv });
    }
    if (cc.p2sh_p2wsh && cc.p2sh_p2wsh_deriv) {
      availablePaths.push({ scriptType: 'nested_segwit', path: cc.p2sh_p2wsh_deriv });
    }
    if (cc.p2sh && cc.p2sh_deriv) {
      availablePaths.push({ scriptType: 'legacy', path: cc.p2sh_deriv });
    }

    // Pick the best available path (prefer native segwit)
    let selectedPath: { xpub: string; deriv: string; scriptType: ScriptType };

    if (cc.p2wsh && cc.p2wsh_deriv) {
      selectedPath = { xpub: cc.p2wsh, deriv: cc.p2wsh_deriv, scriptType: 'native_segwit' };
    } else if (cc.p2sh_p2wsh && cc.p2sh_p2wsh_deriv) {
      selectedPath = { xpub: cc.p2sh_p2wsh, deriv: cc.p2sh_p2wsh_deriv, scriptType: 'nested_segwit' };
    } else if (cc.p2sh && cc.p2sh_deriv) {
      selectedPath = { xpub: cc.p2sh, deriv: cc.p2sh_deriv, scriptType: 'legacy' };
    } else {
      throw new Error('Coldcard export does not contain any recognized derivation paths with xpubs');
    }

    const device: ParsedDevice = {
      fingerprint,
      xpub: selectedPath.xpub,
      derivationPath: normalizeDerivationPath(selectedPath.deriv),
    };

    const network = detectNetwork(device.xpub, device.derivationPath);

    return {
      parsed: {
        type: 'single_sig',
        scriptType: selectedPath.scriptType,
        devices: [device],
        network,
        isChange: false,
      },
      availablePaths,
    };
  }

  // Handle nested format (standard Coldcard export)
  // Collect all available paths
  if (cc.bip84) {
    availablePaths.push({ scriptType: 'native_segwit', path: cc.bip84.deriv });
  }
  if (cc.bip49) {
    availablePaths.push({ scriptType: 'nested_segwit', path: cc.bip49.deriv });
  }
  if (cc.bip44) {
    availablePaths.push({ scriptType: 'legacy', path: cc.bip44.deriv });
  }

  // Pick the best available path (prefer native segwit)
  let selectedPath: { xpub: string; deriv: string; scriptType: ScriptType };

  if (cc.bip84) {
    selectedPath = { xpub: cc.bip84.xpub, deriv: cc.bip84.deriv, scriptType: 'native_segwit' };
  } else if (cc.bip49) {
    selectedPath = { xpub: cc.bip49.xpub, deriv: cc.bip49.deriv, scriptType: 'nested_segwit' };
  } else if (cc.bip44) {
    selectedPath = { xpub: cc.bip44.xpub, deriv: cc.bip44.deriv, scriptType: 'legacy' };
  } else if (cc.bip48_2) {
    // P2WSH multisig derivation - but for single sig import we treat it as single sig
    selectedPath = { xpub: cc.bip48_2.xpub, deriv: cc.bip48_2.deriv, scriptType: 'native_segwit' };
  } else if (cc.bip48_1) {
    // P2SH-P2WSH multisig derivation
    selectedPath = { xpub: cc.bip48_1.xpub, deriv: cc.bip48_1.deriv, scriptType: 'nested_segwit' };
  } else {
    throw new Error('Coldcard export does not contain any recognized BIP derivation paths');
  }

  const device: ParsedDevice = {
    fingerprint,
    xpub: selectedPath.xpub,
    derivationPath: normalizeDerivationPath(selectedPath.deriv),
  };

  const network = detectNetwork(device.xpub, device.derivationPath);

  return {
    parsed: {
      type: 'single_sig',
      scriptType: selectedPath.scriptType,
      devices: [device],
      network,
      isChange: false,
    },
    availablePaths,
  };
}
