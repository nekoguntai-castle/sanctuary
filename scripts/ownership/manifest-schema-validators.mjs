import {
  array, canonicalRelativePath, commit, digest, enumeration, identifier,
  integer, object, string, timestamp, unique,
} from './validation.mjs';
import { CLEANUP_POLICIES, RESOURCE_CLASSES } from './contracts.mjs';

function base(value, type, extraKeys) {
  object(value, '$', ['schemaVersion', 'artifactType', ...extraKeys]);
  if (value.schemaVersion !== '1.0.0') throw new Error(`$.schemaVersion must equal 1.0.0 for ${type}`);
  if (value.artifactType !== type) throw new Error(`$.artifactType must equal ${type}`);
}

export function validateDeployment(value) {
  base(value, 'deployment_manifest', [
    'deploymentId', 'generation', 'createdAt', 'priorActiveDigest',
    'definitionVersion', 'ownerId', 'release', 'commit', 'projectDirectory',
    'projectDirectoryIdentity', 'composeProjectName', 'envFile', 'envFileIdentity',
    'installMode', 'profiles', 'overlays', 'policyDigest', 'contextFingerprint',
    'definitionDigest', 'legacyResources',
  ]);
  identifier(value.deploymentId, '$.deploymentId');
  integer(value.generation, '$.generation', { min: 1 });
  timestamp(value.createdAt, '$.createdAt');
  if (value.priorActiveDigest !== null) digest(value.priorActiveDigest, '$.priorActiveDigest');
  if (value.definitionVersion !== 1) throw new Error('$.definitionVersion must equal 1');
  identifier(value.ownerId, '$.ownerId');
  string(value.release, '$.release', { max: 128 });
  commit(value.commit, '$.commit');
  string(value.projectDirectory, '$.projectDirectory', { max: 1024 });
  identifier(value.projectDirectoryIdentity, '$.projectDirectoryIdentity');
  identifier(value.composeProjectName, '$.composeProjectName');
  string(value.envFile, '$.envFile', { max: 1024 });
  identifier(value.envFileIdentity, '$.envFileIdentity');
  enumeration(value.installMode, '$.installMode', ['online', 'offline']);
  array(value.profiles, '$.profiles', { max: 16 }).forEach((entry, index) => identifier(entry, `$.profiles[${index}]`));
  unique(value.profiles, '$.profiles');
  array(value.overlays, '$.overlays', { min: 1, max: 32 }).forEach((entry, index) => {
    const overlayPath = `$.overlays[${index}]`;
    object(entry, overlayPath, ['sourcePath', 'sourceIdentity', 'snapshotPath', 'sha256', 'kind']);
    string(entry.sourcePath, `${overlayPath}.sourcePath`, { max: 1024 });
    identifier(entry.sourceIdentity, `${overlayPath}.sourceIdentity`);
    canonicalRelativePath(entry.snapshotPath, `${overlayPath}.snapshotPath`);
    digest(entry.sha256, `${overlayPath}.sha256`);
    enumeration(entry.kind, `${overlayPath}.kind`, ['tracked', 'custom', 'generated']);
  });
  unique(value.overlays.map((entry) => entry.sourcePath), '$.overlays.sourcePath');
  unique(value.overlays.map((entry) => entry.snapshotPath), '$.overlays.snapshotPath');
  digest(value.policyDigest, '$.policyDigest');
  digest(value.contextFingerprint, '$.contextFingerprint');
  digest(value.definitionDigest, '$.definitionDigest');
  const legacyResources = array(value.legacyResources, '$.legacyResources', { max: 512 });
  legacyResources.forEach((entry, index) => {
    const entryPath = `$.legacyResources[${index}]`;
    object(entry, entryPath, [
      'resourceClass', 'locator', 'composeResource', 'immutableIdentity', 'cleanupPolicy', 'ownershipState',
    ]);
    enumeration(entry.resourceClass, `${entryPath}.resourceClass`, ['compose_container', 'compose_network', 'compose_volume']);
    string(entry.locator, `${entryPath}.locator`, { max: 256 });
    identifier(entry.composeResource, `${entryPath}.composeResource`);
    identifier(entry.immutableIdentity, `${entryPath}.immutableIdentity`);
    if (entry.cleanupPolicy !== 'preserve_ambiguous') throw new Error(`${entryPath}.cleanupPolicy must equal preserve_ambiguous`);
    if (entry.ownershipState !== 'unlabeled') throw new Error(`${entryPath}.ownershipState must equal unlabeled`);
  });
  unique(legacyResources.map((entry) => `${entry.resourceClass}:${entry.locator}`), '$.legacyResources');
}

export function validateRun(value) {
  base(value, 'run_manifest', ['deploymentId', 'operationRunId', 'ownerId', 'generation', 'startedAt', 'heartbeatAt', 'terminalAt', 'controllerIdentity', 'deploymentDigest']);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  identifier(value.ownerId, '$.ownerId');
  integer(value.generation, '$.generation', { min: 1 });
  const started = timestamp(value.startedAt, '$.startedAt');
  const heartbeat = timestamp(value.heartbeatAt, '$.heartbeatAt');
  if (heartbeat < started) throw new Error('$.heartbeatAt must not precede startedAt');
  if (value.terminalAt !== null) {
    const terminal = timestamp(value.terminalAt, '$.terminalAt');
    if (terminal < heartbeat) throw new Error('$.terminalAt must not precede heartbeatAt');
  }
  identifier(value.controllerIdentity, '$.controllerIdentity');
  digest(value.deploymentDigest, '$.deploymentDigest');
}

export function validateRegistration(value) {
  base(value, 'resource_registration', [
    'registrationId', 'deploymentId', 'operationRunId', 'ownerId',
    'resourceClass', 'lifecycle', 'cleanupPolicy', 'createdAt',
    'createdByRelease', 'createdByCommit', 'locatorKind', 'locator',
    'immutableIdentity', 'metadataDigest', 'referenceIds', 'signerKeyId',
  ]);
  digest(value.registrationId, '$.registrationId');
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  identifier(value.ownerId, '$.ownerId');
  enumeration(value.resourceClass, '$.resourceClass', RESOURCE_CLASSES);
  identifier(value.lifecycle, '$.lifecycle');
  enumeration(value.cleanupPolicy, '$.cleanupPolicy', CLEANUP_POLICIES);
  timestamp(value.createdAt, '$.createdAt');
  string(value.createdByRelease, '$.createdByRelease', { max: 128 });
  if (value.createdByRelease !== 'unreleased') identifier(value.createdByRelease, '$.createdByRelease');
  commit(value.createdByCommit, '$.createdByCommit');
  enumeration(value.locatorKind, '$.locatorKind', ['authority', 'engine_id', 'name', 'path', 'provider_id', 'reference']);
  string(value.locator, '$.locator', { max: 1024 });
  identifier(value.immutableIdentity, '$.immutableIdentity');
  digest(value.metadataDigest, '$.metadataDigest');
  array(value.referenceIds, '$.referenceIds', { max: 128 }).forEach((entry, index) => identifier(entry, `$.referenceIds[${index}]`));
  unique(value.referenceIds, '$.referenceIds');
  digest(value.signerKeyId, '$.signerKeyId');
}
