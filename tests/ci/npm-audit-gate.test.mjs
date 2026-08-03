import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_TARGETS,
  evaluateReports,
  findLockPaths,
  parseExceptionConfig,
  runAuditTarget,
} from '../../scripts/ci/npm-audit-gate.mjs';

test('default audit targets keep the standalone docs site at its canonical path', () => {
  assert.deepEqual(
    DEFAULT_TARGETS.find(({ label }) => label === 'docs-site'),
    {
      label: 'docs-site',
      cwd: 'docs/site',
      lockfile: 'docs/site/package-lock.json',
      roots: [''],
      args: ['audit', '--json'],
    },
  );
  assert.equal(DEFAULT_TARGETS.some(({ label, cwd }) => label === 'website' || cwd === 'website'), false);
});

const NOW = new Date('2026-07-30T18:00:00.000Z');
const GHSA_A = 'GHSA-mh99-v99m-4gvg';
const GHSA_B = 'GHSA-qwww-vcr4-c8h2';

function advisory(ghsa = GHSA_A, severity = 'high') {
  return {
    source: 123,
    name: 'leaf',
    dependency: 'leaf',
    title: 'fixture advisory',
    url: `https://github.com/advisories/${ghsa}`,
    severity,
    range: '<2.0.0',
  };
}

function vulnerability({ severity = 'high', via = [advisory()], nodes = ['node_modules/leaf'] } = {}) {
  return { name: 'leaf', severity, isDirect: false, via, effects: [], range: '*', nodes, fixAvailable: false };
}

function report(vulnerabilities = { leaf: vulnerability() }) {
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
  };
}

function lock(packages = {}) {
  return {
    name: 'fixture',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture', dependencies: { leaf: '1.0.0' } },
      'node_modules/leaf': { version: '1.0.0' },
      ...packages,
    },
  };
}

function target(overrides = {}) {
  return {
    label: 'fixture',
    cwd: '.',
    lockfile: 'package-lock.json',
    roots: [''],
    args: ['audit', '--json'],
    ...overrides,
  };
}

function exception(overrides = {}) {
  return {
    id: 'fixture-exception',
    ghsa: GHSA_A,
    package: 'leaf',
    version: '1.0.0',
    lockfile: 'package-lock.json',
    paths: [['.', 'node_modules/leaf']],
    owner: 'security@example.com',
    rationale: 'Fixture path has controlled input.',
    trackingUrl: `https://github.com/advisories/${GHSA_A}`,
    runtimeSurface: 'test fixture',
    expiresOn: '2026-08-29',
    ...overrides,
  };
}

function parsedExceptions(entries = [exception()], now = NOW) {
  return parseExceptionConfig({ schemaVersion: 1, exceptions: entries }, now);
}

function evaluate({ audit = report(), packageLock = lock(), entries = [exception()], targets = [target()] } = {}) {
  const reports = new Map(targets.map((item) => [item.label, audit]));
  const locks = new Map(targets.map((item) => [item.lockfile, packageLock]));
  return evaluateReports({ reports, targets, locks, exceptions: parsedExceptions(entries) });
}

test('accepts an exact advisory, version, lockfile, and lock-backed path', () => {
  assert.doesNotThrow(() => evaluate());
});

test('rejects an unknown high advisory and an exact path mismatch', () => {
  assert.throws(
    () => evaluate({ audit: report({ leaf: vulnerability({ via: [advisory(GHSA_B)] }) }) }),
    /unapproved high advisory GHSA-qwww-vcr4-c8h2/,
  );
  assert.throws(() => evaluate({ entries: [exception({ paths: [['.', 'node_modules/other']] })] }), /unapproved high advisory/);
});

test('requires every reachable high leaf in a mixed via graph', () => {
  const vulnerabilities = {
    parent: vulnerability({ via: ['leaf-a', 'leaf-b'], nodes: ['node_modules/parent'] }),
    'leaf-a': vulnerability({ via: [advisory(GHSA_A)], nodes: ['node_modules/leaf-a'] }),
    'leaf-b': vulnerability({ via: [advisory(GHSA_B)], nodes: ['node_modules/leaf-b'] }),
  };
  const packageLock = lock({
    '': { dependencies: { 'leaf-a': '1.0.0', 'leaf-b': '1.0.0', parent: '1.0.0' } },
    'node_modules/leaf-a': { version: '1.0.0' },
    'node_modules/leaf-b': { version: '1.0.0' },
    'node_modules/parent': { version: '1.0.0', dependencies: { 'leaf-a': '1.0.0', 'leaf-b': '1.0.0' } },
  });
  assert.throws(
    () => evaluate({
      audit: report(vulnerabilities),
      packageLock,
      entries: [exception({
        package: 'leaf-a',
        paths: [
          ['.', 'node_modules/leaf-a'],
          ['.', 'node_modules/parent', 'node_modules/leaf-a'],
        ],
      })],
    }),
    /GHSA-qwww-vcr4-c8h2/,
  );
});

test('rejects missing nodes, cycles, and unclassified high findings', () => {
  assert.throws(
    () => evaluate({ audit: report({ leaf: vulnerability({ severity: 'unknown' }) }) }),
    /unknown severity/,
  );
  assert.throws(
    () => evaluate({ audit: report({ parent: vulnerability({ via: ['missing'] }) }) }),
    /references missing node/,
  );
  assert.throws(
    () => evaluate({
      audit: report({
        first: vulnerability({ via: ['second'] }),
        second: vulnerability({ via: ['first'] }),
      }),
    }),
    /leafless or partially classified component/,
  );
  assert.throws(
    () => evaluate({ audit: report({ leaf: vulnerability({ via: [advisory(GHSA_A, 'moderate')] }) }) }),
    /no classified high advisory leaf/,
  );
});

test('accepts a cyclic carrier component that resolves to an approved high leaf', () => {
  const vulnerabilities = {
    first: vulnerability({ via: ['second', advisory()], nodes: ['node_modules/first'] }),
    second: vulnerability({ via: ['first'], nodes: ['node_modules/second'] }),
  };
  const packageLock = lock({
    '': { dependencies: { first: '1.0.0', second: '1.0.0' } },
    'node_modules/first': { version: '1.0.0' },
    'node_modules/second': { version: '1.0.0' },
  });
  const entries = [exception({
    package: 'first',
    paths: [['.', 'node_modules/first']],
  })];
  assert.doesNotThrow(() => evaluate({ audit: report(vulnerabilities), packageLock, entries }));
});

test('rejects a partially classified cycle with a reachable leafless component', () => {
  const vulnerabilities = {
    first: vulnerability({ via: ['second', advisory()], nodes: ['node_modules/first'] }),
    second: vulnerability({ via: ['first', 'leafless-a'], nodes: ['node_modules/second'] }),
    'leafless-a': vulnerability({ via: ['leafless-b'], nodes: ['node_modules/leafless-a'] }),
    'leafless-b': vulnerability({ via: ['leafless-a'], nodes: ['node_modules/leafless-b'] }),
  };
  const packageLock = lock({
    '': { dependencies: { first: '1.0.0', second: '1.0.0', 'leafless-a': '1.0.0', 'leafless-b': '1.0.0' } },
    'node_modules/first': { version: '1.0.0' },
    'node_modules/second': { version: '1.0.0' },
    'node_modules/leafless-a': { version: '1.0.0' },
    'node_modules/leafless-b': { version: '1.0.0' },
  });
  const entries = [exception({
    package: 'first',
    paths: [['.', 'node_modules/first']],
  })];
  assert.throws(
    () => evaluate({ audit: report(vulnerabilities), packageLock, entries }),
    /leafless or partially classified component: leafless-a, leafless-b/,
  );
});

test('critical findings can never be excepted, including severity escalation', () => {
  assert.throws(
    () => evaluate({ audit: report({ leaf: vulnerability({ severity: 'critical', via: [advisory(GHSA_A, 'critical')] }) }) }),
    /critical (?:vulnerability|advisory)/,
  );
  assert.throws(
    () => evaluate({ audit: report({ leaf: vulnerability({ via: [advisory(GHSA_A, 'critical')] }) }) }),
    /critical advisory/,
  );
});

test('rejects a critical advisory object carried by a moderate vulnerability entry', () => {
  const moderateCarrier = vulnerability({
    severity: 'moderate',
    via: [advisory(GHSA_A, 'critical')],
  });
  assert.throws(
    () => evaluate({ audit: report({ leaf: moderateCarrier }), entries: [] }),
    /critical advisory affecting leaf cannot be excepted/,
  );
});

test('rejects version mismatches and unreachable audited nodes', () => {
  assert.throws(() => evaluate({ entries: [exception({ version: '1.0.1' })] }), /unapproved high advisory/);
  assert.throws(
    () => evaluate({
      packageLock: lock({
        '': { dependencies: { other: '1.0.0' } },
        'node_modules/other': { version: '1.0.0' },
      }),
    }),
    /unreachable from declared audit roots/,
  );
  assert.throws(
    () => evaluate({
      audit: report({ leaf: vulnerability({ nodes: ['node_modules/not-leaf'] }) }),
      packageLock: lock({ 'node_modules/not-leaf': { version: '1.0.0' } }),
    }),
    /does not match package leaf/,
  );
});

test('lock graph distinguishes duplicate versions and all root paths', () => {
  const packageLock = lock({
    '': { dependencies: { a: '1.0.0', b: '1.0.0' } },
    'node_modules/a': { version: '1.0.0', dependencies: { leaf: '1.0.0' } },
    'node_modules/b': { version: '1.0.0', dependencies: { leaf: '2.0.0' } },
    'node_modules/a/node_modules/leaf': { version: '1.0.0' },
    'node_modules/b/node_modules/leaf': { version: '2.0.0' },
  });
  assert.deepEqual(findLockPaths(packageLock, [''], 'node_modules/a/node_modules/leaf'), [
    ['.', 'node_modules/a', 'node_modules/a/node_modules/leaf'],
  ]);
  const audit = report({
    leaf: vulnerability({ nodes: ['node_modules/a/node_modules/leaf', 'node_modules/b/node_modules/leaf'] }),
  });
  assert.throws(
    () => evaluate({
      audit,
      packageLock,
      entries: [exception({ paths: [['.', 'node_modules/a', 'node_modules/a/node_modules/leaf']] })],
    }),
    /leaf@2.0.0/,
  );
});

test('shared advisory subgraphs can reuse an exact exception without becoming unused', () => {
  const vulnerabilities = {
    parentA: vulnerability({ via: ['leaf'], nodes: ['node_modules/parent-a'] }),
    parentB: vulnerability({ via: ['leaf'], nodes: ['node_modules/parent-b'] }),
    leaf: vulnerability(),
  };
  assert.doesNotThrow(() => evaluate({ audit: report(vulnerabilities) }));
});

test('global unused validation occurs after all target reports', () => {
  assert.throws(
    () => evaluate({ audit: report({}), entries: [exception()] }),
    /unused audit exceptions: fixture-exception/,
  );
  const targets = [
    target({ label: 'clean', lockfile: 'clean/package-lock.json' }),
    target({ label: 'affected' }),
  ];
  const reports = new Map([
    ['clean', report({})],
    ['affected', report()],
  ]);
  const locks = new Map([
    ['clean/package-lock.json', lock()],
    ['package-lock.json', lock()],
  ]);
  assert.doesNotThrow(() => evaluateReports({ reports, targets, locks, exceptions: parsedExceptions() }));
});

test('expiry is valid through its UTC date and invalid the following day', () => {
  assert.doesNotThrow(() => parsedExceptions([exception({ expiresOn: '2026-07-30' })], new Date('2026-07-30T23:59:59Z')));
  assert.throws(
    () => parsedExceptions([exception({ expiresOn: '2026-07-30' })], new Date('2026-07-31T00:00:00Z')),
    /expired/,
  );
  assert.throws(() => parsedExceptions([exception({ expiresOn: '2026-02-30' })]), /valid calendar date/);
  assert.throws(() => parsedExceptions([exception({ expiresOn: '2026-10-29' })]), /more than 90 days/);
});

test('exception schema rejects malformed, duplicate, and unsupported entries', () => {
  assert.throws(() => parseExceptionConfig('{', NOW), /not valid JSON/);
  assert.throws(() => parseExceptionConfig({ schemaVersion: 2, exceptions: [] }, NOW), /unsupported/);
  assert.throws(() => parsedExceptions([exception({ extra: true })]), /unsupported fields/);
  assert.throws(() => parsedExceptions([exception(), exception({ id: 'duplicate-id' })]), /duplicate exception/);
  assert.throws(() => parsedExceptions([exception({ ghsa: 'CVE-2026-1' })]), /canonical GHSA/);
});

test('audit execution rejects malformed reports, network failures, and unsupported schemas', () => {
  const spawn = (_command, _args, _options) => ({ status: 1, stdout: 'not-json', stderr: '' });
  assert.throws(() => runAuditTarget(target(), '.', spawn), /malformed JSON/);
  assert.throws(
    () => runAuditTarget(target(), '.', () => ({ status: 1, stdout: JSON.stringify({ error: { code: 'ENETDOWN' } }) })),
    /unsupported or failed report/,
  );
  assert.throws(
    () => runAuditTarget(target(), '.', () => ({ status: 2, stdout: JSON.stringify(report()) })),
    /exit status 2/,
  );
  assert.throws(
    () => runAuditTarget(target(), '.', () => ({ error: new Error('spawn failed'), stdout: '' })),
    /unable to execute/,
  );
});
