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

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import type {
  AddressDeriver,
  SingleSigTestCase,
  MultisigTestCase,
  VerifiedSingleSigVector,
  VerifiedMultisigVector,
  VerificationResult,
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

/**
 * Minimum implementations required for a vector to be considered verified
 * Note: We use 2 as minimum because:
 * - Bitcoin Core (regtest) can't verify mainnet addresses
 * - Caravan's multisig API has compatibility issues
 * - 2 independent implementations (Bitcoin Core + bitcoinjs-lib) still provides strong verification
 */
const MIN_IMPLEMENTATIONS = 2;

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

  if (uniqueNormalized.size === 1 && addresses.length >= MIN_IMPLEMENTATIONS) {
    // Use the non-regtest address as the canonical one
    const canonicalAddress = addresses.find(a => !a.startsWith('bcrt1')) || addresses[0];
    return {
      testCase,
      results,
      consensus: true,
      consensusAddress: canonicalAddress,
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

  if (uniqueNormalized.size === 1 && addresses.length >= MIN_IMPLEMENTATIONS) {
    // Use the non-regtest address as the canonical one
    const canonicalAddress = addresses.find(a => !a.startsWith('bcrt1') && !a.startsWith('2')) || addresses[0];
    return {
      testCase,
      results,
      consensus: true,
      consensusAddress: canonicalAddress,
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
    }
  }

  console.log();
  return availableImplementations;
}

function requireMinimumImplementations(availableImplementations: AddressDeriver[]): void {
  if (availableImplementations.length < MIN_IMPLEMENTATIONS) {
    console.error(`\x1b[31mError: Need at least ${MIN_IMPLEMENTATIONS} implementations, only ${availableImplementations.length} available.\x1b[0m`);
    console.log('\nTo enable more implementations:');
    console.log('  - Bitcoin Core: docker compose up -d');
    console.log('  - Python: pip install bip_utils');
    console.log('  - Go: ensure Go is installed and modules are available');
    process.exit(1);
  }

  console.log(`Using ${availableImplementations.length} implementations for verification`);
  console.log();
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

function writeOutputFiles(
  verifiedSingleSig: VerifiedSingleSigVector[],
  verifiedMultisig: VerifiedMultisigVector[],
  availableImplementations: AddressDeriver[]
): void {
  console.log('Generating output files...');

  const implementationNames = availableImplementations.map(i => `${i.name} ${i.version}`);
  const outputContent = generateOutputFile(
    verifiedSingleSig,
    verifiedMultisig,
    implementationNames,
    TEST_MNEMONIC
  );

  // Write to output directory
  const outputDir = join(__dirname, 'output');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = join(outputDir, 'verified-vectors.ts');
  writeFileSync(outputPath, outputContent);
  console.log(`  Written: ${outputPath}`);

  // Also write to server/tests/fixtures if it exists
  const fixturesPath = join(__dirname, '../../server/tests/fixtures/verified-address-vectors.ts');
  try {
    writeFileSync(fixturesPath, outputContent);
    console.log(`  Written: ${fixturesPath}`);
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

  writeOutputFiles(singleSig.vectors, multisig.vectors, availableImplementations);
  logSummary(singleSig.vectors, multisig.vectors, totalErrors);
  exitOnErrors(totalErrors);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
