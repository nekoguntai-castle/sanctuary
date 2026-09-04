import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_TARGETS,
  evaluateReports,
  findLockPaths,
  parseExceptionConfig,
  runAuditTarget,
  runGate,
  AUDIT_NPM_ENV,
  AUDIT_TARGET_ATTEMPTS,
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

test('default audit targets cover the isolated CI YAML parser lock', () => {
  assert.deepEqual(
    DEFAULT_TARGETS.find(({ label }) => label === 'ci-yaml-parser'),
    {
      label: 'ci-yaml-parser',
      cwd: 'tests/ci/lib',
      lockfile: 'tests/ci/lib/package-lock.json',
      roots: [''],
      args: ['audit', '--json'],
    },
  );
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
});

test('an exception without an expiry stands, at any distance from today', () => {
  const perpetual = exception();
  delete perpetual.expiresOn;

  assert.doesNotThrow(() => parsedExceptions([perpetual], NOW));
  // Far enough ahead that any ceiling on the expiry window would have caught it.
  assert.doesNotThrow(() => parsedExceptions([perpetual], new Date('2032-01-01T00:00:00Z')));
});

test('a dated exception may now sit further out than a quarter', () => {
  assert.doesNotThrow(() => parsedExceptions([exception({ expiresOn: '2027-10-29' })], NOW));
});

test('an expiry that is present must still be a real, unexpired date', () => {
  // Opting in to a deadline keeps every guarantee it used to carry.
  assert.throws(() => parsedExceptions([exception({ expiresOn: '' })]), /strict YYYY-MM-DD date/);
  assert.throws(() => parsedExceptions([exception({ expiresOn: 'soon' })]), /strict YYYY-MM-DD date/);
  assert.throws(
    () => parsedExceptions([exception({ expiresOn: '2026-01-01' })], NOW),
    /expired on 2026-01-01/,
  );
});

test('exception schema rejects malformed, duplicate, and unsupported entries', () => {
  assert.throws(() => parseExceptionConfig('{', NOW), /not valid JSON/);
  assert.throws(() => parseExceptionConfig({ schemaVersion: 2, exceptions: [] }, NOW), /unsupported/);
  assert.throws(() => parsedExceptions([exception({ extra: true })]), /unsupported fields/);
  assert.throws(() => parsedExceptions([exception(), exception({ id: 'duplicate-id' })]), /duplicate exception/);
  assert.throws(() => parsedExceptions([exception({ ghsa: 'CVE-2026-1' })]), /canonical GHSA/);
});

test('audit execution rejects malformed reports, network failures, and unsupported schemas', async () => {
  const once = { attempts: 1 };
  const spawn = (_command, _args, _options) => ({ status: 1, stdout: 'not-json', stderr: '' });
  await assert.rejects(() => runAuditTarget(target(), '.', spawn), /malformed JSON/);
  await assert.rejects(
    () => runAuditTarget(target(), '.', () => ({ status: 1, stdout: JSON.stringify({ error: { code: 'ENETDOWN' } }) }), once),
    /unsupported or failed report \(ENETDOWN: no summary\) after 1 attempts/,
  );
  // Registry failures carry a summary; the message must name it so a CI log
  // distinguishes an unreachable advisory endpoint from a schema change.
  await assert.rejects(
    () => runAuditTarget(target(), '.', () => ({
      status: 1,
      stdout: JSON.stringify({ error: { code: 'E503', summary: '503 Service Unavailable - POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk' } }),
    }), once),
    /unsupported or failed report \(E503: 503 Service Unavailable - POST https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/security\/advisories\/bulk\)/,
  );
  await assert.rejects(
    () => runAuditTarget(target(), '.', () => ({ status: 1, stdout: JSON.stringify({ error: 'boom' }) }), once),
    /unsupported or failed report \(error: boom\)/,
  );
  // A socket timeout leaves `error.summary` empty and names the endpoint only
  // in the top-level message.
  await assert.rejects(
    () => runAuditTarget(target(), '.', () => ({
      status: 1,
      stdout: JSON.stringify({ message: 'network timeout at: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', error: { summary: '', detail: '' } }),
    }), once),
    /\(unknown code: network timeout at: https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/security\/advisories\/bulk\) after 1 attempts/,
  );
  await assert.rejects(
    () => runAuditTarget(target(), '.', () => ({ status: 2, stdout: JSON.stringify(report()) })),
    /exit status 2/,
  );
  await assert.rejects(
    () => runAuditTarget(target(), '.', () => ({ error: new Error('spawn failed'), stdout: '' })),
    /unable to execute/,
  );
});

test('audit execution retries registry error reports with a short npm fetch timeout', async () => {
  // The advisory endpoint stalls intermittently and npm never retries the
  // POST, so the gate must retry the target itself and cap each request.
  const registryError = { status: 1, stdout: JSON.stringify({ error: { code: 'ERR_SOCKET_TIMEOUT', summary: 'stalled' } }) };
  const calls = [];
  const sleeps = [];
  const flaky = (_command, _args, options) => {
    calls.push(options);
    return calls.length < 3 ? registryError : { status: 0, stdout: JSON.stringify(report()) };
  };
  const result = await runAuditTarget(target(), '.', flaky, { sleep: (ms) => sleeps.push(ms) });
  assert.equal(result.auditReportVersion, 2);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [2000, 2000]);
  for (const options of calls) {
    assert.equal(options.env.npm_config_fetch_timeout, AUDIT_NPM_ENV.npm_config_fetch_timeout);
    assert.equal(options.env.PATH, process.env.PATH);
  }

  // Exhausting the budget reports the attempt count; the default budget is
  // the exported constant so the workflow retry loop can reason about it.
  let exhausted = 0;
  await assert.rejects(
    () => runAuditTarget(target(), '.', () => { exhausted += 1; return registryError; }, { sleep: () => {} }),
    new RegExp(`ERR_SOCKET_TIMEOUT: stalled\\) after ${AUDIT_TARGET_ATTEMPTS} attempts`),
  );
  assert.equal(exhausted, AUDIT_TARGET_ATTEMPTS);

  // A schema mismatch is not a registry fault and must not be retried.
  let schemaCalls = 0;
  await assert.rejects(
    () => runAuditTarget(target(), '.', () => { schemaCalls += 1; return { status: 0, stdout: JSON.stringify({ auditReportVersion: 1 }) }; }, { sleep: () => {} }),
    /unsupported or failed report$/,
  );
  assert.equal(schemaCalls, 1);
  await assert.rejects(() => runAuditTarget(target(), '.', flaky, { attempts: 0 }), /positive integer/);
});

test('gate audits every target concurrently and keeps declaration order', async () => {
  // Eight sequential registry waits do not fit the job budget when the
  // advisory endpoint stalls; the gate must overlap them.
  const root = mkdtempSync(path.join(os.tmpdir(), 'npm-audit-gate-concurrency-'));
  writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock()));
  const configPath = path.join(root, 'exceptions.json');
  writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, exceptions: [] }));
  const started = [];
  let inFlight = 0;
  let peak = 0;
  const releases = new Map();
  const auditRunner = (auditTarget, repoRoot) => new Promise((resolveAudit) => {
    assert.equal(repoRoot, root);
    started.push(auditTarget.label);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    releases.set(auditTarget.label, () => { inFlight -= 1; resolveAudit(report({})); });
  });
  const targets = [target({ label: 'a' }), target({ label: 'b' }), target({ label: 'c' })];
  const gate = runGate({ repoRoot: root, configPath, targets, auditRunner, currentDate: NOW });
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.deepEqual(started, ['a', 'b', 'c']);
  assert.equal(peak, 3);
  for (const label of ['c', 'a', 'b']) releases.get(label)();
  assert.deepEqual(await gate, { targetCount: 3, exceptionCount: 0 });
});
