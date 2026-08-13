import type {
  VerifiedMultisigVector,
  VerifiedSingleSigVector,
  VerifierProvenance,
} from './types.js';

const TYPES = `export type ChainEnvironment = 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';
export type SingleSigScriptType = 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';
export type MultisigScriptType = 'p2sh_p2wsh' | 'p2wsh';

export interface AccountKeyEvidence {
  readonly seedId: string;
  readonly masterFingerprint: string;
  readonly originPath: string;
  readonly encoded: string;
  readonly versionHex: string;
  readonly depth: number;
  readonly parentFingerprint: string;
  readonly childNumber: number;
  readonly chainCodeHex: string;
  readonly publicKeyHex: string;
  readonly payloadHex: string;
}

export interface VerifiedSingleSigVector {
  readonly evidenceTier: 'independently-executed-implementation-consensus';
  readonly caseId: string;
  readonly description: string;
  readonly seedId: string;
  readonly mnemonic: string;
  readonly path: string;
  readonly xpub: string;
  readonly scriptType: SingleSigScriptType;
  readonly network: ChainEnvironment;
  readonly account: number;
  readonly index: number;
  readonly branch: 0 | 1;
  readonly change: boolean;
  readonly expectedAddress: string;
  readonly expectedScriptPubKey: string;
  readonly expectedDescriptor: string;
  readonly accountKeys: readonly AccountKeyEvidence[];
  readonly verifiedBy: readonly string[];
}

export interface VerifiedMultisigVector {
  readonly evidenceTier: 'independently-executed-implementation-consensus';
  readonly caseId: string;
  readonly description: string;
  readonly seedIds: readonly string[];
  readonly xpubs: readonly string[];
  readonly threshold: number;
  readonly totalKeys: number;
  readonly scriptType: MultisigScriptType;
  readonly network: ChainEnvironment;
  readonly account: number;
  readonly accountPath: string;
  readonly index: number;
  readonly branch: 0 | 1;
  readonly change: boolean;
  readonly expectedAddress: string;
  readonly expectedScriptPubKey: string;
  readonly expectedDescriptor: string;
  readonly accountKeys: readonly AccountKeyEvidence[];
  readonly verifiedBy: readonly string[];
}`;

const json = (value: unknown): string => JSON.stringify(value, null, 2);

export function generateOutputFile(
  singleSigVectors: readonly VerifiedSingleSigVector[],
  multisigVectors: readonly VerifiedMultisigVector[],
  provenance: VerifierProvenance,
): string {
  return `/**
 * VERIFIED ADDRESS VECTORS — GENERATED FILE
 *
 * Independently executed implementation-consensus evidence accepted only after exact agreement by
 * Bitcoin Core, bitcoinjs-lib, bip_utils, and btcd. No address normalization is
 * permitted. Regenerate with scripts/verify-addresses/verify-repeatable.sh.
 */

${TYPES}

export const VERIFIER_PROVENANCE = ${json(provenance)} as const;

export const VERIFIED_SINGLESIG_VECTORS: readonly VerifiedSingleSigVector[] = ${json(singleSigVectors)};

export const VERIFIED_MULTISIG_VECTORS: readonly VerifiedMultisigVector[] = ${json(multisigVectors)};
`;
}
