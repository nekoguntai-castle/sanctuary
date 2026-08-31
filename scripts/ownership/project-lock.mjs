import path from 'node:path';
import { canonicalSha256 } from './canonical-json.mjs';
import {
  acquireDeploymentLock, assertDeploymentLock, heartbeatDeploymentLock,
  inspectDeploymentLock, recoverStaleDeploymentLock, releaseDeploymentLock,
} from './deployment-lock.mjs';

const PROJECT = /^[A-Za-z0-9_.-]{1,128}$/;

export function projectMutationLockPath(_runtimeDirectory, project) {
  if (!PROJECT.test(project ?? '') || ['.', '..'].includes(project)) {
    throw new Error('Compose project has an invalid format');
  }
  const isolatedRoot = process.env.SANCTUARY_TEST_PROJECT_LOCK_ROOT;
  if (isolatedRoot && process.env.SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT !== 'true') {
    throw new Error('test project lock root requires an explicit test-only guard');
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid === null) throw new Error('project mutation locks require a stable numeric user identity');
  const root = isolatedRoot === '@runtime'
    ? path.join(path.resolve(_runtimeDirectory), 'ownership', 'test-project-locks')
    : isolatedRoot
      ? path.resolve(isolatedRoot)
    : path.join('/tmp', `sanctuary-ownership-${uid}`, 'project-locks');
  const identity = canonicalSha256({ composeProjectName: project });
  return path.join(root, identity, 'mutation-lock');
}

export function acquireProjectMutationLock(runtimeDirectory, project, options) {
  return acquireDeploymentLock(projectMutationLockPath(runtimeDirectory, project), options);
}

export function assertProjectMutationLock(runtimeDirectory, project, token, operationRunId) {
  return assertDeploymentLock(projectMutationLockPath(runtimeDirectory, project), token, operationRunId);
}

export function heartbeatProjectMutationLock(runtimeDirectory, project, token, operationRunId, options) {
  return heartbeatDeploymentLock(
    projectMutationLockPath(runtimeDirectory, project), token, operationRunId, options,
  );
}

export function inspectProjectMutationLock(runtimeDirectory, project) {
  return inspectDeploymentLock(projectMutationLockPath(runtimeDirectory, project));
}

export function releaseProjectMutationLock(runtimeDirectory, project, token, operationRunId) {
  return releaseDeploymentLock(projectMutationLockPath(runtimeDirectory, project), token, operationRunId);
}

export function recoverProjectMutationLock(runtimeDirectory, project, expectedOwnerDigest) {
  return recoverStaleDeploymentLock(
    projectMutationLockPath(runtimeDirectory, project), expectedOwnerDigest,
  );
}
