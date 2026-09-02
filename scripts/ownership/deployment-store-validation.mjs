import path from 'node:path';
import { canonicalJson, canonicalSha256 } from './canonical-json.mjs';
import { sha256 } from './crypto.mjs';

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const DEPLOYMENT_SCOPES = new Set(['production', 'ci_ephemeral']);

export function assertDeploymentId(deploymentId) {
  if (!ID.test(deploymentId ?? '')) throw new Error('deploymentId has an invalid format');
}

export function validDeploymentIdentifier(value) {
  return ID.test(value ?? '');
}

export function assertDigest(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!/^[a-f0-9]{64}$/.test(value ?? '')) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
}

export function assertPointer(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${kind} pointer is malformed`);
  }
  if (value.deploymentId === undefined || value.deploymentId === '') {
    throw new Error(`${kind} pointer lacks deployment identity`);
  }
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) {
    throw new Error(`${kind} pointer generation is invalid`);
  }
  assertDigest(value.manifestDigest, `${kind} pointer manifestDigest`);
}

export function withoutDigest(definition) {
  const { definitionDigest: _ignored, ...unsigned } = definition;
  return unsigned;
}

export function preparedMatchesPending(prepared, pending) {
  return pending.mode === 'deploy'
    && pending.generation === prepared.generation
    && pending.manifestDigest === prepared.manifestDigest
    && pending.priorActiveDigest === prepared.priorActiveDigest;
}

export function pendingIsActivating(pending) {
  return (pending.mode === 'deploy' && pending.stage === 'activating')
    || (pending.mode === 'rollback' && pending.stage === 'rollback_activating');
}

export function validateDefinitionBundle({ definition, snapshots }) {
  assertDigest(definition.definitionDigest, 'definitionDigest');
  if (canonicalSha256(withoutDigest(definition)) !== definition.definitionDigest) {
    throw new Error('definitionDigest does not match definition');
  }
  if (!Array.isArray(definition.overlays) || !Array.isArray(snapshots)
      || definition.overlays.length !== snapshots.length) {
    throw new Error('definition overlays and snapshots must have equal lengths');
  }
  definition.overlays.forEach((overlay, index) => {
    const snapshot = snapshots[index];
    const mismatch = !Buffer.isBuffer(snapshot.bytes)
      || snapshot.snapshotPath !== overlay.snapshotPath
      || snapshot.sourcePath !== overlay.sourcePath;
    if (mismatch) throw new Error(`snapshot ${index} does not match its definition entry`);
    if (sha256(snapshot.bytes) !== overlay.sha256) {
      throw new Error(`snapshot ${index} digest mismatch`);
    }
    const unsafe = path.isAbsolute(overlay.snapshotPath)
      || overlay.snapshotPath.split('/').some((part) => ['', '.', '..'].includes(part));
    if (unsafe) throw new Error(`snapshot ${index} path is unsafe`);
  });
}

export function deploymentIdentityRecord(deploymentId, identity) {
  if (typeof identity?.projectDirectory !== 'string'
      || typeof identity?.composeProjectName !== 'string') {
    throw new Error('deployment identity requires projectDirectory and composeProjectName');
  }
  const deploymentScope = identity.deploymentScope ?? 'production';
  const ciRunIdentityDigest = identity.ciRunIdentityDigest ?? null;
  const productionScopeInvalid = deploymentScope === 'production' && ciRunIdentityDigest !== null;
  const ephemeralScopeInvalid = deploymentScope === 'ci_ephemeral'
    && !/^[a-f0-9]{64}$/.test(ciRunIdentityDigest ?? '');
  if (!DEPLOYMENT_SCOPES.has(deploymentScope)
      || productionScopeInvalid || ephemeralScopeInvalid) {
    throw new Error('deployment identity scope is invalid');
  }
  return {
    identityVersion: 2, deploymentId,
    projectDirectory: identity.projectDirectory,
    composeProjectName: identity.composeProjectName,
    deploymentScope, ciRunIdentityDigest,
  };
}

export function identityRecordsMatch(existing, record) {
  const legacyProduction = existing.identityVersion === 1
    && record.deploymentScope === 'production'
    && existing.deploymentId === record.deploymentId
    && existing.projectDirectory === record.projectDirectory
    && existing.composeProjectName === record.composeProjectName;
  return legacyProduction || canonicalJson(existing).equals(canonicalJson(record));
}
