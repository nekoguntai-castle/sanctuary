import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEADLINE = 'SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'subject-budget-boundaries-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  mkdirSync(bin);
  const env = { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
    SANCTUARY_RUNNER_LOCK_DIR: path.join(directory, 'locks'),
    FIXTURE_DIRECTORY: directory, FIXTURE_NODE: process.execPath };
  return { directory, bin, env };
}

function invoke(script, args, env) {
  const result = spawnSync('bash', [path.join(ROOT, 'scripts/ci', script), ...args], {
    env, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  return result;
}

function runLock(f, deadline) {
  return invoke('with-runner-lock.sh', ['fixture', 'touch', path.join(f.directory, 'child')], {
    ...f.env, [DEADLINE]: deadline,
  });
}

test('expired subject deadline refuses lock creation and child execution', (t) => {
  const f = fixture(t);
  const result = runLock(f, String(Date.now() - 1000));
  assert.equal(result.status, 124, result.stderr);
  assert.equal(existsSync(f.env.SANCTUARY_RUNNER_LOCK_DIR), false);
  assert.equal(existsSync(path.join(f.directory, 'child')), false);
});

for (const deadline of ['', 'invalid', '01', '9007199254740992']) {
  test(`lock rejects explicitly configured malformed deadline ${JSON.stringify(deadline)}`, (t) => {
    const f = fixture(t);
    const result = runLock(f, deadline);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(f.env.SANCTUARY_RUNNER_LOCK_DIR), false);
    assert.equal(existsSync(path.join(f.directory, 'child')), false);
  });
}

test('contended lock receives remaining subject budget, not configured long wait', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.bin, 'flock'), '#!/bin/bash\nprintf "%s\\n" "$@" > "$FIXTURE_DIRECTORY/flock-args"\nexit 1\n', { mode: 0o755 });
  f.env.SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS = '1500';
  const result = runLock(f, String(Date.now() + 30_000));
  assert.equal(result.status, 75, result.stderr);
  const args = readFileSync(path.join(f.directory, 'flock-args'), 'utf8').trim().split('\n');
  assert.equal(args[0], '-w');
  assert.ok(Number(args[1]) >= 1 && Number(args[1]) <= 30);
  assert.equal(args[2], '9');
  assert.equal(existsSync(path.join(f.directory, 'child')), false);
});

function runFacade(f, options = [], environment = {}, mode = 'run') {
  // Execute the real canonical request writer, but never the coordinator or Docker.
  writeFileSync(path.join(f.bin, 'node'), `#!/bin/bash
case "$1" in
  */write-ci-cleanup-request.mjs) exec "$FIXTURE_NODE" "$@" ;;
  */ci-cleanup-coordinator.mjs) printf '%s\\n' "$@" > "$FIXTURE_DIRECTORY/coordinator-args" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  const args = [mode, '--lane', 'fixture', '--runtime', path.join(f.directory, 'runtime'),
    '--artifact-dir', path.join(f.directory, 'artifacts'), ...options];
  if (mode === 'run') args.push('--', 'touch', path.join(f.directory, 'child'));
  return invoke('cleanup-ci-callsite.sh', args, { ...f.env, ...environment });
}

test('successful lock acquisition cannot launch after its budget expires', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.bin, 'flock'), '#!/bin/bash\nsleep 2\nexit 0\n', { mode: 0o755 });
  const result = runLock(f, String(Date.now() + 1500));
  assert.equal(result.status, 124, result.stderr);
  assert.equal(existsSync(path.join(f.directory, 'child')), false);
  assert.match(result.stdout, /released fixture held .*status=124/);
});

for (const source of ['explicit', 'environment', 'matching-explicit-and-environment']) {
  test(`facade forwards canonical deadline from ${source}`, (t) => {
    const f = fixture(t);
    const deadline = String(Date.now() + 30_000);
    const options = source === 'environment' ? [] : ['--subject-deadline-epoch-ms', deadline];
    const env = source === 'explicit' ? {} : { [DEADLINE]: deadline };
    const result = runFacade(f, options, env);
    assert.equal(result.status, 0, result.stderr);
    const request = JSON.parse(readFileSync(path.join(f.directory, 'runtime/run-request.json'), 'utf8'));
    assert.equal(request.subjectDeadlineEpochMs, Number(deadline));
    const args = readFileSync(path.join(f.directory, 'coordinator-args'), 'utf8').trim().split('\n');
    assert.deepEqual(args.slice(1), ['run', path.join(f.directory, 'runtime/run-request.json'), '--', 'touch', path.join(f.directory, 'child')]);
    assert.equal(existsSync(path.join(f.directory, 'child')), false);
  });
}

test('facade refuses changing an inherited deadline through an explicit flag', (t) => {
  for (const difference of [-5000, 5000]) {
    const f = fixture(t);
    const inherited = Date.now() + 30_000;
    const result = runFacade(f, ['--subject-deadline-epoch-ms', String(inherited + difference)], {
      [DEADLINE]: String(inherited),
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /conflicts with inherited deadline/);
    assert.equal(existsSync(path.join(f.directory, 'coordinator-args')), false);
  }
});

for (const source of ['explicit', 'environment']) {
  for (const value of ['', 'invalid', '01']) {
    test(`facade rejects malformed ${source} deadline ${JSON.stringify(value)}`, (t) => {
      const f = fixture(t);
      const options = source === 'explicit' ? ['--subject-deadline-epoch-ms', value] : [];
      const result = runFacade(f, options, source === 'environment' ? { [DEADLINE]: value } : {});
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(path.join(f.directory, 'runtime/run-request.json')), false);
      assert.equal(existsSync(path.join(f.directory, 'coordinator-args')), false);
    });
  }
}

test('facade rejects explicit empty deadline outside run mode', (t) => {
  const f = fixture(t);
  const result = runFacade(f, ['--subject-deadline-epoch-ms', ''], {}, 'prepare');
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(path.join(f.directory, 'coordinator-args')), false);
});
