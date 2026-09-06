import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
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
import { readUpgradeTarget } from '../../scripts/ownership/ci-cleanup-upgrade-target.mjs';
import { sha256 } from '../../scripts/ownership/crypto.mjs';
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

// A subject-managed lane's installer writes the runtime env; the coordinator
// only creates the directory. Model the installer's write where a test needs
// the definition the subject would bind.
function subjectRuntimeEnv(runtimeDirectory) {
  const envFile = path.join(runtimeDirectory, 'sanctuary.env');
  if (!existsSync(envFile)) writeFileSync(envFile, 'JWT_SECRET=private\n', { mode: 0o600 });
  return envFile;
}

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
      envFile: subjectRuntimeEnv(runtimeDirectory),
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
      prepared.state.authority.operationRunId);
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
    assert.equal(resumed.environment.SANCTUARY_BUILD_ID,
      prepared.environment.SANCTUARY_BUILD_ID);
    const peer = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT,
      runtimeDirectory: path.join(runnerTemp, 'sanctuary-cleanup', 'install-peer'),
      lane: 'install-peer',
      now: new Date('2026-08-31T00:00:01.000Z'),
    });
    assert.equal(peer.environment.SANCTUARY_SOURCE_COMMIT,
      prepared.environment.SANCTUARY_SOURCE_COMMIT);
    assert.equal(peer.environment.SANCTUARY_BUILD_ID,
      peer.state.authority.operationRunId);
    assert.notEqual(peer.environment.SANCTUARY_BUILD_ID,
      prepared.environment.SANCTUARY_BUILD_ID);

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

test('subject-managed prepare leaves runtime env creation to the subject installer', () => {
  withCiEnvironment((runnerTemp) => {
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'fresh-env');
    const prepared = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'fresh-env',
      authorityMode: 'deployment_managed_by_subject',
    });
    const envFile = path.join(runtimeDirectory, 'sanctuary.env');
    assert.equal(prepared.environment.SANCTUARY_ENV_FILE, envFile);
    assert.equal(existsSync(envFile), false);
    const resumed = resumeCiCleanupLifecycle({
      statePath: coordinatorStatePath(runtimeDirectory), checkoutRoot: CHECKOUT,
    });
    assert.equal(resumed.environment.SANCTUARY_ENV_FILE, envFile);
    assert.equal(existsSync(envFile), false);
  });
  withCiEnvironment((runnerTemp) => {
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'managed-env');
    prepareCiCleanupLifecycle({ checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'managed-env' });
    assert.equal(
      readFileSync(path.join(runtimeDirectory, 'sanctuary.env'), 'utf8'),
      'SANCTUARY_OWNERSHIP_ONLY=1\n',
    );
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
        envFile: subjectRuntimeEnv(runtimeDirectory),
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
        envFile: subjectRuntimeEnv(runtimeDirectory),
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

// Issue #1028: once the latest stable release is itself ownership-aware, the
// upgrade lane installs an owned source deployment (revision 1) and upgrades it
// in place to the candidate (revision 2) from the same checkout root. The
// coordinator is prepared with the checkout at the source commit, so its
// authority binds that commit, and the lane declares the candidate; it must
// then accept exactly one successor whose prior active digest is the bound
// source manifest, and retire a successor that never activates.
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function ownedUpgradeCheckout(root) {
  const checkout = path.join(root, 'checkout');
  mkdirSync(checkout, { mode: 0o700 });
  for (const entry of [
    'docker-compose.yml', 'docker/compose', 'config/resource-ownership-contract.json',
    'config/container-image-lock.json', 'package.json',
  ]) cpSync(path.join(CHECKOUT, entry), path.join(checkout, entry), { recursive: true });
  git(checkout, 'init', '-q', '-b', 'main');
  git(checkout, 'config', 'user.email', 'ci@example.invalid');
  git(checkout, 'config', 'user.name', 'ci');
  git(checkout, 'add', '-A');
  git(checkout, 'commit', '-q', '-m', 'source release');
  const source = git(checkout, 'rev-parse', 'HEAD');
  const manifest = JSON.parse(readFileSync(path.join(checkout, 'package.json'), 'utf8'));
  writeFileSync(path.join(checkout, 'package.json'), `${JSON.stringify({ ...manifest, version: '99.0.0' }, null, 2)}\n`);
  git(checkout, 'commit', '-q', '-am', 'candidate');
  const target = git(checkout, 'rev-parse', 'HEAD');
  writeFileSync(path.join(checkout, 'package.json'), `${JSON.stringify({ ...manifest, version: '99.0.1' }, null, 2)}\n`);
  git(checkout, 'commit', '-q', '-am', 'undeclared');
  const undeclared = git(checkout, 'rev-parse', 'HEAD');
  git(checkout, 'checkout', '-q', '--detach', source);
  return { checkout, source, target, undeclared };
}

function withLocks(store, runtimeDirectory, authority, callback) {
  const projectLock = acquireProjectMutationLock(
    runtimeDirectory, authority.composeProjectName, { operationRunId: authority.operationRunId },
  );
  const deploymentLock = acquireDeploymentLock(store.lockPath, {
    operationRunId: authority.operationRunId, token: projectLock.token,
  });
  try { return callback(deploymentLock.token); } finally {
    releaseDeploymentLock(store.lockPath, deploymentLock.token, authority.operationRunId);
    releaseProjectMutationLock(
      runtimeDirectory, authority.composeProjectName, projectLock.token, authority.operationRunId,
    );
  }
}

function definitionFor(checkout, runtimeDirectory, authority, commit, release) {
  return resolveDeploymentDefinition({
    projectDirectory: checkout, runtimeDirectory,
    envFile: subjectRuntimeEnv(runtimeDirectory),
    composeProjectName: authority.composeProjectName,
    ownerId: authority.ownerId, release, commit,
    policyDigest: sha256(readFileSync(path.join(checkout, 'config/resource-ownership-contract.json'))),
    contextFingerprint: 'd'.repeat(64),
  });
}

function activateHealthy(store, authority, lockToken, pending) {
  let current = pending;
  for (const stage of ['build_started', 'build_completed', 'postgres_started', 'password_reconciled', 'stack_started', 'health_verified']) {
    current = store.transitionPending({
      operationRunId: authority.operationRunId, lockToken,
      expectedPendingDigest: current.pendingDigest, nextStage: stage,
    });
  }
  return store.activateRevision({
    operationRunId: authority.operationRunId, lockToken, expectedPendingDigest: current.pendingDigest,
  });
}

function withSubjectEnvironment(environment, callback) {
  const keys = Object.keys(environment);
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  try { return callback(); } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

// Prepare the lane, install and activate the source revision, move the checkout
// to the candidate, and prepare the candidate's successor revision.
function prepareOwnedUpgrade(runnerTemp, lane) {
  const { checkout, source, target, undeclared } = ownedUpgradeCheckout(runnerTemp);
  const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', lane);
  const prepared = prepareCiCleanupLifecycle({
    checkoutRoot: checkout, runtimeDirectory, lane,
    authorityMode: 'deployment_managed_by_subject', upgradeTargetCommit: target,
    now: new Date('2026-09-05T00:00:00.000Z'),
  });
  const authority = prepared.state.authority;
  assert.equal(authority.checkoutCommit, source);
  assert.equal(readUpgradeTarget(prepared.state, checkout).commit, target);
  const store = new DeploymentStore({ runtimeDirectory, deploymentId: authority.deploymentId });
  const sourceActive = withLocks(store, runtimeDirectory, authority, (lockToken) => {
    const pending = store.prepareRevision({
      bundle: definitionFor(checkout, runtimeDirectory, authority, source, 'source-release'),
      expectedActiveDigest: null, operationRunId: authority.operationRunId, lockToken,
      now: () => new Date(prepared.state.resourceCreatedAt),
    });
    const bound = bindSubjectManagedCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: checkout, lockToken,
      now: new Date('2026-09-05T00:00:01.000Z'),
    });
    assert.equal(bound.state.phase, 'trust_installed');
    assert.equal(bound.state.generation, 1);
    withSubjectEnvironment({ ...bound.environment, SANCTUARY_COMMIT: source }, () => {
      const identity = () => deploymentIdentityOptions(runtimeDirectory, authority.deploymentId, store);
      assert.equal(identity().state.generation, 1);
      // A persisted runtime env may still name the source while the checkout
      // has moved to the candidate, or name the candidate before setup.sh
      // refreshes it; both declared commits are accepted for the claim.
      process.env.SANCTUARY_COMMIT = target;
      assert.equal(identity().state.generation, 1);
      // Anything outside the two declared commits is refused, whether it is
      // the subject's claim or where the checkout actually is.
      process.env.SANCTUARY_COMMIT = undeclared;
      assert.throws(identity, /provider state \(revisionBinding\)/);
      process.env.SANCTUARY_COMMIT = source;
      git(checkout, 'checkout', '-q', '--detach', undeclared);
      assert.throws(identity, /provider state \(revisionBinding\)/);
      git(checkout, 'checkout', '-q', '--detach', source);
    });
    return activateHealthy(store, authority, lockToken, pending);
  });
  git(checkout, 'checkout', '-q', '--detach', target);
  const coordinatedView = () => ({
    state: readCoordinatorState(prepared.path, { checkoutRoot: checkout }).state,
    createdAt: prepared.state.resourceCreatedAt,
  });
  const successor = withLocks(store, runtimeDirectory, authority, (lockToken) => {
    assert.equal(resumeCiCleanupLifecycle({ statePath: prepared.path, checkoutRoot: checkout }).state.generation, 1);
    const bundle = definitionFor(checkout, runtimeDirectory, authority, target, 'candidate');
    assertBoundCoordinatedRevision(coordinatedView(), store.inspect(), bundle, store);
    const pending = store.prepareRevision({
      bundle, expectedActiveDigest: sourceActive.active.manifestDigest,
      operationRunId: authority.operationRunId, lockToken,
      now: () => new Date(prepared.state.resourceCreatedAt),
    });
    assert.equal(pending.manifest.priorActiveDigest, sourceActive.active.manifestDigest);
    assertBoundCoordinatedRevision(coordinatedView(), store.inspect(), bundle, store);
    const rebound = bindSubjectManagedCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: checkout, lockToken,
      now: new Date('2026-09-05T00:00:02.000Z'),
    });
    assert.equal(rebound.state.phase, 'trust_installed');
    assert.equal(rebound.state.generation, 2);
    assert.equal(rebound.state.deploymentManifestDigest, pending.manifestDigest);
    assertBoundCoordinatedRevision(coordinatedView(), store.inspect(), bundle, store);
    // Re-entering bind in the successor window is idempotent.
    const again = bindSubjectManagedCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: checkout, lockToken,
      now: new Date('2026-09-05T00:00:02.500Z'),
    });
    assert.equal(again.state.generation, 2);
    assert.equal(again.state.runManifestDigest, rebound.state.runManifestDigest);
    return pending;
  });
  return { checkout, source, target, prepared, authority, store, runtimeDirectory, successor };
}

test('owned-source upgrade binds the source revision then one declared successor', () => {
  withCiEnvironment((runnerTemp) => {
    const { checkout, source, target } = ownedUpgradeCheckout(runnerTemp);
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'owned-upgrade-refusals');
    assert.throws(() => prepareCiCleanupLifecycle({
      checkoutRoot: checkout, runtimeDirectory, lane: 'owned-upgrade-refusals',
      authorityMode: 'coordinator_managed', upgradeTargetCommit: target,
    }), /upgrade target requires subject-managed/);
    assert.throws(() => prepareCiCleanupLifecycle({
      checkoutRoot: checkout, runtimeDirectory, lane: 'owned-upgrade-refusals',
      authorityMode: 'deployment_managed_by_subject', upgradeTargetCommit: source,
    }), /upgrade target commit must differ from the checkout commit/);
    assert.throws(() => prepareCiCleanupLifecycle({
      checkoutRoot: checkout, runtimeDirectory, lane: 'owned-upgrade-refusals',
      authorityMode: 'deployment_managed_by_subject', upgradeTargetCommit: 'f'.repeat(40),
    }), /upgrade target commit is not present in the checkout/);
  });
  withCiEnvironment((runnerTemp) => {
    const upgrade = prepareOwnedUpgrade(runnerTemp, 'owned-upgrade');
    withLocks(upgrade.store, upgrade.runtimeDirectory, upgrade.authority, (lockToken) => {
      activateHealthy(upgrade.store, upgrade.authority, lockToken, upgrade.successor);
    });
    const finished = finishCiCleanupLifecycle({
      statePath: upgrade.prepared.path, checkoutRoot: upgrade.checkout, subjectExitStatus: 0,
      now: new Date('2026-09-05T00:00:03.000Z'),
    });
    assert.equal(finished.state.phase, 'deployment_retired');
    assert.equal(finished.runManifest.manifest.generation, 2);
    assert.equal(upgrade.store.readActive(), null);
    assert.deepEqual(upgrade.store.readRetired().map(({ value }) => value.generation), [2]);
  });
});

test('a declared successor that never activates is retired together with its source', () => {
  withCiEnvironment((runnerTemp) => {
    const upgrade = prepareOwnedUpgrade(runnerTemp, 'owned-upgrade-failed');
    const finished = finishCiCleanupLifecycle({
      statePath: upgrade.prepared.path, checkoutRoot: upgrade.checkout, subjectExitStatus: 17,
      now: new Date('2026-09-05T00:00:03.000Z'),
    });
    assert.equal(finished.state.phase, 'deployment_retired');
    assert.equal(finished.state.subjectExitStatus, 17);
    const inspection = upgrade.store.inspect();
    assert.equal(inspection.active, null);
    assert.equal(inspection.pending, null);
    assert.deepEqual(
      inspection.retired.map(({ value }) => [value.generation, value.retirementVersion, value.disposition ?? 'active']).sort(),
      [[1, 1, 'active'], [2, 2, 'cleanup_required']],
    );
  });
});

test('an undeclared lane still refuses a checkout that moved to another commit', () => {
  withCiEnvironment((runnerTemp) => {
    const { checkout, source, target } = ownedUpgradeCheckout(runnerTemp);
    const runtimeDirectory = path.join(runnerTemp, 'sanctuary-cleanup', 'strict-upgrade');
    const prepared = prepareCiCleanupLifecycle({
      checkoutRoot: checkout, runtimeDirectory, lane: 'strict-upgrade',
      authorityMode: 'deployment_managed_by_subject',
    });
    assert.equal(readUpgradeTarget(prepared.state, checkout), null);
    const authority = prepared.state.authority;
    const store = new DeploymentStore({ runtimeDirectory, deploymentId: authority.deploymentId });
    withLocks(store, runtimeDirectory, authority, (lockToken) => {
      const pending = store.prepareRevision({
        bundle: definitionFor(checkout, runtimeDirectory, authority, source, 'source-release'),
        expectedActiveDigest: null, operationRunId: authority.operationRunId, lockToken,
        now: () => new Date(prepared.state.resourceCreatedAt),
      });
      bindSubjectManagedCiCleanupLifecycle({ statePath: prepared.path, checkoutRoot: checkout, lockToken });
      activateHealthy(store, authority, lockToken, pending);
      git(checkout, 'checkout', '-q', '--detach', target);
      assert.throws(() => bindSubjectManagedCiCleanupLifecycle({
        statePath: prepared.path, checkoutRoot: checkout, lockToken,
      }), /authority changed before resume/);
      withSubjectEnvironment({ SANCTUARY_COMMIT: target }, () => {
        assert.throws(() => prepareCiCleanupLifecycle({
          checkoutRoot: checkout, runtimeDirectory, lane: 'strict-upgrade',
          authorityMode: 'deployment_managed_by_subject',
        }), /authority changed before resume/);
      });
    });
  });
});
