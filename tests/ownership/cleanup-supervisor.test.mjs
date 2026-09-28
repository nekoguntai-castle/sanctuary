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
    await new Promise((resolve) => nativeSetTimeout(resolve, 10));
  }
  assert.fail('condition did not become true before timeout');
}

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const FIXTURE_READY_MS = 5_000;
const FIXTURE_FALLBACK_MS = 8_000;
const FIXTURE_WATCHDOG_MS = 10_000;

function hasReadyPid(marker) {
  const pid = Number(readFileSync(marker, 'utf8'));
  return Number.isSafeInteger(pid) && pid > 1;
}

function readySubject(delayMs = 0) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-supervisor-ready-'));
  const marker = path.join(root, 'ready.pid');
  const program = `const { writeFileSync } = require('node:fs');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${delayMs});
    process.on('SIGTERM', () => {});
    writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)`;
  return { marker, args: ['-e', program, marker] };
}

async function controlledDeadline(t, args, exercise, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 100;
  let callback; let fallback; let registrations = 0; let fired = false; let launcher; let active = true;
  const timerMock = t.mock.method(globalThis, 'setTimeout', (fn, delay, ...values) => {
    if (delay !== timeoutMs) return nativeSetTimeout(fn, delay, ...values);
    registrations += 1;
    assert.equal(registrations, 1, 'exactly one operation deadline');
    callback = () => {
      assert.equal(active, true, 'operation deadline belongs to active fixture');
      assert.equal(fired, false, 'operation deadline fires once');
      fired = true;
      return fn.apply(fallback, values);
    };
    fallback = nativeSetTimeout(callback, FIXTURE_FALLBACK_MS);
    return fallback;
  });
  const fire = () => {
    assert.equal(registrations, 1);
    nativeClearTimeout(fallback);
    callback();
  };
  const running = runSupervisedCleanupCommand(node, args, {
    timeoutMs, graceMs: 20, killWaitMs: 500, ...options, signal: controller.signal,
    spawn: (...values) => { launcher = spawn(...values); return launcher; },
  });
  let watchdog;
  const expired = new Promise((_, reject) => {
    watchdog = nativeSetTimeout(() => {
      controller.abort(); reject(new Error('fixture watchdog expired'));
    }, FIXTURE_WATCHDOG_MS);
  });
  try {
    assert.equal(registrations, 1);
    return await Promise.race([(async () => { await exercise(fire, running); return running; })(), expired]);
  } finally {
    controller.abort();
    let cleanupTimer;
    try {
      await Promise.race([running, new Promise((_, reject) => {
        cleanupTimer = nativeSetTimeout(() => reject(new Error('fixture cleanup did not settle')), 2_000);
      })]);
      assert.equal(cleanupProcessGroupHasRunnableMember(launcher.pid), false);
    } finally {
      active = false;
      nativeClearTimeout(cleanupTimer); nativeClearTimeout(watchdog);
      nativeClearTimeout(fallback); timerMock.mock.restore();
    }
  }
}

test('operation deadline waits for deliberately delayed handler readiness', async (t) => {
  const fixture = readySubject(350);
  const result = await controlledDeadline(t, fixture.args, async (fire) => {
    await waitFor(() => hasReadyPid(fixture.marker), FIXTURE_READY_MS);
    fire();
  });
  assert.deepEqual(result, { outcome: 'timeout', exitCode: null, terminationSignal: 'SIGKILL' });
  assert.equal(processCanRun(Number(readFileSync(fixture.marker, 'utf8'))), false);
});

test('readiness and assertion failures still settle the owned command', async (t) => {
  for (const failure of ['readiness', 'before-fire', 'after-fire']) {
    const fixture = readySubject();
    await assert.rejects(controlledDeadline(t, fixture.args, async (fire) => {
      await waitFor(() => hasReadyPid(fixture.marker), FIXTURE_READY_MS);
      if (failure === 'readiness') await waitFor(() => false, 25);
      if (failure === 'after-fire') fire();
      assert.fail('fixture assertion failed');
    }), failure === 'readiness' ? /condition did not become true/ : /fixture assertion failed/);
    assert.equal(processCanRun(Number(readFileSync(fixture.marker, 'utf8'))), false);
  }
});

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

test('timeout and output caps terminate the dedicated process group', async (t) => {
  const timedOut = await runSupervisedCleanupCommand(node, ['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 25, graceMs: 20, killWaitMs: 500,
  });
  assert.equal(timedOut.outcome, 'timeout');
  assert.ok(['SIGTERM', 'SIGKILL'].includes(timedOut.terminationSignal));

  const resistant = readySubject();
  const killed = await controlledDeadline(t, resistant.args, async (fire) => {
    await waitFor(() => hasReadyPid(resistant.marker), FIXTURE_READY_MS);
    fire();
  });
  assert.deepEqual(killed, { outcome: 'timeout', exitCode: null, terminationSignal: 'SIGKILL' });

  const capped = await controlledDeadline(t, [
    '-e', "process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)",
  ], async () => {}, { maxOutputBytes: 128, timeoutMs: 1_000 });
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

test('timeout kills a grandchild in the supervised Linux process group', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-supervisor-'));
  const pidFile = path.join(root, 'grandchild.pid');
  const descendantProgram = "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)";
  const parentProgram = [
    "const { spawn } = require('node:child_process')",
    `spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {});" + ${JSON.stringify(descendantProgram)}, process.argv[1]], { stdio: 'ignore' })`,
    'setInterval(() => {}, 1000)',
  ].join(';');
  let grandchildPid;
  const result = await controlledDeadline(t, ['-e', parentProgram, pidFile], async (fire) => {
    await waitFor(() => hasReadyPid(pidFile), FIXTURE_READY_MS);
    grandchildPid = Number(readFileSync(pidFile, 'utf8'));
    assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 1);
    fire();
  });
  assert.equal(result.outcome, 'timeout');
  await waitFor(() => !processCanRun(grandchildPid));
});

test('a normally exiting leader cannot leave a runnable process-group member behind', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-supervisor-orphan-'));
  const pidFile = path.join(root, 'grandchild.pid');
  const parentProgram = [
    "const { spawn } = require('node:child_process')",
    "const { writeFileSync } = require('node:fs')",
    "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' })",
    'child.unref()',
    'writeFileSync(process.argv[1], String(child.pid))',
  ].join(';');
  const result = await controlledDeadline(t, ['-e', parentProgram, pidFile], async () => {}, {
    timeoutMs: 1_000,
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
