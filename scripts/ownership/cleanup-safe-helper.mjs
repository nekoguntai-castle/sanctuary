import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, closeSync, existsSync, fstatSync, openSync, readFileSync, readlinkSync, realpathSync,
  lstatSync, renameSync, statSync, unlinkSync,
} from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJson } from './canonical-json.mjs';

export const CLEANUP_SAFE_HELPER_ABI = 'sanctuary.cleanup-host.v1';
export const CLEANUP_SAFE_HELPER_MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_FIELD_BYTES = 4096;
const SOURCE = fileURLToPath(new URL('./native/cleanup-safe-helper.c', import.meta.url));
const PROCESS_STATES = new Set([
  'absent', 'ambiguous', 'current', 'exited', 'identity_changed', 'timeout', 'unsupported',
]);
const ENTRY_STATES = new Set([
  'absent', 'ambiguous', 'current', 'identity_changed', 'refused', 'removed', 'unsupported',
]);

function boundedString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
      || Buffer.byteLength(value) > MAX_FIELD_BYTES) {
    throw new TypeError(`${label} must be a bounded nonempty string without NUL bytes`);
  }
  return value;
}

function decimal(value, label) {
  const text = typeof value === 'bigint' ? value.toString() : String(value);
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) throw new TypeError(`${label} must be an unsigned decimal integer`);
  return text;
}

function exactObject(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...allowed].sort().join('\0')) {
    throw new Error(`${label} returned an invalid object`);
  }
  return value;
}

function validateInvocationBounds(timeoutMs, maxOutputBytes) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 660_000) {
    throw new TypeError('timeoutMs must be a bounded positive integer');
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 128
      || maxOutputBytes > CLEANUP_SAFE_HELPER_MAX_OUTPUT_BYTES) {
    throw new TypeError('maxOutputBytes is outside the helper protocol bound');
  }
}

function invocationFailureCategory(error) {
  if (error?.code === 'ENOBUFS') return 'output_limit';
  if (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM') return 'timeout';
  return error?.code === 'ENOENT' ? 'command_unavailable' : 'query_failed';
}

function helperResult(helperPath, args, {
  timeoutMs = 30_000, maxOutputBytes = CLEANUP_SAFE_HELPER_MAX_OUTPUT_BYTES,
  expectedHelperDigest, exec = execFileSync,
} = {}) {
  boundedString(helperPath, 'helperPath');
  const beforeDigest = validateHelperFile(helperPath);
  if (expectedHelperDigest !== undefined
      && beforeDigest !== validateDigest(expectedHelperDigest, 'expectedHelperDigest')) {
    throw new Error('cleanup safe helper digest changed before execution');
  }
  validateInvocationBounds(timeoutMs, maxOutputBytes);
  let output;
  try {
    output = exec(helperPath, args, {
      encoding: 'utf8', maxBuffer: maxOutputBytes, timeout: timeoutMs,
      windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const category = invocationFailureCategory(error);
    throw Object.assign(new Error(`cleanup safe helper failed (${category})`, { cause: error }), { category });
  }
  if (validateHelperFile(helperPath) !== beforeDigest) throw new Error('cleanup safe helper changed during execution');
  if (Buffer.byteLength(output) > maxOutputBytes) throw new Error('cleanup safe helper exceeded its output bound');
  return parseStrictJson(Buffer.from(output, 'utf8'));
}

function stateResult(helperPath, args, states, options) {
  const result = helperResult(helperPath, args, options);
  const keys = result.reason === undefined ? ['state'] : ['reason', 'state'];
  exactObject(result, keys, 'cleanup safe helper');
  if (!states.has(result.state)) throw new Error('cleanup safe helper returned an invalid state');
  if (result.reason !== undefined) boundedString(result.reason, 'helper reason');
  return Object.freeze(result);
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

function validateHelperFile(helperPath) {
  if (!path.isAbsolute(helperPath) || realpathSync(helperPath) !== helperPath) {
    throw new Error('cleanup safe helper path must be canonical and absolute');
  }
  const info = lstatSync(helperPath);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error('cleanup safe helper must be an owner-only regular file');
  }
  return sha256File(helperPath);
}

export function buildCleanupSafeHelper({
  outputPath, compiler = 'cc', sourcePath = SOURCE, exec = execFileSync,
} = {}) {
  boundedString(outputPath, 'outputPath');
  boundedString(compiler, 'compiler');
  boundedString(sourcePath, 'sourcePath');
  if (!path.isAbsolute(outputPath) || !path.isAbsolute(sourcePath)) {
    throw new Error('helper build paths must be absolute');
  }
  if (realpathSync(path.dirname(outputPath)) !== path.dirname(outputPath)) {
    throw new Error('compiled helper parent path must be canonical');
  }
  const parent = statSync(path.dirname(outputPath));
  if (!parent.isDirectory() || (parent.mode & 0o077) !== 0
      || (typeof process.getuid === 'function' && parent.uid !== process.getuid())) {
    throw new Error('compiled helper parent must be an owner-only directory');
  }
  if (existsSync(outputPath)) throw new Error('compiled helper output already exists');
  const staging = `${outputPath}.tmp-${process.pid}`;
  if (existsSync(staging)) throw new Error('compiled helper staging path already exists');
  try {
    exec(compiler, [
      '-std=c17', '-O2', '-Wall', '-Wextra', '-Werror', sourcePath, '-o', staging,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 60_000, shell: false });
    chmodSync(staging, 0o700);
    const info = statSync(staging);
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('compiled helper is not an owner-only regular file');
    renameSync(staging, outputPath);
  } catch (error) {
    if (existsSync(staging)) unlinkSync(staging);
    throw error;
  }
  return Object.freeze({ helperPath: outputPath, helperDigest: sha256File(outputPath) });
}

export function inspectCleanupSafeHelper(helperPath, options = {}) {
  const helperDigest = validateHelperFile(helperPath);
  const result = helperResult(helperPath, ['info'], options);
  exactObject(result, ['abiVersion', 'openat2', 'pidfd', 'platform', 'renameat2'], 'cleanup safe helper info');
  if (result.abiVersion !== CLEANUP_SAFE_HELPER_ABI || result.platform !== 'linux'
      || ['openat2', 'pidfd', 'renameat2'].some((key) => typeof result[key] !== 'boolean')) {
    throw new Error('cleanup safe helper ABI or feature response is incompatible');
  }
  if (validateHelperFile(helperPath) !== helperDigest) throw new Error('cleanup safe helper changed during inspection');
  return Object.freeze({ ...result, helperDigest });
}

function parseProcStat(text) {
  const close = text.lastIndexOf(')');
  if (close < 0 || text[close + 1] !== ' ') throw new Error('Linux process stat is malformed');
  const fields = text.slice(close + 2).trim().split(/ +/);
  if (fields.length < 20 || !/^[A-Za-z]$/.test(fields[0]) || !/^[0-9]+$/.test(fields[19])) {
    throw new Error('Linux process start identity is malformed');
  }
  return { state: fields[0], startTimeTicks: fields[19] };
}

function normalizePid(pid) {
  const text = decimal(pid, 'pid');
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > 0x7fffffff) {
    throw new TypeError('pid is outside the supported Linux PID range');
  }
  return { text, number };
}

function observeLinuxProcess(pid, readFile = readFileSync) {
  const normalized = normalizePid(pid);
  const bootId = readFile('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  boundedString(bootId, 'Linux boot ID');
  const processStat = parseProcStat(readFile(`/proc/${normalized.text}/stat`, 'utf8'));
  const common = {
    pid: normalized.text, startTimeTicks: processStat.startTimeTicks, bootId,
    bootIdDigest: sha256(bootId),
  };
  if (['Z', 'X', 'x'].includes(processStat.state)) return { ...common, state: 'exited' };
  const argv = readFile(`/proc/${normalized.text}/cmdline`);
  if (!Buffer.isBuffer(argv) || argv.length === 0 || argv.length > 1024 * 1024) {
    throw new Error('Linux process argv is unavailable or unbounded');
  }
  return {
    ...common, state: 'current', argvDigest: sha256(argv),
  };
}

export function readLinuxProcessIdentity(pid, { readFile = readFileSync } = {}) {
  const observed = observeLinuxProcess(pid, readFile);
  if (observed.state !== 'current') throw new Error('Linux process is not runnable');
  const { bootId: ignored, state: ignoredState, ...identity } = observed;
  return Object.freeze(identity);
}

export function readCleanupScriptIdentity(canonicalPath) {
  boundedString(canonicalPath, 'script canonicalPath');
  if (realpathSync(canonicalPath) !== canonicalPath) throw new Error('script path is not canonical');
  const descriptor = openSync(canonicalPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (readlinkSync(`/proc/self/fd/${descriptor}`) !== canonicalPath) throw new Error('script descriptor path changed');
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error('script is not a regular file');
    const scriptDigest = sha256(readFileSync(descriptor));
    const after = fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
      throw new Error('script changed while hashing');
    }
    return Object.freeze({
      canonicalPath, dev: before.dev.toString(), ino: before.ino.toString(), sha256: scriptDigest,
    });
  } finally { closeSync(descriptor); }
}

function validateDigest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function validateProcessAuthority(identity) {
  validateDigest(identity.bootIdDigest, 'bootIdDigest');
  validateDigest(identity.argvDigest, 'argvDigest');
  let observed;
  try { observed = observeLinuxProcess(identity.pid); } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return { state: 'absent' };
    return { state: 'ambiguous', reason: 'process_evidence_failed' };
  }
  if (observed.bootIdDigest !== identity.bootIdDigest
      || observed.startTimeTicks !== identity.startTimeTicks) {
    return { state: 'identity_changed' };
  }
  if (observed.state === 'exited') return { state: 'exited' };
  if (observed.argvDigest !== identity.argvDigest) return { state: 'identity_changed' };
  let observedScript;
  try { observedScript = readCleanupScriptIdentity(identity.script?.canonicalPath); } catch {
    return { state: 'ambiguous', reason: 'script_evidence_failed' };
  }
  for (const key of ['dev', 'ino', 'sha256']) {
    if (observedScript[key] !== identity.script?.[key]) return { state: 'identity_changed' };
  }
  return { state: 'current', bootId: observed.bootId };
}

function processArgs(command, { pid, startTimeTicks, signal = 15, timeoutMs = 10_000 }, bootId) {
  const normalizedPid = normalizePid(pid);
  const args = [command, normalizedPid.text, decimal(startTimeTicks, 'startTimeTicks'), boundedString(bootId, 'bootId')];
  if (command === 'stop-process') {
    if (!Number.isSafeInteger(signal) || signal < 1 || signal > 64) throw new TypeError('signal is invalid');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 600_000) throw new TypeError('timeoutMs is invalid');
    args.push(String(signal), String(timeoutMs));
  }
  return args;
}

export function inspectCleanupProcess(helperPath, identity, options = {}) {
  const evidence = validateProcessAuthority(identity);
  if (evidence.state !== 'current') return Object.freeze(evidence);
  return stateResult(
    helperPath, processArgs('inspect-process', identity, evidence.bootId), PROCESS_STATES, options,
  );
}

export function stopCleanupProcess(helperPath, identity, options = {}) {
  const evidence = validateProcessAuthority(identity);
  if (evidence.state !== 'current') return Object.freeze(evidence);
  const timeoutMs = identity.timeoutMs ?? 10_000;
  return stateResult(helperPath, processArgs(
    'stop-process', { ...identity, timeoutMs }, evidence.bootId,
  ), PROCESS_STATES, {
    ...options, timeoutMs: options.timeoutMs ?? timeoutMs + 5_000,
  });
}

function entryArgs(command, authority, quarantine) {
  const type = authority.entry?.type;
  if (!['file', 'directory'].includes(type)) throw new TypeError('entry type must be file or directory');
  const parentUid = decimal(authority.parent?.uid, 'parent uid');
  if (typeof process.getuid === 'function' && parentUid !== String(process.getuid())) {
    throw new Error('registered parent uid does not match the cleanup identity');
  }
  if (authority.parent?.mode !== 0o700) throw new Error('registered parent mode must equal 0700');
  if (authority.parent?.dev !== authority.entry?.dev) {
    throw new Error('registered parent and entry must share one device');
  }
  const basename = boundedString(authority.entry?.basename, 'entry basename');
  if (basename === '.' || basename === '..' || basename.includes('/')) throw new TypeError('entry basename is unsafe');
  const args = [
    command, boundedString(authority.parent?.canonicalPath, 'parent canonicalPath'), basename,
    decimal(authority.parent?.dev, 'parent dev'), decimal(authority.parent?.ino, 'parent ino'),
    decimal(authority.entry?.dev, 'entry dev'), decimal(authority.entry?.ino, 'entry ino'), type,
  ];
  if (quarantine !== undefined) args.push(boundedString(quarantine, 'quarantine name'));
  return args;
}

export function cleanupQuarantineName(intentDigest) {
  if (typeof intentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(intentDigest)) {
    throw new TypeError('intentDigest must be a lowercase SHA-256 digest');
  }
  return `.sanctuary-quarantine-${intentDigest}`;
}

export function inspectCleanupEntry(helperPath, authority, options = {}) {
  return stateResult(helperPath, entryArgs('inspect-entry', authority), ENTRY_STATES, options);
}

export function removeCleanupEntry(helperPath, authority, intentDigest, options = {}) {
  return stateResult(
    helperPath, entryArgs('remove-entry', authority, cleanupQuarantineName(intentDigest)),
    ENTRY_STATES, options,
  );
}

function worktreeArgs(command, authority, quarantine) {
  if (authority.entry?.type !== 'directory' || authority.adminEntry?.type !== 'directory') {
    throw new TypeError('worktree and admin entries must be directories');
  }
  if (authority.commonDir?.dev !== authority.adminEntry?.dev) {
    throw new Error('registered common directory and admin entry must share one device');
  }
  const adminBasename = boundedString(authority.adminEntry?.basename, 'admin entry basename');
  if (adminBasename === '.' || adminBasename === '..' || adminBasename.includes('/')) {
    throw new TypeError('admin entry basename is unsafe');
  }
  return [
    ...entryArgs(command, authority, quarantine),
    boundedString(authority.commonDir?.canonicalPath, 'common directory canonicalPath'),
    decimal(authority.commonDir?.dev, 'common directory dev'),
    decimal(authority.commonDir?.ino, 'common directory ino'),
    adminBasename,
    decimal(authority.adminEntry?.dev, 'admin entry dev'),
    decimal(authority.adminEntry?.ino, 'admin entry ino'),
    authority.adminEntry.type,
  ];
}

export function removeCleanupWorktree(helperPath, authority, intentDigest, options = {}) {
  return stateResult(
    helperPath, worktreeArgs('remove-worktree', authority, cleanupQuarantineName(intentDigest)), ENTRY_STATES, options,
  );
}

export function inspectCleanupWorktree(helperPath, authority, options = {}) {
  return stateResult(
    helperPath, worktreeArgs('inspect-worktree', authority, '.sanctuary-quarantine-inspection'),
    ENTRY_STATES, options,
  );
}

export const CLEANUP_SAFE_HELPER_SOURCE = SOURCE;
