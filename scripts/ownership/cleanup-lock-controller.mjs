import { canonicalSha256 } from './canonical-json.mjs';
import { assertNoActiveCleanup } from './deployment-cleanup-gate.mjs';
import {
  acquireDeploymentLock, inspectDeploymentLock, recoverStaleDeploymentLock,
  releaseDeploymentLock,
} from './deployment-lock.mjs';
import {
  acquireProjectMutationLock, inspectProjectMutationLock, recoverProjectMutationLock,
  releaseProjectMutationLock,
} from './project-lock.mjs';

function acquirePair({
  runtimeDirectory, deploymentId, deploymentLockPath, composeProjectName,
  operationRunId, journalPath, generation, controllerPid = process.pid, now = () => new Date(),
}) {
  const acquiredAt = now();
  const project = acquireProjectMutationLock(runtimeDirectory, composeProjectName, {
    operationRunId, journalPath, generation, controllerPid, now: () => acquiredAt,
  });
  try {
    const deployment = acquireDeploymentLock(deploymentLockPath, {
      operationRunId, journalPath, generation, controllerPid,
      token: project.token, now: () => acquiredAt,
    });
    return Object.freeze({
      runtimeDirectory, deploymentId, deploymentLockPath, composeProjectName,
      operationRunId, token: deployment.token,
      ownerDigest: canonicalSha256(deployment),
    });
  } catch (error) {
    releaseProjectMutationLock(runtimeDirectory, composeProjectName, project.token, operationRunId);
    throw error;
  }
}

export function releaseCleanupLocks(held) {
  const errors = [];
  try {
    releaseDeploymentLock(held.deploymentLockPath, held.token, held.operationRunId);
  } catch (error) { errors.push(error); }
  try {
    releaseProjectMutationLock(
      held.runtimeDirectory, held.composeProjectName, held.token, held.operationRunId,
    );
  } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'failed to release cleanup mutation locks');
}

export function acquireCleanupApplyLocks(options) {
  const held = acquirePair(options);
  try {
    assertNoActiveCleanup({
      runtimeDirectory: options.runtimeDirectory, deploymentId: options.deploymentId,
    });
    return held;
  } catch (error) {
    releaseCleanupLocks(held);
    throw error;
  }
}

function recoveryObservation(observation, label) {
  if (observation.state === 'unlocked') {
    return Object.freeze({ state: 'absent', ownerDigest: null });
  }
  if (observation.state !== 'locked' || !/^[a-f0-9]{64}$/.test(observation.ownerDigest ?? '')) {
    throw new Error(`${label} lock observation is ambiguous`);
  }
  if (observation.processMatches === true) throw new Error(`${label} lock controller is still live`);
  if (observation.processMatches !== false) throw new Error(`${label} lock liveness is ambiguous`);
  return Object.freeze({ state: 'stale', ownerDigest: observation.ownerDigest });
}

function assertOriginalOwner(observation, expectedOperationRunId, expectedJournalPath, label) {
  if (observation.state !== 'locked') return;
  if (observation.owner?.operationRunId !== expectedOperationRunId
      || observation.owner?.journalPath !== expectedJournalPath) {
    throw new Error(`${label} stale lock does not bind the original cleanup operation and journal`);
  }
}

export function acquireCleanupRecoveryLocks({
  runtimeDirectory, deploymentId, deploymentLockPath, composeProjectName,
  originalOperationRunId, controllerRunId, journalPath, generation,
  controllerPid = process.pid, now = () => new Date(),
}) {
  if (controllerRunId === originalOperationRunId) {
    throw new Error('recovery controllerRunId must be distinct from the original operation');
  }
  const projectRaw = inspectProjectMutationLock(runtimeDirectory, composeProjectName);
  const deploymentRaw = inspectDeploymentLock(deploymentLockPath);
  const project = recoveryObservation(projectRaw, 'project mutation');
  const deployment = recoveryObservation(deploymentRaw, 'deployment mutation');
  assertOriginalOwner(projectRaw, originalOperationRunId, journalPath, 'project mutation');
  assertOriginalOwner(deploymentRaw, originalOperationRunId, journalPath, 'deployment mutation');
  if (projectRaw.owner && deploymentRaw.owner
      && (projectRaw.owner.token !== deploymentRaw.owner.token
        || projectRaw.owner.operationRunId !== deploymentRaw.owner.operationRunId)) {
    throw new Error('stale cleanup locks do not have one original owner');
  }
  const observations = Object.freeze({
    project, deployment,
    projectDigest: canonicalSha256(project), deploymentDigest: canonicalSha256(deployment),
  });
  if (project.state === 'stale') {
    recoverProjectMutationLock(runtimeDirectory, composeProjectName, project.ownerDigest);
  }
  if (deployment.state === 'stale') {
    recoverStaleDeploymentLock(deploymentLockPath, deployment.ownerDigest);
  }
  const held = acquirePair({
    runtimeDirectory, deploymentId, deploymentLockPath, composeProjectName,
    operationRunId: controllerRunId, journalPath, generation, controllerPid, now,
  });
  return Object.freeze({ held, observations });
}
