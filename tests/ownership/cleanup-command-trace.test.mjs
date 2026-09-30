import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CLEANUP_ENGINE_TRACE_FILE_ENV,
  CleanupCommandError,
  runCleanupCommand,
} from '../../scripts/ownership/cleanup-command.mjs';

// R5-B phase 1 (tasks/ci-install-lane-speedup-design-2026-09-29.md): an opt-in
// JSONL trace of every engine invocation, attributing cleanup wall time to
// operations. It must never change a command's result.

function withTraceFile(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-engine-trace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'trace.jsonl');
  const previous = process.env[CLEANUP_ENGINE_TRACE_FILE_ENV];
  process.env[CLEANUP_ENGINE_TRACE_FILE_ENV] = file;
  t.after(() => {
    if (previous === undefined) delete process.env[CLEANUP_ENGINE_TRACE_FILE_ENV];
    else process.env[CLEANUP_ENGINE_TRACE_FILE_ENV] = previous;
  });
  return file;
}

const records = (file) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

test('records operation, subcommand, outcome and duration without option values', (t) => {
  const file = withTraceFile(t);
  const output = runCleanupCommand('docker', [
    '--host', 'unix:///run/user/1001/podman/podman.sock',
    'volume', 'inspect', '--format', '{{json .}}', 'ci-19465-1-upgrade-15_postgres_data',
  ], { operation: 'compose_volume inspect', execFileSync: () => 'ok' });
  assert.equal(output, 'ok');
  const [record] = records(file);
  assert.equal(record.executable, 'docker');
  assert.equal(record.operation, 'compose_volume inspect');
  assert.deepEqual(record.command, ['volume', 'inspect']);
  assert.equal(record.outcome, 'success');
  assert.equal(typeof record.durationMs, 'number');
  assert.ok(record.durationMs >= 0);
  const serialized = readFileSync(file, 'utf8');
  assert.doesNotMatch(serialized, /podman\.sock/);
  assert.doesNotMatch(serialized, /postgres_data/);
});

test('records the failure category and still throws the original classification', (t) => {
  const file = withTraceFile(t);
  const failure = Object.assign(new Error('boom'), { code: 'ETIMEDOUT' });
  assert.throws(
    () => runCleanupCommand('docker', ['image', 'ls'], {
      operation: 'oci_image list', execFileSync: () => { throw failure; },
    }),
    (error) => error instanceof CleanupCommandError && error.category === 'timeout',
  );
  const [record] = records(file);
  assert.equal(record.outcome, 'timeout');
  assert.deepEqual(record.command, ['image', 'ls']);
});

test('never records compose option values as command words', (t) => {
  const file = withTraceFile(t);
  runCleanupCommand('docker', [
    'compose', '-p', 'ci-19465-1-upgrade-15', '--project-directory', '/srv/private',
    '--env-file', '/srv/private/.env', '-f', 'docker-compose.yml', '--profile', 'monitoring', 'down',
  ], { operation: 'compose down', execFileSync: () => '' });
  const [record] = records(file);
  assert.deepEqual(record.command, ['compose', 'down']);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /ci-19465|private|\.env|monitoring/);
});

test('writes nothing when the trace is not enabled', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-engine-trace-off-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previous = process.env[CLEANUP_ENGINE_TRACE_FILE_ENV];
  delete process.env[CLEANUP_ENGINE_TRACE_FILE_ENV];
  t.after(() => { if (previous !== undefined) process.env[CLEANUP_ENGINE_TRACE_FILE_ENV] = previous; });
  assert.equal(runCleanupCommand('docker', ['version'], { execFileSync: () => 'v' }), 'v');
  assert.equal(existsSync(path.join(root, 'trace.jsonl')), false);
});

test('an unwritable trace path never changes the command result', (t) => {
  const previous = process.env[CLEANUP_ENGINE_TRACE_FILE_ENV];
  process.env[CLEANUP_ENGINE_TRACE_FILE_ENV] = path.join(os.tmpdir(), 'no-such-dir-for-trace', 'x', 'trace.jsonl');
  t.after(() => {
    if (previous === undefined) delete process.env[CLEANUP_ENGINE_TRACE_FILE_ENV];
    else process.env[CLEANUP_ENGINE_TRACE_FILE_ENV] = previous;
  });
  assert.equal(runCleanupCommand('docker', ['info'], { execFileSync: () => 'fine' }), 'fine');
});
