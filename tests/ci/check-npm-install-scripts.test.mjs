import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import {
  collectInstallScripts,
  evaluateAllowScripts,
  evaluateInventory,
  expectedAllowScripts,
  packageNameFromLocation,
  parsePolicy,
  verifyInstalledPackages,
} from '../../scripts/ci/check-npm-install-scripts.mjs';

const NOW = new Date('2026-08-03T12:00:00.000Z');

function entry(overrides = {}) {
  return {
    location: 'node_modules/build-tool',
    package: 'build-tool',
    version: '1.2.3',
    scripts: { postinstall: 'node install.js' },
    allowed: true,
    optional: false,
    owner: 'Fixture maintainers',
    rationale: 'The fixture requires its platform-specific binary.',
    reviewOn: '2026-08-31',
    ...overrides,
  };
}

function parsed(entries = [entry()], now = NOW) {
  return parsePolicy({ schemaVersion: 1, entries }, now);
}

function lock(packages = {}) {
  return {
    name: 'fixture',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture' },
      'node_modules/build-tool': { version: '1.2.3', hasInstallScript: true },
      ...packages,
    },
  };
}

function records(packageLock = lock()) {
  return collectInstallScripts(packageLock);
}

function installedFixture(packageJson) {
  const root = mkdtempSync(join(tmpdir(), 'sanctuary-install-script-policy-'));
  const packageDir = join(root, 'node_modules', 'build-tool');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(packageJson)}\n`);
  return root;
}

test('accepts an exact lockfile inventory and derives nested package names', () => {
  assert.doesNotThrow(() => evaluateInventory(records(), parsed()));
  assert.equal(packageNameFromLocation('node_modules/@scope/name'), '@scope/name');
  assert.equal(packageNameFromLocation('node_modules/owner/node_modules/@scope/name'), '@scope/name');
  assert.equal(packageNameFromLocation('node_modules/owner/node_modules/plain'), 'plain');
});

test('rejects unknown and stale lockfile locations', () => {
  const withUnknown = lock({
    'node_modules/unknown': { version: '2.0.0', hasInstallScript: true },
  });
  assert.throws(() => evaluateInventory(records(withUnknown), parsed()), /unapproved npm install script.*unknown/);
  assert.throws(() => evaluateInventory([], parsed()), /stale npm install-script policy locations/);
});

test('rejects package, version, and optionality drift', () => {
  assert.throws(() => evaluateInventory(records(), parsed([entry({ package: 'renamed' })])), /package drift/);
  assert.throws(() => evaluateInventory(records(), parsed([entry({ version: '1.2.4' })])), /version drift/);
  assert.throws(() => evaluateInventory(records(), parsed([entry({ optional: true })])), /optional drift/);
});

test('generates pinned approvals and unpinned denials', () => {
  const entries = parsed([
    entry(),
    entry({ location: 'node_modules/denied', package: 'denied', allowed: false }),
  ]);
  assert.deepEqual(expectedAllowScripts(entries), {
    'build-tool@1.2.3': true,
    denied: false,
  });
  assert.doesNotThrow(() => evaluateAllowScripts({ 'build-tool@1.2.3': true, denied: false }, entries));
});

test('rejects missing, unknown, incorrectly pinned, and wrong-valued allowScripts entries', () => {
  const entries = parsed();
  assert.throws(() => evaluateAllowScripts({}, entries), /missing entries/);
  assert.throws(() => evaluateAllowScripts({ 'build-tool@1.2.3': true, surprise: false }, entries), /unapproved entries/);
  assert.throws(() => evaluateAllowScripts({ 'build-tool': true }, entries), /missing entries/);
  assert.throws(() => evaluateAllowScripts({ 'build-tool@1.2.3': false }, entries), /value drift/);
});

test('rejects duplicate locations and malformed policies', () => {
  assert.throws(() => parsePolicy('{', NOW), /not valid JSON/);
  assert.throws(() => parsePolicy({ schemaVersion: 2, entries: [] }, NOW), /unsupported policy schema/);
  assert.throws(() => parsed([entry({ extra: true })]), /unsupported fields/);
  assert.throws(() => parsed([entry(), entry({ package: 'duplicate' })]), /duplicate policy location/);
  assert.throws(() => parsed([entry({ scripts: {} })]), /at least one lifecycle command/);
  assert.throws(() => parsed([entry({ scripts: { prepare: 'node prepare.js' } })]), /unsupported lifecycle/);
});

test('enforces strict review dates with a ninety-day ceiling', () => {
  assert.doesNotThrow(() => parsed([entry({ reviewOn: '2026-08-03' })], new Date('2026-08-03T23:59:59Z')));
  assert.throws(() => parsed([entry({ reviewOn: '2026-08-03' })], new Date('2026-08-04T00:00:00Z')), /expired/);
  assert.throws(() => parsed([entry({ reviewOn: '2026-02-30' })]), /valid calendar date/);
  assert.throws(() => parsed([entry({ reviewOn: '2026-11-02' })]), /more than 90 days/);
});

test('rejects malformed lockfiles and install-script records without versions', () => {
  assert.throws(() => records({ lockfileVersion: 2, packages: {} }), /package-lock v3/);
  assert.throws(
    () => records(lock({ 'node_modules/bad': { hasInstallScript: true } })),
    /bad.version must be a non-empty/,
  );
});

test('verifies installed lifecycle commands exactly', () => {
  const root = installedFixture({
    name: 'build-tool',
    version: '1.2.3',
    scripts: { postinstall: 'node install.js' },
  });
  assert.doesNotThrow(() => verifyInstalledPackages(parsed(), root));

  const driftRoot = installedFixture({
    name: 'build-tool',
    version: '1.2.3',
    scripts: { postinstall: 'node changed.js' },
  });
  assert.throws(() => verifyInstalledPackages(parsed(), driftRoot), /lifecycle command drift/);
});

test('allows missing optional installs but rejects missing required packages', () => {
  const root = mkdtempSync(join(tmpdir(), 'sanctuary-install-script-policy-missing-'));
  assert.doesNotThrow(() => verifyInstalledPackages(parsed([entry({ optional: true })]), root));
  assert.throws(() => verifyInstalledPackages(parsed(), root), /unable to read installed/);
});

test('strict npm policy prevents an unknown lifecycle script from executing', () => {
  const root = mkdtempSync(join(tmpdir(), 'sanctuary-strict-install-script-'));
  const dependency = join(root, 'dependency');
  const marker = join(root, 'unexpected-script-ran');
  mkdirSync(dependency);
  writeFileSync(join(dependency, 'package.json'), `${JSON.stringify({
    name: 'unknown-lifecycle-package',
    version: '1.0.0',
    scripts: { postinstall: `node -e "require('fs').writeFileSync('${marker}', 'ran')"` },
  })}\n`);
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({
    name: 'strict-policy-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { 'unknown-lifecycle-package': 'file:./dependency' },
    allowScripts: {},
  })}\n`);

  const lock = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--audit=false', '--fund=false'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(lock.status, 0, lock.stderr || lock.stdout);

  const install = spawnSync('npm', ['ci', '--strict-allow-scripts', '--audit=false', '--fund=false'], {
    cwd: root,
    encoding: 'utf8',
  });
  // npm ci --strict-allow-scripts may reject with ESTRICTALLOWSCRIPTS or complete the
  // install while suppressing every lifecycle script that is absent from
  // allowScripts. Both behaviors fail closed; arbitrary install failures do not.
  if (install.status !== 0) {
    assert.match(`${install.stdout}\n${install.stderr}`, /ESTRICTALLOWSCRIPTS/);
  }
  assert.equal(existsSync(marker), false, 'unknown lifecycle script must not execute');
});
