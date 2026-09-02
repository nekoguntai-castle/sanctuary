import { randomUUID } from 'node:crypto';
import {
  closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { sha256 } from './crypto.mjs';

export class DeploymentLockConflict extends Error {
  constructor(message, inspection) {
    super(message);
    this.name = 'DeploymentLockConflict';
    this.code = 'DEPLOYMENT_LOCK_CONFLICT';
    this.inspection = inspection;
  }
}

function ensureOwnerDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== path.resolve(directory)) throw new Error(`lock parent must not traverse a symlink: ${directory}`);
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`lock parent is not a real directory: ${directory}`);
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error(`lock parent is not owned by this user: ${directory}`);
  if ((info.mode & 0o077) !== 0) throw new Error(`lock parent must be owner-only: ${directory}`);
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

export function parseLinuxProcessIdentity(stat) {
  const close = stat.lastIndexOf(')');
  const fields = stat.slice(close + 2).split(' ');
  return fields[19] ? {
    startIdentity: `linux-boot-ticks:${fields[19]}`,
    runnable: !['Z', 'X'].includes(fields[0]),
  } : null;
}

export function processIdentityMatches(observation, expectedStartIdentity) {
  return observation.runnable && observation.startIdentity === expectedStartIdentity;
}

function linuxProcessIdentity(pid) {
  try { return parseLinuxProcessIdentity(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return null; }
}

export function readProcessStartIdentity(pid = process.pid) {
  const linux = linuxProcessIdentity(pid);
  if (linux) return linux.startIdentity;
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  const start = result.status === 0 ? result.stdout.trim() : '';
  if (!start) throw new Error(`cannot determine process start identity for PID ${pid}`);
  return `ps-lstart:${start}`;
}

function processMatches(owner) {
  try { process.kill(owner.pid, 0); } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code !== 'EPERM') throw error;
  }
  const linux = linuxProcessIdentity(owner.pid);
  if (linux) return processIdentityMatches(linux, owner.processStartIdentity);
  try { return readProcessStartIdentity(owner.pid) === owner.processStartIdentity; } catch { return null; }
}

function ownerPath(lockPath) { return path.join(lockPath, 'owner.json'); }

function writeOwnerAtomic(lockPath, owner) {
  const target = ownerPath(lockPath);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, canonicalJson(owner), { flag: 'wx', mode: 0o600 });
  const descriptor = openSync(temporary, constants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  try { renameSync(temporary, target); } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  fsyncDirectory(lockPath);
}

function readOwner(lockPath) {
  const info = lstatSync(lockPath);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`deployment lock is not a real directory: ${lockPath}`);
  const bytes = readFileSync(ownerPath(lockPath));
  const owner = parseStrictJson(bytes);
  if (!Buffer.from(canonicalJson(owner)).equals(bytes)) throw new Error('deployment lock owner record is not canonical JSON');
  return { owner, digest: canonicalSha256(owner) };
}

export function inspectDeploymentLock(lockPath) {
  try {
    const { owner, digest } = readOwner(lockPath);
    return { state: 'locked', owner, ownerDigest: digest, processMatches: processMatches(owner) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        lstatSync(lockPath);
        return { state: 'ambiguous', reason: 'owner record is missing', ownerDigest: canonicalSha256({ state: 'missing-owner' }) };
      } catch (lockError) {
        if (lockError.code === 'ENOENT') return { state: 'unlocked' };
        throw lockError;
      }
    }
    try {
      const bytes = readFileSync(ownerPath(lockPath));
      return { state: 'ambiguous', reason: error.message, ownerDigest: sha256(bytes) };
    } catch { return { state: 'ambiguous', reason: error.message }; }
  }
}

export function acquireDeploymentLock(lockPath, {
  operationRunId,
  journalPath = null,
  generation = null,
  token = randomUUID(),
  controllerPid = process.pid,
  controllerStartIdentity,
  now = () => new Date(),
} = {}) {
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(operationRunId ?? '')) throw new Error('operationRunId has an invalid format');
  if (!/^[0-9a-f-]{16,128}$/i.test(token)) throw new Error('lock token has an invalid format');
  if (!Number.isSafeInteger(controllerPid) || controllerPid < 1) throw new Error('controllerPid must be a positive integer');
  const observedStartIdentity = readProcessStartIdentity(controllerPid);
  if (controllerStartIdentity !== undefined && controllerStartIdentity !== observedStartIdentity) {
    throw new Error('controller PID start identity mismatch');
  }
  ensureOwnerDirectory(path.dirname(lockPath));
  try { mkdirSync(lockPath, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') throw new DeploymentLockConflict('deployment mutation lock is already held', inspectDeploymentLock(lockPath));
    throw error;
  }
  const owner = {
    lockVersion: 1,
    operationRunId,
    token,
    pid: controllerPid,
    processStartIdentity: observedStartIdentity,
    journalPath,
    generation,
    acquiredAt: now().toISOString(),
    heartbeatAt: now().toISOString(),
  };
  try {
    writeFileSync(ownerPath(lockPath), canonicalJson(owner), { flag: 'wx', mode: 0o600 });
    const descriptor = openSync(ownerPath(lockPath), constants.O_RDONLY);
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    fsyncDirectory(lockPath);
    fsyncDirectory(path.dirname(lockPath));
  } catch (error) {
    try { unlinkSync(ownerPath(lockPath)); } catch {}
    try { rmdirSync(lockPath); } catch {}
    throw error;
  }
  return owner;
}

export function assertDeploymentLock(lockPath, token, operationRunId) {
  const { owner } = readOwner(lockPath);
  if (owner.token !== token) throw new Error('deployment lock token mismatch');
  if (operationRunId !== undefined && owner.operationRunId !== operationRunId) throw new Error('deployment lock operation mismatch');
  const matches = processMatches(owner);
  if (matches !== true) throw new Error(matches === false ? 'deployment lock controller is no longer running' : 'deployment lock controller identity is ambiguous');
  return owner;
}

export function heartbeatDeploymentLock(lockPath, token, operationRunId, {
  journalPath,
  generation,
  now = () => new Date(),
} = {}) {
  const owner = assertDeploymentLock(lockPath, token, operationRunId);
  const updated = {
    ...owner,
    journalPath: journalPath === undefined ? owner.journalPath : journalPath,
    generation: generation === undefined ? owner.generation : generation,
    heartbeatAt: now().toISOString(),
  };
  writeOwnerAtomic(lockPath, updated);
  return updated;
}

export function releaseDeploymentLock(lockPath, token, operationRunId) {
  assertDeploymentLock(lockPath, token, operationRunId);
  unlinkSync(ownerPath(lockPath));
  fsyncDirectory(lockPath);
  rmdirSync(lockPath);
  fsyncDirectory(path.dirname(lockPath));
}

export function recoverStaleDeploymentLock(lockPath, expectedOwnerDigest) {
  const inspection = inspectDeploymentLock(lockPath);
  if (!['locked', 'ambiguous'].includes(inspection.state)) throw new Error('deployment lock is not held');
  if (inspection.ownerDigest !== expectedOwnerDigest) throw new Error('deployment lock changed before recovery');
  if (inspection.state === 'ambiguous' && inspection.reason !== 'owner record is missing') {
    throw new Error('deployment lock owner record is ambiguous');
  }
  if (inspection.state === 'locked' && inspection.processMatches !== false) {
    throw new Error(inspection.processMatches ? 'deployment lock owner is still running' : 'deployment lock owner liveness is ambiguous');
  }
  const recoveryPath = `${lockPath}.recover-${process.pid}-${randomUUID()}`;
  renameSync(lockPath, recoveryPath);
  const moved = inspectDeploymentLock(recoveryPath);
  if (moved.ownerDigest !== expectedOwnerDigest) {
    renameSync(recoveryPath, lockPath);
    throw new Error('deployment lock changed during recovery');
  }
  try { unlinkSync(ownerPath(recoveryPath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  rmdirSync(recoveryPath);
  fsyncDirectory(path.dirname(lockPath));
}
