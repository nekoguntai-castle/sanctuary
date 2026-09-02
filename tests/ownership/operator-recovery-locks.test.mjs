import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  acquireOperatorRecoveryLocks, acquireOperatorRecoveryRecoveryLocks,
  releaseOperatorRecoveryLocks,
} from '../../scripts/ownership/operator-recovery-locks.mjs';

test('recovery locks use canonical project/deployment fences and release cleanly', () => {
  const runtimeDirectory = mkdtempSync(path.join(tmpdir(), 'operator-recovery-locks-'));
  const options = {
    runtimeDirectory, deploymentId: 'ci-1-deploy', composeProjectName: 'ci-1-project',
    operationRunId: 'operator-run-1', journalPath: path.join(runtimeDirectory, 'journal.jsonl'),
  };
  const held = acquireOperatorRecoveryLocks(options);
  assert.throws(() => acquireOperatorRecoveryLocks({ ...options, operationRunId: 'other-run' }), /lock|active/i);
  releaseOperatorRecoveryLocks(held);
  const next = acquireOperatorRecoveryLocks({ ...options, operationRunId: 'other-run' });
  releaseOperatorRecoveryLocks(next);
});

test('journal recovery CAS-reclaims stale original and prior recovery lock pairs', async () => {
  const runtimeDirectory = mkdtempSync(path.join(tmpdir(), 'operator-recovery-lock-reclaim-'));
  const common = {
    runtimeDirectory, deploymentId: 'deploy-a', composeProjectName: 'project-a',
    journalPath: path.join(runtimeDirectory, 'journal.jsonl'),
  };
  const controller = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await once(controller, 'spawn');
  acquireOperatorRecoveryLocks({ ...common, operationRunId: 'original-run', controllerPid: controller.pid });
  controller.kill('SIGKILL');
  await once(controller, 'exit');
  const recoveryController = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await once(recoveryController, 'spawn');
  const firstRecoveryId = 'operator-recovery-11111111-1111-4111-8111-111111111111';
  const recovered = acquireOperatorRecoveryRecoveryLocks({
    ...common, originalOperationRunId: 'original-run', controllerRunId: firstRecoveryId,
    controllerPid: recoveryController.pid,
  });
  assert.equal(recovered.observations.project.state, 'stale');
  assert.equal(recovered.observations.deployment.state, 'stale');
  assert.equal(recovered.held.operationRunId, firstRecoveryId);
  recoveryController.kill('SIGKILL');
  await once(recoveryController, 'exit');
  const second = acquireOperatorRecoveryRecoveryLocks({
    ...common, originalOperationRunId: 'original-run',
    controllerRunId: 'operator-recovery-22222222-2222-4222-8222-222222222222',
  });
  assert.equal(second.observations.project.state, 'stale');
  assert.equal(second.observations.deployment.state, 'stale');
  releaseOperatorRecoveryLocks(second.held);
});
