import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSupervisedCleanupCommand } from '../../scripts/ownership/cleanup-supervisor.mjs';

const node = process.execPath;

function processCanRun(pid) {
  try {
    process.kill(pid, 0);
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const commandEnd = stat.lastIndexOf(')');
    return !['Z', 'X'].includes(stat.slice(commandEnd + 2).split(/\s+/, 1)[0]);
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function waitFor(check, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (check()) return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('condition did not become true before timeout');
}

test('successful and failed commands expose only categorical bounded results', async () => {
  const success = await runSupervisedCleanupCommand(node, [
    '-e', "process.stdout.write('private-output'); process.stderr.write('private-error')",
  ]);
  assert.deepEqual(success, { outcome: 'success', exitCode: 0, terminationSignal: null });
  assert.doesNotMatch(JSON.stringify(success), /private/);

  const failure = await runSupervisedCleanupCommand(node, ['-e', 'process.exit(17)']);
  assert.deepEqual(failure, { outcome: 'command_failed', exitCode: 17, terminationSignal: null });

  const unavailable = await runSupervisedCleanupCommand('/definitely/missing/cleanup-command', []);
  assert.deepEqual(unavailable, { outcome: 'command_unavailable', exitCode: null, terminationSignal: null });
});

test('timeout and output caps terminate the dedicated process group', async () => {
  const timedOut = await runSupervisedCleanupCommand(node, ['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 25, graceMs: 20, killWaitMs: 500,
  });
  assert.equal(timedOut.outcome, 'timeout');
  assert.ok(['SIGTERM', 'SIGKILL'].includes(timedOut.terminationSignal));

  const killed = await runSupervisedCleanupCommand(node, [
    '-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
  ], { timeoutMs: 100, graceMs: 20, killWaitMs: 500 });
  assert.deepEqual(killed, { outcome: 'timeout', exitCode: null, terminationSignal: 'SIGKILL' });

  const capped = await runSupervisedCleanupCommand(node, [
    '-e', "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)",
  ], { maxOutputBytes: 128, timeoutMs: 1_000, graceMs: 20, killWaitMs: 500 });
  assert.equal(capped.outcome, 'output_limit');
  assert.ok(['SIGTERM', 'SIGKILL'].includes(capped.terminationSignal));
});

test('AbortSignal stops the command and waits for process-group exit', async () => {
  const controller = new AbortController();
  const running = runSupervisedCleanupCommand(node, ['-e', 'setInterval(() => {}, 1000)'], {
    signal: controller.signal, timeoutMs: 1_000, graceMs: 20, killWaitMs: 500,
  });
  setTimeout(() => controller.abort(), 25);
  const result = await running;
  assert.equal(result.outcome, 'cancelled');
  assert.ok(['SIGTERM', 'SIGKILL'].includes(result.terminationSignal));

  const preCancelled = new AbortController();
  preCancelled.abort();
  assert.deepEqual(
    await runSupervisedCleanupCommand('/does/not/exist', [], { signal: preCancelled.signal }),
    { outcome: 'cancelled', exitCode: null, terminationSignal: null },
  );
});

test('timeout kills a grandchild in the supervised Linux process group', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-supervisor-'));
  const pidFile = path.join(root, 'grandchild.pid');
  const parentProgram = [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' })",
    'writeFileSync(process.argv[1], String(child.pid))',
    'setInterval(() => {}, 1000)',
  ].join(';');
  const running = runSupervisedCleanupCommand(node, ['-e', parentProgram, pidFile], {
    timeoutMs: 100, graceMs: 20, killWaitMs: 500,
  });
  await waitFor(() => readFileSync(pidFile, 'utf8').length > 0);
  const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
  assert.equal(processCanRun(grandchildPid), true);
  const result = await running;
  assert.equal(result.outcome, 'timeout');
  await waitFor(() => !processCanRun(grandchildPid));
});

test('a normally exiting leader cannot leave a runnable process-group member behind', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-supervisor-orphan-'));
  const pidFile = path.join(root, 'grandchild.pid');
  const parentProgram = [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' })",
    'child.unref()',
    'writeFileSync(process.argv[1], String(child.pid))',
  ].join(';');
  const result = await runSupervisedCleanupCommand(node, ['-e', parentProgram, pidFile], {
    timeoutMs: 1_000, graceMs: 20, killWaitMs: 500,
  });
  const grandchildPid = Number(readFileSync(pidFile, 'utf8'));
  assert.deepEqual(result, { outcome: 'quiescence_failed', exitCode: 0, terminationSignal: null });
  await waitFor(() => !processCanRun(grandchildPid));
});
