import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindSubjectManagedCiCleanupLifecycle, finishCiCleanupLifecycle,
  prepareCiCleanupLifecycle, resumeCiCleanupLifecycle,
} from '../../scripts/ownership/ci-cleanup-lifecycle.mjs';
import {
  coordinatorStatePath, readCoordinatorState, transitionCoordinatorState,
} from '../../scripts/ownership/ci-cleanup-state.mjs';
import { DeploymentStore } from '../../scripts/ownership/deployment-store.mjs';
import {
  assertBoundCoordinatedRevision, deploymentIdentityOptions,
} from '../../scripts/ownership/deployment-coordinated-authority.mjs';
import { resolveDeploymentDefinition } from '../../scripts/ownership/deployment-definition.mjs';
import {
  acquireDeploymentLock, releaseDeploymentLock,
} from '../../scripts/ownership/deployment-lock.mjs';
import {
  acquireProjectMutationLock, releaseProjectMutationLock,
} from '../../scripts/ownership/project-lock.mjs';

const CHECKOUT = path.resolve('.');

function withCiEnvironment(callback) {
  const keys = [
    'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'RUNNER_TEMP',
    'FORGEJO_ACTIONS', 'FORGEJO_SERVER_URL',
  ];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-lifecycle-'));
  chmodSync(runnerTemp, 0o700);
  Object.assign(process.env, {
    GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '73001',
    GITHUB_RUN_ATTEMPT: '2', RUNNER_TEMP: runnerTemp,
    FORGEJO_ACTIONS: 'false', FORGEJO_SERVER_URL: '',
  });
  try { return callback(runnerTemp); } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

function prepareBoundSubject(runnerTemp, lane) {
  const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', lane);
  const prepared = prepareCiCleanupLifecycle({
    checkoutRoot: CHECKOUT, runtimeDirectory, lane,
    authorityMode: 'deployment_managed_by_subject',
    now: new Date('2026-08-31T00:00:00.000Z'),
  });
  const authority = prepared.state.authority;
  const store = new DeploymentStore({
    runtimeDirectory, deploymentId: authority.deploymentId,
  });
  const projectLock = acquireProjectMutationLock(
    runtimeDirectory, authority.composeProjectName,
    { operationRunId: authority.operationRunId },
  );
  const deploymentLock = acquireDeploymentLock(store.lockPath, {
    operationRunId: authority.operationRunId, token: projectLock.token,
  });
  try {
    const bundle = resolveDeploymentDefinition({
      projectDirectory: CHECKOUT, runtimeDirectory,
      envFile: path.join(runtimeDirectory, 'sanctuary.env'),
      composeProjectName: authority.composeProjectName,
      ownerId: authority.ownerId, release: 'subject-release',
      commit: authority.checkoutCommit, policyDigest: authority.policyDigest,
      contextFingerprint: 'd'.repeat(64),
    });
    store.prepareRevision({
      bundle, expectedActiveDigest: null,
      operationRunId: authority.operationRunId, lockToken: deploymentLock.token,
      now: () => new Date(prepared.state.resourceCreatedAt),
    });
    const bound = bindSubjectManagedCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT,
      lockToken: deploymentLock.token,
      now: new Date('2026-08-31T00:00:01.000Z'),
    });
    return { prepared, store, bound };
  } finally {
    releaseDeploymentLock(store.lockPath, deploymentLock.token, authority.operationRunId);
    releaseProjectMutationLock(
      runtimeDirectory, authority.composeProjectName, projectLock.token,
      authority.operationRunId,
    );
  }
}

test('CI cleanup lifecycle activates exact manifest authority then terminalizes and retires it', () => {
  withCiEnvironment((runnerTemp) => {
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'install');
    const prepared = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'install',
      now: new Date('2026-08-31T00:00:00.000Z'),
    });
    assert.equal(prepared.state.phase, 'trust_installed');
    assert.equal(prepared.environment.SANCTUARY_RESOURCE_LIFECYCLE, 'obsolete');
    assert.equal(prepared.environment.SANCTUARY_SOURCE_COMMIT, prepared.state.authority.checkoutCommit);
    assert.match(prepared.environment.SANCTUARY_IMAGE_LOCK_SHA256, /^[a-f0-9]{64}$/);
    assert.match(prepared.environment.SANCTUARY_VERSION, /^\d+\.\d+\.\d+/);
    assert.equal(prepared.environment.SANCTUARY_BUILD_ID,
      `checkout-${prepared.state.authority.checkoutCommit}`);
    assert.equal(prepared.environment.SANCTUARY_IMAGE_TAG,
      prepared.state.authority.composeProjectName);
    assert.equal(prepared.environment.SANCTUARY_VOLUME_CLEANUP_POLICY, 'exact_delete');
    const store = new DeploymentStore({
      runtimeDirectory, deploymentId: prepared.state.authority.deploymentId,
    });
    assert.equal(store.readActive().value.manifestDigest, prepared.state.deploymentManifestDigest);
    const resumed = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'install',
      now: new Date('2026-08-31T00:00:01.000Z'),
    });
    assert.equal(resumed.digest, prepared.digest);

    const finished = finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 17,
      now: new Date('2026-08-31T00:00:05.000Z'),
    });
    assert.equal(finished.state.phase, 'deployment_retired');
    assert.equal(finished.state.subjectExitStatus, 17);
    assert.equal(finished.state.cleanupSuppression, null);
    assert.equal(finished.runManifest.manifest.terminalAt, '2026-08-31T00:00:05.000Z');
    assert.equal(store.readActive(), null);
    assert.equal(store.readRetired().length, 1);
    const retried = finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 17,
      now: new Date('2026-08-31T00:00:06.000Z'),
    });
    assert.equal(retried.digest, finished.digest);
  });
});

test('CI cleanup lifecycle durably preserves process-quiescence suppression', () => {
  withCiEnvironment((runnerTemp) => {
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'suppressed');
    const prepared = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'suppressed',
      now: new Date('2026-08-31T00:00:00.000Z'),
    });
    const finished = finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 143,
      cleanupSuppression: 'subject_quiescence_failed',
      now: new Date('2026-08-31T00:00:05.000Z'),
    });
    assert.equal(finished.state.cleanupSuppression, 'subject_quiescence_failed');
    const resumed = finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 143,
      now: new Date('2026-08-31T00:00:06.000Z'),
    });
    assert.equal(resumed.state.cleanupSuppression, 'subject_quiescence_failed');
  });
});

test('deployment-managed subject binds its exact pending definition before mutation', () => {
  withCiEnvironment((runnerTemp) => {
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'subject-managed');
    const prepared = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'subject-managed',
      authorityMode: 'deployment_managed_by_subject',
      now: new Date('2026-08-31T00:00:00.000Z'),
    });
    assert.equal(prepared.state.phase, 'subject_ready');
    assert.equal(prepared.environment.SANCTUARY_DEPLOYMENT_SCOPE, 'ci_ephemeral');
    assert.equal(prepared.environment.SANCTUARY_CLEANUP_STATE, prepared.path);
    assert.equal(
      prepared.environment.SANCTUARY_CLEANUP_CREATED_AT,
      prepared.state.resourceCreatedAt,
    );
    assert.notEqual(prepared.environment.SANCTUARY_CLEANUP_CREATED_AT, 'null');
    const authority = prepared.state.authority;
    const store = new DeploymentStore({
      runtimeDirectory, deploymentId: authority.deploymentId,
    });
    const projectLock = acquireProjectMutationLock(
      runtimeDirectory, authority.composeProjectName,
      { operationRunId: authority.operationRunId },
    );
    const deploymentLock = acquireDeploymentLock(store.lockPath, {
      operationRunId: authority.operationRunId, token: projectLock.token,
    });
    try {
      const bundle = resolveDeploymentDefinition({
        projectDirectory: CHECKOUT, runtimeDirectory,
        envFile: path.join(runtimeDirectory, 'sanctuary.env'),
        composeProjectName: authority.composeProjectName,
        ownerId: authority.ownerId, release: 'subject-release',
        commit: authority.checkoutCommit, policyDigest: authority.policyDigest,
        contextFingerprint: 'd'.repeat(64),
      });
      let pending = store.prepareRevision({
        bundle, expectedActiveDigest: null,
        operationRunId: authority.operationRunId, lockToken: deploymentLock.token,
        legacyResources: [{
          resourceClass: 'compose_volume', locator: 'legacy-data',
          composeResource: 'postgres_data', immutableIdentity: 'e'.repeat(64),
          cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled',
        }],
        now: () => new Date(prepared.state.resourceCreatedAt),
      });
      const bound = bindSubjectManagedCiCleanupLifecycle({
        statePath: prepared.path, checkoutRoot: CHECKOUT,
        lockToken: deploymentLock.token,
        now: new Date('2026-08-31T00:00:02.000Z'),
      });
      assert.equal(bound.state.phase, 'trust_installed');
      assert.equal(bound.state.generation, pending.manifest.generation);
      assert.equal(bound.state.deploymentManifestDigest, pending.manifestDigest);
      for (const stage of [
        'build_started', 'build_completed', 'postgres_started', 'password_reconciled',
        'stack_started', 'health_verified',
      ]) {
        pending = store.transitionPending({
          operationRunId: authority.operationRunId, lockToken: deploymentLock.token,
          expectedPendingDigest: pending.pendingDigest, nextStage: stage,
        });
      }
      store.activateRevision({
        operationRunId: authority.operationRunId, lockToken: deploymentLock.token,
        expectedPendingDigest: pending.pendingDigest,
        now: () => new Date('2026-08-31T00:00:03.000Z'),
      });
    } finally {
      releaseDeploymentLock(store.lockPath, deploymentLock.token, authority.operationRunId);
      releaseProjectMutationLock(
        runtimeDirectory, authority.composeProjectName, projectLock.token,
        authority.operationRunId,
      );
    }
    const finished = finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 0,
      now: new Date('2026-08-31T00:00:04.000Z'),
    });
    assert.equal(finished.state.phase, 'deployment_retired');
    assert.equal(store.readActive(), null);
    assert.equal(store.readRetired()[0].value.generation, prepared.state.generation ?? 1);
  });
});

test('deployment-managed failed pending subject retires into exact cleanup authority', () => {
  withCiEnvironment((runnerTemp) => {
    const { prepared, store } = prepareBoundSubject(runnerTemp, 'subject-failed');
    const finished = finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 17,
      now: new Date('2026-08-31T00:00:02.000Z'),
    });
    assert.equal(finished.state.phase, 'deployment_retired');
    assert.equal(store.readPending(), null);
    assert.equal(store.readActive(), null);
    const retired = store.readRetired();
    assert.equal(retired.length, 1);
    assert.equal(retired[0].value.retirementVersion, 2);
    assert.equal(retired[0].value.disposition, 'cleanup_required');
    assert.equal(retired[0].value.sourcePointerKind, 'pending');
    const retried = finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 17,
      now: new Date('2026-08-31T00:00:03.000Z'),
    });
    assert.equal(retried.digest, finished.digest);
  });
});

test('deployment-managed binding resumes after its durable bound-state crash window', () => {
  withCiEnvironment((runnerTemp) => {
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'bound-crash');
    const prepared = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'bound-crash',
      authorityMode: 'deployment_managed_by_subject',
      now: new Date('2026-08-31T00:00:00.000Z'),
    });
    const authority = prepared.state.authority;
    const store = new DeploymentStore({ runtimeDirectory, deploymentId: authority.deploymentId });
    const projectLock = acquireProjectMutationLock(
      runtimeDirectory, authority.composeProjectName,
      { operationRunId: authority.operationRunId },
    );
    const deploymentLock = acquireDeploymentLock(store.lockPath, {
      operationRunId: authority.operationRunId, token: projectLock.token,
    });
    let pending;
    try {
      const bundle = resolveDeploymentDefinition({
        projectDirectory: CHECKOUT, runtimeDirectory,
        envFile: path.join(runtimeDirectory, 'sanctuary.env'),
        composeProjectName: authority.composeProjectName,
        ownerId: authority.ownerId, release: 'subject-release',
        commit: authority.checkoutCommit, policyDigest: authority.policyDigest,
        contextFingerprint: 'd'.repeat(64),
      });
      pending = store.prepareRevision({
        bundle, expectedActiveDigest: null,
        operationRunId: authority.operationRunId, lockToken: deploymentLock.token,
        now: () => new Date(prepared.state.resourceCreatedAt),
      });
      transitionCoordinatorState({
        statePath: prepared.path, checkoutRoot: CHECKOUT,
        expectedDigest: prepared.digest, nextPhase: 'deployment_bound',
        updates: {
          deploymentManifestPath: path.join(
            store.root, 'revisions', String(pending.manifest.generation),
            'deployment-manifest.json',
          ),
          deploymentManifestDigest: pending.manifestDigest,
          generation: pending.manifest.generation,
          deploymentPointerDigest: pending.pendingDigest,
        },
      });
    } finally {
      releaseDeploymentLock(store.lockPath, deploymentLock.token, authority.operationRunId);
      releaseProjectMutationLock(
        runtimeDirectory, authority.composeProjectName, projectLock.token,
        authority.operationRunId,
      );
    }
    const resumed = resumeCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT,
      now: new Date('2026-08-31T00:00:01.000Z'),
    });
    assert.equal(resumed.state.phase, 'trust_installed');
    assert.equal(resumed.state.deploymentManifestDigest, pending.manifestDigest);
    assert.notEqual(resumed.state.runManifestDigest, null);
    const finished = finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 17,
      now: new Date('2026-08-31T00:00:02.000Z'),
    });
    assert.equal(finished.state.phase, 'deployment_retired');
    assert.equal(store.readPending(), null);
    assert.equal(store.readRetired()[0].value.disposition, 'cleanup_required');
  });
});

test('deployment-managed session rejects creation-label timestamp drift before mutation', () => {
  withCiEnvironment((runnerTemp) => {
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'timestamp-drift');
    const prepared = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'timestamp-drift',
      authorityMode: 'deployment_managed_by_subject',
      now: new Date('2026-08-31T00:00:00.000Z'),
    });
    const authority = prepared.state.authority;
    const store = new DeploymentStore({ runtimeDirectory, deploymentId: authority.deploymentId });
    const keys = Object.keys(prepared.environment);
    const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, prepared.environment);
    try {
      assert.equal(
        deploymentIdentityOptions(runtimeDirectory, authority.deploymentId, store).createdAt,
        prepared.state.resourceCreatedAt,
      );
      for (const invalid of ['null', 'invalid', '2026-08-31T00:00:01.000Z']) {
        process.env.SANCTUARY_CLEANUP_CREATED_AT = invalid;
        assert.throws(
          () => deploymentIdentityOptions(runtimeDirectory, authority.deploymentId, store),
          /creation timestamp does not match provider state/,
        );
      }
      assert.equal(store.inspect().pending, null);
    } finally {
      for (const key of keys) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    }
  });
});

test('deployment-managed session fences the exact bound generation on retry', () => {
  withCiEnvironment((runnerTemp) => {
    const { store, bound } = prepareBoundSubject(runnerTemp, 'bound-retry');
    const inspection = store.inspect();
    const revision = store.readManifest(bound.state.generation, { verifySnapshots: true });
    const coordinated = {
      state: bound.state, createdAt: bound.state.resourceCreatedAt,
    };
    const bundle = { definition: { definitionDigest: revision.manifest.definitionDigest } };
    assert.doesNotThrow(() => assertBoundCoordinatedRevision(
      coordinated, inspection, bundle, store,
    ));
    assert.throws(() => assertBoundCoordinatedRevision(
      coordinated, { ...inspection, active: inspection.pending }, bundle, store,
    ), /bound revision state is ambiguous/);
    assert.throws(() => assertBoundCoordinatedRevision(
      coordinated,
      {
        ...inspection,
        pending: {
          value: { ...inspection.pending.value, generation: inspection.pending.value.generation + 1 },
          digest: inspection.pending.digest,
        },
      },
      bundle,
      store,
    ), /bound revision changed/);
  });
});

test('CI cleanup lifecycle adopts an exact prepared pointer after finalization response loss', () => {
  withCiEnvironment((runnerTemp) => {
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'prepared-loss');
    const original = DeploymentStore.prototype.finalizePreparedRevision;
    let finalized;
    DeploymentStore.prototype.finalizePreparedRevision = function injectResponseLoss(options) {
      finalized = original.call(this, options);
      throw new Error('injected prepared-pointer response loss');
    };
    try {
      assert.throws(() => prepareCiCleanupLifecycle({
        checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'prepared-loss',
        now: new Date('2026-08-31T01:00:00.000Z'),
      }), /injected prepared-pointer response loss/);
    } finally {
      DeploymentStore.prototype.finalizePreparedRevision = original;
    }

    const statePath = coordinatorStatePath(runtimeDirectory);
    const interrupted = readCoordinatorState(statePath, { checkoutRoot: CHECKOUT });
    assert.equal(interrupted.state.phase, 'revision_prepared');
    assert.notEqual(interrupted.state.deploymentPointerDigest, finalized.preparedDigest);
    const store = new DeploymentStore({
      runtimeDirectory, deploymentId: interrupted.state.authority.deploymentId,
    });
    assert.equal(store.inspect().pending, null);
    assert.equal(store.inspect().prepared.digest, finalized.preparedDigest);

    const resumed = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'prepared-loss',
      now: new Date('2026-08-31T01:00:01.000Z'),
    });
    assert.equal(resumed.state.phase, 'trust_installed');
    assert.equal(resumed.state.deploymentPointerDigest, finalized.preparedDigest);
    assert.equal(store.readActive().value.manifestDigest, resumed.state.deploymentManifestDigest);
  });
});
