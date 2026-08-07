#!/usr/bin/env npx tsx
/**
 * Address Verification Vector Generator
 *
 * This script generates verified address vectors by deriving addresses
 * using multiple independent implementations and only accepting vectors
 * where all implementations agree.
 *
 * Usage:
 *   npm run generate          # Generate vectors (requires all implementations)
 *   npm run verify            # Verify existing vectors
 *
 * Prerequisites:
 *   - Bitcoin Core running (docker compose up -d)
 *   - Python with bip_utils (pip install bip_utils)
 *   - Go with btcd modules (go mod download)
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import type {
  AddressDeriver,
  SingleSigTestCase,
  MultisigTestCase,
  VerifiedSingleSigVector,
  VerifiedMultisigVector,
  VerificationResult,
  Network,
} from './types.js';

// Import implementations
import { bitcoinCore } from './implementations/bitcoincore.js';
import { bitcoinjsImpl } from './implementations/bitcoinjs.js';
import { caravanImpl } from './implementations/caravan.js';
import { pythonImpl } from './implementations/python.js';
import { goImpl } from './implementations/go.js';
import { normalizeAddress } from './addressNormalization.js';
import { generateOutputFile } from './outputFile.js';
import {
  TEST_MNEMONIC,
  generateSingleSigTestCases,
  generateMultisigTestCases,
} from './testCases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIN_IMPLEMENTATIONS = 3;
const BITCOIN_CORE_NAME = 'Bitcoin Core';
const PRODUCTION_LIBRARY_NAME = 'bitcoinjs-lib';
const INDEPENDENT_NON_JS_NAMES = new Set([
  'bip_utils (Python)',
  'btcd/btcutil (Go)',
]);
const VERIFY_ONLY = process.argv.includes('--verify-only');

function hasImplementationResult(
  results: Map<string, string>,
  implementationName: string
): boolean {
  return [...results.keys()].some(name => name.startsWith(`${implementationName} `));
}

function hasIndependentNonJsResult(results: Map<string, string>): boolean {
  return [...INDEPENDENT_NON_JS_NAMES].some(name => hasImplementationResult(results, name));
}

function hasRequiredResultImplementations(results: Map<string, string>): boolean {
  return (
    hasImplementationResult(results, BITCOIN_CORE_NAME) &&
    hasImplementationResult(results, PRODUCTION_LIBRARY_NAME) &&
    hasIndependentNonJsResult(results)
  );
}

function isMainnetAddress(address: string): boolean {
  return (
    address.startsWith('1') ||
    address.startsWith('3') ||
    address.toLowerCase().startsWith('bc1')
  );
}

function isTestnetAddress(address: string): boolean {
  return (
    address.startsWith('m') ||
    address.startsWith('n') ||
    address.startsWith('2') ||
    address.toLowerCase().startsWith('tb1')
  );
}

function isAddressForNetwork(address: string, network: Network): boolean {
  return network === 'mainnet' ? isMainnetAddress(address) : isTestnetAddress(address);
}

function getCanonicalAddress(
  testCase: SingleSigTestCase | MultisigTestCase,
  results: Map<string, string>
): string {
  const addresses = [...results.values()];
  return addresses.find(address => isAddressForNetwork(address, testCase.network)) ?? addresses[0];
}

// =============================================================================
// Verification
// =============================================================================

/**
 * Verify a single-sig test case across all implementations
 */
async function verifySingleSig(
  testCase: SingleSigTestCase,
  implementations: AddressDeriver[]
): Promise<VerificationResult> {
  const results = new Map<string, string>();
  const errors: string[] = [];

  for (const impl of implementations) {
    try {
      const address = await impl.deriveSingleSig(
        testCase.xpub,
        testCase.index,
        testCase.scriptType,
        testCase.change,
        testCase.network
      );
      results.set(`${impl.name} ${impl.version}`, address);
    } catch (error) {
      errors.push(`${impl.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Check consensus using normalized addresses
  const addresses = [...results.values()];
  const normalizedAddresses = addresses.map(normalizeAddress);
  const uniqueNormalized = new Set(normalizedAddresses);

  if (
    uniqueNormalized.size === 1 &&
    addresses.length >= MIN_IMPLEMENTATIONS &&
    hasRequiredResultImplementations(results) &&
    errors.length === 0
  ) {
    return {
      testCase,
      results,
      consensus: true,
      consensusAddress: getCanonicalAddress(testCase, results),
      errors,
    };
  }

  // Find disagreements using normalized comparison
  const disagreements: Array<{ impl: string; address: string }> = [];
  const normalizedCounts = new Map<string, { count: number; original: string }>();

  for (const addr of addresses) {
    const normalized = normalizeAddress(addr);
    const existing = normalizedCounts.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      normalizedCounts.set(normalized, { count: 1, original: addr });
    }
  }

  // Find the most common normalized address
  let maxCount = 0;
  let majorityNormalized = '';
  let majorityOriginal = '';
  for (const [normalized, { count, original }] of normalizedCounts) {
    if (count > maxCount) {
      maxCount = count;
      majorityNormalized = normalized;
      majorityOriginal = original;
    }
  }

  for (const [impl, addr] of results) {
    if (normalizeAddress(addr) !== majorityNormalized) {
      disagreements.push({ impl, address: addr });
    }
  }

  return {
    testCase,
    results,
    consensus: false,
    consensusAddress: majorityOriginal,
    disagreements,
    errors,
  };
}

/**
 * Verify a multisig test case across all implementations
 */
async function verifyMultisig(
  testCase: MultisigTestCase,
  implementations: AddressDeriver[]
): Promise<VerificationResult> {
  const results = new Map<string, string>();
  const errors: string[] = [];

  for (const impl of implementations) {
    try {
      const address = await impl.deriveMultisig(
        testCase.xpubs,
        testCase.threshold,
        testCase.index,
        testCase.scriptType,
        testCase.change,
        testCase.network
      );
      results.set(`${impl.name} ${impl.version}`, address);
    } catch (error) {
      const errMsg = `${impl.name}: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errMsg);
      // Log errors for debugging
      console.log(`\n  \x1b[33mERROR:\x1b[0m ${errMsg}`);
    }
  }

  // Check consensus using normalized addresses (handles regtest vs testnet)
  const addresses = [...results.values()];
  const normalizedAddresses = addresses.map(normalizeAddress);
  const uniqueNormalized = new Set(normalizedAddresses);

  if (
    uniqueNormalized.size === 1 &&
    addresses.length >= MIN_IMPLEMENTATIONS &&
    hasRequiredResultImplementations(results) &&
    errors.length === 0
  ) {
    return {
      testCase,
      results,
      consensus: true,
      consensusAddress: getCanonicalAddress(testCase, results),
      errors,
    };
  }

  // Find disagreements using normalized comparison
  const disagreements: Array<{ impl: string; address: string }> = [];
  const normalizedCounts = new Map<string, { count: number; original: string }>();

  for (const addr of addresses) {
    const normalized = normalizeAddress(addr);
    const existing = normalizedCounts.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      normalizedCounts.set(normalized, { count: 1, original: addr });
    }
  }

  // Find the most common normalized address
  let maxCount = 0;
  let majorityNormalized = '';
  let majorityOriginal = '';
  for (const [normalized, { count, original }] of normalizedCounts) {
    if (count > maxCount) {
      maxCount = count;
      majorityNormalized = normalized;
      majorityOriginal = original;
    }
  }

  for (const [impl, addr] of results) {
    if (normalizeAddress(addr) !== majorityNormalized) {
      disagreements.push({ impl, address: addr });
    }
  }

  return {
    testCase,
    results,
    consensus: false,
    consensusAddress: majorityOriginal,
    disagreements,
    errors,
  };
}

// =============================================================================
// Main
// =============================================================================

interface GeneratedTestCases {
  singleSigCases: SingleSigTestCase[];
  multisigCases: MultisigTestCase[];
}

interface SingleSigVerificationSummary {
  vectors: VerifiedSingleSigVector[];
  errors: number;
}

interface MultisigVerificationSummary {
  vectors: VerifiedMultisigVector[];
  errors: number;
}

function logBanner(): void {
  console.log('='.repeat(60));
  console.log('Address Verification Vector Generator');
  console.log('='.repeat(60));
  console.log();
}

function getAllImplementations(): AddressDeriver[] {
  return [
    bitcoinCore,
    bitcoinjsImpl,
    caravanImpl,
    pythonImpl,
    goImpl,
  ];
}

async function getAvailableImplementations(): Promise<AddressDeriver[]> {
  console.log('Checking available implementations...');
  const availableImplementations: AddressDeriver[] = [];

  for (const impl of getAllImplementations()) {
    const available = await impl.isAvailable();
    const status = available ? '\x1b[32m[OK]\x1b[0m' : '\x1b[31m[UNAVAILABLE]\x1b[0m';
    console.log(`  ${status} ${impl.name} ${impl.version}`);
    if (available) {
      availableImplementations.push(impl);
    } else {
      // Say why. An implementation dropping out silently downgrades the
      // cross-check without anyone noticing -- the Go implementation was absent
      // from CI for an unknown length of time behind a bare [UNAVAILABLE].
      console.log(`       reason: ${impl.unavailableReason ?? 'no reason reported'}`);
    }
  }

  console.log();
  return availableImplementations;
}

function requireMinimumImplementations(availableImplementations: AddressDeriver[]): void {
  const names = new Set(availableImplementations.map(impl => impl.name));
  const hasBitcoinCore = names.has(BITCOIN_CORE_NAME);
  const hasProductionLibrary = names.has(PRODUCTION_LIBRARY_NAME);
  const hasIndependentNonJs = availableImplementations.some(impl => INDEPENDENT_NON_JS_NAMES.has(impl.name));

  if (availableImplementations.length < MIN_IMPLEMENTATIONS) {
    console.error(`\x1b[31mError: Need at least ${MIN_IMPLEMENTATIONS} implementations, only ${availableImplementations.length} available.\x1b[0m`);
    logImplementationRequirements();
    process.exit(1);
  }

  if (!hasBitcoinCore || !hasProductionLibrary || !hasIndependentNonJs) {
    console.error('\x1b[31mError: Address verification requires Bitcoin Core, bitcoinjs-lib, and at least one independent non-JS implementation.\x1b[0m');
    console.error(`  Bitcoin Core available: ${hasBitcoinCore ? 'yes' : 'no'}`);
    console.error(`  bitcoinjs-lib available: ${hasProductionLibrary ? 'yes' : 'no'}`);
    console.error(`  Independent non-JS implementation available: ${hasIndependentNonJs ? 'yes' : 'no'}`);
    logImplementationRequirements();
    process.exit(1);
  }

  console.log(`Using ${availableImplementations.length} implementations for verification`);
  console.log();
}

function logImplementationRequirements(): void {
  console.log('\nTo enable required implementations:');
  console.log('  - Bitcoin Core: docker compose up -d, or expose BITCOIN_RPC_URL/BITCOIN_RPC_USER/BITCOIN_RPC_PASS');
  console.log('  - Python: pip install bip_utils');
  console.log('  - Go alternative: ensure Go is installed and modules are available');
}

function generateTestCases(): GeneratedTestCases {
  console.log('Generating test cases...');
  const singleSigCases = generateSingleSigTestCases();
  const multisigCases = generateMultisigTestCases();
  console.log(`  Single-sig: ${singleSigCases.length} cases`);
  console.log(`  Multisig: ${multisigCases.length} cases`);
  console.log();

  return { singleSigCases, multisigCases };
}

function logDisagreement(result: VerificationResult): void {
  console.log(`\n  \x1b[31mDISAGREEMENT:\x1b[0m ${result.testCase.description}`);
  for (const [impl, addr] of result.results) {
    console.log(`    ${impl}: ${addr}`);
  }
  if (!hasRequiredResultImplementations(result.results)) {
    console.log('    Missing required successful implementation group.');
  }
  for (const error of result.errors ?? []) {
    console.log(`    ${error}`);
  }
}

function toVerifiedSingleSigVector(result: VerificationResult): VerifiedSingleSigVector {
  const testCase = result.testCase as SingleSigTestCase;
  return {
    description: testCase.description,
    mnemonic: testCase.mnemonic,
    path: testCase.path,
    xpub: testCase.xpub,
    scriptType: testCase.scriptType,
    network: testCase.network,
    index: testCase.index,
    change: testCase.change,
    expectedAddress: result.consensusAddress ?? '',
    verifiedBy: [...result.results.keys()],
  };
}

async function verifySingleSigCases(
  singleSigCases: SingleSigTestCase[],
  availableImplementations: AddressDeriver[]
): Promise<SingleSigVerificationSummary> {
  console.log('Verifying single-sig addresses...');
  const verifiedSingleSig: VerifiedSingleSigVector[] = [];
  let singleSigErrors = 0;

  for (let i = 0; i < singleSigCases.length; i++) {
    const testCase = singleSigCases[i];
    process.stdout.write(`\r  Progress: ${i + 1}/${singleSigCases.length}`);

    const result = await verifySingleSig(testCase, availableImplementations);

    if (result.consensus && result.consensusAddress) {
      verifiedSingleSig.push(toVerifiedSingleSigVector(result));
    } else {
      singleSigErrors++;
      logDisagreement(result);
    }
  }

  console.log();
  console.log(`  Verified: ${verifiedSingleSig.length}, Errors: ${singleSigErrors}`);
  console.log();

  return { vectors: verifiedSingleSig, errors: singleSigErrors };
}

function toVerifiedMultisigVector(result: VerificationResult): VerifiedMultisigVector {
  const testCase = result.testCase as MultisigTestCase;
  return {
    description: testCase.description,
    xpubs: testCase.xpubs,
    threshold: testCase.threshold,
    totalKeys: testCase.totalKeys,
    scriptType: testCase.scriptType,
    network: testCase.network,
    index: testCase.index,
    change: testCase.change,
    expectedAddress: result.consensusAddress ?? '',
    expectedDescriptor: '',
    verifiedBy: [...result.results.keys()],
  };
}

async function verifyMultisigCases(
  multisigCases: MultisigTestCase[],
  availableImplementations: AddressDeriver[]
): Promise<MultisigVerificationSummary> {
  console.log('Verifying multisig addresses...');
  const verifiedMultisig: VerifiedMultisigVector[] = [];
  let multisigErrors = 0;

  for (let i = 0; i < multisigCases.length; i++) {
    const testCase = multisigCases[i];
    process.stdout.write(`\r  Progress: ${i + 1}/${multisigCases.length}`);

    const result = await verifyMultisig(testCase, availableImplementations);

    if (result.consensus && result.consensusAddress) {
      verifiedMultisig.push(toVerifiedMultisigVector(result));
    } else {
      multisigErrors++;
      logDisagreement(result);
    }
  }

  console.log();
  console.log(`  Verified: ${verifiedMultisig.length}, Errors: ${multisigErrors}`);
  console.log();

  return { vectors: verifiedMultisig, errors: multisigErrors };
}

function verifyKeyOrdering(verifiedMultisig: VerifiedMultisigVector[]): number {
  const keyOrderingTests = verifiedMultisig.filter(v => v.description.includes('key ordering'));
  if (keyOrderingTests.length > 1) {
    const allSameAddress = keyOrderingTests.every(t => t.expectedAddress === keyOrderingTests[0].expectedAddress);
    if (allSameAddress) {
      console.log('\x1b[32mKey ordering verification PASSED\x1b[0m - all orderings produce same address');
    } else {
      console.log('\x1b[31mKey ordering verification FAILED\x1b[0m - different orderings produce different addresses');
      console.log();
      return 1;
    }
    console.log();
  }

  return 0;
}

interface OutputPaths {
  scriptOutputPath: string;
  fixtureOutputPath: string;
}

function getOutputPaths(): OutputPaths {
  return {
    scriptOutputPath: join(__dirname, 'output', 'verified-vectors.ts'),
    fixtureOutputPath: join(__dirname, '../../server/tests/fixtures/verified-address-vectors.ts'),
  };
}

function buildOutputContent(
  verifiedSingleSig: VerifiedSingleSigVector[],
  verifiedMultisig: VerifiedMultisigVector[],
  availableImplementations: AddressDeriver[]
): string {
  const implementationNames = availableImplementations.map(i => `${i.name} ${i.version}`);
  return generateOutputFile(
    verifiedSingleSig,
    verifiedMultisig,
    implementationNames,
    TEST_MNEMONIC
  );
}

function normalizeGeneratedOutput(content: string): string {
  return content.replace(/Last verified: \d{4}-\d{2}-\d{2}/, 'Last verified: <ignored>');
}

function readExistingOutput(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }

  return readFileSync(path, 'utf8');
}

function hasOutputDrift(expectedContent: string, existingContent: string | null): boolean {
  if (existingContent === null) {
    return true;
  }

  return normalizeGeneratedOutput(existingContent) !== normalizeGeneratedOutput(expectedContent);
}

function verifyOutputFiles(outputContent: string): void {
  console.log('Checking generated vectors against committed fixtures...');
  const paths = getOutputPaths();
  const driftedPaths = [
    paths.scriptOutputPath,
    paths.fixtureOutputPath,
  ].filter(path => hasOutputDrift(outputContent, readExistingOutput(path)));

  if (driftedPaths.length > 0) {
    console.error('\x1b[31mAddress vector fixtures are stale or missing.\x1b[0m');
    for (const path of driftedPaths) {
      console.error(`  Drift detected: ${path}`);
    }
    console.error('Regenerate with: cd scripts/verify-addresses && npm run generate');
    process.exit(1);
  }

  console.log('\x1b[32mAddress vector fixtures match regenerated output.\x1b[0m');
}

function writeOutputFiles(outputContent: string): void {
  console.log('Generating output files...');

  // Write to output directory
  const paths = getOutputPaths();
  const outputDir = dirname(paths.scriptOutputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(paths.scriptOutputPath, outputContent);
  console.log(`  Written: ${paths.scriptOutputPath}`);

  // Also write to server/tests/fixtures if it exists
  try {
    writeFileSync(paths.fixtureOutputPath, outputContent);
    console.log(`  Written: ${paths.fixtureOutputPath}`);
  } catch (error) {
    console.log(`  Note: Could not write to fixtures directory: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function logSummary(
  verifiedSingleSig: VerifiedSingleSigVector[],
  verifiedMultisig: VerifiedMultisigVector[],
  totalErrors: number
): void {
  console.log();
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`  Single-sig vectors: ${verifiedSingleSig.length}`);
  console.log(`  Multisig vectors: ${verifiedMultisig.length}`);
  console.log(`  Total verified: ${verifiedSingleSig.length + verifiedMultisig.length}`);
  console.log(`  Errors/Disagreements: ${totalErrors}`);
  console.log();
}

function exitOnErrors(totalErrors: number): void {
  if (totalErrors > 0) {
    console.log('\x1b[31mWARNING: Some test cases had disagreements between implementations.\x1b[0m');
    console.log('Review the output above and investigate discrepancies.');
    process.exit(1);
  }

  console.log('\x1b[32mAll vectors verified successfully!\x1b[0m');
}

async function main() {
  logBanner();
  const availableImplementations = await getAvailableImplementations();
  requireMinimumImplementations(availableImplementations);

  const { singleSigCases, multisigCases } = generateTestCases();
  const singleSig = await verifySingleSigCases(singleSigCases, availableImplementations);
  const multisig = await verifyMultisigCases(multisigCases, availableImplementations);
  const keyOrderingErrors = verifyKeyOrdering(multisig.vectors);
  const totalErrors = singleSig.errors + multisig.errors + keyOrderingErrors;
  const outputContent = buildOutputContent(singleSig.vectors, multisig.vectors, availableImplementations);

  if (VERIFY_ONLY) {
    verifyOutputFiles(outputContent);
  } else {
    writeOutputFiles(outputContent);
  }
  logSummary(singleSig.vectors, multisig.vectors, totalErrors);
  exitOnErrors(totalErrors);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
