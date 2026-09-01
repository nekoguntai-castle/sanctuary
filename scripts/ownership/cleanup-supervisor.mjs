import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

export const DEFAULT_SUPERVISOR_TIMEOUT_MS = 30_000;
export const DEFAULT_SUPERVISOR_GRACE_MS = 2_000;
export const DEFAULT_SUPERVISOR_KILL_WAIT_MS = 2_000;
export const DEFAULT_SUPERVISOR_OUTPUT_LIMIT = 8 * 1024 * 1024;

const OUTCOMES = new Set([
  'success', 'command_failed', 'timeout', 'cancelled', 'output_limit',
  'command_unavailable', 'permission_denied', 'spawn_failed', 'quiescence_failed',
]);

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

  return new Promise((resolve) => {
    let child;
    let settled = false;
    let terminationOutcome = null;
    let outputBytes = 0;
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
      try { signalGroup(child.pid, 'SIGKILL'); } catch { terminationOutcome = 'quiescence_failed'; }
      killWaitTimeout = setTimeout(() => {
        try { signalGroup(child.pid, 'SIGKILL'); } catch {}
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

    try {
      child = (options.spawn ?? spawn)(executable, args, {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(publicResult(spawnFailure(error)));
      return;
    }

    child.stdout?.on('data', countOutput);
    child.stderr?.on('data', countOutput);
    child.once('error', (error) => finish(publicResult(spawnFailure(error))));
    child.once('close', (code, signal) => {
      if (terminationOutcome) finishAfterGroupExit(code, signal);
      else finishAfterGroupExit(code, signal, code === 0 ? 'success' : 'command_failed');
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    timeout = setTimeout(() => terminate('timeout'), timeoutMs);
  });
}
