import type {
  VerifiedMultisigVector,
  VerifiedSingleSigVector,
} from "./types.js";

function getVerificationHeader(
  singleSigVectors: VerifiedSingleSigVector[],
  multisigVectors: VerifiedMultisigVector[],
  implementations: string[],
  date: string,
): string {
  return `/**
 * VERIFIED ADDRESS VECTORS
 *
 * These vectors have been verified by multiple independent implementations:
 * ${implementations.map((i) => ` * - ${i}`).join("\n")}
 *
 * DO NOT MODIFY MANUALLY - regenerate using:
 *   cd scripts/verify-addresses && npm run generate
 *
 * Last verified: ${date}
 * Vectors: ${singleSigVectors.length} single-sig, ${multisigVectors.length} multisig
 */`;
}

function getOutputTypes(): string {
  return `export type ScriptType = 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';
export type MultisigScriptType = 'p2sh' | 'p2sh_p2wsh' | 'p2wsh';
export type Network = 'mainnet' | 'testnet';

export interface VerifiedSingleSigVector {
  description: string;
  mnemonic: string;
  path: string;
  xpub: string;
  scriptType: ScriptType;
  network: Network;
  index: number;
  change: boolean;
  expectedAddress: string;
  verifiedBy: string[];
}

export interface VerifiedMultisigVector {
  description: string;
  xpubs: string[];
  threshold: number;
  totalKeys: number;
  scriptType: MultisigScriptType;
  network: Network;
  index: number;
  change: boolean;
  expectedAddress: string;
  verifiedBy: string[];
}`;
}

function getOutputVectors(
  singleSigVectors: VerifiedSingleSigVector[],
  multisigVectors: VerifiedMultisigVector[],
): string {
  return `export const VERIFIED_SINGLESIG_VECTORS: VerifiedSingleSigVector[] = ${formatVectorArray(singleSigVectors)};

export const VERIFIED_MULTISIG_VECTORS: VerifiedMultisigVector[] = ${formatVectorArray(multisigVectors)};`;
}

function getOutputMnemonic(testMnemonic: string): string {
  return `/**
 * Test mnemonic used for all single-sig derivations
 * This is the official BIP-39 test mnemonic
 */
export const TEST_MNEMONIC = '${testMnemonic}';`;
}

function formatVectorArray(
  vectors: Array<VerifiedSingleSigVector | VerifiedMultisigVector>,
): string {
  if (vectors.length === 0) {
    return "[]";
  }

  const lines = vectors.map((vector) => `  ${JSON.stringify(vector)}`);
  return `[\n${lines.join(",\n")}\n]`;
}

/**
 * Generate TypeScript output file with verified vectors.
 */
export function generateOutputFile(
  singleSigVectors: VerifiedSingleSigVector[],
  multisigVectors: VerifiedMultisigVector[],
  implementations: string[],
  testMnemonic: string,
): string {
  const date = new Date().toISOString().split("T")[0];
  const sections = [
    getVerificationHeader(
      singleSigVectors,
      multisigVectors,
      implementations,
      date,
    ),
    getOutputTypes(),
    getOutputVectors(singleSigVectors, multisigVectors),
    getOutputMnemonic(testMnemonic),
  ];

  return `${sections.join("\n\n")}\n`;
}
