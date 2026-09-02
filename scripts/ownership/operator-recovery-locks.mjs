import path from 'node:path';
import {
  acquireCleanupApplyLocks, acquireCleanupRecoveryLocks, releaseCleanupLocks,
} from './cleanup-lock-controller.mjs';
import { ensureOwnerDirectory } from './deployment-store-io.mjs';
import { inspectDeploymentLock } from './deployment-lock.mjs';
import { inspectProjectMutationLock } from './project-lock.mjs';

function recoveryDeploymentRoot(runtimeDirectory, deploymentId) {
  const ownership = path.join(path.resolve(runtimeDirectory), 'ownership');
  const deployments = path.join(ownership, 'deployments');
  const deployment = path.join(deployments, deploymentId);
  ensureOwnerDirectory(ownership);
  ensureOwnerDirectory(deployments);
  ensureOwnerDirectory(deployment);
  return deployment;
}

/** Acquire the same cooperative project/deployment fences used by ordinary cleanup. */
export function acquireOperatorRecoveryLocks({
  runtimeDirectory, deploymentId, composeProjectName, operationRunId, journalPath,
  controllerPid, now,
} = {}) {
  const deploymentRoot = recoveryDeploymentRoot(runtimeDirectory, deploymentId);
  return acquireCleanupApplyLocks({
    runtimeDirectory, deploymentId,
    deploymentLockPath: path.join(deploymentRoot, 'mutation-lock'),
    composeProjectName, operationRunId, journalPath, generation: 1,
    ...(controllerPid === undefined ? {} : { controllerPid }),
    ...(now ? { now } : {}),
  });
}

/** CAS-reclaim only the exact stale original lock pair before journal recovery. */
export function acquireOperatorRecoveryRecoveryLocks({
  runtimeDirectory, deploymentId, composeProjectName, originalOperationRunId,
  controllerRunId, journalPath, controllerPid, now,
} = {}) {
  const deploymentRoot = recoveryDeploymentRoot(runtimeDirectory, deploymentId);
  const deploymentLockPath = path.join(deploymentRoot, 'mutation-lock');
  const priorOwners = [
    inspectProjectMutationLock(runtimeDirectory, composeProjectName),
    inspectDeploymentLock(deploymentLockPath),
  ].filter((entry) => entry.state === 'locked').map((entry) => entry.owner);
  const priorRunIds = [...new Set(priorOwners.map((owner) => owner.operationRunId))];
  if (priorRunIds.length > 1) throw new Error('stale operator recovery locks do not have one prior controller');
  const expectedPriorRunId = priorRunIds[0] ?? originalOperationRunId;
  if (expectedPriorRunId !== originalOperationRunId
      && !/^operator-recovery-[0-9a-f-]{36}$/.test(expectedPriorRunId)) {
    throw new Error('stale operator recovery lock owner is not an approved recovery controller');
  }
  return acquireCleanupRecoveryLocks({
    runtimeDirectory, deploymentId,
    deploymentLockPath,
    composeProjectName, originalOperationRunId: expectedPriorRunId, controllerRunId,
    journalPath, generation: 1,
    ...(controllerPid === undefined ? {} : { controllerPid }),
    ...(now ? { now } : {}),
  });
}

export function releaseOperatorRecoveryLocks(held) {
  return releaseCleanupLocks(held);
}
