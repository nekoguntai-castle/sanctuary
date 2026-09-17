import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const sourceScript = resolve('scripts/bump-funds-critical.sh');

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const WIDGET_OLD_INTEGRITY = 'sha512-d2lkZ2V0LWxpYi0xLjAuMA==';
const WIDGET_NEW_INTEGRITY = 'sha512-d2lkZ2V0LWxpYi0xLjAuMQ==';
const GADGET_OLD_INTEGRITY = 'sha512-Z2FkZ2V0LWxpYi0yLjAuMA==';
const GADGET_NEW_INTEGRITY = 'sha512-Z2FkZ2V0LWxpYi0yLjAuMQ==';

function git(repo, args) {
  const result = spawnSync('git', [
    '-c', 'user.name=Sanctuary Test',
    '-c', 'user.email=sanctuary-test@example.invalid',
    ...args,
  ], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function createFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'sanctuary-bump-funds-critical-'));
  mkdirSync(join(repo, 'config'), { recursive: true });
  mkdirSync(join(repo, 'docs/reference/generated'), { recursive: true });
  mkdirSync(join(repo, 'scripts'), { recursive: true });

  writeJson(join(repo, 'config/ci-toolchain-lock.json'), {
    schemaVersion: 1,
    fundsCriticalPackages: [
      {
        name: 'widget-lib',
        version: '1.0.0',
        integrity: WIDGET_OLD_INTEGRITY,
        manifests: ['package.json'],
        lockfiles: ['package-lock.json'],
      },
      {
        name: 'gadget-lib',
        version: '2.0.0',
        integrity: GADGET_OLD_INTEGRITY,
        manifests: ['package.json'],
        lockfiles: ['package-lock.json'],
      },
    ],
  });
  writeJson(join(repo, 'config/signing-dependency-scope.json'), {
    schemaVersion: 1,
    exactPackageNames: ['widget-lib'],
    packageNamePrefixes: ['@scoped-prefix/'],
  });
  writeJson(join(repo, 'package.json'), {
    name: 'fixture',
    version: '1.0.0',
    dependencies: { 'widget-lib': '1.0.0', 'gadget-lib': '2.0.0' },
  });
  writeJson(join(repo, 'package-lock.json'), {
    name: 'fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture', version: '1.0.0' },
      'node_modules/widget-lib': { version: '1.0.0', resolved: 'https://registry.example/widget-lib', integrity: WIDGET_OLD_INTEGRITY },
      'node_modules/gadget-lib': { version: '2.0.0', resolved: 'https://registry.example/gadget-lib', integrity: GADGET_OLD_INTEGRITY },
    },
  });
  writeJson(join(repo, 'docs/reference/generated/hardware-wallet-compatibility.json'), {
    schemaVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    rows: ['canonical'],
  });
  writeFileSync(join(repo, 'docs/reference/generated/hardware-wallet-compatibility.md'), '# Hardware evidence\n');

  const script = readFileSync(sourceScript, 'utf8');
  writeFileSync(join(repo, 'scripts/bump-funds-critical.sh'), script);
  chmodSync(join(repo, 'scripts/bump-funds-critical.sh'), 0o755);

  const registry = {
    'widget-lib@1.0.0': WIDGET_OLD_INTEGRITY,
    'widget-lib@1.0.1': WIDGET_NEW_INTEGRITY,
    'gadget-lib@2.0.0': GADGET_OLD_INTEGRITY,
    'gadget-lib@2.1.0': GADGET_NEW_INTEGRITY,
  };
  const npmStub = join(repo, 'stub-npm.mjs');
  writeFileSync(npmStub, `#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const REGISTRY = ${JSON.stringify(registry)};
const [, , command, ...rest] = process.argv;
const logPath = process.env.STUB_NPM_LOG;
if (logPath) appendFileSync(logPath, \`\${command} \${rest.join(' ')} | cwd=\${process.cwd()}\\n\`);
if (command === 'view') {
  const spec = rest[0];
  if (!(spec in REGISTRY)) { process.exit(1); }
  process.stdout.write(REGISTRY[spec] + '\\n');
  process.exit(0);
}
if (command === 'install') {
  // Like real npm with no package spec: resolve from the already-edited manifest.
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const declared = { ...manifest.devDependencies, ...manifest.dependencies, ...manifest.overrides };
  const lockPath = join(process.cwd(), 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  for (const [name, version] of Object.entries(declared)) {
    const spec = \`\${name}@\${version}\`;
    if (!(spec in REGISTRY)) continue;
    lock.packages[\`node_modules/\${name}\`] = { version, resolved: \`https://registry.example/\${name}\`, integrity: REGISTRY[spec] };
  }
  if (process.env.STUB_NPM_TOUCH_EXTRA === '1') {
    lock.packages['node_modules/gadget-lib'] = { version: '9.9.9', resolved: 'https://registry.example/gadget-lib', integrity: 'sha512-dHJhc2hlZA==' };
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\\n');
  process.exit(0);
}
process.exit(1);
`);
  chmodSync(npmStub, 0o755);

  const reportStub = join(repo, 'stub-report.mjs');
  writeFileSync(reportStub, `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
if (process.env.STUB_REPORT_LOG) appendFileSync(process.env.STUB_REPORT_LOG, 'called\\n');
const value = (flag) => process.argv[process.argv.indexOf(flag) + 1];
writeFileSync(value('--json'), JSON.stringify({ schemaVersion: 1, generatedAt: value('--as-of'), rows: ['repinned'] }, null, 2) + '\\n');
writeFileSync(value('--markdown'), '# Hardware evidence (repinned)\\n');
`);
  chmodSync(reportStub, 0o755);

  const gateStub = join(repo, 'stub-gate.mjs');
  writeFileSync(gateStub, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
if (process.env.STUB_GATE_LOG) appendFileSync(process.env.STUB_GATE_LOG, 'called\\n');
if (process.env.STUB_GATE_FAIL === '1') { console.error('gate stub: forced failure'); process.exit(7); }
`);
  chmodSync(gateStub, 0o755);

  git(repo, ['init', '--quiet']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'fixture']);

  return { repo, npmStub, reportStub, gateStub };
}

function run(fixture, args, extraEnv = {}) {
  const reportLog = join(fixture.repo, 'report.log');
  const gateLog = join(fixture.repo, 'gate.log');
  const npmLog = join(fixture.repo, 'npm.log');
  return {
    result: spawnSync('bash', ['scripts/bump-funds-critical.sh', ...args], {
      cwd: fixture.repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        SANCTUARY_BUMP_NPM_BIN: fixture.npmStub,
        SANCTUARY_BUMP_REPORT_BIN: fixture.reportStub,
        SANCTUARY_BUMP_GATE_BIN: fixture.gateStub,
        STUB_NPM_LOG: npmLog,
        STUB_REPORT_LOG: reportLog,
        STUB_GATE_LOG: gateLog,
        ...extraEnv,
      },
    }),
    reportLog,
    gateLog,
    npmLog,
  };
}

function cleanup(fixture) {
  rmSync(fixture.repo, { recursive: true, force: true });
}

const snapshot = (repo) => ({
  packageJson: readFileSync(join(repo, 'package.json'), 'utf8'),
  packageLock: readFileSync(join(repo, 'package-lock.json'), 'utf8'),
  lockConfig: readFileSync(join(repo, 'config/ci-toolchain-lock.json'), 'utf8'),
});

test('rejects an unknown package with the valid list', () => {
  const fixture = createFixture();
  try {
    const { result } = run(fixture, ['not-a-real-package', '1.0.0']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown funds-critical package: not-a-real-package/);
    assert.match(result.stderr, /widget-lib/);
  } finally { cleanup(fixture); }
});

test('rejects a version that does not exist on the registry', () => {
  const fixture = createFixture();
  try {
    const { result } = run(fixture, ['widget-lib', '9.9.9']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not exist on the registry/);
  } finally { cleanup(fixture); }
});

test('refuses a dirty working tree unless --allow-dirty', () => {
  const fixture = createFixture();
  try {
    writeFileSync(join(fixture.repo, 'README-uncommitted.md'), 'dirty\n');
    const { result } = run(fixture, ['widget-lib', '1.0.1']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /working tree is dirty/);
  } finally { cleanup(fixture); }
});

test('--allow-dirty proceeds despite an unrelated uncommitted file', () => {
  const fixture = createFixture();
  try {
    writeFileSync(join(fixture.repo, 'README-uncommitted.md'), 'dirty\n');
    const { result } = run(fixture, ['widget-lib', '1.0.1', '--allow-dirty']);
    assert.equal(result.status, 0, result.stderr);
  } finally { cleanup(fixture); }
});

test('--dry-run reports the plan and changes nothing', () => {
  const fixture = createFixture();
  try {
    const before = snapshot(fixture.repo);
    const { result, npmLog, reportLog, gateLog } = run(fixture, ['widget-lib', '1.0.1', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[dry-run\] Would bump widget-lib: 1\.0\.0 -> 1\.0\.1/);
    assert.deepEqual(snapshot(fixture.repo), before);
    // Dry-run still validates the registry (to detect a no-op and a
    // nonexistent version) but must never call npm install/report/gate.
    assert.doesNotMatch(readFileSync(npmLog, 'utf8'), /^install/m);
    assert.equal(existsSync(reportLog), false);
    assert.equal(existsSync(gateLog), false);
  } finally { cleanup(fixture); }
});

test('a no-op bump to the currently pinned version changes nothing even without --dry-run', () => {
  const fixture = createFixture();
  try {
    const before = snapshot(fixture.repo);
    const { result } = run(fixture, ['widget-lib', '1.0.0']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /already at 1\.0\.0/);
    assert.deepEqual(snapshot(fixture.repo), before);
  } finally { cleanup(fixture); }
});

test('happy path updates every manifest, lockfile, and the lock config, and runs the gate', () => {
  const fixture = createFixture();
  try {
    const { result, npmLog, gateLog } = run(fixture, ['widget-lib', '1.0.1']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readJson(join(fixture.repo, 'package.json')).dependencies['widget-lib'], '1.0.1');
    const lock = readJson(join(fixture.repo, 'package-lock.json'));
    assert.equal(lock.packages['node_modules/widget-lib'].version, '1.0.1');
    assert.equal(lock.packages['node_modules/widget-lib'].integrity, WIDGET_NEW_INTEGRITY);
    const policy = readJson(join(fixture.repo, 'config/ci-toolchain-lock.json'))
      .fundsCriticalPackages.find((p) => p.name === 'widget-lib');
    assert.equal(policy.version, '1.0.1');
    assert.equal(policy.integrity, WIDGET_NEW_INTEGRITY);
    // npm must resolve from the edited manifest: passing `<pkg>@<ver>` makes real
    // npm rewrite the exact pin to a caret range, which the gate then rejects.
    assert.match(readFileSync(npmLog, 'utf8'), /^install --package-lock-only /m);
    assert.doesNotMatch(readFileSync(npmLog, 'utf8'), /^install \S*widget-lib@/m);
    assert.equal(existsSync(gateLog), true);
  } finally { cleanup(fixture); }
});

test('lockfile-sprawl assertion fires when the lockfile update touches another package', () => {
  const fixture = createFixture();
  try {
    const { result } = run(fixture, ['widget-lib', '1.0.1'], { STUB_NPM_TOUCH_EXTRA: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /gadget-lib/);
    assert.match(result.stderr, /leaving the tree for inspection/);
    // Manifest edits happen before the lockfile step, so the tree is left
    // exactly as the failure found it rather than rolled back.
    assert.equal(readJson(join(fixture.repo, 'package.json')).dependencies['widget-lib'], '1.0.1');
  } finally { cleanup(fixture); }
});

test('errors when a listed manifest no longer declares the package', () => {
  const fixture = createFixture();
  try {
    const manifestPath = join(fixture.repo, 'package.json');
    const manifest = readJson(manifestPath);
    delete manifest.dependencies['widget-lib'];
    writeJson(manifestPath, manifest);
    git(fixture.repo, ['add', '-A']);
    git(fixture.repo, ['commit', '--quiet', '-m', 'drop declaration']);
    const { result } = run(fixture, ['widget-lib', '1.0.1']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package\.json does not declare widget-lib/);
  } finally { cleanup(fixture); }
});

test('re-pins the hardware compatibility statement only for a scoped package', () => {
  const fixture = createFixture();
  try {
    const scoped = run(fixture, ['widget-lib', '1.0.1']);
    assert.equal(scoped.result.status, 0, scoped.result.stderr);
    assert.equal(existsSync(scoped.reportLog), true);
    assert.match(readFileSync(join(fixture.repo, 'docs/reference/generated/hardware-wallet-compatibility.md'), 'utf8'), /repinned/);
  } finally { cleanup(fixture); }
});

test('does not re-pin the hardware compatibility statement for an unscoped package', () => {
  const fixture = createFixture();
  try {
    const unscoped = run(fixture, ['gadget-lib', '2.1.0']);
    assert.equal(unscoped.result.status, 0, unscoped.result.stderr);
    assert.equal(existsSync(unscoped.reportLog), false);
  } finally { cleanup(fixture); }
});

test('a failing supply-chain gate propagates a non-zero exit', () => {
  const fixture = createFixture();
  try {
    const { result } = run(fixture, ['widget-lib', '1.0.1'], { STUB_GATE_FAIL: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forced failure/);
    // The bump itself already landed; only the gate failed.
    assert.equal(readJson(join(fixture.repo, 'package.json')).dependencies['widget-lib'], '1.0.1');
  } finally { cleanup(fixture); }
});

test('--help prints usage and exits zero without touching the tree', () => {
  const fixture = createFixture();
  try {
    const before = snapshot(fixture.repo);
    const { result } = run(fixture, ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: scripts\/bump-funds-critical\.sh/);
    assert.deepEqual(snapshot(fixture.repo), before);
  } finally { cleanup(fixture); }
});
