import { execFileSync } from 'node:child_process';

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

/** Run one bounded argv command directly. A shell is never involved. */
export function runCleanupCommand(executable, args, options = {}) {
  validateCommand(executable, args);
  const { operation, run, spawn } = commandOptions(executable, options);
  try {
    return run(executable, args, spawn);
  } catch (error) {
    if (error instanceof CleanupCommandError) throw error;
    throw new CleanupCommandError(commandCategory(error), operation, error);
  }
}

export function commandAmbiguity(error, details = {}) {
  const category = error instanceof CleanupCommandError ? error.category : (error?.category ?? 'query_failed');
  return { category, operation: error?.operation ?? details.operation ?? 'runtime query', ...details };
}
