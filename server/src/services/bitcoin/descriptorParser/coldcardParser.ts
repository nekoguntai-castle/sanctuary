/**
 * Coldcard JSON Export Parser
 *
 * Parses Coldcard hardware wallet JSON exports into standard ParsedDescriptor format.
 * Supports both nested format (standard export) and flat format (generic multisig export).
 */

import { normalizeDerivationPath } from '@sanctuary/shared/utils/bitcoin';
import {
  accountPathMatchesWalletPolicy,
  type DerivationNetworkFamily,
} from '@sanctuary/shared/constants/walletPolicy';
import { WalletScriptType, WalletType } from '@sanctuary/shared/constants/walletIdentity';
import { ColdcardDetectionSchema } from '../../import/schemas';
import { validateParsedDescriptorDomain } from './domainValidation';
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
  assertChainMatchesNetwork(cc.chain, network);
  const parsed: ParsedDescriptor = {
    type: WalletType.SINGLE_SIG,
    scriptType: selectedPath.scriptType,
    devices: [device],
    network,
    isChange: false,
  };
  const derivationFamily: DerivationNetworkFamily = network === 'mainnet' ? 'mainnet' : 'testnet';
  if (!accountPathMatchesWalletPolicy(device.derivationPath, {
    walletType: parsed.type,
    scriptType: parsed.scriptType,
    derivationFamily,
  })) {
    throw new Error('Coldcard derivation path does not match the selected wallet policy');
  }
  validateParsedDescriptorDomain(parsed);

  return {
    parsed,
    availablePaths,
  };
}

function getColdcardPaths(cc: ColdcardJsonExport): {
  selectedPath: ColdcardSelectedPath;
  availablePaths: Array<{ scriptType: ScriptType; path: string }>;
} {
  if (isFlatColdcardFormat(cc)) {
    throw new Error('Coldcard multisig key exports do not define a complete wallet policy');
  }

  return getNestedColdcardPaths(cc);
}

function isFlatColdcardFormat(cc: ColdcardJsonExport): boolean {
  return cc.p2wsh !== undefined || cc.p2sh_p2wsh !== undefined || cc.p2sh !== undefined;
}

function getNestedColdcardPaths(cc: ColdcardJsonExport): {
  selectedPath: ColdcardSelectedPath;
  availablePaths: Array<{ scriptType: ScriptType; path: string }>;
} {
  const standardCandidates = getNestedStandardPathCandidates(cc);
  standardCandidates.forEach(assertStandardCandidatePath);
  return {
    selectedPath: selectUsablePath(
      standardCandidates,
      cc.bip48_1 || cc.bip48_2
        ? 'Coldcard BIP48 key exports do not define a complete multisig wallet policy'
        : 'Coldcard export does not contain any recognized BIP derivation paths'
    ),
    availablePaths: getAvailablePaths(standardCandidates),
  };
}

function assertStandardCandidatePath(candidate: ColdcardPathCandidate): void {
  if (!candidate.xpub || !candidate.deriv) {
    throw new Error('Coldcard BIP path requires both an extended public key and derivation');
  }
  const path = normalizeDerivationPath(candidate.deriv);
  const detected = detectNetwork(candidate.xpub, path);
  const derivationFamily: DerivationNetworkFamily = detected === 'mainnet' ? 'mainnet' : 'testnet';
  if (!accountPathMatchesWalletPolicy(path, {
    walletType: WalletType.SINGLE_SIG,
    scriptType: candidate.scriptType,
    derivationFamily,
  })) {
    throw new Error('Coldcard derivation path does not match the selected wallet policy');
  }
}

function assertChainMatchesNetwork(
  chain: string | undefined,
  network: ParsedDescriptor['network'],
): void {
  if (chain === undefined) return;
  const normalized = chain.toUpperCase();
  if (normalized !== 'BTC' && normalized !== 'XTN') {
    throw new Error('Coldcard export uses an unsupported chain identifier');
  }
  const expectedMainnet = normalized === 'BTC';
  if (expectedMainnet !== (network === 'mainnet')) {
    throw new Error('Coldcard chain does not match the extended public key network');
  }
}

function getNestedStandardPathCandidates(cc: ColdcardJsonExport): ColdcardPathCandidate[] {
  const candidates: ColdcardPathCandidate[] = [];
  addNestedPathCandidate(candidates, cc.bip84, WalletScriptType.NATIVE_SEGWIT);
  addNestedPathCandidate(candidates, cc.bip49, WalletScriptType.NESTED_SEGWIT);
  addNestedPathCandidate(candidates, cc.bip44, WalletScriptType.LEGACY);
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
