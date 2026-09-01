import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { createHash, generateKeyPairSync } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { publicKeyFingerprint, signDetached, verifyDetached } from './crypto.mjs';
import {
  acquireDeploymentLock,
  DeploymentLockConflict,
  recoverStaleDeploymentLock,
  releaseDeploymentLock,
} from './deployment-lock.mjs';
import { assertLocalPrivateSafe } from './privacy.mjs';
import { writeExternalFileAtomic } from './safe-file.mjs';
import { validateArtifact } from './schemas.mjs';

const PRIVATE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const REGISTRATION_LOCK_WAIT_MS = 10;
const REGISTRATION_LOCK_ATTEMPTS = 1000;

function waitForRegistrationLock() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, REGISTRATION_LOCK_WAIT_MS);
}

function acquireRegistrationLock(lock, operationRunId = `registration-${process.pid}`) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return acquireDeploymentLock(lock, { operationRunId });
    } catch (error) {
      if (!(error instanceof DeploymentLockConflict)) throw error;
      const inspection = error.inspection;
      if (inspection.state === 'locked' && inspection.processMatches === false) {
        try {
          recoverStaleDeploymentLock(lock, inspection.ownerDigest);
          continue;
        } catch {
          // Another contender may have recovered or replaced the stale lock.
          // Reinspect through the normal acquire path instead of trusting the
          // observation made before that race.
        }
      }
      if (attempt >= REGISTRATION_LOCK_ATTEMPTS) throw error;
      waitForRegistrationLock();
    }
  }
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  const before = lstatSync(directory);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error(`private directory must not be a symlink: ${directory}`);
  if (realpathSync(directory) !== path.resolve(directory)) throw new Error(`private directory must not traverse a symlink: ${directory}`);
  if (typeof process.getuid === 'function' && before.uid !== process.getuid()) throw new Error(`private directory has a different owner: ${directory}`);
  chmodSync(directory, DIRECTORY_MODE);
  const after = lstatSync(directory);
  if (before.dev !== after.dev || before.ino !== after.ino) throw new Error(`private directory identity changed: ${directory}`);
}

function readPrivateFile(file) {
  const descriptor = openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error(`private key material is not a regular file: ${file}`);
    if (typeof process.getuid === 'function' && before.uid !== process.getuid()) throw new Error(`private key material has a different owner: ${file}`);
    if ((before.mode & 0o077) !== 0) throw new Error(`private key material permissions are too broad: ${file}`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw new Error(`private key material identity changed while reading: ${file}`);
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function assertExistingPrivateDirectory(directory) {
  const before = lstatSync(directory);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new Error(`private directory must not be a symlink: ${directory}`);
  if (realpathSync(directory) !== path.resolve(directory)) throw new Error(`private directory must not traverse a symlink: ${directory}`);
  if (typeof process.getuid === 'function' && before.uid !== process.getuid()) throw new Error(`private directory has a different owner: ${directory}`);
  if ((before.mode & 0o077) !== 0) throw new Error(`private directory permissions are too broad: ${directory}`);
  return before;
}

function readStableDirectory(directory) {
  const before = assertExistingPrivateDirectory(directory);
  const entries = readdirSync(directory).sort();
  const after = lstatSync(directory);
  if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`private directory identity changed while reading: ${directory}`);
  }
  return entries;
}

function writeGeneratedKeys(staging) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(path.join(staging, 'private.pem'), privatePem, { flag: 'wx', mode: PRIVATE_MODE });
  writeFileSync(path.join(staging, 'public.pem'), publicPem, { flag: 'wx', mode: PRIVATE_MODE });
}

export function ensureRegistrationKeys(root) {
  ensurePrivateDirectory(root);
  const keys = path.join(root, 'keys');
  if (!existsSync(keys)) {
    const staging = path.join(root, `.keys-${process.pid}-${Date.now()}`);
    mkdirSync(staging, { mode: DIRECTORY_MODE });
    try {
      writeGeneratedKeys(staging);
      renameSync(staging, keys);
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (!existsSync(keys)) throw error;
    }
  }
  ensurePrivateDirectory(keys);
  return {
    privateKey: readPrivateFile(path.join(keys, 'private.pem')),
    publicKey: readPrivateFile(path.join(keys, 'public.pem')),
  };
}

function registrationCore(input, signerKeyId) {
  const referenceIds = [...(input.referenceIds ?? [])].sort();
  return {
    schemaVersion: '1.0.0',
    artifactType: 'resource_registration',
    registrationId: '0'.repeat(64),
    deploymentId: input.deploymentId,
    operationRunId: input.operationRunId,
    ownerId: input.ownerId,
    resourceClass: input.resourceClass,
    lifecycle: input.lifecycle,
    cleanupPolicy: input.cleanupPolicy,
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdByRelease: input.createdByRelease,
    createdByCommit: input.createdByCommit,
    locatorKind: input.locatorKind,
    locator: input.locator,
    immutableIdentity: input.immutableIdentity,
    metadataDigest: input.metadataDigest,
    referenceIds,
    signerKeyId,
  };
}

function finalizeRegistration(input, signerKeyId) {
  const provisional = registrationCore(input, signerKeyId);
  const registrationId = canonicalSha256(registrationDigestInput(provisional));
  return { ...provisional, registrationId };
}

function registrationDigestInput(registration) {
  const { registrationId: ignored, ...rest } = registration;
  return rest;
}

export function validateRegistrationIdentity(registration) {
  validateArtifact(registration);
  const actual = canonicalSha256(registrationDigestInput(registration));
  if (actual !== registration.registrationId) throw new Error('registrationId does not match canonical registration bytes');
  assertLocalPrivateSafe(registration);
  return registration;
}

function writeRegistrationFiles(root, checkoutRoot, registration, privateKey) {
  const directory = path.join(root, 'registrations', registration.resourceClass);
  ensurePrivateDirectory(path.dirname(directory));
  ensurePrivateDirectory(directory);
  const payload = canonicalJson(registration);
  const base = path.join(directory, registration.registrationId);
  const signature = signDetached(payload, privateKey).toString('base64');
  writeExternalFileAtomic(`${base}.json`, payload, { checkoutRoot });
  writeExternalFileAtomic(`${base}.sig`, Buffer.from(signature), { checkoutRoot });
  return `${base}.json`;
}

export function registerResource(input, { root, checkoutRoot }) {
  const keys = ensureRegistrationKeys(root);
  const lock = path.join(root, '.registration-lock');
  const lockOwner = acquireRegistrationLock(lock);
  try {
    return registerResourceLocked(input, { root, checkoutRoot, keys });
  } finally {
    releaseDeploymentLock(lock, lockOwner.token, lockOwner.operationRunId);
  }
}

export function acquireRegistrationFence(root, operationRunId) {
  assertExistingPrivateDirectory(root);
  return acquireRegistrationLock(path.join(root, '.registration-lock'), operationRunId);
}

export function releaseRegistrationFence(root, owner) {
  releaseDeploymentLock(
    path.join(root, '.registration-lock'), owner.token, owner.operationRunId,
  );
}

function registerResourceLocked(input, { root, checkoutRoot, keys }) {
  const signerKeyId = publicKeyFingerprint(keys.publicKey);
  const existingReferences = input.resourceClass === 'oci_image'
    ? listRegistrations(root, { resourceClass: 'oci_image', immutableIdentity: input.immutableIdentity })
    : [];
  const sharedReferences = [...new Set([
    ...(input.referenceIds ?? []),
    ...existingReferences.flatMap((entry) => entry.referenceIds),
  ])].sort();
  const sharedImage = existingReferences.some((entry) => entry.operationRunId !== input.operationRunId)
    || sharedReferences.length > 1;
  const effectiveInput = sharedImage
    ? { ...input, lifecycle: 'shared', cleanupPolicy: 'retain', referenceIds: sharedReferences }
    : input;
  const registration = finalizeRegistration(effectiveInput, signerKeyId);
  validateRegistrationIdentity(registration);
  const target = path.join(root, 'registrations', registration.resourceClass, `${registration.registrationId}.json`);
  if (!existsSync(target)) writeRegistrationFiles(root, checkoutRoot, registration, keys.privateKey);
  if (sharedImage) {
    for (const prior of existingReferences) {
      if (prior.lifecycle === 'shared' && prior.cleanupPolicy === 'retain'
        && sharedReferences.every((reference) => prior.referenceIds.includes(reference))) continue;
      const superseding = finalizeRegistration({
        ...prior, lifecycle: 'shared', cleanupPolicy: 'retain', referenceIds: sharedReferences,
      }, signerKeyId);
      validateRegistrationIdentity(superseding);
      const supersedingTarget = path.join(root, 'registrations', 'oci_image', `${superseding.registrationId}.json`);
      if (!existsSync(supersedingTarget)) writeRegistrationFiles(root, checkoutRoot, superseding, keys.privateKey);
    }
  }
  return { registration, path: target };
}

function readOneRegistration(file, publicKey, fingerprint) {
  const bytes = readPrivateFile(file);
  const signature = Buffer.from(readPrivateFile(file.replace(/\.json$/, '.sig')).toString('utf8'), 'base64');
  verifyDetached(bytes, signature, publicKey, fingerprint);
  const registration = validateRegistrationIdentity(parseStrictJson(bytes));
  if (registration.signerKeyId !== fingerprint) throw new Error('registration signerKeyId does not match public key');
  return registration;
}

function readRegistrationClass(directory, className, publicKey, fingerprint) {
  const entries = readStableDirectory(directory);
  if (entries.some((entry) => !entry.endsWith('.json') && !entry.endsWith('.sig'))) {
    throw new Error(`registration directory contains an unexpected entry: ${directory}`);
  }
  const jsonBases = new Set(entries.filter((entry) => entry.endsWith('.json')).map((entry) => entry.slice(0, -5)));
  const signatureBases = new Set(entries.filter((entry) => entry.endsWith('.sig')).map((entry) => entry.slice(0, -4)));
  if ([...jsonBases].some((entry) => !signatureBases.has(entry))
      || [...signatureBases].some((entry) => !jsonBases.has(entry))) {
    throw new Error(`registration directory contains an incomplete signed pair: ${directory}`);
  }
  return [...jsonBases].sort().map((base) => {
    const registration = readOneRegistration(path.join(directory, `${base}.json`), publicKey, fingerprint);
    if (registration.registrationId !== base || registration.resourceClass !== className) {
      throw new Error(`registration storage identity does not match signed payload: ${base}`);
    }
    return registration;
  });
}

function readRegistrationsFromExistingRoot(root, { resourceClass, immutableIdentity } = {}) {
  assertExistingPrivateDirectory(root);
  readStableDirectory(path.join(root, 'keys'));
  const publicKey = readPrivateFile(path.join(root, 'keys', 'public.pem'));
  const fingerprint = publicKeyFingerprint(publicKey);
  const classesRoot = path.join(root, 'registrations');
  if (!existsSync(classesRoot)) return [];
  const classes = resourceClass ? [resourceClass] : readStableDirectory(classesRoot);
  return classes.flatMap((className) => {
    const directory = path.join(classesRoot, className);
    if (!existsSync(directory)) return [];
    return readRegistrationClass(directory, className, publicKey, fingerprint);
  }).filter((entry) => immutableIdentity === undefined || entry.immutableIdentity === immutableIdentity);
}

export function readRegistrations(root, options = {}) {
  return readRegistrationsFromExistingRoot(path.resolve(root), options);
}

export function listRegistrations(root, options = {}) {
  ensurePrivateDirectory(root);
  ensurePrivateDirectory(path.join(root, 'keys'));
  return readRegistrationsFromExistingRoot(path.resolve(root), options);
}

export function inspectRegisteredLocator(registration) {
  validateRegistrationIdentity(registration);
  if (registration.locatorKind !== 'path') return { state: 'not_applicable' };
  let observed;
  try {
    const descriptor = openSync(registration.locator, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const before = fstatSync(descriptor);
      if (registration.immutableIdentity.startsWith('sha256:')) {
        if (!before.isFile()) return { state: 'identity_changed', immutableIdentity: 'not-a-regular-file' };
        const hash = createHash('sha256');
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let count;
        while ((count = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
        observed = `sha256:${hash.digest('hex')}`;
      } else {
        observed = `path-${before.dev}-${before.ino}`;
      }
      const after = fstatSync(descriptor);
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return { state: 'ambiguous', error: 'path changed while inspecting' };
    } finally { closeSync(descriptor); }
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'missing' };
    return { state: 'ambiguous', error: error.message };
  }
  return observed === registration.immutableIdentity
    ? { state: 'current', immutableIdentity: observed }
    : { state: 'identity_changed', immutableIdentity: observed };
}

export function effectiveRegistrationState(registrations) {
  if (!Array.isArray(registrations) || registrations.length === 0) return { lifecycle: 'absent', cleanupPolicy: 'retain' };
  const references = new Set(registrations.flatMap((entry) => entry.referenceIds));
  const retained = registrations.some((entry) => entry.cleanupPolicy === 'retain') || references.size > 1;
  return {
    lifecycle: retained ? 'shared' : registrations[0].lifecycle,
    cleanupPolicy: retained ? 'retain' : registrations[0].cleanupPolicy,
    referenceIds: [...references].sort(),
  };
}

export function defaultOwnershipRoot() {
  if (process.env.SANCTUARY_OWNERSHIP_ROOT) return path.resolve(process.env.SANCTUARY_OWNERSHIP_ROOT);
  const runtime = process.env.SANCTUARY_RUNTIME_DIR ?? path.join(os.homedir(), '.config', 'sanctuary');
  return path.join(path.resolve(runtime), 'ownership');
}
