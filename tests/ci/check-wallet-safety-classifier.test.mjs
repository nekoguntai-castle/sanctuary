import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test('bash wallet-safety matcher agrees with matchesClassifierPath', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'config/wallet-safety-critical-paths.json'), 'utf8')
  );
  const probes = [
    'docs/adr/0003-jade-plus-authentication-boundary.md',
    'docs/adr/0003-jade-plus-authentication-boundary.mdx',
    'docs/adr/0004-other.md',
    'docs/reference/example.md',
    'README.md',
    'scripts/verify-addresses/README.md',
    'scripts/verify-psbt/README.md',
    'scripts/verify-psbt/nested/deep/file.mjs',
    'server/src/services/bitcoin/a.ts',
    'server/src/services/bitcoin/nested/deep/a.ts',
    'server/src/services/bitcoin',
    'server/src/services/bitcoinX/a.ts',
    'server/src/api/push.ts',
    'config/wallet-safety-critical-paths.json',
    'config/wallet-safety-critical-pathsXjson',
    'shared/constants/bitcoin.ts',
    'shared/constants/bitcoinXts',
    'shared/constants/bitcoin.ts/extra',
    '.github/workflows/verify-vectors.yml',
  ];
  const probeSet = [...new Set([...probes, ...manifest.paths.map((path) => path.replaceAll('*', 'x'))])];
  const script = [
    '. scripts/ci/classify-files-lib.sh',
    'for f in "$@"; do',
    '  if is_wallet_safety_critical_file "$f"; then echo "$f=1"; else echo "$f=0"; fi',
    'done',
  ].join('\n');
  const output = execFileSync('bash', ['-c', script, 'parity', ...probeSet], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const bash = new Map(output.trim().split('\n').map((line) => {
    const index = line.lastIndexOf('=');
    return [line.slice(0, index), line.slice(index + 1) === '1'];
  }));
  for (const file of probeSet) {
    const expected = manifest.paths.some((pattern) => matchesClassifierPath(file, pattern));
    assert.equal(bash.get(file), expected, `bash and node disagree on ${file}`);
  }
  for (const pattern of manifest.paths) {
    assert.equal(bash.get(pattern.replaceAll('*', 'x')), true, `pattern ${pattern} must match itself`);
  }
  // The pre-commit hook sources the library from POSIX sh: it must parse and agree there too.
  const posix = execFileSync('sh', ['-c', `REPO_ROOT=. ${script}`, 'parity', ...probeSet], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(posix, output, 'POSIX sh and bash must classify every probe identically');
});

test('bash hardware proof-source matcher classifies every documentation proof source', () => {
  const docsOnly = (path) => /\.mdx?$/.test(path) || path.startsWith('docs/') || path.startsWith('tasks/');
  const proofDocs = ['trezor', 'ledger', 'jade'].flatMap((vendor) =>
    execFileSync(
      'node',
      ['scripts/ci/hardware-emulator-source-inventory.mjs', 'list', '--vendor', vendor, '--format', 'lines'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    )
      .split('\n')
      .filter((path) => path && docsOnly(path))
  );
  assert.ok(proofDocs.includes('docs/reference/release-gates.md'));
  assert.ok(proofDocs.includes('shared/utils/README.md'));
  const script = [
    '. scripts/ci/classify-files-lib.sh',
    'for f in "$@"; do',
    '  if is_hardware_proof_source_file "$f"; then echo "$f=1"; else echo "$f=0"; fi',
    'done',
  ].join('\n');
  const probes = [...new Set(proofDocs), 'docs/reference/unrelated.md', 'README.md', 'tasks/plan.md'];
  const run = (shell, prefix = '') =>
    execFileSync(shell, ['-c', `${prefix}${script}`, 'parity', ...probes], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  const bash = run('bash');
  for (const path of proofDocs) {
    assert.match(bash, new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=1$`, 'm'), `${path} must be a proof source`);
  }
  assert.match(bash, /^docs\/reference\/unrelated\.md=0$/m);
  assert.match(bash, /^README\.md=0$/m);
  assert.equal(run('sh', 'REPO_ROOT=. '), bash, 'POSIX sh and bash must classify every probe identically');
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
