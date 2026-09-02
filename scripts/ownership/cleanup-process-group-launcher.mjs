#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const ORPHANED_GROUP_EXIT = 125;
const POLL_MS = 10;

function positiveInteger(value, label) {
  if (!/^[1-9][0-9]*$/.test(value ?? '')) throw new TypeError(`${label} must be positive`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} is too large`);
  return parsed;
}

function parseArguments(argv) {
  if (argv[0] !== '--grace-ms' || argv[2] !== '--kill-wait-ms'
      || argv[4] !== '--expected-ppid' || argv[6] !== '--') {
    throw new TypeError('cleanup launcher arguments are invalid');
  }
  const executable = argv[7];
  if (!executable || executable.includes('\0')) throw new TypeError('cleanup executable is invalid');
  const args = argv.slice(8);
  if (args.some((entry) => entry.includes('\0'))) throw new TypeError('cleanup arguments are invalid');
  return {
    graceMs: positiveInteger(argv[1], 'graceMs'),
    killWaitMs: positiveInteger(argv[3], 'killWaitMs'),
    expectedPpid: positiveInteger(argv[5], 'expectedPpid'), executable, args,
  };
}

function processGroupState(statBytes, groupId) {
  const text = statBytes.toString('utf8');
  const commandEnd = text.lastIndexOf(')');
  if (commandEnd < 0) throw new Error('malformed Linux process stat');
  const fields = text.slice(commandEnd + 2).trim().split(/\s+/);
  if (Number(fields[2]) !== groupId) return 'different_group';
  return ['Z', 'X'].includes(fields[0]) ? 'non_runnable' : 'runnable';
}

function groupHasRunnableMember(groupId) {
  if (process.env.SANCTUARY_TEST_LAUNCHER_PROC_FAILURE_ONCE === '1') {
    delete process.env.SANCTUARY_TEST_LAUNCHER_PROC_FAILURE_ONCE;
    throw new Error('injected process inspection failure');
  }
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (processGroupState(readFileSync(`/proc/${entry}/stat`), groupId) === 'runnable') return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

function signalGroup(groupId, signal) {
  try { process.kill(-groupId, signal); } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function quiesceGroupBeforeFatal(groupId, config) {
  try { signalGroup(groupId, 'SIGTERM'); } catch {}
  const graceDeadline = Date.now() + config.graceMs;
  while (Date.now() < graceDeadline) {
    try { if (!groupHasRunnableMember(groupId)) return; } catch {}
    sleepSync(POLL_MS);
  }
  try { signalGroup(groupId, 'SIGKILL'); } catch {}
  const killDeadline = Date.now() + config.killWaitMs;
  while (Date.now() < killDeadline) {
    try { if (!groupHasRunnableMember(groupId)) return; } catch {}
    sleepSync(POLL_MS);
  }
}

function mirrorTermination(code, signal) {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(Number.isInteger(code) ? code : 1);
}

function reportOrphanedGroup(childExit) {
  try {
    writeFileSync(3, `${JSON.stringify({
      orphaned: true, code: childExit?.code ?? null, signal: childExit?.signal ?? null,
    })}\n`);
  } catch {
    process.exit(ORPHANED_GROUP_EXIT);
  }
}

function launch(config) {
  let child;
  let childExit = null;
  let requestedSignal = null;
  let forced = false;
  let orphaned = false;
  let graceTimer;
  let pollTimer;
  let killDeadline = 0;
  const fatalAfterSpawn = () => {
    if (child?.pid) quiesceGroupBeforeFatal(child.pid, config);
    process.exit(ORPHANED_GROUP_EXIT);
  };

  const finish = () => {
    if (orphaned) {
      reportOrphanedGroup(childExit);
      mirrorTermination(childExit?.code, childExit?.signal);
      return;
    }
    mirrorTermination(childExit?.code, forced ? 'SIGKILL' : (requestedSignal ?? childExit?.signal));
  };
  const poll = () => {
    let runnable;
    try { runnable = groupHasRunnableMember(child.pid); } catch { fatalAfterSpawn(); }
    if (!runnable) {
      clearTimeout(graceTimer);
      finish();
      return;
    }
    if (forced && Date.now() >= killDeadline) {
      signalGroup(child.pid, 'SIGKILL');
      process.exit(ORPHANED_GROUP_EXIT);
    }
    pollTimer = setTimeout(poll, POLL_MS);
  };
  const force = () => {
    if (forced || !child?.pid) return;
    forced = true;
    killDeadline = Date.now() + config.killWaitMs;
    try { signalGroup(child.pid, 'SIGKILL'); } catch { fatalAfterSpawn(); }
    poll();
  };
  const terminate = (signal) => {
    requestedSignal ??= signal;
    if (!child?.pid) return;
    if (signal === 'SIGKILL') {
      force();
      return;
    }
    try { signalGroup(child.pid, 'SIGTERM'); } catch { fatalAfterSpawn(); }
    graceTimer ??= setTimeout(force, config.graceMs);
    pollTimer ??= setTimeout(poll, POLL_MS);
  };

  process.on('SIGTERM', () => terminate('SIGTERM'));
  process.on('SIGUSR2', () => terminate('SIGKILL'));
  if (process.ppid !== config.expectedPpid) process.exit(ORPHANED_GROUP_EXIT);
  child = spawn(config.executable, config.args, {
    detached: true, shell: false, stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (process.ppid !== config.expectedPpid) fatalAfterSpawn();
  child.once('error', (error) => process.exit(error.code === 'EACCES' ? 126 : 127));
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
    if (requestedSignal) {
      poll();
      return;
    }
    let survivors;
    try { survivors = groupHasRunnableMember(child.pid); } catch { fatalAfterSpawn(); }
    if (!survivors) {
      mirrorTermination(code, signal);
      return;
    }
    orphaned = true;
    terminate('SIGTERM');
  });
  if (requestedSignal) terminate(requestedSignal);
}

try {
  launch(parseArguments(process.argv.slice(2)));
} catch {
  process.exit(127);
}
