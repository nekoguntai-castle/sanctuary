import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../../scripts/ownership/canonical-json.mjs';
import { resolveDeploymentDefinition, composeArguments } from '../../scripts/ownership/deployment-definition.mjs';
import {
  acquireDeploymentLock, assertDeploymentLock, DeploymentLockConflict, heartbeatDeploymentLock, inspectDeploymentLock,
  readProcessStartIdentity, recoverStaleDeploymentLock, releaseDeploymentLock,
} from '../../scripts/ownership/deployment-lock.mjs';
import { DeploymentStore } from '../../scripts/ownership/deployment-store.mjs';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-store-project-'));
  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-store-runtime-'));
  writeFileSync(path.join(root, 'docker-compose.yml'), 'services:\n  app:\n    image: one:test\n');
  writeFileSync(path.join(runtimeDirectory, 'sanctuary.env'), 'JWT_SECRET=private\n');
  const definitionOptions = {
    projectDirectory: root, runtimeDirectory, ownerId: 'operator-1', release: 'v1.0.0',
    commit: 'a'.repeat(40), policyDigest: 'b'.repeat(64), contextFingerprint: 'c'.repeat(64),
  };
  const store = new DeploymentStore({ runtimeDirectory, deploymentId: 'deployment-1' });
  store.initialize({ projectDirectory: root, composeProjectName: path.basename(root).toLowerCase() });
  return { root, runtimeDirectory, definitionOptions, store };
}

function advanceDeployment(store, owner, prepared) {
  let state = prepared;
  for (const stage of ['build_started', 'build_completed', 'postgres_started', 'password_reconciled', 'stack_started', 'health_verified']) {
    state = store.transitionPending({ operationRunId: owner.operationRunId, lockToken: owner.token, expectedPendingDigest: state.pendingDigest, nextStage: stage });
  }
  return state;
}

test('atomic directory lock conflicts and releases only for the exact token and operation', () => {
  const fixtureState = fixture();
  const owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-1' });
  assert.equal(assertDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-1').pid, process.pid);
  const heartbeat = heartbeatDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-1', { generation: 7 });
  assert.equal(heartbeat.generation, 7);
  assert.throws(() => acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-2' }), DeploymentLockConflict);
  assert.throws(() => releaseDeploymentLock(fixtureState.store.lockPath, '00000000-0000-0000-0000-000000000000', 'run-1'), /token mismatch/);
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-1');
  assert.equal(inspectDeploymentLock(fixtureState.store.lockPath).state, 'unlocked');
});

test('stale lock recovery requires the observed digest and refuses a live owner', () => {
  const fixtureState = fixture();
  const live = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-live' });
  const inspection = inspectDeploymentLock(fixtureState.store.lockPath);
  assert.throws(() => recoverStaleDeploymentLock(fixtureState.store.lockPath, inspection.ownerDigest), /still running/);
  releaseDeploymentLock(fixtureState.store.lockPath, live.token, 'run-live');

  const moduleUrl = pathToFileURL(path.resolve('scripts/ownership/deployment-lock.mjs')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { acquireDeploymentLock } from ${JSON.stringify(moduleUrl)}; acquireDeploymentLock(process.argv[1], { operationRunId: 'run-dead' });`, fixtureState.store.lockPath]);
  assert.equal(child.status, 0, child.stderr.toString());
  const stale = inspectDeploymentLock(fixtureState.store.lockPath);
  assert.equal(stale.processMatches, false);
  assert.throws(() => recoverStaleDeploymentLock(fixtureState.store.lockPath, '0'.repeat(64)), /changed before recovery/);
  recoverStaleDeploymentLock(fixtureState.store.lockPath, stale.ownerDigest);
  assert.equal(inspectDeploymentLock(fixtureState.store.lockPath).state, 'unlocked');
});

test('controller PID and start identity survive a short-lived CLI helper and reject PID reuse', () => {
  const fixtureState = fixture();
  const moduleUrl = pathToFileURL(path.resolve('scripts/ownership/deployment-lock.mjs')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { acquireDeploymentLock } from ${JSON.stringify(moduleUrl)}; const owner = acquireDeploymentLock(process.argv[1], { operationRunId: 'run-parent', controllerPid: Number(process.argv[2]) }); process.stdout.write(owner.token);`, fixtureState.store.lockPath, String(process.pid)]);
  assert.equal(child.status, 0, child.stderr.toString());
  const token = child.stdout.toString();
  assert.equal(inspectDeploymentLock(fixtureState.store.lockPath).processMatches, true);
  assert.equal(assertDeploymentLock(fixtureState.store.lockPath, token, 'run-parent').pid, process.pid);
  releaseDeploymentLock(fixtureState.store.lockPath, token, 'run-parent');
  assert.throws(() => acquireDeploymentLock(fixtureState.store.lockPath, {
    operationRunId: 'run-reused', controllerPid: process.pid,
    controllerStartIdentity: `${readProcessStartIdentity(process.pid)}-different`,
  }), /start identity mismatch/);
});

test('immutable snapshots survive source replacement and activation is CAS health-gated', () => {
  const fixtureState = fixture();
  const owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-1' });
  const bundle = resolveDeploymentDefinition(fixtureState.definitionOptions);
  const prepared = fixtureState.store.prepareRevision({ bundle, expectedActiveDigest: null, operationRunId: 'run-1', lockToken: owner.token });
  assert.throws(() => fixtureState.store.activateRevision({ operationRunId: 'run-1', lockToken: owner.token, expectedPendingDigest: prepared.pendingDigest }), /not health verified/);
  writeFileSync(path.join(fixtureState.root, 'docker-compose.yml'), 'services:\n  app:\n    image: two:test\n');
  const revision = fixtureState.store.readManifest(1, { verifySnapshots: true });
  const snapshotArgs = composeArguments(revision.manifest, { snapshotRoot: revision.revisionRoot });
  const snapshotFile = snapshotArgs[snapshotArgs.indexOf('-f') + 1];
  assert.match(readFileSync(snapshotFile, 'utf8'), /image: one:test/);
  const healthy = advanceDeployment(fixtureState.store, owner, prepared);
  const active = fixtureState.store.activateRevision({ operationRunId: 'run-1', lockToken: owner.token, expectedPendingDigest: healthy.pendingDigest });
  assert.equal(active.active.generation, 1);
  assert.equal(fixtureState.store.inspect().pending, null);
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-1');
});

test('write-ahead transition retries reuse the recorded next pointer', () => {
  const fixtureState = fixture();
  const owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-retry' });
  const prepared = fixtureState.store.prepareRevision({ bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: null, operationRunId: 'run-retry', lockToken: owner.token });
  const first = fixtureState.store.transitionPending({ operationRunId: 'run-retry', lockToken: owner.token, expectedPendingDigest: prepared.pendingDigest, nextStage: 'build_started', now: () => new Date('2026-01-01T00:00:00.000Z') });
  writeFileSync(fixtureState.store.pendingPath, canonicalJson(prepared.pending));
  const retried = fixtureState.store.transitionPending({ operationRunId: 'run-retry', lockToken: owner.token, expectedPendingDigest: prepared.pendingDigest, nextStage: 'build_started', now: () => new Date('2027-01-01T00:00:00.000Z') });
  assert.deepEqual(retried, first);
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-retry');
});

test('failed/stale revisions never reuse generations and stale active writers refuse', () => {
  const fixtureState = fixture();
  let owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-1' });
  const first = fixtureState.store.prepareRevision({ bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: null, operationRunId: 'run-1', lockToken: owner.token });
  const firstHealthy = advanceDeployment(fixtureState.store, owner, first);
  fixtureState.store.activateRevision({ operationRunId: 'run-1', lockToken: owner.token, expectedPendingDigest: firstHealthy.pendingDigest });
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-1');

  owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-2' });
  assert.throws(() => fixtureState.store.prepareRevision({ bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: null, operationRunId: 'run-2', lockToken: owner.token }), /compare-and-swap/);
  const activeDigest = fixtureState.store.readActive().value.manifestDigest;
  const second = fixtureState.store.prepareRevision({ bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: activeDigest, operationRunId: 'run-2', lockToken: owner.token });
  assert.equal(second.manifest.generation, 2);
  assert.throws(() => fixtureState.store.prepareRevision({ bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: activeDigest, operationRunId: 'run-2', lockToken: owner.token }), /already pending/);
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-2');
});

test('interrupted deployment checkpoints preserve active and resume the same pending revision', () => {
  for (const checkpoint of ['postgres_started', 'password_reconciled', 'stack_started']) {
    const fixtureState = fixture();
    let owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-initial' });
    const initial = fixtureState.store.prepareRevision({
      bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: null,
      operationRunId: 'run-initial', lockToken: owner.token,
    });
    const initialHealthy = advanceDeployment(fixtureState.store, owner, initial);
    fixtureState.store.activateRevision({
      operationRunId: 'run-initial', lockToken: owner.token,
      expectedPendingDigest: initialHealthy.pendingDigest,
    });
    releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-initial');

    writeFileSync(path.join(fixtureState.root, 'docker-compose.yml'), `services:\n  app:\n    image: ${checkpoint}:test\n`);
    owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: `run-${checkpoint}` });
    let pending = fixtureState.store.prepareRevision({
      bundle: resolveDeploymentDefinition(fixtureState.definitionOptions),
      expectedActiveDigest: fixtureState.store.readActive().value.manifestDigest,
      operationRunId: `run-${checkpoint}`, lockToken: owner.token,
    });
    const stages = ['build_started', 'build_completed', 'postgres_started', 'password_reconciled', 'stack_started'];
    for (const stage of stages.slice(0, stages.indexOf(checkpoint) + 1)) {
      pending = fixtureState.store.transitionPending({
        operationRunId: `run-${checkpoint}`, lockToken: owner.token,
        expectedPendingDigest: pending.pendingDigest, nextStage: stage,
      });
    }

    assert.equal(fixtureState.store.readActive().value.generation, 1);
    assert.equal(fixtureState.store.readPending().value.generation, 2);
    const interruptedDigest = pending.pendingDigest;
    const interruptedPointer = fixtureState.store.readPending().value;
    releaseDeploymentLock(fixtureState.store.lockPath, owner.token, `run-${checkpoint}`);

    const recoveryRunId = `recover-${checkpoint}`;
    owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: recoveryRunId });
    assert.throws(() => fixtureState.store.resumePending({
      operationRunId: recoveryRunId, lockToken: owner.token,
      expectedPendingDigest: interruptedDigest, expectedDefinitionDigest: '0'.repeat(64),
    }), /definition differs/);
    pending = fixtureState.store.resumePending({
      operationRunId: recoveryRunId, lockToken: owner.token,
      expectedPendingDigest: interruptedDigest,
      expectedDefinitionDigest: fixtureState.store.readManifest(2).manifest.definitionDigest,
    });
    assert.equal(pending.pending.generation, 2);
    assert.equal(pending.pending.stage, checkpoint);
    // Simulate a crash after the create-only recovery record is synced but
    // before the pending pointer replacement becomes durable.
    writeFileSync(fixtureState.store.pendingPath, canonicalJson(interruptedPointer));
    pending = fixtureState.store.resumePending({
      operationRunId: recoveryRunId, lockToken: owner.token,
      expectedPendingDigest: interruptedDigest,
      expectedDefinitionDigest: fixtureState.store.readManifest(2).manifest.definitionDigest,
      now: () => new Date('2030-01-01T00:00:00.000Z'),
    });
    assert.equal(pending.pending.operationRunId, recoveryRunId);
    for (const stage of [...stages.slice(stages.indexOf(checkpoint) + 1), 'health_verified']) {
      pending = fixtureState.store.transitionPending({
        operationRunId: recoveryRunId, lockToken: owner.token,
        expectedPendingDigest: pending.pendingDigest, nextStage: stage,
      });
    }
    const active = fixtureState.store.activateRevision({
      operationRunId: recoveryRunId, lockToken: owner.token,
      expectedPendingDigest: pending.pendingDigest,
    });
    assert.equal(active.active.generation, 2);
    assert.equal(active.active.manifestDigest, fixtureState.store.readManifest(2).manifestDigest);
    assert.notEqual(active.active.manifestDigest, interruptedDigest);
    assert.equal(fixtureState.store.inspect().pending, null);
    releaseDeploymentLock(fixtureState.store.lockPath, owner.token, recoveryRunId);
  }
});

test('no-start finalizes prepared state without changing active', () => {
  const fixtureState = fixture();
  const owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-no-start' });
  const pending = fixtureState.store.prepareRevision({ bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: null, operationRunId: 'run-no-start', lockToken: owner.token });
  const terminal = fixtureState.store.finalizePreparedRevision({ operationRunId: 'run-no-start', lockToken: owner.token, expectedPendingDigest: pending.pendingDigest });
  assert.equal(terminal.prepared.generation, 1);
  const state = fixtureState.store.inspect();
  assert.equal(state.active, null);
  assert.equal(state.pending, null);
  assert.equal(state.prepared.value.generation, 1);
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-no-start');
});

test('pointer reconciliation closes finalize, resume, and activation crash windows', () => {
  const fixtureState = fixture();
  const owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-reconcile' });
  const initial = fixtureState.store.prepareRevision({
    bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: null,
    operationRunId: 'run-reconcile', lockToken: owner.token,
  });
  fixtureState.store.finalizePreparedRevision({
    operationRunId: 'run-reconcile', lockToken: owner.token, expectedPendingDigest: initial.pendingDigest,
  });

  // Crash after prepared write but before pending unlink.
  writeFileSync(fixtureState.store.pendingPath, canonicalJson(initial.pending));
  let reconciled = fixtureState.store.reconcilePointers({ operationRunId: 'run-reconcile', lockToken: owner.token });
  assert.equal(reconciled.pending.value.generation, 1);
  assert.equal(reconciled.prepared, null);
  const finalizedAgain = fixtureState.store.finalizePreparedRevision({
    operationRunId: 'run-reconcile', lockToken: owner.token, expectedPendingDigest: initial.pendingDigest,
  });

  const resumed = fixtureState.store.resumePreparedRevision({
    operationRunId: 'run-reconcile', lockToken: owner.token,
    expectedPreparedDigest: finalizedAgain.preparedDigest,
    expectedDefinitionDigest: resolveDeploymentDefinition(fixtureState.definitionOptions).definition.definitionDigest,
  });
  // Crash after pending write but before prepared unlink.
  writeFileSync(fixtureState.store.preparedPath, canonicalJson(finalizedAgain.prepared));
  reconciled = fixtureState.store.reconcilePointers({ operationRunId: 'run-reconcile', lockToken: owner.token });
  assert.equal(reconciled.pending.value.generation, 1);
  assert.equal(reconciled.prepared, null);

  const healthy = advanceDeployment(fixtureState.store, owner, resumed);
  fixtureState.store.activateRevision({
    operationRunId: 'run-reconcile', lockToken: owner.token, expectedPendingDigest: healthy.pendingDigest,
  });
  // Crash after active write but before activating-pending unlink.
  writeFileSync(fixtureState.store.pendingPath, canonicalJson({
    ...healthy.pending, stage: 'activating', sequence: healthy.pending.sequence + 1,
  }));
  reconciled = fixtureState.store.reconcilePointers({ operationRunId: 'run-reconcile', lockToken: owner.token });
  assert.equal(reconciled.active.value.generation, 1);
  assert.equal(reconciled.pending, null);
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-reconcile');
});

test('pointer reconciliation refuses nonmatching dual pointers', () => {
  const fixtureState = fixture();
  const owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-ambiguous' });
  const initial = fixtureState.store.prepareRevision({
    bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: null,
    operationRunId: 'run-ambiguous', lockToken: owner.token,
  });
  writeFileSync(fixtureState.store.preparedPath, canonicalJson({
    pointerVersion: 1, deploymentId: 'deployment-1', generation: 2,
    manifestDigest: initial.manifestDigest, priorActiveDigest: null,
    preparedAt: '2026-08-31T00:00:00.000Z',
  }));
  assert.throws(
    () => fixtureState.store.reconcilePointers({ operationRunId: 'run-ambiguous', lockToken: owner.token }),
    /ambiguous pending and prepared deployment pointers/,
  );
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-ambiguous');
});

test('rollback points active only after target snapshots and rollback health verify', () => {
  const fixtureState = fixture();
  let owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-1' });
  const first = fixtureState.store.prepareRevision({ bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: null, operationRunId: 'run-1', lockToken: owner.token });
  const firstHealthy = advanceDeployment(fixtureState.store, owner, first);
  fixtureState.store.activateRevision({ operationRunId: 'run-1', lockToken: owner.token, expectedPendingDigest: firstHealthy.pendingDigest });
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-1');

  writeFileSync(path.join(fixtureState.root, 'docker-compose.yml'), 'services:\n  app:\n    image: two:test\n');
  owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-2' });
  const priorDigest = fixtureState.store.readActive().value.manifestDigest;
  const second = fixtureState.store.prepareRevision({ bundle: resolveDeploymentDefinition(fixtureState.definitionOptions), expectedActiveDigest: priorDigest, operationRunId: 'run-2', lockToken: owner.token });
  const secondHealthy = advanceDeployment(fixtureState.store, owner, second);
  fixtureState.store.activateRevision({ operationRunId: 'run-2', lockToken: owner.token, expectedPendingDigest: secondHealthy.pendingDigest });
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-2');

  owner = acquireDeploymentLock(fixtureState.store.lockPath, { operationRunId: 'run-rollback' });
  const currentDigest = fixtureState.store.readActive().value.manifestDigest;
  let rollback = fixtureState.store.beginRollback({ targetGeneration: 1, expectedActiveDigest: currentDigest, operationRunId: 'run-rollback', lockToken: owner.token });
  rollback = fixtureState.store.transitionPending({ operationRunId: 'run-rollback', lockToken: owner.token, expectedPendingDigest: rollback.pendingDigest, nextStage: 'rollback_stack_started' });
  assert.equal(fixtureState.store.readActive().value.generation, 2);
  rollback = fixtureState.store.transitionPending({ operationRunId: 'run-rollback', lockToken: owner.token, expectedPendingDigest: rollback.pendingDigest, nextStage: 'rollback_health_verified' });
  const restored = fixtureState.store.completeRollback({ operationRunId: 'run-rollback', lockToken: owner.token, expectedPendingDigest: rollback.pendingDigest });
  assert.equal(restored.active.generation, 1);
  releaseDeploymentLock(fixtureState.store.lockPath, owner.token, 'run-rollback');
});
