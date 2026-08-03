import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectDeprecations,
  evaluateInstallLog,
  evaluateInventory,
  packageNameFromLocation,
  parseAllowlist,
  parseNpmInstallLog,
} from '../../scripts/ci/check-npm-deprecations.mjs';

const NOW = new Date('2026-08-02T12:00:00.000Z');

function entry(overrides = {}) {
  return {
    id: 'fixture-warning',
    package: 'old-package',
    version: '1.2.3',
    lockfile: 'package-lock.json',
    locations: ['node_modules/old-package'],
    message: 'Use the maintained package instead.',
    owner: 'fixture maintainers',
    directOwners: ['root:direct-owner@4.5.6'],
    dependencyPaths: ['root > direct-owner@4.5.6 > old-package@1.2.3'],
    rationale: 'The fixture owner has not published a compatible replacement.',
    upstreamIssue: 'https://example.com/upstream/issues/1',
    reviewOn: '2026-08-31',
    ...overrides,
  };
}

function parsed(entries = [entry()], now = NOW) {
  return parseAllowlist({ schemaVersion: 1, entries }, now);
}

function lock(packages = {}) {
  return {
    name: 'fixture',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture' },
      'node_modules/old-package': {
        version: '1.2.3',
        deprecated: 'Use the maintained package instead.',
      },
      ...packages,
    },
  };
}

function records(packageLock = lock(), lockfile = 'package-lock.json') {
  return collectDeprecations(packageLock, lockfile);
}

test('accepts exact lockfile-backed deprecations and scoped package names', () => {
  assert.doesNotThrow(() => evaluateInventory(records(), parsed()));
  assert.equal(packageNameFromLocation('node_modules/@scope/name'), '@scope/name');
  assert.equal(packageNameFromLocation('node_modules/owner/node_modules/@scope/name'), '@scope/name');
  assert.equal(packageNameFromLocation('node_modules/owner/node_modules/plain'), 'plain');
});

test('rejects unknown deprecations and stale allowlist locations', () => {
  const unknownLock = lock({
    'node_modules/new-warning': { version: '2.0.0', deprecated: 'New warning.' },
  });
  assert.throws(() => evaluateInventory(records(unknownLock), parsed()), /unapproved npm deprecation.*new-warning/);
  assert.throws(() => evaluateInventory([], parsed()), /unused npm deprecation allowlist entries/);
});

test('rejects package, version, and message drift', () => {
  assert.throws(
    () => evaluateInventory(records(), parsed([entry({ package: 'renamed-package' })])),
    /package drift/,
  );
  assert.throws(
    () => evaluateInventory(records(), parsed([entry({ version: '1.2.4' })])),
    /version drift/,
  );
  assert.throws(
    () => evaluateInventory(records(), parsed([entry({ message: 'Changed warning.' })])),
    /message drift/,
  );
});

test('tracks the same package version at multiple exact locations', () => {
  const nestedLocation = 'node_modules/owner/node_modules/old-package';
  const packageLock = lock({
    [nestedLocation]: { version: '1.2.3', deprecated: 'Use the maintained package instead.' },
  });
  const allowlist = parsed([entry({
    locations: ['node_modules/old-package', nestedLocation],
    dependencyPaths: [
      'root > old-package@1.2.3',
      'root > owner@1.0.0 > old-package@1.2.3',
    ],
  })]);
  assert.doesNotThrow(() => evaluateInventory(records(packageLock), allowlist));
});

test('enforces review dates in UTC with a ninety-day ceiling', () => {
  assert.doesNotThrow(() => parsed([entry({ reviewOn: '2026-08-02' })], new Date('2026-08-02T23:59:59Z')));
  assert.throws(
    () => parsed([entry({ reviewOn: '2026-08-02' })], new Date('2026-08-03T00:00:00Z')),
    /expired/,
  );
  assert.throws(() => parsed([entry({ reviewOn: '2026-02-30' })]), /valid calendar date/);
  assert.throws(() => parsed([entry({ reviewOn: '2026-11-01' })]), /more than 90 days/);
});

test('rejects malformed configs, entries, and duplicate identities', () => {
  assert.throws(() => parseAllowlist('{', NOW), /not valid JSON/);
  assert.throws(() => parseAllowlist({ schemaVersion: 2, entries: [] }, NOW), /unsupported/);
  assert.throws(() => parsed([entry({ extra: true })]), /unsupported fields/);
  assert.throws(() => parsed([entry(), entry({ id: 'duplicate-id' })]), /duplicate allowlist location/);
  assert.throws(() => parsed([entry(), entry({ id: 'fixture-warning', locations: ['node_modules/other'] })]), /duplicate allowlist id/);
  assert.throws(() => parsed([entry({ upstreamIssue: 'http://example.com/1' })]), /must use HTTPS/);
  assert.throws(() => parsed([entry({ locations: [] })]), /at least one string/);
  assert.throws(() => parsed([entry({ dependencyPaths: ['same', 'same'] })]), /contains duplicates/);
});

test('rejects malformed lockfiles and deprecated records', () => {
  assert.throws(() => records({ lockfileVersion: 2, packages: {} }), /package-lock v3/);
  assert.throws(
    () => records(lock({ 'node_modules/bad': { version: '1.0.0', deprecated: '' } })),
    /deprecated must be a non-empty/,
  );
  assert.throws(
    () => records(lock({ 'node_modules/bad': { deprecated: 'Old.' } })),
    /version must be a non-empty/,
  );
});

test('matches the exact clean npm install warning multiset', () => {
  const output = [
    'npm warn deprecated old-package@1.2.3: Use the maintained package instead.',
    'added 10 packages in 1s',
  ].join('\n');
  assert.deepEqual(parseNpmInstallLog(output), [{
    package: 'old-package',
    version: '1.2.3',
    message: 'Use the maintained package instead.',
  }]);
  assert.doesNotThrow(() => evaluateInstallLog(records(), output));
  assert.throws(() => evaluateInstallLog(records(), ''), /expected 1, found 0/);
  assert.throws(
    () => evaluateInstallLog(records(), output.replace('1.2.3', '1.2.4')),
    /clean npm install deprecation drift/,
  );
});
