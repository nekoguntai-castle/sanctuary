import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveNodeExecutable } from './runtime-executable.mjs';

export const DEFAULT_SUPERVISOR_TIMEOUT_MS = 30_000;
export const DEFAULT_SUPERVISOR_GRACE_MS = 2_000;
export const DEFAULT_SUPERVISOR_KILL_WAIT_MS = 2_000;
export const DEFAULT_SUPERVISOR_OUTPUT_LIMIT = 8 * 1024 * 1024;

const OUTCOMES = new Set([
  'success', 'command_failed', 'timeout', 'cancelled', 'output_limit',
  'command_unavailable', 'permission_denied', 'spawn_failed', 'quiescence_failed',
]);
const LINUX_PARENT_DEATH_LAUNCHERS = Object.freeze(['/usr/bin/setpriv', '/bin/setpriv']);
const PROCESS_GROUP_LAUNCHER = fileURLToPath(new URL('./cleanup-process-group-launcher.mjs', import.meta.url));
const LAUNCHER_STATUS_LIMIT = 1_024;

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function validateCommand(executable, args) {
  if (typeof executable !== 'string' || executable.length === 0 || executable.includes('\0')) {
    throw new TypeError('command executable must be a nonempty string');
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new TypeError('command arguments must be strings without NUL bytes');
  }
}

function publicResult(outcome, exitCode = null, terminationSignal = null) {
  if (!OUTCOMES.has(outcome)) throw new Error('unknown cleanup supervision outcome');
  return Object.freeze({ outcome, exitCode, terminationSignal });
}

function spawnFailure(error) {
  if (error?.code === 'ENOENT') return 'command_unavailable';
  if (error?.code === 'EACCES') return 'permission_denied';
  return 'spawn_failed';
}

function executableStatus(filePath) {
  try {
    accessSync(filePath, fsConstants.X_OK);
    return 'available';
  } catch (error) {
    return error?.code === 'EACCES' ? 'permission_denied' : 'command_unavailable';
  }
}

function resolveExecutable(executable, { cwd, env }) {
  const workingDirectory = cwd ?? process.cwd();
  if (executable.includes('/')) {
    const resolved = path.resolve(workingDirectory, executable);
    const status = executableStatus(resolved);
    return status === 'available' ? { executable: resolved } : { outcome: status };
  }
  const searchPath = env?.PATH ?? process.env.PATH ?? '/usr/bin:/bin';
  let permissionDenied = false;
  for (const directory of searchPath.split(path.delimiter)) {
    const candidate = path.resolve(workingDirectory, directory || '.', executable);
    const status = executableStatus(candidate);
    if (status === 'available') return { executable: candidate };
    if (status === 'permission_denied') permissionDenied = true;
  }
  return { outcome: permissionDenied ? 'permission_denied' : 'command_unavailable' };
}

function parentDeathLaunch(executable, args, options) {
  const command = resolveExecutable(executable, options);
  if (command.outcome) return command;
  const launcher = LINUX_PARENT_DEATH_LAUNCHERS.find((candidate) => (
    executableStatus(candidate) === 'available'
  ));
  if (!launcher) return { outcome: 'command_unavailable' };
  const launcherKillWaitMs = Math.max(1, Math.floor(options.killWaitMs / 2));
  return {
    executable: launcher,
    args: [
      '--pdeathsig', 'SIGTERM', '--', liveNodeExecutable(), PROCESS_GROUP_LAUNCHER,
      '--grace-ms', String(options.graceMs), '--kill-wait-ms', String(launcherKillWaitMs),
      '--expected-ppid', String(process.pid),
      '--', command.executable, ...args,
    ],
  };
}

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function processGroupState(statBytes, groupId) {
  const text = statBytes.toString('utf8');
  const commandEnd = text.lastIndexOf(')');
  if (commandEnd < 0) throw new Error('malformed Linux process stat');
  const fields = text.slice(commandEnd + 2).trim().split(/\s+/);
  const parsedGroup = Number(fields[2]);
  if (!Number.isSafeInteger(parsedGroup) || typeof fields[0] !== 'string') {
    throw new Error('malformed Linux process stat');
  }
  if (parsedGroup !== groupId) return 'different_group';
  return ['Z', 'X'].includes(fields[0]) ? 'non_runnable' : 'runnable';
}

export function cleanupProcessGroupHasRunnableMember(groupId) {
  if (!groupExists(groupId)) return false;
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (processGroupState(readFileSync(`/proc/${entry}/stat`), groupId) === 'runnable') {
        return true;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

/**
 * Run one mutation client in its own process group. Output is counted and
 * discarded; callers receive only bounded categorical state.
 */
export function runSupervisedCleanupCommand(executable, args, options = {}) {
  validateCommand(executable, args);
  if (process.platform !== 'linux') throw new Error('cleanup mutation supervision requires Linux process groups');
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_SUPERVISOR_TIMEOUT_MS, 'timeoutMs');
  const graceMs = positiveInteger(options.graceMs ?? DEFAULT_SUPERVISOR_GRACE_MS, 'graceMs');
  const killWaitMs = positiveInteger(options.killWaitMs ?? DEFAULT_SUPERVISOR_KILL_WAIT_MS, 'killWaitMs');
  const maxOutputBytes = positiveInteger(options.maxOutputBytes ?? DEFAULT_SUPERVISOR_OUTPUT_LIMIT, 'maxOutputBytes');
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new TypeError('signal must be an AbortSignal');
  }
  if (options.signal?.aborted) return Promise.resolve(publicResult('cancelled'));
  const launch = parentDeathLaunch(executable, args, { ...options, graceMs, killWaitMs });
  if (launch.outcome) return Promise.resolve(publicResult(launch.outcome));

  return new Promise((resolve) => {
    let child;
    let settled = false;
    let terminationOutcome = null;
    let outputBytes = 0;
    let launcherStatusBytes = 0;
    let launcherStatus = '';
    let timeout;
    let graceTimeout;
    let killWaitTimeout;
    let quiescencePoll;

    const clearTimers = () => {
      clearTimeout(timeout);
      clearTimeout(graceTimeout);
      clearTimeout(killWaitTimeout);
      clearTimeout(quiescencePoll);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimers();
      options.signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const kill = () => {
      if (!child?.pid || settled) return;
      try { signalGroup(child.pid, 'SIGUSR2'); } catch { terminationOutcome = 'quiescence_failed'; }
      killWaitTimeout = setTimeout(() => {
        try { signalGroup(child.pid, 'SIGUSR2'); } catch {}
        finish(publicResult('quiescence_failed'));
      }, killWaitMs);
    };
    const finishAfterGroupExit = (code, signal, outcome = terminationOutcome) => {
      clearTimeout(graceTimeout);
      clearTimeout(killWaitTimeout);
      let exists;
      try { exists = cleanupProcessGroupHasRunnableMember(child.pid); } catch {
        finish(publicResult('quiescence_failed', code, signal));
        return;
      }
      if (!exists) {
        finish(publicResult(outcome, code, signal));
        return;
      }
      const survivorsAreFailure = terminationOutcome === null;
      const finalOutcome = survivorsAreFailure ? 'quiescence_failed' : outcome;
      const pollAfterKill = (deadline) => {
        let alive;
        try { alive = cleanupProcessGroupHasRunnableMember(child.pid); } catch {
          finish(publicResult('quiescence_failed', code, signal));
          return;
        }
        if (!alive) finish(publicResult(finalOutcome, code, signal));
        else if (Date.now() >= deadline) finish(publicResult('quiescence_failed', code, signal));
        else quiescencePoll = setTimeout(() => pollAfterKill(deadline), 10);
      };
      const forceAndPoll = () => {
        try { signalGroup(child.pid, 'SIGKILL'); } catch {
          finish(publicResult('quiescence_failed', code, signal));
          return;
        }
        quiescencePoll = setTimeout(() => pollAfterKill(Date.now() + killWaitMs), 10);
      };
      if (survivorsAreFailure) {
        try { signalGroup(child.pid, 'SIGTERM'); } catch {
          finish(publicResult('quiescence_failed', code, signal));
          return;
        }
        graceTimeout = setTimeout(forceAndPoll, graceMs);
      } else forceAndPoll();
    };
    const terminate = (outcome) => {
      if (terminationOutcome || settled) return;
      terminationOutcome = outcome;
      if (!child?.pid) return;
      try {
        if (!signalGroup(child.pid, 'SIGTERM')) return;
      } catch {
        terminationOutcome = 'quiescence_failed';
        kill();
        return;
      }
      graceTimeout = setTimeout(kill, graceMs);
    };
    const abort = () => terminate('cancelled');
    const countOutput = (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes) terminate('output_limit');
    };
    const countLauncherStatus = (chunk) => {
      launcherStatusBytes += Buffer.byteLength(chunk);
      if (launcherStatusBytes > LAUNCHER_STATUS_LIMIT) {
        terminationOutcome = 'quiescence_failed';
        kill();
        return;
      }
      launcherStatus += chunk.toString('utf8');
    };
    const launcherReportedOrphan = (code, signal) => {
      if (launcherStatus === '') return false;
      const parsed = JSON.parse(launcherStatus);
      if (parsed?.orphaned !== true
          || Object.keys(parsed).sort().join('\0') !== 'code\0orphaned\0signal'
          || parsed.code !== code || parsed.signal !== signal) {
        throw new Error('cleanup launcher status is invalid');
      }
      return true;
    };

    try {
      child = (options.spawn ?? spawn)(launch.executable, launch.args, {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(publicResult(spawnFailure(error)));
      return;
    }

    child.stdout?.on('data', countOutput);
    child.stderr?.on('data', countOutput);
    child.stdio?.[3]?.on('data', countLauncherStatus);
    child.once('error', (error) => finish(publicResult(spawnFailure(error))));
    child.once('close', (code, signal) => {
      if (terminationOutcome) finishAfterGroupExit(code, signal);
      else {
        let reportedOrphan;
        try { reportedOrphan = launcherReportedOrphan(code, signal); } catch {
          finishAfterGroupExit(code, signal, 'quiescence_failed');
          return;
        }
        finishAfterGroupExit(code, signal, code === 125 || reportedOrphan ? 'quiescence_failed'
          : code === 0 ? 'success' : 'command_failed');
      }
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    timeout = setTimeout(() => terminate('timeout'), timeoutMs);
  });
}
