#!/usr/bin/env tsx
/**
 * PSBT verification gate.
 *
 * This script intentionally fails until Bitcoin Core-backed PSBT vectors exist.
 * A silent or missing verifier creates false confidence for signing-critical code.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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
  'p2wpkh',
  'p2sh-p2wpkh',
  'p2wsh',
  'p2sh-p2wsh',
  'mempoolAccept',
];
const REQUIRED_SIGNED_VECTOR_COUNT = 4;

function fail(message: string): never {
  console.error(`PSBT verifier failed: ${message}`);
  process.exit(1);
}

function countGeneratedVectors(content: string): number {
  const matches = content.match(/"psbtBase64"\s*:/g) ?? [];
  return matches.length;
}

function countGeneratedSignedVectors(content: string): number {
  const matches = content.match(/"finalTxHex"\s*:/g) ?? [];
  return matches.length;
}

function verifyGeneratedVectors(): void {
  if (!existsSync(GENERATED_VECTORS_PATH)) {
    fail(
      `missing ${GENERATED_VECTORS_PATH}. Run the Bitcoin Core-backed PSBT vector generator before verifying.`
    );
  }

  const content = readFileSync(GENERATED_VECTORS_PATH, 'utf8');
  for (const marker of REQUIRED_MARKERS) {
    if (!content.includes(marker)) {
      fail(`generated PSBT vectors are missing required marker: ${marker}`);
    }
  }

  const vectorCount = countGeneratedVectors(content);
  if (vectorCount < REQUIRED_VECTOR_COUNT) {
    fail(`generated PSBT vectors are incomplete: found ${vectorCount}, expected at least ${REQUIRED_VECTOR_COUNT}`);
  }

  console.log(`PSBT verifier passed with ${vectorCount} generated Bitcoin Core-backed vectors.`);
}

function verifyGeneratedSignedVectors(): void {
  if (!existsSync(GENERATED_SIGNED_VECTORS_PATH)) {
    fail(
      `missing ${GENERATED_SIGNED_VECTORS_PATH}. Run the funded Bitcoin Core-backed signed PSBT vector generator before verifying.`
    );
  }

  const content = readFileSync(GENERATED_SIGNED_VECTORS_PATH, 'utf8');
  for (const marker of REQUIRED_SIGNED_MARKERS) {
    if (!content.includes(marker)) {
      fail(`generated signed PSBT vectors are missing required marker: ${marker}`);
    }
  }

  const vectorCount = countGeneratedSignedVectors(content);
  if (vectorCount < REQUIRED_SIGNED_VECTOR_COUNT) {
    fail(`generated signed PSBT vectors are incomplete: found ${vectorCount}, expected at least ${REQUIRED_SIGNED_VECTOR_COUNT}`);
  }

  console.log(`Signed PSBT verifier passed with ${vectorCount} generated Bitcoin Core-accepted vectors.`);
}

verifyGeneratedVectors();
verifyGeneratedSignedVectors();
