import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const monotonicNow = () => performance.now();
const run = (args, timeoutMs) => execFileSync(args[0], args.slice(1), {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: timeoutMs,
});
const probeDatabase = (args, timeoutMs) => run(args, timeoutMs);
const databaseContainerRunning = (name, timeoutMs) => run([
  'docker', 'inspect', '--format', '{{.State.Running}}', name,
], timeoutMs).trim();
const waitForInterval = milliseconds => new Promise(resolvePromise => (
  setTimeout(resolvePromise, milliseconds)
));
const noTermination = () => {};

function databaseProbeSucceeded(probe, args, timeoutMs) {
  try {
    return String(probe(args, timeoutMs)).trim() === '1';
  } catch {
    return false;
  }
}

function remainingBudget(deadline, now) {
  const remainingMs = deadline - now();
  if (remainingMs <= 0) throw new Error('PostgreSQL readiness timeout');
  return remainingMs;
}

function requireRunningContainer(state) {
  if (state === 'true') return;
  if (state === 'false') throw new Error('PostgreSQL container exited before readiness');
  throw new Error('PostgreSQL container running state became unavailable');
}

export async function waitForDatabaseReadiness(names, password, runtime = {}) {
  const {
    timeoutMs = 30_000,
    intervalMs = 100,
    now = monotonicNow,
    probe = probeDatabase,
    running = databaseContainerRunning,
    wait = waitForInterval,
    throwIfTerminated = noTermination,
  } = runtime;
  const deadline = now() + timeoutMs;
  const probeArgs = [
    'docker', 'exec', '--env', `PGPASSWORD=${password}`, names.postgres,
    'psql', '--host', '127.0.0.1', '--username', 'sanctuary',
    '--dbname', 'sanctuary_replay', '--set', 'ON_ERROR_STOP=1',
    '--tuples-only', '--no-align', '--command', 'SELECT 1',
  ];

  for (;;) {
    throwIfTerminated();
    let remainingMs = remainingBudget(deadline, now);
    if (databaseProbeSucceeded(probe, probeArgs, Math.min(2_000, remainingMs))) {
      remainingBudget(deadline, now);
      return;
    }
    throwIfTerminated();
    remainingMs = remainingBudget(deadline, now);
    requireRunningContainer(running(names.postgres, Math.min(2_000, remainingMs)));
    remainingMs = remainingBudget(deadline, now);
    await wait(Math.min(intervalMs, remainingMs));
  }
}
