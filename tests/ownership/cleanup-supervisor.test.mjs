import assert from 'node:assert/strict';
import {
  chmodSync, constants as fsConstants, copyFileSync, existsSync, mkdtempSync, readFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cleanupProcessGroupHasRunnableMember, runSupervisedCleanupCommand,
} from '../../scripts/ownership/cleanup-supervisor.mjs';

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

test('supervisor uses the live Node inode after its launcher path is removed', {
  skip: process.platform !== 'linux',
}, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-supervisor-node-runtime-'));
  const transientNode = path.join(root, 'subject-managed-node');
  copyFileSync(process.execPath, transientNode, fsConstants.COPYFILE_FICLONE);
  chmodSync(transientNode, 0o700);
  const supervisorModule = new URL(
    '../../scripts/ownership/cleanup-supervisor.mjs', import.meta.url,
  ).href;
  const source = `
    import { unlinkSync } from 'node:fs';
    import { runSupervisedCleanupCommand } from ${JSON.stringify(supervisorModule)};
    unlinkSync(process.execPath);
    const result = await runSupervisedCleanupCommand('/bin/true', []);
    process.stdout.write(JSON.stringify(result));
  `;
  const result = spawnSync(transientNode, ['--input-type=module', '-e', source], {
    cwd: path.resolve('.'), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    outcome: 'success', exitCode: 0, terminationSignal: null,
  });
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
  assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 1);
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

test('controller SIGKILL terminates the mutation client and its process-group descendants',
  { timeout: 5_000 }, async (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-supervisor-parent-death-'));
    const clientPidFile = path.join(root, 'client.pid');
    const descendantPidFile = path.join(root, 'descendant.pid');
    const marker = path.join(root, 'delayed-marker');
    const descendantProgram = [
      "const { writeFileSync } = require('node:fs')",
      'process.on(\'SIGTERM\', () => {})',
      'writeFileSync(process.argv[1], String(process.pid))',
      'setTimeout(() => writeFileSync(process.argv[2], \'unsafe\'), 400)',
      'setInterval(() => {}, 1000)',
    ].join(';');
    const clientProgram = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      `spawn(process.execPath, ['-e', ${JSON.stringify(descendantProgram)}, process.argv[2], process.argv[3]], { stdio: 'ignore' })`,
      'writeFileSync(process.argv[1], String(process.pid))',
      'setInterval(() => {}, 1000)',
    ].join(';');
    const supervisorModule = new URL(
      '../../scripts/ownership/cleanup-supervisor.mjs', import.meta.url,
    ).href;
    const controllerSource = `
      import { runSupervisedCleanupCommand } from ${JSON.stringify(supervisorModule)};
      await runSupervisedCleanupCommand(process.execPath, [
        '-e', ${JSON.stringify(clientProgram)}, ${JSON.stringify(clientPidFile)},
        ${JSON.stringify(descendantPidFile)}, ${JSON.stringify(marker)},
      ], { graceMs: 40, killWaitMs: 500 });
    `;
    const controller = spawn(node, ['--input-type=module', '-e', controllerSource], {
      detached: true, stdio: 'ignore',
    });
    t.after(() => {
      if (controller.exitCode === null && controller.signalCode === null) {
        try { process.kill(-controller.pid, 'SIGKILL'); } catch {}
      }
    });
    await waitFor(() => existsSync(clientPidFile) && existsSync(descendantPidFile));
    const clientPid = Number(readFileSync(clientPidFile, 'utf8'));
    const descendantPid = Number(readFileSync(descendantPidFile, 'utf8'));
    t.after(() => {
      try { process.kill(-clientPid, 'SIGKILL'); } catch {}
    });
    assert.equal(processCanRun(clientPid), true);
    assert.equal(processCanRun(descendantPid), true);
    process.kill(-controller.pid, 'SIGKILL');
    await waitFor(() => !processCanRun(clientPid));
    await waitFor(() => !processCanRun(descendantPid));
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(existsSync(marker), false);
  });

test('launcher proc inspection failure quiesces the detached child group before exit',
  { timeout: 5_000 }, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-launcher-proc-failure-'));
    const descendantPidFile = path.join(root, 'descendant.pid');
    const program = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const child = spawn(process.execPath, ['-e', 'process.on(\"SIGTERM\",()=>{});setInterval(()=>{},1000)'], { stdio: 'ignore' })",
      'writeFileSync(process.argv[1], String(child.pid))',
      'child.unref()',
      'process.exit(0)',
    ].join(';');
    const result = await runSupervisedCleanupCommand(node, ['-e', program, descendantPidFile], {
      graceMs: 30, killWaitMs: 500,
      env: { ...process.env, SANCTUARY_TEST_LAUNCHER_PROC_FAILURE_ONCE: '1' },
    });
    const descendantPid = Number(readFileSync(descendantPidFile, 'utf8'));
    assert.notEqual(result.outcome, 'success');
    await waitFor(() => !processCanRun(descendantPid));
  });

test('launcher refuses a stale expected controller before spawning the mutation client', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-launcher-parent-race-'));
  const marker = path.join(root, 'spawned');
  const launcher = new URL('../../scripts/ownership/cleanup-process-group-launcher.mjs', import.meta.url);
  const child = spawn(node, [launcher.pathname, '--grace-ms', '20', '--kill-wait-ms', '50',
    '--expected-ppid', '1', '--', node, '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`]);
  const [code] = await once(child, 'exit');
  assert.equal(code, 125);
  assert.equal(existsSync(marker), false);
});

// Issue #1013: on a loaded runner an unrelated process can exit between the
// /proc directory listing and the read of its stat file. Linux then reports
// ESRCH (not ENOENT) for the vanished task, which the scan used to rethrow,
// turning an exited /bin/true into `quiescence_failed`.
test('process group scan skips tasks that vanish mid-read with ESRCH', {
  skip: process.platform !== 'linux',
}, () => {
  const child = spawn(node, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  try {
    const vanishing = new Set([String(process.pid)]);
    const readStat = (pid) => {
      if (vanishing.has(pid)) {
        throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      }
      return readFileSync(`/proc/${pid}/stat`);
    };
    assert.equal(cleanupProcessGroupHasRunnableMember(child.pid, { readStat }), true);
    for (const entry of ['EACCES', 'EIO']) {
      assert.throws(
        () => cleanupProcessGroupHasRunnableMember(child.pid, {
          readStat: () => { throw Object.assign(new Error(entry), { code: entry }); },
        }),
        (error) => error.code === entry,
      );
    }
  } finally {
    process.kill(-child.pid, 'SIGKILL');
  }
});
