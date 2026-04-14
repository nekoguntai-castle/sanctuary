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

type ColdcardPathCandidate = {
  xpub?: string;
  deriv?: string;
  scriptType: ScriptType;
};
type ColdcardSelectedPath = { xpub: string; deriv: string; scriptType: ScriptType };
type ColdcardNestedPath = { xpub: string; deriv: string };

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
  const { selectedPath, availablePaths } = getColdcardPaths(cc);

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

function getColdcardPaths(cc: ColdcardJsonExport): {
  selectedPath: ColdcardSelectedPath;
  availablePaths: Array<{ scriptType: ScriptType; path: string }>;
} {
  if (isFlatColdcardFormat(cc)) {
    return getFlatColdcardPaths(cc);
  }

  return getNestedColdcardPaths(cc);
}

function isFlatColdcardFormat(cc: ColdcardJsonExport): boolean {
  return cc.p2wsh !== undefined || cc.p2sh_p2wsh !== undefined || cc.p2sh !== undefined;
}

function getFlatColdcardPaths(cc: ColdcardJsonExport): {
  selectedPath: ColdcardSelectedPath;
  availablePaths: Array<{ scriptType: ScriptType; path: string }>;
} {
  // Candidate order is path-selection priority.
  const candidates: ColdcardPathCandidate[] = [
    { xpub: cc.p2wsh, deriv: cc.p2wsh_deriv, scriptType: 'native_segwit' },
    { xpub: cc.p2sh_p2wsh, deriv: cc.p2sh_p2wsh_deriv, scriptType: 'nested_segwit' },
    { xpub: cc.p2sh, deriv: cc.p2sh_deriv, scriptType: 'legacy' },
  ];

  return {
    selectedPath: selectUsablePath(
      candidates,
      'Coldcard export does not contain any recognized derivation paths with xpubs'
    ),
    availablePaths: getAvailablePaths(candidates),
  };
}

function getNestedColdcardPaths(cc: ColdcardJsonExport): {
  selectedPath: ColdcardSelectedPath;
  availablePaths: Array<{ scriptType: ScriptType; path: string }>;
} {
  const standardCandidates = getNestedStandardPathCandidates(cc);
  const selectionCandidates = [...standardCandidates];
  // BIP48 multisig paths are kept as single-sig xpub fallbacks for Coldcard imports.
  addNestedPathCandidate(selectionCandidates, cc.bip48_2, 'native_segwit');
  addNestedPathCandidate(selectionCandidates, cc.bip48_1, 'nested_segwit');

  return {
    selectedPath: selectUsablePath(
      selectionCandidates,
      'Coldcard export does not contain any recognized BIP derivation paths'
    ),
    availablePaths: getAvailablePaths(standardCandidates),
  };
}

function getNestedStandardPathCandidates(cc: ColdcardJsonExport): ColdcardPathCandidate[] {
  const candidates: ColdcardPathCandidate[] = [];
  addNestedPathCandidate(candidates, cc.bip84, 'native_segwit');
  addNestedPathCandidate(candidates, cc.bip49, 'nested_segwit');
  addNestedPathCandidate(candidates, cc.bip44, 'legacy');
  return candidates;
}

function addNestedPathCandidate(
  candidates: ColdcardPathCandidate[],
  path: ColdcardNestedPath | undefined,
  scriptType: ScriptType
): void {
  if (path) {
    candidates.push({ xpub: path.xpub, deriv: path.deriv, scriptType });
  }
}

function selectUsablePath(
  candidates: ColdcardPathCandidate[],
  errorMessage: string
): ColdcardSelectedPath {
  const selectedPath = candidates.find(hasXpubAndDeriv);
  if (!selectedPath) {
    throw new Error(errorMessage);
  }

  return selectedPath;
}

function getAvailablePaths(candidates: ColdcardPathCandidate[]): Array<{ scriptType: ScriptType; path: string }> {
  return candidates.filter(hasXpubAndDeriv).map(candidate => ({
    scriptType: candidate.scriptType,
    path: candidate.deriv,
  }));
}

function hasXpubAndDeriv(candidate: ColdcardPathCandidate): candidate is ColdcardSelectedPath {
  return Boolean(candidate.xpub && candidate.deriv);
}
