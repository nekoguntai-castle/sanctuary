import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkActionRuntimes } from '../../scripts/ci/check-github-action-runtimes.mjs';

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeWorkflow(rootDir, content) {
  writeFile(path.join(rootDir, '.github/workflows/runtime-check.yml'), content);
}

function writeLocalAction(rootDir, actionPath, runtime) {
  writeFile(
    path.join(rootDir, actionPath, 'action.yml'),
    `name: local action\nruns:\n  using: ${runtime}\n  main: index.js\n`,
  );
}

function writeRemoteAction(manifestRoot, spec, content) {
  const atIndex = spec.lastIndexOf('@');
  const locator = spec.slice(0, atIndex);
  const ref = spec.slice(atIndex + 1);
  const [owner, repo, ...actionPath] = locator.split('/');
  writeFile(
    path.join(manifestRoot, owner, repo, encodeURIComponent(ref), ...actionPath, 'action.yml'),
    content,
  );
}

async function runFixture(workflowContent, configure = () => {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-runtime-check-'));
  const rootDir = path.join(tempDir, 'repo');
  const manifestRoot = path.join(tempDir, 'manifests');
  writeWorkflow(rootDir, workflowContent);
  configure(rootDir, manifestRoot);

  try {
    return await checkActionRuntimes({ rootDir, manifestRoot });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function assertAllowsModernActions() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/good@v1
      - uses: docker://alpine:3.20
  reuse:
    uses: ./.github/workflows/reusable.yml
`,
    (rootDir, manifestRoot) => {
      writeRemoteAction(
        manifestRoot,
        'actions/good@v1',
        "name: good\nruns:\n  using: 'node24'\n  main: dist/index.js\n",
      );
      writeFile(path.join(rootDir, '.github/workflows/reusable.yml'), 'name: reusable\n');
    },
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 0);
  assert.equal(result.checkedManifests, 1);
}

async function assertBlocksDirectDeprecatedRuntime() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/bad@v1
`,
    (_rootDir, manifestRoot) => {
      writeRemoteAction(
        manifestRoot,
        'actions/bad@v1',
        "name: bad\nruns:\n  using: node20\n  main: dist/index.js\n",
      );
    },
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].runtime, 'node20');
  assert.match(result.findings[0].chain, /runtime-check\.yml:8/);
  assert.match(result.findings[0].chain, /actions\/bad@v1/);
}

async function assertBlocksCompositeNestedDeprecatedRuntime() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/composite@v1
`,
    (_rootDir, manifestRoot) => {
      writeRemoteAction(
        manifestRoot,
        'actions/composite@v1',
        `
name: composite
runs:
  using: composite
  steps:
    - uses: actions/nested-bad@v1
`,
      );
      writeRemoteAction(
        manifestRoot,
        'actions/nested-bad@v1',
        "name: nested bad\nruns:\n  using: node20\n  main: dist/index.js\n",
      );
    },
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].runtime, 'node20');
  assert.match(result.findings[0].chain, /actions\/composite@v1/);
  assert.match(result.findings[0].chain, /actions\/nested-bad@v1/);
}

async function assertBlocksLocalDeprecatedRuntime() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/local-bad
`,
    (rootDir) => {
      writeLocalAction(rootDir, '.github/actions/local-bad', 'node20');
    },
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].runtime, 'node20');
  assert.match(result.findings[0].chain, /\.github\/actions\/local-bad/);
}

async function assertFailsClosedOnMissingManifest() {
  const result = await runFixture(`
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/missing@v1
`);

  assert.equal(result.findings.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /missing fixture manifest/);
}

await assertAllowsModernActions();
await assertBlocksDirectDeprecatedRuntime();
await assertBlocksCompositeNestedDeprecatedRuntime();
await assertBlocksLocalDeprecatedRuntime();
await assertFailsClosedOnMissingManifest();
console.log('github action runtime guard regression checks passed');
