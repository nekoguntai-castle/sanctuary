import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { readExternalFile, writeExternalFileAtomic } from './safe-file.mjs';
import { validateArtifact } from './schemas.mjs';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const MAX_RUN_MANIFEST_BYTES = 16 * 1024;

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const resolved = path.resolve(directory);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(resolved) !== resolved
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())
      || (info.mode & 0o077) !== 0) {
    throw new Error(`run manifest directory must be owner-only and non-symlink: ${resolved}`);
  }
  return resolved;
}

function canonicalTimestamp(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return date.toISOString();
}

function assertId(value, label) {
  if (!ID.test(value ?? '')) throw new Error(`${label} has an invalid format`);
}

export function runManifestPath(runtimeDirectory, deploymentId, operationRunId) {
  assertId(deploymentId, 'deploymentId');
  assertId(operationRunId, 'operationRunId');
  return path.join(
    path.resolve(runtimeDirectory), 'ownership', 'deployments', deploymentId,
    'runs', operationRunId, 'run-manifest.json',
  );
}

export function readRunManifest(filePath, { checkoutRoot }) {
  const bytes = readExternalFile(path.resolve(filePath), {
    checkoutRoot, maxBytes: MAX_RUN_MANIFEST_BYTES,
  });
  const manifest = parseStrictJson(bytes);
  if (!canonicalJson(manifest).equals(bytes)) throw new Error('run manifest must be canonical JSON');
  validateArtifact(manifest);
  if (manifest.artifactType !== 'run_manifest') throw new Error('artifact is not a run manifest');
  return Object.freeze({ manifest, digest: canonicalSha256(manifest), path: path.resolve(filePath) });
}

export function createRunManifest({
  store, checkoutRoot, deploymentManifest, operationRunId, lockToken, now = new Date(),
}) {
  if (!store || typeof store.assertLocked !== 'function') throw new Error('deployment store is required');
  const lockOwner = store.assertLocked(lockToken, operationRunId);
  validateArtifact(deploymentManifest);
  if (deploymentManifest.artifactType !== 'deployment_manifest') {
    throw new Error('deploymentManifest must be a deployment manifest');
  }
  const stored = store.readManifest(deploymentManifest.generation, { verifySnapshots: true });
  if (stored.manifestDigest !== canonicalSha256(deploymentManifest)) {
    throw new Error('run manifest deployment does not match the locked deployment store');
  }
  assertId(operationRunId, 'operationRunId');
  const startedAt = canonicalTimestamp(now, 'now');
  const controllerIdentity = canonicalSha256({
    operationRunId, pid: lockOwner.pid, processStartIdentity: lockOwner.processStartIdentity,
  });
  const manifest = {
    schemaVersion: '1.0.0', artifactType: 'run_manifest',
    deploymentId: deploymentManifest.deploymentId, operationRunId,
    ownerId: deploymentManifest.ownerId,
    generation: deploymentManifest.generation, startedAt, heartbeatAt: startedAt,
    terminalAt: null, controllerIdentity,
    deploymentDigest: canonicalSha256(deploymentManifest),
  };
  validateArtifact(manifest);
  const filePath = runManifestPath(store.runtimeDirectory, manifest.deploymentId, operationRunId);
  ensurePrivateDirectory(path.dirname(filePath));
  writeExternalFileAtomic(filePath, canonicalJson(manifest), { checkoutRoot });
  return Object.freeze({ manifest, digest: canonicalSha256(manifest), path: filePath });
}

function transitionRunManifest({
  store, checkoutRoot, operationRunId, lockToken, expectedDigest, now, terminal,
}) {
  if (!store || typeof store.assertLocked !== 'function') throw new Error('deployment store is required');
  store.assertLocked(lockToken, operationRunId);
  const filePath = runManifestPath(store.runtimeDirectory, store.deploymentId, operationRunId);
  const current = readRunManifest(filePath, { checkoutRoot });
  if (current.digest !== expectedDigest) throw new Error('run manifest compare-and-swap failed');
  if (current.manifest.terminalAt !== null) {
    if (terminal) return current;
    throw new Error('terminal run manifest cannot be heartbeated');
  }
  const instant = canonicalTimestamp(now, 'now');
  if (new Date(instant) < new Date(current.manifest.heartbeatAt)) {
    throw new Error('run manifest transition must not move backward in time');
  }
  const manifest = {
    ...current.manifest, heartbeatAt: instant, terminalAt: terminal ? instant : null,
  };
  validateArtifact(manifest);
  writeExternalFileAtomic(path.resolve(filePath), canonicalJson(manifest), {
    checkoutRoot, replace: true,
  });
  return Object.freeze({ manifest, digest: canonicalSha256(manifest), path: path.resolve(filePath) });
}

export function heartbeatRunManifest(options) {
  return transitionRunManifest({ ...options, terminal: false });
}

export function terminalizeRunManifest(options) {
  return transitionRunManifest({ ...options, terminal: true });
}
