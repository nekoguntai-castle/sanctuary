import { posix as posixPath } from 'node:path';
import {
  array, canonicalRelativePath, commit, digest, enumeration, identifier,
  integer, object, string, timestamp, unique,
} from './validation.mjs';
import { canonicalSha256 } from './canonical-json.mjs';
import { CLEANUP_POLICIES, RESOURCE_CLASSES } from './contracts.mjs';

const DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,19}$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;

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

const REGISTRATION_KEYS = Object.freeze([
  'registrationId', 'deploymentId', 'operationRunId', 'ownerId',
  'resourceClass', 'lifecycle', 'cleanupPolicy', 'createdAt',
  'createdByRelease', 'createdByCommit', 'locatorKind', 'locator',
  'immutableIdentity', 'metadataDigest', 'referenceIds', 'signerKeyId',
]);

function decimal(value, valuePath, { positive = false, max = UINT64_MAX } = {}) {
  string(value, valuePath, { max: 20, pattern: positive ? POSITIVE_DECIMAL : DECIMAL });
  if (BigInt(value) > max) throw new Error(`${valuePath} exceeds its numeric bound`);
}

function absolutePath(value, valuePath) {
  string(value, valuePath, { max: 1024 });
  if (!posixPath.isAbsolute(value) || posixPath.normalize(value) !== value || value.includes('\0')) {
    throw new Error(`${valuePath} must be a canonical absolute path`);
  }
}

function basename(value, valuePath) {
  string(value, valuePath, { max: 255 });
  if (value === '.' || value === '..' || posixPath.basename(value) !== value || value.includes('\0')) {
    throw new Error(`${valuePath} must be one path basename`);
  }
}

function validateControlledParent(value, valuePath) {
  object(value, valuePath, ['canonicalPath', 'dev', 'ino', 'uid', 'mode']);
  absolutePath(value.canonicalPath, `${valuePath}.canonicalPath`);
  decimal(value.dev, `${valuePath}.dev`);
  decimal(value.ino, `${valuePath}.ino`, { positive: true });
  decimal(value.uid, `${valuePath}.uid`);
  if (value.mode !== 0o700) throw new Error(`${valuePath}.mode must equal 448`);
}

function validateDirectoryEntry(value, valuePath) {
  object(value, valuePath, ['basename', 'dev', 'ino', 'type']);
  basename(value.basename, `${valuePath}.basename`);
  decimal(value.dev, `${valuePath}.dev`);
  decimal(value.ino, `${valuePath}.ino`, { positive: true });
  if (value.type !== 'directory') throw new Error(`${valuePath}.type must equal directory`);
}

function validateSameDevice(parent, entry) {
  if (parent.dev !== entry.dev) {
    throw new Error('$.executionAuthority entry and controlled parent must share one device');
  }
}

function gitBranch(value, valuePath) {
  string(value, valuePath, {
    max: 512, pattern: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
  });
  if (value.includes('..') || value.includes('//') || value.includes('@{')
      || value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) {
    throw new Error(`${valuePath} must be a canonical branch name`);
  }
}

function validateCollectorAuthority(value) {
  object(value, '$.executionAuthority', [
    'kind', 'pid', 'startTimeTicks', 'bootIdDigest', 'argvDigest', 'script',
    'heartbeatPath', 'terminalPath',
  ]);
  if (value.kind !== 'linux_pidfd_v1') {
    throw new Error('$.executionAuthority.kind must equal linux_pidfd_v1');
  }
  decimal(value.pid, '$.executionAuthority.pid', { positive: true, max: 2_147_483_647n });
  decimal(value.startTimeTicks, '$.executionAuthority.startTimeTicks', { positive: true });
  digest(value.bootIdDigest, '$.executionAuthority.bootIdDigest');
  digest(value.argvDigest, '$.executionAuthority.argvDigest');
  object(value.script, '$.executionAuthority.script', ['canonicalPath', 'dev', 'ino', 'sha256']);
  absolutePath(value.script.canonicalPath, '$.executionAuthority.script.canonicalPath');
  decimal(value.script.dev, '$.executionAuthority.script.dev');
  decimal(value.script.ino, '$.executionAuthority.script.ino', { positive: true });
  digest(value.script.sha256, '$.executionAuthority.script.sha256');
  absolutePath(value.heartbeatPath, '$.executionAuthority.heartbeatPath');
  absolutePath(value.terminalPath, '$.executionAuthority.terminalPath');
  if (value.heartbeatPath === value.terminalPath) {
    throw new Error('collector heartbeat and terminal paths must differ');
  }
}

function validateTemporaryAuthority(value) {
  object(value, '$.executionAuthority', ['kind', 'parent', 'entry', 'creatorRunId']);
  if (value.kind !== 'linux_dirfd_v1') {
    throw new Error('$.executionAuthority.kind must equal linux_dirfd_v1');
  }
  validateControlledParent(value.parent, '$.executionAuthority.parent');
  validateDirectoryEntry(value.entry, '$.executionAuthority.entry');
  validateSameDevice(value.parent, value.entry);
  identifier(value.creatorRunId, '$.executionAuthority.creatorRunId');
}

function validateWorktreeAuthority(value) {
  object(value, '$.executionAuthority', [
    'kind', 'parent', 'entry', 'commonDir', 'adminEntry', 'branch',
    'headOid', 'baseOid', 'lifecycleEvidenceDigest',
  ]);
  if (value.kind !== 'linux_git_worktree_v1') {
    throw new Error('$.executionAuthority.kind must equal linux_git_worktree_v1');
  }
  validateControlledParent(value.parent, '$.executionAuthority.parent');
  validateDirectoryEntry(value.entry, '$.executionAuthority.entry');
  validateSameDevice(value.parent, value.entry);
  object(value.commonDir, '$.executionAuthority.commonDir', ['canonicalPath', 'dev', 'ino']);
  absolutePath(value.commonDir.canonicalPath, '$.executionAuthority.commonDir.canonicalPath');
  decimal(value.commonDir.dev, '$.executionAuthority.commonDir.dev');
  decimal(value.commonDir.ino, '$.executionAuthority.commonDir.ino', { positive: true });
  validateDirectoryEntry(value.adminEntry, '$.executionAuthority.adminEntry');
  validateSameDevice(value.commonDir, value.adminEntry);
  gitBranch(value.branch, '$.executionAuthority.branch');
  commit(value.headOid, '$.executionAuthority.headOid');
  commit(value.baseOid, '$.executionAuthority.baseOid');
  digest(value.lifecycleEvidenceDigest, '$.executionAuthority.lifecycleEvidenceDigest');
}

function validateExecutionAuthority(value) {
  if (value.resourceClass === 'collector_process') validateCollectorAuthority(value.executionAuthority);
  else if (value.resourceClass === 'temporary_artifact') validateTemporaryAuthority(value.executionAuthority);
  else if (value.resourceClass === 'git_worktree') validateWorktreeAuthority(value.executionAuthority);
  else throw new Error('$.executionAuthority is permitted only for executable host resource classes');
  if (value.metadataDigest !== canonicalSha256(value.executionAuthority)) {
    throw new Error('$.metadataDigest must bind the canonical executionAuthority');
  }
  if (value.resourceClass === 'collector_process') {
    if (value.locatorKind !== 'authority' || value.locator !== value.executionAuthority.pid) {
      throw new Error('collector process locator must equal its execution authority PID');
    }
  } else {
    const expected = posixPath.join(
      value.executionAuthority.parent.canonicalPath, value.executionAuthority.entry.basename,
    );
    if (value.locatorKind !== 'path' || value.locator !== expected) {
      throw new Error('host path locator must equal its execution authority parent and basename');
    }
  }
  if (value.resourceClass === 'temporary_artifact'
      && value.executionAuthority.creatorRunId !== value.operationRunId) {
    throw new Error('temporary artifact creatorRunId must equal its registration operationRunId');
  }
}

export function validateRegistration(value) {
  const version = value?.schemaVersion;
  if (!['1.0.0', '1.1.0'].includes(version)) {
    throw new Error('$.schemaVersion must equal 1.0.0 or 1.1.0 for resource_registration');
  }
  object(value, '$', [
    'schemaVersion', 'artifactType', ...REGISTRATION_KEYS,
    ...(version === '1.1.0' ? ['executionAuthority'] : []),
  ]);
  if (value.artifactType !== 'resource_registration') {
    throw new Error('$.artifactType must equal resource_registration');
  }
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
  // A v1.0 host registration remains visible/verifiable but carries no typed
  // execution authority; the host adapter is responsible for refusing it.
  if (version === '1.1.0') validateExecutionAuthority(value);
}
