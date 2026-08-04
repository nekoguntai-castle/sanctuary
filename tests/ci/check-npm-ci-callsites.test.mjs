import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import {
  discoverCallsiteFiles,
  evaluate,
  findCandidateLines,
  findUnprotectedLines,
  parsePolicy,
  runGate,
} from '../../scripts/ci/check-npm-ci-callsites.mjs';

const GATE = new URL('../../scripts/ci/check-npm-ci-callsites.mjs', import.meta.url).pathname;
const POLICY = new URL('../../scripts/ci/npm-ci-callsite-policy.json', import.meta.url);

function policyFixture(callsites) {
  return { schemaVersion: 1, callsites };
}

function exec(file, rationale = 'fixture') {
  return { file, executable: true, rationale };
}

function prose(file, expectedMatches, rationale = 'fixture prose') {
  return { file, executable: false, expectedMatches, rationale };
}

test('parsePolicy accepts a well-formed policy', () => {
  const entries = parsePolicy(policyFixture([exec('a.sh'), prose('b.yml', 1)]));
  assert.equal(entries.length, 2);
});

test('parsePolicy rejects an unsupported schema version', () => {
  assert.throws(() => parsePolicy({ schemaVersion: 9, callsites: [] }), /unsupported policy schemaVersion/);
});

test('parsePolicy rejects a duplicate file entry', () => {
  assert.throws(() => parsePolicy(policyFixture([exec('a.sh'), exec('a.sh')])), /duplicate/);
});

test('parsePolicy rejects a missing rationale', () => {
  const broken = policyFixture([{ file: 'a.sh', executable: true, rationale: '' }]);
  assert.throws(() => parsePolicy(broken), /rationale must be a non-empty string/);
});

test('parsePolicy requires expectedMatches on a non-executable entry', () => {
  const broken = policyFixture([{ file: 'a.yml', executable: false, rationale: 'prose' }]);
  assert.throws(() => parsePolicy(broken), /expectedMatches must be an integer/);
});

test('findCandidateLines ignores comments and quoted labels', () => {
  const content = [
    '# npm ci in a comment',
    'retry-command.sh "root npm ci" npm ci --ignore-scripts',
    'echo "run npm ci first"',
  ].join('\n');
  const candidates = findCandidateLines(content);
  assert.equal(candidates.length, 1, 'only the real command counts');
  assert.equal(candidates[0].protected, true);
});

test('findUnprotectedLines flags a bare npm ci', () => {
  const offenders = findUnprotectedLines('RUN npm ci --audit=false');
  assert.equal(offenders.length, 1);
  assert.equal(offenders[0].line, 1);
});

test('findUnprotectedLines accepts either protective flag', () => {
  assert.deepEqual(findUnprotectedLines('RUN npm ci --strict-allow-scripts'), []);
  assert.deepEqual(findUnprotectedLines('RUN npm ci --ignore-scripts'), []);
});

test('findUnprotectedLines handles the --prefix form', () => {
  assert.equal(findUnprotectedLines('npm --prefix docs/site ci').length, 1);
  assert.deepEqual(findUnprotectedLines('npm --prefix docs/site ci --ignore-scripts'), []);
});

test('evaluate fails on an unreviewed call site', () => {
  const problems = evaluate(parsePolicy(policyFixture([])), ['new/install.sh'], () => '');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unreviewed npm ci call site: new\/install\.sh/);
});

test('evaluate fails on a stale policy entry', () => {
  const problems = evaluate(parsePolicy(policyFixture([exec('gone.sh')])), [], () => '');
  assert.match(problems[0], /stale policy entry: gone\.sh/);
});

test('evaluate fails on an unprotected command in an executable entry', () => {
  const problems = evaluate(
    parsePolicy(policyFixture([exec('a.sh')])),
    ['a.sh'],
    () => 'npm ci --audit=false',
  );
  assert.match(problems[0], /unprotected npm ci: a\.sh:1/);
});

test('evaluate passes a protected command', () => {
  const problems = evaluate(
    parsePolicy(policyFixture([exec('a.sh')])),
    ['a.sh'],
    () => 'npm ci --strict-allow-scripts',
  );
  assert.deepEqual(problems, []);
});

test('evaluate catches a real command sneaking into a prose-only file', () => {
  const problems = evaluate(
    parsePolicy(policyFixture([prose('a.yml', 1)])),
    ['a.yml'],
    () => 'description mentions npm ci here\nRUN npm ci',
  );
  assert.equal(problems.length, 1, 'drift must be caught even though the flag rule is skipped');
  assert.match(problems[0], /prose-only call site drifted: a\.yml now has 2/);
});

test('evaluate passes a prose-only file whose count is unchanged', () => {
  const problems = evaluate(
    parsePolicy(policyFixture([prose('a.yml', 1)])),
    ['a.yml'],
    () => 'description mentions npm ci here',
  );
  assert.deepEqual(problems, []);
});

test('discovery excludes markdown, docs, and tasks', () => {
  const files = discoverCallsiteFiles();
  assert.ok(files.length > 0, 'discovery must find something');
  files.forEach((file) => {
    assert.ok(!file.endsWith('.md'), `markdown must be excluded: ${file}`);
    assert.ok(!file.startsWith('docs/'), `docs must be excluded: ${file}`);
    assert.ok(!file.startsWith('tasks/'), `tasks must be excluded: ${file}`);
  });
});

test('the shipped policy covers every discovered call site exactly', () => {
  const entries = parsePolicy(readFileSync(POLICY, 'utf8'));
  const discovered = discoverCallsiteFiles();
  assert.deepEqual(
    entries.map((entry) => entry.file).sort(),
    [...discovered].sort(),
    'policy and repository must agree',
  );
});

test('every real Dockerfile and workflow install site is protected', () => {
  const result = runGate();
  assert.ok(result.executableCount >= 20, `expected broad coverage, got ${result.executableCount}`);
});

test('the CLI passes against the real repository', () => {
  const run = spawnSync(process.execPath, [GATE], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /npm ci call-site policy passed/);
});
