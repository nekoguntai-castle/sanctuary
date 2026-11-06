import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { lifecycleProofModulePurity } from '../../scripts/ownership/lifecycle-browser-process-proof.mjs';

const PROOF_FILES = [
  'scripts/ownership/lifecycle-bootstrap-proof.mjs',
  'scripts/ownership/lifecycle-browser-container-proof.mjs',
  'scripts/ownership/lifecycle-browser-process-proof.mjs',
];
const BOOTSTRAP_PROOF_SOURCE = readFileSync(
  path.resolve('scripts/ownership/lifecycle-bootstrap-proof.mjs'), 'utf8',
);
const CONTAINER_PROOF_SOURCE = readFileSync(
  path.resolve('scripts/ownership/lifecycle-browser-container-proof.mjs'), 'utf8',
);
const PROCESS_PROOF_SOURCE = readFileSync(
  path.resolve('scripts/ownership/lifecycle-browser-process-proof.mjs'), 'utf8',
);
const PROOF_SOURCES = new Map([
  [PROOF_FILES[0], BOOTSTRAP_PROOF_SOURCE],
  [PROOF_FILES[1], CONTAINER_PROOF_SOURCE],
  [PROOF_FILES[2], PROCESS_PROOF_SOURCE],
]);
const BOOTSTRAP_TEST_SOURCE = readFileSync(
  path.resolve('tests/ownership/lifecycle-bootstrap-proof.test.mjs'), 'utf8',
);
const CONTAINER_TEST_SOURCE = readFileSync(
  path.resolve('tests/ownership/lifecycle-browser-container-proof.test.mjs'), 'utf8',
);
const PURITY_TEST_SOURCE = readFileSync(
  path.resolve('tests/ownership/lifecycle-proof-module-purity.test.mjs'), 'utf8',
);

test('source recognizers and the bootstrap mutation fixture are pure source data', () => {
  for (const [relativePath, source] of PROOF_SOURCES) {
    assert.equal(lifecycleProofModulePurity({ relativePath, source }).proven, true);
  }
  const testPath = 'tests/ownership/lifecycle-bootstrap-proof.test.mjs';
  assert.equal(lifecycleProofModulePurity({ relativePath: testPath, source: BOOTSTRAP_TEST_SOURCE }).proven, true);
  const containerTestPath = 'tests/ownership/lifecycle-browser-container-proof.test.mjs';
  assert.equal(lifecycleProofModulePurity({ relativePath: containerTestPath, source: CONTAINER_TEST_SOURCE }).proven, true);
  assert.equal(lifecycleProofModulePurity({ relativePath: 'tests/ownership/lifecycle-proof-module-purity.test.mjs', source: PURITY_TEST_SOURCE }).proven, true);
});

test('quoted lifecycle patterns remain inert data', () => {
  const relativePath = PROOF_FILES[0];
  const source = PROOF_SOURCES.get(relativePath) + "\nconst fixture = \"process.kill('SIGTERM'); fs.rmSync('/tmp/x')\";";
  assert.equal(lifecycleProofModulePurity({ relativePath, source }).proven, true);
});

test('computed authority lookups and constructor calls are rejected', () => {
  const relativePath = PROOF_FILES[0];
  const original = PROOF_SOURCES.get(relativePath);
  const mutations = [
    "\n(()=>{})['constructor']('return process')()['kill'](123, 'SIGTERM');",
    "\n(()=>{})['con'+'structor']('return globalThis')()['process']['kill'](123, 'SIGTERM');",
    "\nconst hidden = globalThis['pro'+'cess']; hidden['kill'](123, 'SIGTERM');",
    "\nReflect['apply'](process['kill'], process, [123, 'SIGTERM']);",
  ];
  for (const mutation of mutations) {
    assert.equal(lifecycleProofModulePurity({ relativePath, source: original + mutation }).proven, false, mutation);
  }
});

test('source recognizers reject imports, host IO, process control, and dynamic execution', () => {
  const mutations = [
    "\nprocess.kill('SIGTERM');", "\nimport { rmSync } from 'node:fs';",
    "\nconst fs = require('node:fs'); fs.rmSync('/tmp/x', { recursive: true });",
    "\nspawn('node', ['-e', 'process.exit(0)']);", "\neval('process.kill(1)');", "\nopen('/tmp/x');",
    "\nfetch('https://example.invalid');", '\nconst value = `${process}`;',
    "\nconst action = `${process.kill('SIGTERM')}`;",
  ];
  for (const relativePath of PROOF_FILES) {
    for (const mutation of mutations) {
      const original = PROOF_SOURCES.get(relativePath);
      assert.equal(lifecycleProofModulePurity({ relativePath, source: original + mutation }).proven, false, `${relativePath}: ${mutation}`);
    }
  }
});

test('the mutation fixture allows only its reviewed imports and fixed source reads', () => {
  const relativePath = 'tests/ownership/lifecycle-bootstrap-proof.test.mjs';
  const original = BOOTSTRAP_TEST_SOURCE;
  assert.equal(lifecycleProofModulePurity({
    relativePath,
    source: original.replace("path.resolve('scripts/ci/bootstrap-node.sh')", "path.resolve('/etc/passwd')"),
  }).proven, false);
  assert.equal(lifecycleProofModulePurity({
    relativePath,
    source: `${original}\nreadFileSync('/etc/passwd', 'utf8');`,
  }).proven, false);
  assert.equal(lifecycleProofModulePurity({
    relativePath,
    source: `${original}\nimport fs from 'node:fs';`,
  }).proven, false);
});

test('container mutation fixture rejects any unreviewed read path or cleanup call', () => {
  const relativePath = 'tests/ownership/lifecycle-browser-container-proof.test.mjs';
  assert.equal(lifecycleProofModulePurity({
    relativePath,
    source: CONTAINER_TEST_SOURCE.replace("read('scripts/ci/run-sandboxed-playwright.mjs')", "read('/etc/passwd')"),
  }).proven, false);
  assert.equal(lifecycleProofModulePurity({
    relativePath,
    source: `${CONTAINER_TEST_SOURCE}\nread('/etc/passwd');`,
  }).proven, false);
  assert.equal(lifecycleProofModulePurity({
    relativePath,
    source: CONTAINER_TEST_SOURCE + "\nprocess.kill('SIGTERM');",
  }).proven, false);
});
