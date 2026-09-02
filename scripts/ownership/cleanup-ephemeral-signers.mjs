import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { assertKeyPair, publicKeyFingerprint } from './crypto.mjs';
import {
  acquireDeploymentLock, DeploymentLockConflict, recoverStaleDeploymentLock,
  releaseDeploymentLock,
} from './deployment-lock.mjs';
import { readPrivateKeyFile, writeExternalFileAtomic } from './safe-file.mjs';

const ROLES = Object.freeze(['authorization', 'evidence']);
const CREATION_LOCK = '.creation-lock';

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const resolved = path.resolve(directory);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(resolved) !== resolved
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o077) !== 0) {
    throw new Error(`cleanup signer directory must be owner-only and non-symlink: ${resolved}`);
  }
  return resolved;
}

function fsyncDirectory(directory) {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function pendingName(role) { return `.${role}.pending`; }

function allowedRootEntry(entry) {
  return ROLES.includes(entry) || entry === CREATION_LOCK
    || ROLES.some((role) => entry === pendingName(role));
}

function assertSafeDiscardFile(filePath) {
  const info = lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink()
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o077) !== 0) {
    throw new Error('cleanup signer staging contains an unsafe entry');
  }
}

function allowedPendingFile(entry) {
  return ['private.pem', 'public.pem'].includes(entry)
    || /^(?:private|public)\.pem\.tmp-[1-9][0-9]*-[1-9][0-9]*$/.test(entry);
}

function discardPendingRole(pendingRoot) {
  if (!existsSync(pendingRoot)) return;
  const info = lstatSync(pendingRoot);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(pendingRoot) !== pendingRoot
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o077) !== 0) {
    throw new Error('cleanup signer staging must be owner-only and non-symlink');
  }
  const entries = readdirSync(pendingRoot);
  if (entries.some((entry) => !allowedPendingFile(entry))) {
    throw new Error('cleanup signer staging contains unexpected files');
  }
  for (const entry of entries) {
    const filePath = path.join(pendingRoot, entry);
    assertSafeDiscardFile(filePath);
    unlinkSync(filePath);
  }
  fsyncDirectory(pendingRoot);
  rmdirSync(pendingRoot);
  fsyncDirectory(path.dirname(pendingRoot));
}

function acquireCreationLock(keyRoot) {
  const lockPath = path.join(keyRoot, CREATION_LOCK);
  const operationRunId = `signer-${process.pid}-${randomUUID()}`;
  try {
    return acquireDeploymentLock(lockPath, { operationRunId });
  } catch (error) {
    if (!(error instanceof DeploymentLockConflict)) throw error;
    const stale = error.inspection.state === 'ambiguous'
      || (error.inspection.state === 'locked' && error.inspection.processMatches === false);
    if (!stale) throw error;
    recoverStaleDeploymentLock(lockPath, error.inspection.ownerDigest);
    return acquireDeploymentLock(lockPath, { operationRunId });
  }
}

function generatedPair() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  return {
    privateKey: Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })),
    publicKey: Buffer.from(pair.publicKey.export({ type: 'spki', format: 'pem' })),
  };
}

function createRole(roleRoot, checkoutRoot) {
  const pendingRoot = path.join(path.dirname(roleRoot), pendingName(path.basename(roleRoot)));
  discardPendingRole(pendingRoot);
  ensurePrivateDirectory(pendingRoot);
  let committed = false;
  try {
    const pair = generatedPair();
    writeExternalFileAtomic(path.join(pendingRoot, 'private.pem'), pair.privateKey, { checkoutRoot });
    writeExternalFileAtomic(path.join(pendingRoot, 'public.pem'), pair.publicKey, { checkoutRoot });
    readRole(pendingRoot, checkoutRoot);
    renameSync(pendingRoot, roleRoot);
    fsyncDirectory(path.dirname(roleRoot));
    committed = true;
  } finally {
    if (!committed) discardPendingRole(pendingRoot);
  }
}

function readRole(roleRoot, checkoutRoot) {
  const entries = readdirSync(roleRoot).sort();
  if (entries.join('\0') !== ['private.pem', 'public.pem'].join('\0')) {
    throw new Error('cleanup signer role directory is partial or contains unexpected files');
  }
  const privateKeyPath = path.join(roleRoot, 'private.pem');
  const publicKeyPath = path.join(roleRoot, 'public.pem');
  const privateKey = readPrivateKeyFile(privateKeyPath, { checkoutRoot });
  const publicKey = readPrivateKeyFile(publicKeyPath, { checkoutRoot });
  assertKeyPair(privateKey, publicKey);
  return Object.freeze({
    privateKeyPath, publicKeyPath, fingerprint: publicKeyFingerprint(publicKey),
  });
}

export function createEphemeralCleanupSigners({ keyRoot, checkoutRoot }) {
  const resolvedRoot = ensurePrivateDirectory(keyRoot);
  const lock = acquireCreationLock(resolvedRoot);
  try {
    const unexpected = readdirSync(resolvedRoot).filter((entry) => !allowedRootEntry(entry));
    if (unexpected.length > 0) throw new Error('cleanup signer root contains unexpected files');
    const roles = {};
    for (const role of ROLES) {
      const roleRoot = path.join(resolvedRoot, role);
      const pendingRoot = path.join(resolvedRoot, pendingName(role));
      if (existsSync(roleRoot)) {
        ensurePrivateDirectory(roleRoot);
        discardPendingRole(pendingRoot);
      } else createRole(roleRoot, checkoutRoot);
      roles[role] = readRole(roleRoot, checkoutRoot);
    }
    if (roles.authorization.fingerprint === roles.evidence.fingerprint) {
      throw new Error('cleanup authorization and evidence signing keys must be distinct');
    }
    return Object.freeze(roles);
  } finally {
    releaseDeploymentLock(path.join(resolvedRoot, CREATION_LOCK), lock.token, lock.operationRunId);
  }
}
