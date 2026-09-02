import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  checkWalletSafetyClassifier,
  matchesClassifierPath,
  validateClassifier,
} from '../../scripts/ci/check-wallet-safety-classifier.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

function recursiveFiles(directory) {
  return readdirSync(resolve(REPO_ROOT, directory)).flatMap((name) => {
    const path = resolve(REPO_ROOT, directory, name);
    return statSync(path).isDirectory()
      ? recursiveFiles(relative(REPO_ROOT, path))
      : [relative(REPO_ROOT, path)];
  });
}

test('checked-in wallet-safety classifier is synchronized', async () => {
  await assert.doesNotReject(checkWalletSafetyClassifier());
});

test('checked-in classifier covers every hardware proof helper and emulator module', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'config/wallet-safety-critical-paths.json'), 'utf8')
  );
  const proofFiles = [
    'config/hardware-emulator-source-inventory.json',
    'scripts/ci/hardware-emulator-source-inventory.mjs',
    'scripts/ci/registered-start-gate.mjs',
    'tests/ci/check-hardware-emulator-source-inventory.test.mjs',
    ...recursiveFiles('server/tests/helpers').filter((path) =>
      /\/hardwareSigned[^/]*\.ts$/.test(path)
    ),
    ...recursiveFiles('tests/integration/trezorEmulator'),
    'tests/integration/trezorEmulator.integration.test.ts',
    ...recursiveFiles('tests/integration/ledgerEmulator'),
    'tests/integration/ledgerEmulator.integration.test.ts',
    ...recursiveFiles('tests/integration/jadeEmulator'),
    'tests/integration/jadeEmulator.integration.test.ts',
    'server/tests/unit/services/bitcoin/hardwareSignedEvidenceProvenance.test.ts',
  ];
  const uncovered = proofFiles.filter(
    (file) => !manifest.paths.some((pattern) => matchesClassifierPath(file, pattern))
  );
  assert.deepEqual(uncovered, []);
});

const BROAD_WORKFLOW = `  pull_request:
  merge_group:
  push:
  schedule:
  VERIFY_PSBT_CORE_IMAGE: bitcoin/bitcoin:29.0@sha256:${'a'.repeat(64)}
      - run: node scripts/ci/check-wallet-safety-classifier.mjs
      - run: node scripts/ci/hardware-emulator-source-inventory.mjs validate
      - working-directory: scripts/verify-psbt
        run: npm run verify
      - run: scripts/ci/run-psbt-core-subject.sh live
      - run: psbt.signed-vectors.test.ts
      - run: psbt.hardware-signed-vectors.test.ts
      - run: npm run test:trezor-emulator-proof
      - path: \${{ env.TREZOR_EMULATOR_PROOF_DIR }}
      - path: \${{ env.TREZOR_EMULATOR_DIAGNOSTICS_DIR }}
      - run: npm run test:ledger-emulator-proof
      - path: \${{ env.LEDGER_EMULATOR_PROOF_DIR }}
      - path: \${{ env.LEDGER_EMULATOR_DIAGNOSTICS_DIR }}
      - run: npm run test:jade-protocol-harness
      - path: \${{ env.JADE_PROTOCOL_PROOF_DIR }}
      - run: npm run test:jade-emulator-proof
      - path: \${{ env.JADE_EMULATOR_PROOF_DIR }}
      - path: \${{ env.JADE_EMULATOR_DIAGNOSTICS_DIR }}`;
const REPOSITORY_FILES = ['server/src/services/wallet/create.ts', 'same'];
const PROOF_MANIFEST = {
  schemaVersion: 1,
  coreImage: `bitcoin/bitcoin:29.0@sha256:${'a'.repeat(64)}`,
  coreVersion: 290000,
  coreSubversion: '/Satoshi:29.0.0/',
};

test('event path filters fail closed', () => {
  for (const filter of ['paths', 'paths-ignore']) {
    for (const indentation of ['    ', '      ', '\t']) {
      assert.throws(
        () =>
          validateClassifier(
            { schemaVersion: 1, paths: ['server/src/services/wallet/**'] },
          `${BROAD_WORKFLOW}\n${indentation}${filter}:\n      - 'unrelated/**'`,
          REPOSITORY_FILES,
            PROOF_MANIFEST
        ),
        /without path filters/
      );
    }
  }
});

test('a critical path repeated outside an event cannot hide a filtered workflow', () => {
  assert.throws(
    () =>
      validateClassifier(
        { schemaVersion: 1, paths: ['server/src/services/wallet/**'] },
      `${BROAD_WORKFLOW}\n    paths:\n      - 'server/src/services/wallet/**'\n'server/src/services/wallet/**'\n'server/src/services/wallet/**'`,
      REPOSITORY_FILES,
        PROOF_MANIFEST
    ),
    /without path filters/
  );
});

test('inline event path filters fail closed', () => {
  for (const filter of ['paths', 'paths-ignore']) {
    assert.throws(
      () =>
        validateClassifier(
          { schemaVersion: 1, paths: ['server/src/services/wallet/**'] },
          BROAD_WORKFLOW.replace('  pull_request:', `  pull_request: { ${filter}: ['server/**'] }`),
        REPOSITORY_FILES,
          PROOF_MANIFEST
      ),
      /without path filters/
    );
  }
});

test('empty or unresolved inventories fail closed', () => {
  assert.throws(
    () =>
      validateClassifier(
      { schemaVersion: 1, paths: [] },
      BROAD_WORKFLOW,
      REPOSITORY_FILES,
        PROOF_MANIFEST
    ),
    /unsupported shape/
  );
  assert.throws(
    () =>
      validateClassifier(
        { schemaVersion: 1, paths: ['definitely/not/a/real/path/**'] },
      BROAD_WORKFLOW,
      REPOSITORY_FILES,
        PROOF_MANIFEST
    ),
    /does not resolve/
  );
});

test('duplicate classifier rows are rejected', () => {
  assert.throws(
    () =>
      validateClassifier(
        { schemaVersion: 1, paths: ['same', 'same'] },
      BROAD_WORKFLOW,
      REPOSITORY_FILES,
        PROOF_MANIFEST
    ),
    /unique/
  );
});

test('mandatory PSBT and hardware proof commands and exact Core image fail closed', () => {
  for (const missing of [
    'hardware-emulator-source-inventory.mjs validate',
    'scripts/verify-psbt',
    'npm run verify',
    'psbt.signed-vectors.test.ts',
    'psbt.hardware-signed-vectors.test.ts',
    'npm run test:trezor-emulator-proof',
    'TREZOR_EMULATOR_PROOF_DIR',
    'TREZOR_EMULATOR_DIAGNOSTICS_DIR',
    'npm run test:ledger-emulator-proof',
    'LEDGER_EMULATOR_PROOF_DIR',
    'LEDGER_EMULATOR_DIAGNOSTICS_DIR',
    'npm run test:jade-protocol-harness',
    'JADE_PROTOCOL_PROOF_DIR',
    'npm run test:jade-emulator-proof',
    'JADE_EMULATOR_PROOF_DIR',
    'JADE_EMULATOR_DIAGNOSTICS_DIR',
  ]) {
    assert.throws(
      () =>
        validateClassifier(
          { schemaVersion: 1, paths: ['server/src/services/wallet/**'] },
          BROAD_WORKFLOW.replace(missing, 'removed'),
        REPOSITORY_FILES,
          PROOF_MANIFEST
      ),
      /mandatory PSBT proof command/
    );
  }

  assert.throws(
    () =>
      validateClassifier(
        { schemaVersion: 1, paths: ['server/src/services/wallet/**'] },
        BROAD_WORKFLOW.replace(
          PROOF_MANIFEST.coreImage,
          `bitcoin/bitcoin:29.0@sha256:${'b'.repeat(64)}`
        ),
      REPOSITORY_FILES,
        PROOF_MANIFEST
    ),
    /must match the proof manifest/
  );
});
