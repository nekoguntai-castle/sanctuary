import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const sourceScript = resolve('scripts/bump-version.sh');
const outputs = [
  'package.json',
  'server/package.json',
  'gateway/package.json',
  'llm-egress-proxy/package.json',
  'package-lock.json',
  'llm-egress-proxy/package-lock.json',
  'docs/reference/generated/hardware-wallet-compatibility.json',
  'docs/reference/generated/hardware-wallet-compatibility.md',
];

const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const digest = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

function canonicalReport(repo) {
  const reportPath = join(repo, outputs[6]);
  const existing = JSON.parse(readFileSync(reportPath, 'utf8'));
  const version = JSON.parse(readFileSync(join(repo, 'package.json'))).version;
  const report = {
    schemaVersion: 1,
    generatedAt: existing.generatedAt,
    revision: existing.revision,
    source: {
      applicationVersion: version,
      packageLockSha256: digest(join(repo, 'package-lock.json')),
    },
    rows: ['canonical'],
  };
  writeJson(reportPath, report);
  writeFileSync(join(repo, outputs[7]), `# Hardware evidence\n\nApplication: ${version}\nLock: ${report.source.packageLockSha256}\n`);
}

function createFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'sanctuary-bump-test-'));
  for (const output of outputs) mkdirSync(dirname(join(repo, output)), { recursive: true });
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  cpSync(sourceScript, join(repo, 'scripts/bump-version.sh'));
  chmodSync(join(repo, 'scripts/bump-version.sh'), 0o755);
  for (const name of ['package.json', 'server/package.json', 'gateway/package.json', 'llm-egress-proxy/package.json']) {
    writeJson(join(repo, name), { name, version: '1.2.3' });
  }
  writeJson(join(repo, 'package-lock.json'), {
    name: 'root', version: '1.2.3', lockfileVersion: 3,
    packages: { '': { version: '1.2.3' }, server: { version: '1.2.3' }, gateway: { version: '1.2.3' } },
  });
  writeJson(join(repo, 'llm-egress-proxy/package-lock.json'), {
    name: 'proxy', version: '1.2.3', lockfileVersion: 3,
    packages: { '': { version: '1.2.3' } },
  });
  writeJson(join(repo, outputs[6]), {
    schemaVersion: 1, generatedAt: '2026-08-01T00:00:00.000Z', revision: null,
    source: { applicationVersion: 'placeholder', packageLockSha256: 'placeholder' }, rows: ['canonical'],
  });
  canonicalReport(repo);

  const npmStub = join(repo, 'stub-npm.mjs');
  writeFileSync(npmStub, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
const version = process.argv.at(-1);
const here = process.cwd();
if (process.env.STUB_NPM_FAIL_DIR === basename(here)) process.exit(23);
const update = (path, fn) => { const value = JSON.parse(readFileSync(path)); fn(value); writeFileSync(path, JSON.stringify(value, null, 2) + '\\n'); };
update(join(here, 'package.json'), value => { value.version = version; });
if (basename(here) === 'llm-egress-proxy') {
  update(join(here, 'package-lock.json'), value => { value.version = version; value.packages[''].version = version; });
} else {
  const root = basename(here) === 'server' || basename(here) === 'gateway' ? resolve(here, '..') : here;
  update(join(root, 'package-lock.json'), value => {
    value.version = version; value.packages[''].version = version;
    if (basename(here) === 'server' || basename(here) === 'gateway') value.packages[basename(here)].version = version;
  });
}
`);
  chmodSync(npmStub, 0o755);

  const reportStub = join(repo, 'stub-report.mjs');
  writeFileSync(reportStub, `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
if (process.env.STUB_REPORT_FAIL === '1') process.exit(24);
const value = flag => process.argv[process.argv.indexOf(flag) + 1];
const version = JSON.parse(readFileSync('package.json')).version;
const hash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
const report = { schemaVersion: 1, generatedAt: value('--as-of'), revision: process.argv.includes('--revision') ? value('--revision') : null, source: { applicationVersion: version, packageLockSha256: hash }, rows: ['canonical'] };
writeFileSync(value('--json'), JSON.stringify(report, null, 2) + '\\n');
writeFileSync(value('--markdown'), '# Hardware evidence\\n\\nApplication: ' + version + '\\nLock: ' + hash + '\\n');
`);
  chmodSync(reportStub, 0o755);
  return { repo, npmStub, reportStub };
}

function run(fixture, args, extraEnv = {}) {
  return spawnSync('bash', ['scripts/bump-version.sh', ...args], {
    cwd: fixture.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      SANCTUARY_BUMP_NPM_BIN: fixture.npmStub,
      SANCTUARY_BUMP_REPORT_BIN: fixture.reportStub,
      ...extraEnv,
    },
  });
}

const snapshot = (repo) => Object.fromEntries(outputs.map((name) => [name, readFileSync(join(repo, name), 'utf8')]));

test('bumps every declared output and --check validates the result', () => {
  const fixture = createFixture();
  try {
    const bumped = run(fixture, ['1.2.4']);
    assert.equal(bumped.status, 0, bumped.stderr);
    assert.equal(run(fixture, ['--check']).status, 0);
    for (const name of outputs.slice(0, 4)) {
      assert.equal(JSON.parse(readFileSync(join(fixture.repo, name))).version, '1.2.4');
    }
    assert.match(readFileSync(join(fixture.repo, outputs[7]), 'utf8'), /Application: 1\.2\.4/);
  } finally { rmSync(fixture.repo, { recursive: true, force: true }); }
});

test('check fails closed when any declared output is missing', async (t) => {
  for (const name of outputs) {
    await t.test(name, () => {
      const fixture = createFixture();
      try {
        rmSync(join(fixture.repo, name));
        const result = run(fixture, ['--check']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /required release output is missing/);
      } finally { rmSync(fixture.repo, { recursive: true, force: true }); }
    });
  }
});

for (const failure of [
  ['an intermediate npm write', { STUB_NPM_FAIL_DIR: 'gateway' }],
  ['generated evidence refresh', { STUB_REPORT_FAIL: '1' }],
]) {
  test(`restores all outputs after ${failure[0]} fails`, () => {
    const fixture = createFixture();
    try {
      const before = snapshot(fixture.repo);
      const result = run(fixture, ['1.2.4'], failure[1]);
      assert.notEqual(result.status, 0);
      assert.deepEqual(snapshot(fixture.repo), before);
    } finally { rmSync(fixture.repo, { recursive: true, force: true }); }
  });
}

const corruptions = [
  ...outputs.slice(0, 4).map((name) => [name, (value) => { value.version = '9.9.9'; }]),
  ['package-lock.json', (value) => { value.version = '9.9.9'; }],
  ['package-lock.json', (value) => { value.packages[''].version = '9.9.9'; }],
  ['package-lock.json', (value) => { value.packages.server.version = '9.9.9'; }],
  ['package-lock.json', (value) => { value.packages.gateway.version = '9.9.9'; }],
  ['llm-egress-proxy/package-lock.json', (value) => { value.version = '9.9.9'; }],
  ['llm-egress-proxy/package-lock.json', (value) => { value.packages[''].version = '9.9.9'; }],
  [outputs[6], (value) => { value.source.applicationVersion = '9.9.9'; }],
  [outputs[6], (value) => { value.source.packageLockSha256 = '0'.repeat(64); }],
  [outputs[6], (value) => { value.rows = ['not-canonical']; }],
];

test('check fails closed for every manifest, lock identity, digest, and generated parity field', async (t) => {
  for (const [index, [name, mutate]] of corruptions.entries()) {
    await t.test(`${index + 1}: ${name}`, () => {
      const fixture = createFixture();
      try {
        const path = join(fixture.repo, name);
        const value = JSON.parse(readFileSync(path, 'utf8'));
        mutate(value);
        writeJson(path, value);
        assert.notEqual(run(fixture, ['--check']).status, 0);
      } finally { rmSync(fixture.repo, { recursive: true, force: true }); }
    });
  }
  await t.test('Markdown differs from canonical JSON rendering', () => {
    const fixture = createFixture();
    try {
      writeFileSync(join(fixture.repo, outputs[7]), '# stale\n');
      assert.notEqual(run(fixture, ['--check']).status, 0);
    } finally { rmSync(fixture.repo, { recursive: true, force: true }); }
  });
});
