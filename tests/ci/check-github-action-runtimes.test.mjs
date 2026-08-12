import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkActionRuntimes } from '../../scripts/ci/check-github-action-runtimes.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VENDORED_UPLOAD_ACTION = './.github/actions/vendor/forgejo-artifact-v4/upload';
const VENDORED_DOWNLOAD_ACTION = './.github/actions/vendor/forgejo-artifact-v4/download';
const VENDORED_UPLOAD_SHA = '16871d9e8cfcf27ff31822cac382bbb5450f1e1e';
const VENDORED_DOWNLOAD_SHA = 'd8d0a99033603453ad2255e58720b460a0555e1e';

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

function topLevelSectionKeys(source, section) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${section}:`);
  assert.notEqual(start, -1, `missing ${section} section`);

  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[^ ]/.test(line)) {
      break;
    }
    const match = line.match(/^  ([a-z0-9-]+):/);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

function assertArtifactWrapperContract() {
  const upload = fs.readFileSync(
    path.join(REPO_ROOT, '.github/actions/upload-artifact/action.yml'),
    'utf8',
  );
  const download = fs.readFileSync(
    path.join(REPO_ROOT, '.github/actions/download-artifact/action.yml'),
    'utf8',
  );

  assert.match(
    upload,
    /uses: \.\/\.github\/actions\/vendor\/forgejo-artifact-v4\/upload/,
  );
  assert.match(
    download,
    /uses: \.\/\.github\/actions\/vendor\/forgejo-artifact-v4\/download/,
  );
  assert.deepEqual(topLevelSectionKeys(upload, 'inputs'), [
    'name',
    'path',
    'retention-days',
    'if-no-files-found',
    'overwrite',
    'include-hidden-files',
  ]);
  assert.deepEqual(topLevelSectionKeys(upload, 'outputs'), [
    'artifact-id',
    'artifact-url',
  ]);
  assert.deepEqual(topLevelSectionKeys(download, 'inputs'), [
    'name',
    'path',
    'pattern',
    'merge-multiple',
  ]);
  assert.deepEqual(topLevelSectionKeys(download, 'outputs'), ['download-path']);

  for (const output of ['artifact-id', 'artifact-url']) {
    assert.match(
      upload,
      new RegExp('value: \\$\\{\\{ steps\\.upload\\.outputs\\.' + output + ' \\}\\}'),
    );
  }
  assert.match(download, /value: \$\{\{ steps\.download\.outputs\.download-path \}\}/);
}

function assertVendoredArtifactRuntimeContract() {
  for (const [label, actionPath] of [
    ['upload', VENDORED_UPLOAD_ACTION],
    ['download', VENDORED_DOWNLOAD_ACTION],
  ]) {
    const manifestPath = path.join(REPO_ROOT, actionPath, 'action.yml');
    const manifest = fs.readFileSync(manifestPath, 'utf8');

    assert.match(manifest, /^\s*using:\s*['"]?node24['"]?\s*$/m, `${label} must use node24`);
    const bundlePath = label === 'upload' ? 'dist/upload/index.js' : 'dist/index.js';
    const escapedBundlePath = bundlePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      manifest,
      new RegExp(`^\\s*main:\\s*['"]?${escapedBundlePath}['"]?\\s*$`, 'm'),
      `${label} must execute its reviewed vendored bundle`,
    );
  }

  const vendorRoot = path.join(REPO_ROOT, '.github/actions/vendor/forgejo-artifact-v4');
  const provenance = JSON.parse(fs.readFileSync(path.join(vendorRoot, 'provenance.json'), 'utf8'));
  assert.equal(provenance.runtime, 'node24');
  assert.equal(provenance.protocol, 'Forgejo patched artifact v4');
  assert.equal(provenance.upstream.upload.commit, VENDORED_UPLOAD_SHA);
  assert.equal(provenance.upstream.download.commit, VENDORED_DOWNLOAD_SHA);

  for (const relativePath of Object.keys(provenance.files)) {
    const trackedPath = path.posix.join(
      '.github/actions/vendor/forgejo-artifact-v4',
      relativePath,
    );
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', trackedPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.equal(tracked.status, 0, `vendored provenance file is not tracked: ${trackedPath}`);
  }

  const verification = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/ci/vendor/forgejo-artifact-v4/verify-vendor.mjs'), vendorRoot],
    { encoding: 'utf8' },
  );
  assert.equal(
    verification.status,
    0,
    `vendor provenance verification failed:\n${verification.stdout}${verification.stderr}`,
  );
}

function runVendoredUploadFixture(searchPath, includeHiddenFiles) {
  const bundlePath = path.join(
    REPO_ROOT,
    VENDORED_UPLOAD_ACTION,
    'dist/upload/index.js',
  );
  const env = {
    ...process.env,
    NODE_OPTIONS: '--throw-deprecation',
    INPUT_NAME: 'hidden-file-contract-fixture',
    INPUT_PATH: searchPath,
    'INPUT_IF-NO-FILES-FOUND': 'ignore',
    'INPUT_RETENTION-DAYS': '',
    'INPUT_COMPRESSION-LEVEL': '6',
    INPUT_OVERWRITE: 'false',
    'INPUT_INCLUDE-HIDDEN-FILES': String(includeHiddenFiles),
  };
  for (const secretName of [
    'ACTIONS_RUNTIME_TOKEN',
    'ACTIONS_RUNTIME_URL',
    'ACTIONS_RESULTS_URL',
    'GITHUB_TOKEN',
  ]) {
    delete env[secretName];
  }

  return spawnSync(process.execPath, [bundlePath], { encoding: 'utf8', env });
}

function assertVendoredUploadHiddenFileContract() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-hidden-contract-'));
  const explicitHiddenFile = path.join(fixtureRoot, '.explicit-hidden.txt');
  writeFile(path.join(fixtureRoot, 'visible.txt'), 'visible');
  writeFile(explicitHiddenFile, 'hidden');
  writeFile(path.join(fixtureRoot, 'nested/visible.txt'), 'visible');
  writeFile(path.join(fixtureRoot, 'nested/.hidden-file.txt'), 'hidden');
  writeFile(path.join(fixtureRoot, 'nested/.hidden-directory/secret.txt'), 'hidden');

  try {
    for (const [searchPath, includeHiddenFiles, expectedCount, expectedStatus] of [
      [fixtureRoot, false, 2, 1],
      [fixtureRoot, true, 5, 1],
      [explicitHiddenFile, false, 0, 0],
      [explicitHiddenFile, true, 1, 1],
    ]) {
      const result = runVendoredUploadFixture(searchPath, includeHiddenFiles);
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.status, expectedStatus, output);
      assert.doesNotMatch(output, /DeprecationWarning|DEP0040|DEP0169|DEP0005/);
      assert.doesNotMatch(output, /GHESNotSupported|not currently supported on GHES/);
      if (expectedCount === 0) {
        assert.match(output, /No files were found/);
      } else {
        assert.match(output, new RegExp(`there will be ${expectedCount} files? uploaded`));
        assert.match(output, /ACTIONS_(?:RUNTIME_TOKEN|RESULTS_URL)/);
      }
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

async function runFixture(workflowContent, configure = () => {}, runtimeOptions = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-runtime-check-'));
  const rootDir = path.join(tempDir, 'repo');
  const manifestRoot = path.join(tempDir, 'manifests');
  writeWorkflow(rootDir, workflowContent);
  configure(rootDir, manifestRoot);

  try {
    return await checkActionRuntimes({ rootDir, manifestRoot, ...runtimeOptions });
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

async function assertBlocksFloatingForgejoActionRef() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: https://data.forgejo.org/forgejo/upload-artifact@v4
`,
  );

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Forgejo action must use an exact commit SHA/);
  assert.equal(result.findings.length, 0);
}

async function assertBlocksPinnedForgejoDeprecatedRuntime() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: https://data.forgejo.org/forgejo/bad-action@1111111111111111111111111111111111111111
`,
    (_rootDir, manifestRoot) => {
      writeRemoteAction(
        manifestRoot,
        'forgejo/bad-action@1111111111111111111111111111111111111111',
        "name: bad\nruns:\n  using: node20\n  main: dist/index.js\n",
      );
    },
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].runtime, 'node20');
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

async function assertUsesTrackedManifestRootByDefault() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-runtime-check-'));
  const rootDir = path.join(tempDir, 'repo');
  writeWorkflow(
    rootDir,
    `
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/good@v1
`,
  );
  writeRemoteAction(
    path.join(rootDir, 'scripts/ci/action-runtime-manifests'),
    'actions/good@v1',
    "name: good\nruns:\n  using: node24\n  main: dist/index.js\n",
  );

  try {
    const result = await checkActionRuntimes({ rootDir });
    assert.equal(result.errors.length, 0);
    assert.equal(result.findings.length, 0);
    assert.equal(result.checkedManifests, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function assertIgnoresForgejoGithubTokenForRemoteManifestFetches() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-runtime-check-'));
  const rootDir = path.join(tempDir, 'repo');
  writeWorkflow(
    rootDir,
    `
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`,
  );

  const originalFetch = globalThis.fetch;
  const originalServerUrl = process.env.GITHUB_SERVER_URL;
  const originalToken = process.env.GITHUB_TOKEN;
  let authorizationHeader = 'not-called';
  let requestedUrl = '';

  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    authorizationHeader = init?.headers?.Authorization;
    return new Response("name: checkout\nruns:\n  using: node24\n  main: dist/index.js\n");
  };
  process.env.GITHUB_SERVER_URL = 'https://forgejo.example.invalid';
  process.env.GITHUB_TOKEN = 'forgejo-runtime-token';

  try {
    const result = await checkActionRuntimes({ rootDir, manifestRoot: '' });
    assert.equal(result.errors.length, 0);
    assert.equal(result.findings.length, 0);
    assert.equal(authorizationHeader, undefined);
    assert.match(requestedUrl, /^https:\/\/data\.forgejo\.org\//);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalServerUrl === undefined) {
      delete process.env.GITHUB_SERVER_URL;
    } else {
      process.env.GITHUB_SERVER_URL = originalServerUrl;
    }
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function assertBlocksBareRepoRootCiHelperCalls() {
  const result = await runFixture(`
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - run: bash scripts/ci/ensure-node.sh
`);

  assert.equal(result.findings.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /runtime-check\.yml:\d+:/);
  assert.match(result.errors[0], /scripts\/ci\/ensure-node\.sh must be invoked through/);
  assert.match(result.errors[0], /\$\{\{ github\.workspace \}\}/);
}

async function assertAllowsWorkspaceAbsoluteCiHelperCalls() {
  const result = await runFixture(`
name: Runtime Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - run: bash \${{ github.workspace }}/scripts/ci/ensure-node.sh
`);

  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 0);
}

function validTestSuiteWorkflow() {
  return `
name: Test Suite
on: pull_request
jobs:
  # ============================================
  # Full Lane (pull requests, merge queue, main, nightly, manual)
  # ============================================
  full-backend-integration-tests:
    name: Full Backend Integration Tests
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready]
    steps:
      - run: |
          for g in $(scripts/ci/backend-integration-groups.sh --groups); do
            scripts/ci/backend-integration-groups.sh "$g"
          done
  full-backend-tests:
    name: Full Backend Tests
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready, full-backend-integration-tests]
    steps:
      - run: echo backend aggregate
  full-frontend-typechecks:
    name: Full Frontend Typecheck
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready]
    steps:
      - run: echo typecheck
  full-frontend-coverage-merge:
    name: Full Frontend Coverage Merge
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready]
    steps:
      - run: |
          npm run test:coverage:shard -- 1 2
          test -s .vitest-reports/blob-1-2.json
          npm run test:coverage:shard -- 2 2
          test -s .vitest-reports/blob-2-2.json
          npm run test:coverage:merge -- .vitest-reports
  full-frontend-tests:
    name: Full Frontend Tests
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready, full-frontend-typechecks, full-frontend-coverage-merge]
    steps:
      - run: echo frontend aggregate
  full-gateway-tests:
    name: Full Gateway Tests
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready]
    steps:
      - run: echo gateway
  full-llm-egress-proxy-tests:
    name: Full LLM Egress Proxy Tests
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready]
    steps:
      - run: echo ai proxy
  full-critical-mutation:
    name: Full Critical Mutation Gate
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready]
    steps:
      - run: echo mutation
  full-browser-e2e-tests:
    name: Full Browser E2E Tests
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready]
    steps:
      - run: echo browser
  full-render-e2e-tests:
    name: Full Render E2E Tests
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready, full-browser-e2e-tests]
    steps:
      - run: echo render
  full-build-check:
    name: Full Build Check
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready]
    steps:
      - run: echo build
  full-test-summary:
    name: Full Test Summary
    if: always()
    runs-on: ubuntu-latest
    needs: [detect-changes, full-lane-ready, full-backend-tests, full-frontend-tests, full-gateway-tests, full-llm-egress-proxy-tests, full-critical-mutation, full-browser-e2e-tests, full-render-e2e-tests, full-build-check]
    steps:
      - run: echo full
`;
}

async function assertBlocksManualFullTestSummaryStatusPost() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs: {}
`,
    (rootDir) => {
      writeFile(
        path.join(rootDir, '.github/workflows/test.yml'),
        `
name: Test Suite
on: pull_request
jobs:
  pr-required-checks:
    name: PR Required Checks
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS -X POST /statuses/head \
            -d '{"context":"Test Suite / Full Test Summary (pull_request)","state":"success"}'
  full-test-summary:
    name: Full Lane Test Summary
    if: always() && github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - run: echo full
`,
      );
    },
  );

  assert.equal(result.findings.length, 0);
  assert.match(
    result.errors.join('\n'),
    /required Full Test Summary pull_request context must be emitted by the real full-test-summary job/,
  );
  assert.match(result.errors.join('\n'), /full-test-summary job must be named "Full Test Summary"/);
  assert.match(result.errors.join('\n'), /must not exclude pull_request events/);
}

async function assertBlocksSkippedAsSuccessfulFullLanePrerequisite() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs: {}
`,
    (rootDir) => {
      writeFile(
        path.join(rootDir, '.github/workflows/test.yml'),
        `
name: Test Suite
on: pull_request
jobs:
  # ============================================
  # Full Lane (pull requests, merge queue, main, nightly, manual)
  # ============================================
  full-frontend-coverage:
    name: Full Frontend Coverage
    if: >-
      always() &&
      needs.full-frontend-typechecks.result != 'failure' &&
      needs.full-frontend-typechecks.result != 'cancelled'
    runs-on: ubuntu-latest
    steps:
      - run: echo coverage
  full-test-summary:
    name: Full Test Summary
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: echo full
`,
      );
    },
  );

  assert.equal(result.findings.length, 0);
  assert.match(
    result.errors.join('\n'),
    /full-lane dependency gates must not treat skipped prerequisites as success/,
  );
}

async function assertBlocksBrowserE2eMatrixFanout() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs: {}
`,
    (rootDir) => {
      writeFile(
        path.join(rootDir, '.github/workflows/test.yml'),
        `
name: Test Suite
on: pull_request
jobs:
  # ============================================
  # Full Lane (pull requests, merge queue, main, nightly, manual)
  # ============================================
  full-browser-e2e-tests:
    name: Full Browser E2E Tests
    strategy:
      matrix:
        group: [admin-auth, wallet-experience]
    runs-on: ubuntu-latest
    steps:
      - run: echo browser
  full-test-summary:
    name: Full Test Summary
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: echo full
`,
      );
    },
  );

  assert.equal(result.findings.length, 0);
  assert.match(
    result.errors.join('\n'),
    /full-browser-e2e-tests must stay sequential/,
  );
}

async function assertBlocksMissingFrontendCoverageShard() {
  const workflow = validTestSuiteWorkflow().replace(
    '          npm run test:coverage:shard -- 2 2\n',
    '',
  );
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs: {}
`,
    (rootDir) => {
      writeFile(path.join(rootDir, '.github/workflows/test.yml'), workflow);
    },
  );

  assert.equal(result.findings.length, 0);
  assert.match(
    result.errors.join('\n'),
    /must run both frontend coverage shards sequentially/,
  );
}

async function assertBlocksCoverageShardSelfDependency() {
  const workflow = validTestSuiteWorkflow().replace(
    /(  full-frontend-coverage-merge:[\s\S]*?    needs: )\[detect-changes, full-lane-ready\]/,
    '$1[detect-changes, full-lane-ready, full-frontend-coverage-merge]',
  );
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs: {}
`,
    (rootDir) => {
      writeFile(path.join(rootDir, '.github/workflows/test.yml'), workflow);
    },
  );

  assert.equal(result.findings.length, 0);
  assert.match(
    result.errors.join('\n'),
    /workflow job "full-frontend-coverage-merge" must not need "full-frontend-coverage-merge"/,
  );
}

async function assertBlocksFalseFullLaneDependency() {
  const workflow = validTestSuiteWorkflow().replace(
    /(  full-gateway-tests:[\s\S]*?    needs: )\[detect-changes, full-lane-ready\]/,
    '$1[detect-changes, full-lane-ready, full-frontend-tests]',
  );
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs: {}
`,
    (rootDir) => {
      writeFile(path.join(rootDir, '.github/workflows/test.yml'), workflow);
    },
  );

  assert.equal(result.findings.length, 0);
  assert.match(
    result.errors.join('\n'),
    /workflow job "full-gateway-tests" must not need "full-frontend-tests"/,
  );
}

async function assertBlocksRenamedTestSuiteWorkflow() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs: {}
`,
    (rootDir) => {
      writeFile(
        path.join(rootDir, '.github/workflows/test.yml'),
        validTestSuiteWorkflow().replace('name: Test Suite', 'name: Tests'),
      );
    },
  );

  assert.equal(result.findings.length, 0);
  assert.match(result.errors.join('\n'), /workflow must be named "Test Suite"/);
}

async function assertBlocksBackendIntegrationMatrix() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs: {}
`,
    (rootDir) => {
      writeFile(
        path.join(rootDir, '.github/workflows/test.yml'),
        validTestSuiteWorkflow().replace(
          '    name: Full Backend Integration Tests\n',
          '    name: Full Backend Integration Tests\n    strategy:\n      matrix:\n        group: [api, flows]\n',
        ),
      );
    },
  );

  assert.equal(result.findings.length, 0);
  assert.match(
    result.errors.join('\n'),
    /full-backend-integration-tests must stay sequential/,
  );
}

async function assertAllowsRealFullTestSummaryGate() {
  const result = await runFixture(
    `
name: Runtime Check
on: pull_request
jobs: {}
`,
    (rootDir) => {
      writeFile(
        path.join(rootDir, '.github/workflows/test.yml'),
        validTestSuiteWorkflow(),
      );
    },
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 0);
}

await assertAllowsModernActions();
await assertBlocksDirectDeprecatedRuntime();
await assertBlocksFloatingForgejoActionRef();
await assertBlocksPinnedForgejoDeprecatedRuntime();
await assertBlocksCompositeNestedDeprecatedRuntime();
await assertBlocksLocalDeprecatedRuntime();
await assertFailsClosedOnMissingManifest();
await assertUsesTrackedManifestRootByDefault();
await assertIgnoresForgejoGithubTokenForRemoteManifestFetches();
await assertBlocksBareRepoRootCiHelperCalls();
await assertAllowsWorkspaceAbsoluteCiHelperCalls();
await assertBlocksManualFullTestSummaryStatusPost();
await assertBlocksSkippedAsSuccessfulFullLanePrerequisite();
await assertBlocksBrowserE2eMatrixFanout();
await assertBlocksMissingFrontendCoverageShard();
await assertBlocksCoverageShardSelfDependency();
await assertBlocksFalseFullLaneDependency();
await assertBlocksRenamedTestSuiteWorkflow();
await assertBlocksBackendIntegrationMatrix();
await assertAllowsRealFullTestSummaryGate();
assertArtifactWrapperContract();
assertVendoredArtifactRuntimeContract();
assertVendoredUploadHiddenFileContract();
console.log('github action runtime guard regression checks passed');
