#!/usr/bin/env npx tsx
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bs58check from 'bs58check';

import { bitcoinCore, getCoreProvenance } from './implementations/bitcoincore.js';
import { bitcoinjsImpl } from './implementations/bitcoinjs.js';
import { getGoRuntimeVersion, goImpl } from './implementations/go.js';
import { getPythonProvenance, pythonImpl } from './implementations/python.js';
import { generateOutputFile } from './outputFile.js';
import { VERIFIER_SOURCE_FILES } from './sourceManifest.js';
import {
  PINNED_CORE_IMAGE,
  PINNED_GO_VERSION,
  PINNED_NODE_VERSION,
  PINNED_PYTHON_EFFECTIVE_UID,
  PINNED_PYTHON_VERSION,
  PYTHON_VERIFIER_IMAGE,
} from './standardsOracle.js';
import { generateDerivationTestCases, TEST_SEEDS } from './testCases.js';
import { decodeAccountKeyEvidence } from './xpub.js';
import {
  DERIVATION_MATRIX_ID,
  DERIVATION_MATRIX_SCHEMA_VERSION,
  EXPECTED_DERIVATION_CASE_COUNT,
  type AccountKeyEvidence,
  type DerivationEvidence,
  type DerivationImplementation,
  type DerivationTestCase,
  type TestSeed,
  type VerifiedMultisigVector,
  type VerifiedSingleSigVector,
  type VerifierProvenance,
} from './types.js';

const CURRENT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(CURRENT_FILE);
const REPOSITORY_ROOT = join(SCRIPT_DIR, '..', '..');
const OUTPUTS = [
  join(SCRIPT_DIR, 'output', 'verified-vectors.ts'),
  join(REPOSITORY_ROOT, 'server', 'tests', 'fixtures', 'verified-address-vectors.ts'),
] as const;
const IMPLEMENTATIONS: readonly DerivationImplementation[] = [bitcoinCore, bitcoinjsImpl, pythonImpl, goImpl];

const implementationLabel = (impl: DerivationImplementation): string => `${impl.name} ${impl.version}`;
const fileSha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

export function calculateSourceSha256(): string {
  const hash = createHash('sha256');
  for (const source of [...VERIFIER_SOURCE_FILES].sort()) {
    const path = join(REPOSITORY_ROOT, source);
    if (!existsSync(path)) throw new Error(`Missing verifier source: ${source}`);
    hash.update(`${source}\0`);
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function indexEvidence(
  implementation: DerivationImplementation,
  evidence: readonly DerivationEvidence[],
  cases: readonly DerivationTestCase[],
): Map<string, DerivationEvidence> {
  const indexed = new Map<string, DerivationEvidence>();
  for (const item of evidence) {
    if (item.implementationVersion !== implementation.version) {
      throw new Error(`${implementation.name} result version does not match inspected version`);
    }
    if (indexed.has(item.caseId)) throw new Error(`${implementation.name} duplicated ${item.caseId}`);
    indexed.set(item.caseId, item);
  }
  const expected = new Set(cases.map(testCase => testCase.id));
  const unknown = [...indexed.keys()].find(caseId => !expected.has(caseId));
  if (unknown || indexed.size !== cases.length) {
    throw new Error(`${implementation.name} result coverage is not the exact derivation matrix`);
  }
  return indexed;
}

const evidenceIdentity = (evidence: readonly AccountKeyEvidence[]): string => JSON.stringify(evidence);

export function assertExactConsensus(
  testCase: DerivationTestCase,
  results: readonly DerivationEvidence[],
): void {
  if (results.length !== IMPLEMENTATIONS.length) throw new Error(`Incomplete verifier set for ${testCase.id}`);
  const expectedImplementations = new Set(IMPLEMENTATIONS.map(implementation => implementation.name));
  const actualImplementations = new Set(results.map(result => result.implementation));
  if (
    actualImplementations.size !== expectedImplementations.size
    || [...expectedImplementations].some(name => !actualImplementations.has(name))
  ) {
    throw new Error(`Incorrect verifier identities for ${testCase.id}`);
  }
  if (results.some(result => result.caseId !== testCase.id)) {
    throw new Error(`Mislabeled derivation evidence for ${testCase.id}`);
  }
  const coreEvidence = results.filter(result => result.evidenceScope === 'root-private-descriptor-to-output');
  if (coreEvidence.length !== 1 || coreEvidence[0].implementation !== bitcoinCore.name
    || coreEvidence[0].accountKeys.length !== 0) {
    throw new Error(`Incorrect Bitcoin Core evidence scope for ${testCase.id}`);
  }
  if (new Set(results.map(result => result.address)).size !== 1) {
    throw new Error(`Exact address disagreement for ${testCase.id}`);
  }
  if (new Set(results.map(result => result.scriptPubKeyHex)).size !== 1) {
    throw new Error(`Exact scriptPubKey disagreement for ${testCase.id}`);
  }
  const seedDerivers = results.filter(result => result.evidenceScope === 'seed-to-account-and-output');
  if (seedDerivers.length !== 3) throw new Error(`Missing independent seed-to-account evidence for ${testCase.id}`);
  if (seedDerivers.some(result => result.accountKeys.length !== testCase.seedIds.length)) {
    throw new Error(`Incomplete account-key evidence for ${testCase.id}`);
  }
  if (new Set(seedDerivers.map(result => evidenceIdentity(result.accountKeys))).size !== 1) {
    throw new Error(`Account-key metadata disagreement for ${testCase.id}`);
  }
}

type AdversarialProof = VerifierProvenance['adversarialProofs'][number];

async function rejectsCase(
  implementation: DerivationImplementation,
  testCase: DerivationTestCase,
  seeds: readonly TestSeed[] = TEST_SEEDS,
): Promise<boolean> {
  try {
    await implementation.deriveCases([testCase], seeds);
    return false;
  } catch {
    return true;
  }
}

async function verifyAdversarialCorpus(
  cases: readonly DerivationTestCase[],
): Promise<readonly AdversarialProof[]> {
  const base = cases.find(testCase => testCase.kind === 'multisig'
    && testCase.scriptType === 'p2wsh'
    && testCase.chain === 'testnet3'
    && testCase.account === 0
    && testCase.threshold === 2
    && testCase.branch === 0
    && testCase.index === 0);
  if (!base || base.kind !== 'multisig') throw new Error('Missing adversarial multisig base case');
  const ordered = { ...base, id: 'adversarial:sortedmulti:ordered' };
  const reversed = {
    ...base,
    id: 'adversarial:sortedmulti:reversed',
    seedIds: [...base.seedIds].reverse(),
  };
  const duplicate = {
    ...base,
    id: 'adversarial:duplicate-account-key',
  };
  const duplicateSeeds = TEST_SEEDS.map((seed, index) => (
    index === 1 ? { ...seed, mnemonic: TEST_SEEDS[0].mnemonic } : seed
  ));
  const duplicateCaseSeeds = duplicateSeeds.filter(seed => duplicate.seedIds.includes(seed.id));
  if (new Set(duplicate.seedIds).size !== duplicate.seedIds.length
    || new Set(duplicateCaseSeeds.map(seed => seed.id)).size !== duplicate.seedIds.length
    || new Set(duplicateCaseSeeds.map(seed => seed.mnemonic)).size === duplicateCaseSeeds.length) {
    throw new Error('Duplicate-key adversarial case must use distinct IDs for duplicate derived material');
  }
  const invalidSeeds = TEST_SEEDS.map((seed, index) => (
    index === 0 ? { ...seed, mnemonic: 'not a valid BIP39 mnemonic' } : seed
  ));
  const verifiedBy: string[] = [];
  const adapterValidatedBy: string[] = [];
  const forwardResults: DerivationEvidence[] = [];
  const backwardResults: DerivationEvidence[] = [];
  for (const implementation of IMPLEMENTATIONS) {
    const [forward] = await implementation.deriveCases([ordered], TEST_SEEDS);
    const [backward] = await implementation.deriveCases([reversed], TEST_SEEDS);
    if (!forward || !backward
      || forward.address !== backward.address
      || forward.scriptPubKeyHex !== backward.scriptPubKeyHex) {
      throw new Error(`${implementation.name} failed reversed sortedmulti proof`);
    }
    forwardResults.push(forward);
    backwardResults.push(backward);
    if (!await rejectsCase(implementation, duplicate, duplicateSeeds)
      || !await rejectsCase(implementation, ordered, invalidSeeds)) {
      throw new Error(`${implementation.name} accepted adversarial key material`);
    }
    verifiedBy.push(implementationLabel(implementation));
    adapterValidatedBy.push(`${implementationLabel(implementation)} adapter`);
  }
  assertExactConsensus(ordered, forwardResults);
  assertExactConsensus(reversed, backwardResults);
  const validExtendedKey = forwardResults.find(result => result.implementation === bitcoinjsImpl.name)!
    .accountKeys[0];
  const invalidPayload = Buffer.from(bs58check.decode(validExtendedKey.encoded));
  invalidPayload[45] = 0x04;
  const invalidExtendedKey = bs58check.encode(invalidPayload);
  try {
    decodeAccountKeyEvidence({
      ...validExtendedKey,
      encoded: invalidExtendedKey,
      expectedFormat: base.slip132Format,
    });
    throw new Error('Verifier accepted a non-compressed extended public key');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('compressed public key')) throw error;
  }
  return [
    { id: 'reversed-sortedmulti', scope: 'four-way-core-derived-output', verifiedBy },
    { id: 'duplicate-key-rejection', scope: 'adapter-input-validation', verifiedBy: adapterValidatedBy },
    { id: 'invalid-seed-rejection', scope: 'adapter-input-validation', verifiedBy: adapterValidatedBy },
    {
      id: 'invalid-extended-public-key-rejection',
      scope: 'verifier-xpub-boundary',
      verifiedBy: ['SLIP-132/BIP32 verifier decoder'],
    },
  ];
}

async function collectEvidence(cases: readonly DerivationTestCase[]) {
  const evidenceByImplementation = new Map<string, Map<string, DerivationEvidence>>();
  for (const implementation of IMPLEMENTATIONS) {
    if (!await implementation.isAvailable()) {
      throw new Error(`${implementation.name} is required: ${implementation.unavailableReason ?? 'unavailable'}`);
    }
    const evidence = await implementation.deriveCases(cases, TEST_SEEDS);
    evidenceByImplementation.set(implementation.id, indexEvidence(implementation, evidence, cases));
  }
  return evidenceByImplementation;
}

function vectorsFromEvidence(
  cases: readonly DerivationTestCase[],
  evidence: Map<string, Map<string, DerivationEvidence>>,
): { single: VerifiedSingleSigVector[]; multi: VerifiedMultisigVector[] } {
  const single: VerifiedSingleSigVector[] = [];
  const multi: VerifiedMultisigVector[] = [];
  const verifiedBy = IMPLEMENTATIONS.map(implementationLabel);
  const mnemonicById = new Map<string, string>(TEST_SEEDS.map(seed => [seed.id, seed.mnemonic]));
  for (const testCase of cases) {
    const results = IMPLEMENTATIONS.map(implementation => evidence.get(implementation.id)!.get(testCase.id)!);
    assertExactConsensus(testCase, results);
    const canonical = results.find(result => result.implementation === bitcoinjsImpl.name)!;
    if (!canonical.descriptor) throw new Error(`Missing public descriptor for ${testCase.id}`);
    const common = {
      caseId: testCase.id,
      description: testCase.description,
      network: testCase.chain,
      account: testCase.account,
      index: testCase.index,
      branch: testCase.branch,
      change: testCase.branch === 1,
      expectedAddress: canonical.address,
      expectedScriptPubKey: canonical.scriptPubKeyHex,
      expectedDescriptor: canonical.descriptor,
      accountKeys: canonical.accountKeys,
      verifiedBy,
    } as const;
    if (testCase.kind === 'single_sig') {
      const seedId = testCase.seedIds[0];
      single.push({
        ...common,
        seedId,
        mnemonic: mnemonicById.get(seedId)!,
        path: testCase.accountPath,
        xpub: canonical.accountKeys[0].encoded,
        scriptType: testCase.scriptType,
      });
    } else {
      multi.push({
        ...common,
        seedIds: testCase.seedIds,
        xpubs: canonical.accountKeys.map(key => key.encoded),
        threshold: testCase.threshold,
        totalKeys: testCase.totalKeys,
        scriptType: testCase.scriptType,
        accountPath: testCase.accountPath,
      });
    }
  }
  return { single, multi };
}

export function assertPinnedPythonExecution(): void {
  if (process.env.VERIFY_ADDRESSES_PYTHON) {
    throw new Error('Generated provenance forbids the host Python override');
  }
  if (process.env.VERIFY_ADDRESSES_PYTHON_PROVENANCE_MODE !== 'local-iid'
    || !/^sha256:[0-9a-f]{64}$/.test(process.env.VERIFY_ADDRESSES_PYTHON_IMAGE_ID ?? '')) {
    throw new Error('Verifier requires an immutable locally built Python verifier image ID');
  }
}

/** Bind the container's verifier payload to the source included in this attestation. */
export function assertPythonVerifierSource(actualSha256: string): string {
  const expectedSha256 = fileSha256(join(SCRIPT_DIR, 'implementations', 'python-verify.py'));
  if (actualSha256 !== expectedSha256) {
    throw new Error('Python verifier image source does not match the checked-out verifier');
  }
  return expectedSha256;
}

function provenance(adversarialProofs: readonly AdversarialProof[]): VerifierProvenance {
  assertPinnedCoreExecution();
  const python = getPythonProvenance();
  const go = getGoRuntimeVersion();
  if (process.versions.node !== PINNED_NODE_VERSION
    || python.pythonVersion !== PINNED_PYTHON_VERSION
    || python.effectiveUid !== PINNED_PYTHON_EFFECTIVE_UID
    || go !== PINNED_GO_VERSION) {
    throw new Error(
      `Verifier runtime drift: node=${process.versions.node}, python=${python.pythonVersion}, go=${go}`,
    );
  }
  assertPinnedPythonExecution();
  const pythonVerifierSourceSha256 = assertPythonVerifierSource(python.sourceSha256);
  return {
    schemaVersion: DERIVATION_MATRIX_SCHEMA_VERSION,
    matrixId: DERIVATION_MATRIX_ID,
    exactCaseCount: EXPECTED_DERIVATION_CASE_COUNT,
    sourceSha256: calculateSourceSha256(),
    coreImage: PINNED_CORE_IMAGE,
    runtimes: {
      node: process.versions.node,
      python: python.pythonVersion,
      pythonEffectiveUid: python.effectiveUid,
      pythonImage: PYTHON_VERIFIER_IMAGE,
      go,
      pythonRequirementsSha256: fileSha256(join(SCRIPT_DIR, 'requirements.lock')),
      pythonDependencyFingerprint: python.dependencyFingerprint,
      pythonVerifierSourceSha256,
    },
    evidenceScopes: IMPLEMENTATIONS.map(implementation => ({
      implementation: implementationLabel(implementation),
      scope: implementation === bitcoinCore
        ? 'root-private-descriptor-to-output'
        : 'seed-to-account-and-output',
    })),
    adversarialProofs,
    implementations: IMPLEMENTATIONS.map(({ id, name, version }) => ({ id, name, version })),
    coreChains: getCoreProvenance(),
  };
}

export function assertPinnedCoreExecution(): void {
  if (process.env.VERIFY_ADDRESSES_CORE_PROVENANCE_MODE !== 'pinned-compose'
    || process.env.VERIFY_ADDRESSES_CORE_IMAGE !== PINNED_CORE_IMAGE) {
    throw new Error('Vector generation requires the exact digest-pinned Bitcoin Core Compose stack');
  }
}

export function writeAtomically(
  paths: readonly string[],
  content: string,
  renameFile: typeof renameSync = renameSync,
): void {
  const staged = paths.map(path => `${path}.tmp-${process.pid}`);
  const originals = new Map(paths.map(path => [
    path,
    existsSync(path) ? readFileSync(path, 'utf8') : null,
  ]));
  try {
    staged.forEach((path, index) => {
      mkdirSync(dirname(paths[index]), { recursive: true });
      writeFileSync(path, content, { encoding: 'utf8', flag: 'wx' });
    });
    staged.forEach((path, index) => renameFile(path, paths[index]));
  } catch (error) {
    staged.filter(existsSync).forEach(unlinkSync);
    for (const path of paths) {
      const original = originals.get(path);
      if (original === null) {
        if (existsSync(path)) unlinkSync(path);
      } else if (original !== undefined) {
        writeFileSync(path, original, 'utf8');
      }
    }
    throw error;
  }
}

function verifyOutputs(paths: readonly string[], content: string): void {
  for (const path of paths) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      throw new Error(`Verified vectors are stale: ${relative(REPOSITORY_ROOT, path)}`);
    }
  }
}

export async function generateVerifiedVectors(verifyOnly = false): Promise<void> {
  const cases = generateDerivationTestCases();
  const evidence = await collectEvidence(cases);
  const adversarialProofs = await verifyAdversarialCorpus(cases);
  const vectors = vectorsFromEvidence(cases, evidence);
  const content = generateOutputFile(vectors.single, vectors.multi, provenance(adversarialProofs));
  if (verifyOnly) verifyOutputs(OUTPUTS, content);
  else writeAtomically(OUTPUTS, content);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  generateVerifiedVectors(process.argv.includes('--verify-only')).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
