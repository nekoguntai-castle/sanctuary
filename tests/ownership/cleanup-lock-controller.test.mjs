import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireCleanupApplyLocks, acquireCleanupRecoveryLocks, releaseCleanupLocks,
} from '../../scripts/ownership/cleanup-lock-controller.mjs';
import {
  acquireDeploymentLock, inspectDeploymentLock, releaseDeploymentLock,
} from '../../scripts/ownership/deployment-lock.mjs';
import { DeploymentStore } from '../../scripts/ownership/deployment-store.mjs';
import { inspectDeploymentCleanupState } from '../../scripts/ownership/deployment-cleanup-gate.mjs';
import {
  acquireProjectMutationLock, inspectProjectMutationLock,
} from '../../scripts/ownership/project-lock.mjs';

process.env.SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT = 'true';
process.env.SANCTUARY_TEST_PROJECT_LOCK_ROOT = mkdtempSync(path.join(os.tmpdir(), 'cleanup-controller-locks-'));

async function stoppedController() {
  const controller = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await once(controller, 'spawn');
  return controller;
}

async function stopController(controller) {
  controller.kill('SIGKILL');
  await once(controller, 'exit');
}

function recoveryFixture(name) {
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), `cleanup-controller-${name}-`));
  chmodSync(runtimeDirectory, 0o700);
  const deploymentId = `deploy-${name}`;
  return {
    runtimeDirectory,
    deploymentId,
    composeProjectName: `cleanup-controller-${name}`,
    store: new DeploymentStore({ runtimeDirectory, deploymentId }),
    journalPath: path.join(runtimeDirectory, 'ownership', 'cleanup-executions', `${name}.jsonl`),
  };
}

function assertFreshPair(fixture, recovered, expectedProject, expectedDeployment) {
  assert.equal(recovered.observations.project.state, expectedProject);
  assert.equal(recovered.observations.deployment.state, expectedDeployment);
  const project = inspectProjectMutationLock(
    fixture.runtimeDirectory, fixture.composeProjectName,
  );
  const deployment = inspectDeploymentLock(fixture.store.lockPath);
  assert.equal(project.owner.operationRunId, 'recover-1');
  assert.equal(deployment.owner.operationRunId, 'recover-1');
  assert.equal(project.owner.token, recovered.held.token);
  assert.equal(deployment.owner.token, recovered.held.token);
  releaseCleanupLocks(recovered.held);
  assert.equal(inspectDeploymentLock(fixture.store.lockPath).state, 'unlocked');
  assert.equal(inspectProjectMutationLock(
    fixture.runtimeDirectory, fixture.composeProjectName,
  ).state, 'unlocked');
}

async function exercisePartialRecovery(name, staleProject, staleDeployment) {
  const fixture = recoveryFixture(name);
  let controller;
  if (staleProject || staleDeployment) {
    controller = await stoppedController();
    const owner = {
      operationRunId: 'cleanup-1', journalPath: fixture.journalPath,
      generation: 1, controllerPid: controller.pid,
    };
    if (staleProject) {
      acquireProjectMutationLock(
        fixture.runtimeDirectory, fixture.composeProjectName, owner,
      );
    }
    if (staleDeployment) acquireDeploymentLock(fixture.store.lockPath, owner);
    await stopController(controller);
  }
  const recovered = acquireCleanupRecoveryLocks({
    ...fixture, deploymentLockPath: fixture.store.lockPath,
    originalOperationRunId: 'cleanup-1', controllerRunId: 'recover-1', generation: 1,
  });
  assertFreshPair(
    fixture, recovered, staleProject ? 'stale' : 'absent', staleDeployment ? 'stale' : 'absent',
  );
}

function childMailbox(child) {
  const queued = [];
  const waiters = [];
  child.on('message', (message) => {
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queued.push(message);
  });
  return () => new Promise((resolve, reject) => {
    if (queued.length > 0) { resolve(queued.shift()); return; }
    const timer = setTimeout(() => reject(new Error('lock contender timed out')), 5_000);
    waiters.push((message) => { clearTimeout(timer); resolve(message); });
  });
}

function spawnApplyContender(options) {
  const controllerUrl = new URL(
    '../../scripts/ownership/cleanup-lock-controller.mjs', import.meta.url,
  ).href;
  const script = `
    import { acquireCleanupApplyLocks, releaseCleanupLocks } from ${JSON.stringify(controllerUrl)};
    const options = ${JSON.stringify(options)};
    process.send({ type: 'ready' });
    process.on('message', (message) => {
      if (message === 'start') {
        try {
          globalThis.held = acquireCleanupApplyLocks({ ...options, controllerPid: process.pid });
          process.send({ type: 'acquired', token: globalThis.held.token });
        } catch (error) {
          process.send({ type: 'conflict', code: error.code, message: error.message }, () => process.exit(0));
        }
      }
      if (message === 'release' && globalThis.held) {
        releaseCleanupLocks(globalThis.held);
        process.send({ type: 'released' }, () => process.exit(0));
      }
    });
  `;
  return spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
}

function boundedExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('lock contender did not exit')), 5_000);
    child.once('exit', (...status) => {
      clearTimeout(timer);
      resolve(status);
    });
  });
}

test('recovery acquires one fresh pair when both original locks are absent', async () => {
  await exercisePartialRecovery('both-absent', false, false);
});

test('recovery CAS-reclaims a stale project lock when the deployment lock is absent', async () => {
  await exercisePartialRecovery('project-stale', true, false);
});

test('recovery CAS-reclaims a stale deployment lock when the project lock is absent', async () => {
  await exercisePartialRecovery('deployment-stale', false, true);
});

test('barrier-released apply contenders produce one paired owner and one stable conflict', async (t) => {
  const fixture = recoveryFixture('concurrent-apply');
  const options = {
    runtimeDirectory: fixture.runtimeDirectory,
    deploymentId: fixture.deploymentId,
    deploymentLockPath: fixture.store.lockPath,
    composeProjectName: fixture.composeProjectName,
    operationRunId: 'cleanup-race',
    journalPath: fixture.journalPath,
    generation: 1,
  };
  const contenders = [spawnApplyContender(options), spawnApplyContender(options)];
  t.after(() => contenders.forEach((child) => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }));
  const exits = contenders.map(boundedExit);
  const mailboxes = contenders.map(childMailbox);
  assert.deepEqual(await Promise.all(mailboxes.map((receive) => receive())), [
    { type: 'ready' }, { type: 'ready' },
  ]);

  const outcomes = mailboxes.map((receive) => receive());
  contenders.forEach((child) => child.send('start'));
  const resolved = await Promise.all(outcomes);
  const acquiredIndex = resolved.findIndex(({ type }) => type === 'acquired');
  const conflict = resolved.find(({ type }) => type === 'conflict');
  assert.notEqual(acquiredIndex, -1);
  assert.equal(resolved.filter(({ type }) => type === 'acquired').length, 1);
  assert.equal(conflict.code, 'DEPLOYMENT_LOCK_CONFLICT');

  const project = inspectProjectMutationLock(
    fixture.runtimeDirectory, fixture.composeProjectName,
  );
  const deployment = inspectDeploymentLock(fixture.store.lockPath);
  assert.equal(project.owner.token, resolved[acquiredIndex].token);
  assert.equal(deployment.owner.token, resolved[acquiredIndex].token);
  assert.equal(project.owner.pid, contenders[acquiredIndex].pid);
  assert.equal(deployment.owner.pid, contenders[acquiredIndex].pid);
  assert.deepEqual(
    inspectDeploymentCleanupState(fixture), { state: 'clear', pointerDigest: null },
  );
  assert.equal(existsSync(path.join(
    fixture.runtimeDirectory, 'ownership', 'cleanup-executions',
  )), false);
  assert.equal(existsSync(path.join(
    fixture.runtimeDirectory, 'ownership', 'deployments', fixture.deploymentId,
    'active-cleanup.json',
  )), false);

  const released = mailboxes[acquiredIndex]();
  contenders[acquiredIndex].send('release');
  assert.deepEqual(await released, { type: 'released' });
  await Promise.all(exits);
  assert.equal(inspectDeploymentLock(fixture.store.lockPath).state, 'unlocked');
  assert.equal(inspectProjectMutationLock(
    fixture.runtimeDirectory, fixture.composeProjectName,
  ).state, 'unlocked');
});

test('recovery binds both stale owners, CAS-reclaims them, and acquires one fresh controller pair', async () => {
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-controller-runtime-'));
  chmodSync(runtimeDirectory, 0o700);
  const deploymentId = 'deploy-1';
  const composeProjectName = 'cleanup-controller-project';
  const store = new DeploymentStore({ runtimeDirectory, deploymentId });
  const journalPath = path.join(runtimeDirectory, 'ownership', 'cleanup-executions', 'journal.jsonl');
  const controller = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await once(controller, 'spawn');
  acquireCleanupApplyLocks({
    runtimeDirectory, deploymentId, deploymentLockPath: store.lockPath,
    composeProjectName, operationRunId: 'cleanup-1', journalPath,
    generation: 1, controllerPid: controller.pid,
  });
  controller.kill('SIGKILL');
  await once(controller, 'exit');
  assert.equal(inspectDeploymentLock(store.lockPath).processMatches, false);
  assert.equal(inspectProjectMutationLock(runtimeDirectory, composeProjectName).processMatches, false);

  assert.throws(() => acquireCleanupRecoveryLocks({
    runtimeDirectory, deploymentId, deploymentLockPath: store.lockPath,
    composeProjectName, originalOperationRunId: 'cleanup-1',
    controllerRunId: 'cleanup-1', journalPath, generation: 1,
  }), /must be distinct/);
  assert.equal(inspectDeploymentLock(store.lockPath).state, 'locked');
  assert.equal(inspectProjectMutationLock(runtimeDirectory, composeProjectName).state, 'locked');

  const recovered = acquireCleanupRecoveryLocks({
    runtimeDirectory, deploymentId, deploymentLockPath: store.lockPath,
    composeProjectName, originalOperationRunId: 'cleanup-1',
    controllerRunId: 'recover-1', journalPath, generation: 1,
  });
  assert.equal(recovered.observations.project.state, 'stale');
  assert.equal(recovered.observations.deployment.state, 'stale');
  assert.equal(recovered.held.operationRunId, 'recover-1');
  assert.equal(inspectDeploymentLock(store.lockPath).owner.operationRunId, 'recover-1');
  assert.equal(
    inspectProjectMutationLock(runtimeDirectory, composeProjectName).owner.token,
    recovered.held.token,
  );
  releaseCleanupLocks(recovered.held);
  assert.equal(inspectDeploymentLock(store.lockPath).state, 'unlocked');
  assert.equal(inspectProjectMutationLock(runtimeDirectory, composeProjectName).state, 'unlocked');
});

test('cleanup lock release attempts the project lock when deployment release fails', () => {
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'cleanup-controller-release-'));
  chmodSync(runtimeDirectory, 0o700);
  const store = new DeploymentStore({ runtimeDirectory, deploymentId: 'deploy-release' });
  const composeProjectName = 'cleanup-controller-release-project';
  const operationRunId = 'cleanup-release';
  const project = acquireProjectMutationLock(runtimeDirectory, composeProjectName, {
    operationRunId, controllerPid: process.pid,
  });
  const deployment = acquireDeploymentLock(store.lockPath, {
    operationRunId, controllerPid: process.pid,
  });

  assert.throws(() => releaseCleanupLocks({
    runtimeDirectory, deploymentId: 'deploy-release', deploymentLockPath: store.lockPath,
    composeProjectName, operationRunId, token: project.token,
  }), /token mismatch/);
  assert.equal(inspectProjectMutationLock(runtimeDirectory, composeProjectName).state, 'unlocked');
  assert.equal(inspectDeploymentLock(store.lockPath).state, 'locked');
  releaseDeploymentLock(store.lockPath, deployment.token, operationRunId);
});
