import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256 } from './canonical-json.mjs';
import { PROTECTED_COMPOSE_PROJECTS } from './contracts.mjs';
import {
  ensureOwnerDirectory, fsyncDirectory, readCanonical, readOptional, writeCreateOnly,
} from './deployment-store-io.mjs';
import { assertDigest } from './deployment-store-validation.mjs';
import { assertProjectMutationLock } from './project-lock.mjs';
import { validateArtifact } from './schemas.mjs';

function assertRetirementAuthority(store, options, failureMessage) {
  store.assertLocked(options.lockToken, options.operationRunId);
  const identity = store.readIdentity();
  assertProjectMutationLock(
    store.runtimeDirectory, identity.composeProjectName,
    options.projectLockToken, options.operationRunId,
  );
  const eligible = identity.identityVersion === 2
    && identity.deploymentScope === 'ci_ephemeral'
    && /^[a-f0-9]{64}$/.test(identity.ciRunIdentityDigest ?? '')
    && !PROTECTED_COMPOSE_PROJECTS.includes(identity.composeProjectName);
  if (!eligible) throw new Error(failureMessage);
  return identity;
}

function assertRetirementInputs(store, options, message) {
  if (!Number.isSafeInteger(options.expectedGeneration) || options.expectedGeneration < 1) {
    throw new Error('retired generation must be a positive safe integer');
  }
  assertDigest(options.expectedManifestDigest, 'retired manifest digest');
  assertDigest(options.expectedRunManifestDigest, 'retired run manifest digest');
  validateArtifact(options.runManifest);
  const run = options.runManifest;
  const matches = [
    run.artifactType === 'run_manifest',
    canonicalSha256(run) === options.expectedRunManifestDigest,
    run.deploymentId === store.deploymentId,
    run.operationRunId === options.operationRunId,
    run.generation === options.expectedGeneration,
    run.ownerId !== '', run.terminalAt !== null,
    run.deploymentDigest === options.expectedManifestDigest,
  ].every(Boolean);
  if (!matches) throw new Error(message);
}

function storeRetirementRecord(store, retired, now) {
  ensureOwnerDirectory(store.retiredRevisions);
  const retiredPath = path.join(store.retiredRevisions, `${retired.generation}.json`);
  const existing = readOptional(retiredPath);
  const current = { ...retired, retiredAt: now().toISOString() };
  if (existing) {
    const stable = { ...current, retiredAt: existing.value.retiredAt };
    if (!canonicalJson(existing.value).equals(canonicalJson(stable))) {
      throw new Error('retired revision record collision');
    }
    return { existing, retiredPath, bytes: canonicalJson(stable) };
  }
  return { existing: null, retiredPath, bytes: canonicalJson(current) };
}

function commitRetirementRecord(record) {
  if (!record.existing) writeCreateOnly(record.retiredPath, record.bytes);
}

function verifyRetiredManifest(store, options) {
  const revision = store.readManifest(options.expectedGeneration, { verifySnapshots: true });
  if (revision.manifestDigest !== options.expectedManifestDigest) {
    throw new Error('retired deployment manifest digest mismatch');
  }
}

export function retireActiveEphemeralRevision(store, options) {
  const identity = assertRetirementAuthority(
    store, options, 'only an immutable CI-ephemeral deployment may be retired',
  );
  assertDigest(options.expectedActivePointerDigest, 'retired active pointer digest');
  assertRetirementInputs(
    store, options, 'terminal run manifest does not authorize exact ephemeral retirement',
  );
  if (store.readPending() || readOptional(store.preparedPath)) {
    throw new Error('ephemeral revision retirement refuses pending or prepared deployment state');
  }
  const active = store.readActive();
  const retired = {
    retirementVersion: 1, deploymentId: store.deploymentId,
    generation: options.expectedGeneration, manifestDigest: options.expectedManifestDigest,
    activePointerDigest: options.expectedActivePointerDigest,
    runManifestDigest: options.expectedRunManifestDigest,
    ciRunIdentityDigest: identity.ciRunIdentityDigest,
    operationRunId: options.operationRunId,
  };
  const record = storeRetirementRecord(store, retired, options.now ?? (() => new Date()));
  if (record.existing && !active) {
    return {
      retired: record.existing.value, retiredDigest: record.existing.digest,
      retiredPath: record.retiredPath,
    };
  }
  if (!active || active.value.generation !== options.expectedGeneration
      || active.value.manifestDigest !== options.expectedManifestDigest
      || active.digest !== options.expectedActivePointerDigest) {
    throw new Error('active revision compare-and-swap failed during retirement');
  }
  verifyRetiredManifest(store, options);
  commitRetirementRecord(record);
  unlinkSync(store.activePath);
  fsyncDirectory(store.root);
  const stored = readCanonical(record.retiredPath);
  return { retired: stored.value, retiredDigest: stored.digest, retiredPath: record.retiredPath };
}

function failedRetirementPointers(store, kind) {
  const active = store.readActive();
  const pending = store.readPending();
  const prepared = readOptional(store.preparedPath);
  if (active || (pending && prepared)) {
    throw new Error('failed ephemeral retirement requires one non-active revision pointer');
  }
  return kind === 'pending'
    ? { source: pending, other: prepared }
    : { source: prepared, other: pending };
}

function failedRetirementRecord(store, options, identity) {
  return {
    retirementVersion: 2, deploymentId: store.deploymentId,
    generation: options.expectedGeneration, manifestDigest: options.expectedManifestDigest,
    disposition: 'cleanup_required', sourcePointerKind: options.expectedSourcePointerKind,
    sourcePointerDigest: options.expectedSourcePointerDigest,
    runManifestDigest: options.expectedRunManifestDigest,
    ciRunIdentityDigest: identity.ciRunIdentityDigest,
    operationRunId: options.operationRunId,
  };
}

function failedSourceMatches(source, other, options) {
  return [
    Boolean(source), !other,
    source?.digest === options.expectedSourcePointerDigest,
    source?.value.generation === options.expectedGeneration,
    source?.value.manifestDigest === options.expectedManifestDigest,
    source?.value.priorActiveDigest === null,
    options.expectedSourcePointerKind !== 'pending'
      || source?.value.operationRunId === options.operationRunId,
  ].every(Boolean);
}

export function retireFailedEphemeralRevision(store, options) {
  const identity = assertRetirementAuthority(
    store, options, 'failed retirement is restricted to unprotected CI-ephemeral deployments',
  );
  assertDigest(options.expectedSourcePointerDigest, 'retired source pointer digest');
  assertRetirementInputs(
    store, options, 'terminal run manifest does not authorize failed ephemeral retirement',
  );
  if (!['pending', 'prepared'].includes(options.expectedSourcePointerKind)) {
    throw new Error('failed retirement source pointer kind is invalid');
  }
  const { source, other } = failedRetirementPointers(
    store, options.expectedSourcePointerKind,
  );
  const retired = failedRetirementRecord(store, options, identity);
  const record = storeRetirementRecord(store, retired, options.now ?? (() => new Date()));
  if (record.existing && !source && !other) {
    return {
      retired: record.existing.value, retiredDigest: record.existing.digest,
      retiredPath: record.retiredPath,
    };
  }
  if (!failedSourceMatches(source, other, options)) {
    throw new Error('failed revision pointer compare-and-swap failed during retirement');
  }
  verifyRetiredManifest(store, options);
  commitRetirementRecord(record);
  unlinkSync(options.expectedSourcePointerKind === 'pending' ? store.pendingPath : store.preparedPath);
  fsyncDirectory(store.root);
  const stored = readCanonical(record.retiredPath);
  return { retired: stored.value, retiredDigest: stored.digest, retiredPath: record.retiredPath };
}
