import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const DEFAULT_COMMAND_OUTPUT_LIMIT = 8 * 1024 * 1024;

export class CleanupCommandError extends Error {
  constructor(category, operation, cause) {
    super(`${operation} failed (${category})`, { cause });
    this.name = 'CleanupCommandError';
    this.category = category;
    this.operation = operation;
  }
}

function commandCategory(error) {
  if (error?.code === 'ENOBUFS') return 'output_limit';
  if (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM') return 'timeout';
  if (error?.code === 'ENOENT') return 'command_unavailable';
  const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr ?? '');
  if (/permission denied|access denied|not authorized/i.test(stderr)) return 'permission_denied';
  return 'query_failed';
}

function validateCommand(executable, args) {
  if (typeof executable !== 'string' || executable.length === 0 || executable.includes('\0')) {
    throw new TypeError('command executable must be a nonempty string');
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new TypeError('command arguments must be strings without NUL bytes');
  }
}

function commandOptions(executable, options) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_COMMAND_OUTPUT_LIMIT;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive integer');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new TypeError('maxOutputBytes must be a positive integer');
  return {
    operation: options.operation ?? `${executable} query`,
    run: options.execFileSync ?? execFileSync,
    spawn: {
      cwd: options.cwd, env: options.env, encoding: 'utf8', input: options.input,
      maxBuffer: maxOutputBytes, timeout: timeoutMs, windowsHide: true, shell: false,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    },
  };
}

/**
 * Opt-in diagnostics (R5-B phase 1 of tasks/ci-install-lane-speedup-design-2026-09-29.md):
 * when set, every engine invocation appends one JSON line naming its operation,
 * subcommand, outcome and duration. Option values (sockets, filters, names) are
 * never recorded, and a trace write failure never changes a command's result.
 */
export const CLEANUP_ENGINE_TRACE_FILE_ENV = 'SANCTUARY_CLEANUP_ENGINE_TRACE_FILE';
const OPTIONS_WITH_VALUES = new Set([
  '--host', '-H', '--url', '--context', '--connection', '--filter', '-f', '--format',
  '-p', '--project-name', '--project-directory', '--env-file', '--profile', '--file',
  '--config', '-c', '-l', '--log-level',
]);
let traceWriteFailed = false;

function traceCommandWords(args) {
  const words = [];
  for (let index = 0; index < args.length && words.length < 2; index += 1) {
    const arg = args[index];
    if (OPTIONS_WITH_VALUES.has(arg)) index += 1;
    else if (!arg.startsWith('-')) words.push(arg);
  }
  return words;
}

function recordEngineTrace(executable, args, operation, startedAt, outcome) {
  const traceFile = process.env[CLEANUP_ENGINE_TRACE_FILE_ENV];
  if (!traceFile || traceWriteFailed) return;
  const record = {
    executable: path.basename(executable), operation, command: traceCommandWords(args), outcome,
    durationMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
  };
  try {
    appendFileSync(traceFile, `${JSON.stringify(record)}\n`);
  } catch {
    // Diagnostics are best effort: stop tracing rather than fail cleanup.
    traceWriteFailed = true;
  }
}

/** Run one bounded argv command directly. A shell is never involved. */
export function runCleanupCommand(executable, args, options = {}) {
  validateCommand(executable, args);
  const { operation, run, spawn } = commandOptions(executable, options);
  const startedAt = process.hrtime.bigint();
  let output;
  try {
    output = run(executable, args, spawn);
  } catch (error) {
    const classified = error instanceof CleanupCommandError
      ? error
      : new CleanupCommandError(commandCategory(error), operation, error);
    recordEngineTrace(executable, args, operation, startedAt, classified.category);
    throw classified;
  }
  recordEngineTrace(executable, args, operation, startedAt, 'success');
  return output;
}

export function commandAmbiguity(error, details = {}) {
  const category = error instanceof CleanupCommandError ? error.category : (error?.category ?? 'query_failed');
  return { category, operation: error?.operation ?? details.operation ?? 'runtime query', ...details };
}
