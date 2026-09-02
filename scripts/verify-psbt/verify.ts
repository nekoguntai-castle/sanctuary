#!/usr/bin/env tsx
/**
 * PSBT verification gate.
 *
 * This script intentionally fails until Bitcoin Core-backed PSBT vectors exist.
 * A silent or missing verifier creates false confidence for signing-critical code.
 */

import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { PSBT_PROOF_MANIFEST } from './provenance';
import type * as GeneratedPsbtFixtures from '../../server/tests/fixtures/generated-psbt-vectors';
import type * as GeneratedSignedPsbtFixtures from '../../server/tests/fixtures/generated-signed-psbt-vectors';

const requireUnknown: (id: string) => unknown = createRequire(import.meta.url);

const fail = (message: string): never => {
  console.error(`PSBT verifier failed: ${message}`);
  process.exit(1);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function assertGeneratedPsbtFixtures(
  value: unknown,
): asserts value is typeof GeneratedPsbtFixtures {
  if (!isRecord(value)
    || !isRecord(value.GENERATED_PSBT_PROVENANCE)
    || !Array.isArray(value.GENERATED_P2WPKH_VECTORS)
    || !Array.isArray(value.GENERATED_P2SH_P2WPKH_VECTORS)
    || !Array.isArray(value.GENERATED_P2TR_VECTORS)
    || !Array.isArray(value.GENERATED_P2WSH_VECTORS)
    || !Array.isArray(value.GENERATED_P2SH_P2WSH_VECTORS)) {
    fail('generated PSBT fixture module has an invalid export contract');
  }
}

function assertGeneratedSignedPsbtFixtures(
  value: unknown,
): asserts value is typeof GeneratedSignedPsbtFixtures {
  if (!isRecord(value)
    || !isRecord(value.GENERATED_SIGNED_PSBT_PROVENANCE)
    || !Array.isArray(value.GENERATED_SIGNED_PSBT_VECTORS)) {
    fail('generated signed PSBT fixture module has an invalid export contract');
  }
}

const generatedPsbtFixtures = requireUnknown('../../server/tests/fixtures/generated-psbt-vectors');
const generatedSignedPsbtFixtures = requireUnknown(
  '../../server/tests/fixtures/generated-signed-psbt-vectors',
);
assertGeneratedPsbtFixtures(generatedPsbtFixtures);
assertGeneratedSignedPsbtFixtures(generatedSignedPsbtFixtures);

const {
  GENERATED_P2SH_P2WPKH_VECTORS,
  GENERATED_P2SH_P2WSH_VECTORS,
  GENERATED_P2TR_VECTORS,
  GENERATED_P2WPKH_VECTORS,
  GENERATED_P2WSH_VECTORS,
  GENERATED_PSBT_PROVENANCE,
} = generatedPsbtFixtures;
const {
  GENERATED_SIGNED_PSBT_PROVENANCE,
  GENERATED_SIGNED_PSBT_VECTORS,
} = generatedSignedPsbtFixtures;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GENERATED_VECTORS_PATH = join(__dirname, '../../server/tests/fixtures/generated-psbt-vectors.ts');
const GENERATED_SIGNED_VECTORS_PATH = join(__dirname, '../../server/tests/fixtures/generated-signed-psbt-vectors.ts');

const REQUIRED_MARKERS = [
  'Bitcoin Core',
  'GENERATED_P2WPKH_VECTORS',
  'GENERATED_P2SH_P2WPKH_VECTORS',
  'GENERATED_P2TR_VECTORS',
  'GENERATED_P2WSH_VECTORS',
  'GENERATED_P2SH_P2WSH_VECTORS',
];
const REQUIRED_VECTOR_COUNT = 5;
const REQUIRED_SIGNED_MARKERS = [
  'Bitcoin Core',
  'Sanctuary software signer',
  'GENERATED_SIGNED_PSBT_VECTORS',
  'p2pkh',
  'p2wpkh',
  'p2sh-p2wpkh',
  'p2tr',
  'p2wsh',
  'p2sh-p2wsh',
  'mempoolAccept',
  'coreProof',
  'taproot_key_path_sig',
];
const REQUIRED_SIGNED_VECTOR_COUNT = 6;
const PROVENANCE_KEYS = ['coreImage', 'coreVersion', 'coreSubversion'] as const;
const REQUIRED_SIGNED_SCRIPT_TYPES = [
  'p2pkh',
  'p2sh-p2wpkh',
  'p2sh-p2wsh',
  'p2tr',
  'p2wpkh',
  'p2wsh',
] as const;

type StructuredProvenance = {
  coreImage: string;
  coreVersion: number;
  coreSubversion: string;
};

const assertStructuredProvenance = (
  actual: StructuredProvenance,
  label: string,
): void => {
  for (const key of PROVENANCE_KEYS) {
    if (actual[key] !== PSBT_PROOF_MANIFEST[key]) {
      fail(`${label} ${key} does not match the PSBT proof manifest`);
    }
  }
};

const verifyPinnedProvenance = (content: string, label: string): void => {
  for (const value of [
    PSBT_PROOF_MANIFEST.coreImage,
    String(PSBT_PROOF_MANIFEST.coreVersion),
    PSBT_PROOF_MANIFEST.coreSubversion,
  ]) {
    if (!content.includes(value)) {
      fail(`${label} does not attest the pinned Bitcoin Core value: ${value}`);
    }
  }
};

const countGeneratedVectors = (content: string): number => {
  const matches = content.match(/"psbtBase64"\s*:/g) ?? [];
  return matches.length;
};

const countGeneratedSignedVectors = (content: string): number => {
  const matches = content.match(/"finalTxHex"\s*:/g) ?? [];
  return matches.length;
};

const readGeneratedVectors = (): string => {
  if (!existsSync(GENERATED_VECTORS_PATH)) {
    fail(
      `missing ${GENERATED_VECTORS_PATH}. Run the Bitcoin Core-backed PSBT vector generator before verifying.`
    );
  }

  return readFileSync(GENERATED_VECTORS_PATH, 'utf8');
};

const verifyGeneratedVectorMarkers = (content: string): void => {
  for (const marker of REQUIRED_MARKERS) {
    if (!content.includes(marker)) {
      fail(`generated PSBT vectors are missing required marker: ${marker}`);
    }
  }
};

const verifyGeneratedVectorCount = (content: string): number => {
  const vectorCount = countGeneratedVectors(content);
  if (vectorCount !== REQUIRED_VECTOR_COUNT) {
    fail(`generated PSBT vectors have drifted: found ${vectorCount}, expected exactly ${REQUIRED_VECTOR_COUNT}`);
  }

  return vectorCount;
};

const verifyGeneratedVectorFamilies = (): void => {
  const groups = [
    GENERATED_P2WPKH_VECTORS,
    GENERATED_P2SH_P2WPKH_VECTORS,
    GENERATED_P2TR_VECTORS,
    GENERATED_P2WSH_VECTORS,
    GENERATED_P2SH_P2WSH_VECTORS,
  ];
  if (groups.some(group => group.length !== 1)) {
    fail('generated PSBT vectors must contain exactly one vector per required script family');
  }
};

const verifyGeneratedVectors = (): void => {
  const content = readGeneratedVectors();
  verifyPinnedProvenance(content, 'generated PSBT vectors');
  verifyGeneratedVectorMarkers(content);
  const vectorCount = verifyGeneratedVectorCount(content);
  assertStructuredProvenance(GENERATED_PSBT_PROVENANCE, 'generated PSBT vectors');
  verifyGeneratedVectorFamilies();

  console.log(`PSBT verifier passed with ${vectorCount} generated Bitcoin Core-backed vectors.`);
};

const readGeneratedSignedVectors = (): string => {
  if (!existsSync(GENERATED_SIGNED_VECTORS_PATH)) {
    fail(
      `missing ${GENERATED_SIGNED_VECTORS_PATH}. Run the funded Bitcoin Core-backed signed PSBT vector generator before verifying.`
    );
  }

  return readFileSync(GENERATED_SIGNED_VECTORS_PATH, 'utf8');
};

const verifyGeneratedSignedVectorMarkers = (content: string): void => {
  for (const marker of REQUIRED_SIGNED_MARKERS) {
    if (!content.includes(marker)) {
      fail(`generated signed PSBT vectors are missing required marker: ${marker}`);
    }
  }
};

const verifyGeneratedSignedVectorCount = (content: string): number => {
  const vectorCount = countGeneratedSignedVectors(content);
  if (vectorCount !== REQUIRED_SIGNED_VECTOR_COUNT) {
    fail(`generated signed PSBT vectors have drifted: found ${vectorCount}, expected exactly ${REQUIRED_SIGNED_VECTOR_COUNT}`);
  }

  return vectorCount;
};

const verifyGeneratedSignedScriptFamilies = (): void => {
  const actualScriptTypes = GENERATED_SIGNED_PSBT_VECTORS
    .map(vector => vector.scriptType)
    .sort();
  if (JSON.stringify(actualScriptTypes) !== JSON.stringify(REQUIRED_SIGNED_SCRIPT_TYPES)) {
    fail(`generated signed PSBT script families have drifted: ${actualScriptTypes.join(', ')}`);
  }
};

const verifyGeneratedSignedCoreEvidence = (): void => {
  if (GENERATED_SIGNED_PSBT_VECTORS.some(vector => !vector.mempoolAccept.allowed
    || vector.mempoolAccept.txid !== vector.expectedTxid
    || !vector.coreProof.finalizedPsbt.complete
    || vector.coreProof.finalizedPsbt.hex !== vector.finalTxHex
    || vector.coreProof.decodedTransaction.txid !== vector.expectedTxid
    || vector.coreProof.decodedTransaction.vsize !== vector.expectedVsize
    || vector.coreProof.analyzedSignedPsbt.next !== 'finalizer'
    || !vector.verifiedBy.includes(`Bitcoin Core ${PSBT_PROOF_MANIFEST.coreSubversion}`))) {
    fail('generated signed PSBT vectors lack exact Bitcoin Core acceptance evidence');
  }
};

const verifyGeneratedSignedTaprootEvidence = (): void => {
  const taproot = GENERATED_SIGNED_PSBT_VECTORS.find(vector => vector.scriptType === 'p2tr');
  const taprootInput = taproot?.coreProof.decodedSignedPsbt.inputs[0];
  const taprootDerivation = taprootInput?.taproot_bip32_derivs?.[0];
  if (!taproot
    || taprootInput?.taproot_key_path_sig?.length !== 128
    || taprootInput.taproot_internal_key?.length !== 64
    || taprootDerivation?.pubkey !== taprootInput.taproot_internal_key
    || taprootDerivation.master_fingerprint !== 'd90c6a4f'
    || taprootDerivation.path !== 'm/86h/1h/0h/0/0'
    || taprootDerivation.leaf_hashes.length !== 0
    || taproot.coreProof.decodedTransaction.vin[0]?.txinwitness?.length !== 1) {
    fail('generated signed P2TR vector lacks exact BIP371 key-path evidence');
  }
};

const verifyGeneratedSignedVectors = (): void => {
  const content = readGeneratedSignedVectors();
  verifyPinnedProvenance(content, 'generated signed PSBT vectors');
  verifyGeneratedSignedVectorMarkers(content);
  const vectorCount = verifyGeneratedSignedVectorCount(content);
  assertStructuredProvenance(GENERATED_SIGNED_PSBT_PROVENANCE, 'generated signed PSBT vectors');
  verifyGeneratedSignedScriptFamilies();
  verifyGeneratedSignedCoreEvidence();
  verifyGeneratedSignedTaprootEvidence();

  console.log(`Signed PSBT verifier passed with ${vectorCount} generated Bitcoin Core-accepted vectors.`);
};

verifyGeneratedVectors();
verifyGeneratedSignedVectors();
