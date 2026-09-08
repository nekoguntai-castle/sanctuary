import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEADLINE_VARIABLE, JOB_STARTED_VARIABLE, initializeDeadline, lockWaitSeconds, runSubjectBudget, stepDeadline,
} from '../../scripts/ci/subject-budget.mjs';

const NOW = 1_800_000_000_000;

test('initialization subtracts reserve and accepts maximum job boundary', () => {
  assert.equal(initializeDeadline('5400', '900', NOW), NOW + 4_500_000);
  assert.equal(initializeDeadline('86400', '1', NOW), NOW + 86_399_000);
});

test('initialization charges setup time from the validated job start', () => {
  assert.equal(initializeDeadline('10', '2', NOW, undefined, String(NOW - 5000)), NOW + 3000);
  assert.equal(initializeDeadline('10', '2', NOW, undefined, String(NOW)), NOW + 8000);
  for (const value of ['', '0', '01', String(NOW + 1), String(NOW - 86_400_001)]) {
    assert.throws(() => initializeDeadline('10', '2', NOW, undefined, value));
  }
  for (const elapsed of [7001, 8000, 86_400_000]) {
    assert.throws(() => initializeDeadline('10', '2', NOW, undefined, String(NOW - elapsed)), { exitCode: 124 });
  }
  const writes = [];
  runSubjectBudget(['initialize', '10', '2'], {
    environment: { [JOB_STARTED_VARIABLE]: String(NOW - 5000) }, now: NOW,
    envFile: '/env', append: (...args) => writes.push(args),
  });
  assert.equal(writes[0][1], `${DEADLINE_VARIABLE}=${NOW + 3000}\n`);
  assert.throws(() => runSubjectBudget(['initialize', '10', '2'], {
    environment: { [JOB_STARTED_VARIABLE]: String(NOW - 8000) }, now: NOW,
    envFile: '/env', append: () => assert.fail('exhausted setup wrote deadline'),
  }), { exitCode: 124 });
});

test('invalid initialization and reset never write or output', () => {
  const invalid = [
    ['0', '1'], ['01', '1'], ['+2', '1'], ['2.0', '1'], [' 2', '1'],
    ['2\n', '1'], ['2', '0'], ['2', '2'], ['2', '3'], ['86401', '1'],
    ['9007199254740992', '1'], ['2', null], [2, '1'],
  ];
  const append = () => assert.fail('invalid budget wrote environment');
  const output = () => assert.fail('invalid budget produced output');
  for (const [job, reserve] of invalid) {
    assert.throws(() => runSubjectBudget(['initialize', job, reserve], {
      environment: {}, now: NOW, envFile: '/unused', append, output,
    }));
  }
  for (const value of ['', 'invalid', String(NOW + 5000)]) {
    assert.throws(() => runSubjectBudget(['initialize', '2', '1'], {
      environment: { [DEADLINE_VARIABLE]: value }, now: NOW,
      envFile: '/unused', append, output,
    }), /refusing reset/);
  }
  assert.throws(() => initializeDeadline('2', '1', Number.MAX_SAFE_INTEGER), /overflow/);
  for (const clock of [-1, NaN, Infinity, 0.5]) {
    assert.throws(() => initializeDeadline('2', '1', clock), /clock/);
  }
});

test('initialize appends one canonical environment line and requires a destination', () => {
  const writes = [];
  const options = { environment: {}, now: NOW, envFile: '/env',
    append: (...args) => writes.push(args) };
  runSubjectBudget(['initialize', '10', '2'], options);
  assert.deepEqual(writes, [['/env', `${DEADLINE_VARIABLE}=${NOW + 8000}\n`, { encoding: 'utf8' }]]);
  assert.throws(() => runSubjectBudget(['initialize', '10', '2'], {
    ...options, envFile: null,
  }), /environment file/);
  assert.equal(writes.length, 1);
});

test('lock wait preserves absent-env behavior and floors remaining budget', () => {
  assert.equal(lockWaitSeconds('1500', undefined, NOW), 1500);
  assert.equal(lockWaitSeconds('1500', String(NOW + 2500), NOW), 2);
  assert.equal(lockWaitSeconds('1', String(NOW + 2500), NOW), 1);
  assert.equal(lockWaitSeconds('2', String(NOW + 1000), NOW), 1);
  assert.equal(lockWaitSeconds('86401', String(NOW + 86_400_000), NOW), 86400);
});

test('lock wait refuses malformed or overlong deadlines, with exhausted exit 124', () => {
  for (const deadline of ['', '0', '01', '-1', '1.2', '1\n', '9007199254740992',
    String(NOW + 86_400_001)]) {
    assert.throws(() => lockWaitSeconds('2', deadline, NOW));
  }
  for (const remaining of [-1000, 0, 999]) {
    assert.throws(() => lockWaitSeconds('2', String(NOW + remaining), NOW), { exitCode: 124 });
  }
  for (const value of ['0', '01', '-2', '2.5', '', '9007199254740992']) {
    assert.throws(() => lockWaitSeconds(value, undefined, NOW));
  }
  assert.throws(() => lockWaitSeconds('2', String(NOW), NaN), /clock/);
});

test('CLI dispatcher prints only wait seconds and rejects invalid arguments without writes', () => {
  const lines = [];
  const options = { environment: {}, now: NOW, output: (value) => lines.push(value),
    append: () => assert.fail('unexpected append') };
  runSubjectBudget(['lock-wait', '1500'], options);
  assert.deepEqual(lines, ['1500\n']);
  for (const args of [[], ['bad'], ['initialize', '2'], ['lock-wait', '2', 'extra']]) {
    assert.throws(() => runSubjectBudget(args, options), /usage/);
  }
});

test('step deadline narrows inherited budget and never extends it', () => {
  assert.equal(stepDeadline('10', '2', NOW), NOW + 8000);
  assert.equal(stepDeadline('10', '2', NOW, String(NOW + 5000)), NOW + 5000);
  assert.equal(stepDeadline('10', '2', NOW, String(NOW + 9000)), NOW + 8000);
  assert.equal(stepDeadline('10', '2', NOW, String(NOW + 1000)), NOW + 1000);
  assert.throws(() => stepDeadline('10', '2', NOW, String(NOW + 999)), { exitCode: 124 });
  assert.throws(() => stepDeadline('10', '2', NOW, ''), /positive safe integer/);
  assert.throws(() => stepDeadline('10', '2', NOW, String(NOW + 86_400_001)), /24 hours/);
  assert.throws(() => stepDeadline('2', '2', NOW), /budget/);
  const lines = [];
  runSubjectBudget(['step-deadline', '10', '2'], {
    environment: { [DEADLINE_VARIABLE]: String(NOW + 5000) }, now: NOW,
    output: (line) => lines.push(line), append: () => assert.fail('unexpected write'),
  });
  assert.deepEqual(lines, [`${NOW + 5000}\n`]);
});

test('real CLI exits 124 on exhausted budget and never prints a wait duration', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'subject-budget-test-'));
  const stdoutPath = path.join(directory, 'stdout');
  const stderrPath = path.join(directory, 'stderr');
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  let result;
  try {
    result = spawnSync(process.execPath, ['scripts/ci/subject-budget.mjs', 'lock-wait', '10'], {
      env: { ...process.env, [DEADLINE_VARIABLE]: '1' }, stdio: ['ignore', stdout, stderr],
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  assert.equal(result.status, 124);
  assert.equal(readFileSync(stdoutPath, 'utf8'), '');
  assert.match(readFileSync(stderrPath, 'utf8'), /budget exhausted/);
});
