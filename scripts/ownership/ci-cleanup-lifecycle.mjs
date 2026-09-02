import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from './canonical-json.mjs';
import { assertCiCleanupAuthority, ciCleanupAuthority } from './ci-cleanup-authority.mjs';
import {
  coordinatorStatePath, createCoordinatorState, readCoordinatorState,
  transitionCoordinatorState,
} from './ci-cleanup-state.mjs';
import { installEphemeralCiCleanupTrust } from './ci-cleanup-trust.mjs';
import {
  bindSubjectManagedCiCleanupLifecycle, ensureLifecycleSigners, subjectEnvironment,
} from './ci-cleanup-subject-lifecycle.mjs';
export { bindSubjectManagedCiCleanupLifecycle };
import { sha256 } from './crypto.mjs';
import { resolveDeploymentDefinition } from './deployment-definition.mjs';
import {
  acquireDeploymentLock, releaseDeploymentLock,
} from './deployment-lock.mjs';
import { DeploymentStore } from './deployment-store.mjs';
import {
  acquireProjectMutationLock, releaseProjectMutationLock,
} from './project-lock.mjs';
import {
  createRunManifest, readRunManifest, terminalizeRunManifest,
} from './run-manifest-store.mjs';
import { writeExternalFileAtomic } from './safe-file.mjs';
import { createLegacyFixtureWitness } from './ci-legacy-fixture-witness.mjs';

function acquireLifecycleLocks(store, authority) {
  const project = acquireProjectMutationLock(
    authority.runtimeDirectory, authority.composeProjectName,
    { operationRunId: authority.operationRunId },
  );
  try {
    const deployment = acquireDeploymentLock(store.lockPath, {
      operationRunId: authority.operationRunId, token: project.token,
    });
    return { token: deployment.token };
  } catch (error) {
    releaseProjectMutationLock(
      authority.runtimeDirectory, authority.composeProjectName,
      project.token, authority.operationRunId,
    );
    throw error;
  }
}

function releaseLifecycleLocks(store, authority, held) {
  const errors = [];
  try {
    releaseDeploymentLock(store.lockPath, held.token, authority.operationRunId);
  } catch (error) { errors.push(error); }
  try {
    releaseProjectMutationLock(
      authority.runtimeDirectory, authority.composeProjectName,
      held.token, authority.operationRunId,
    );
  } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'failed to release CI lifecycle locks');
}

function ensureRuntimeInputs(authority) {
  mkdirSync(authority.runtimeDirectory, { recursive: true, mode: 0o700 });
  const envPath = path.join(authority.runtimeDirectory, 'sanctuary.env');
  if (!existsSync(envPath)) {
    writeExternalFileAtomic(envPath, Buffer.from('SANCTUARY_OWNERSHIP_ONLY=1\n'), {
      checkoutRoot: authority.checkoutRoot,
    });
  }
  return envPath;
}

function definitionBundle(authority, envFile) {
  return resolveDeploymentDefinition({
    projectDirectory: authority.checkoutRoot, runtimeDirectory: authority.runtimeDirectory,
    envFile, composeProjectName: authority.composeProjectName,
    ownerId: authority.ownerId, release: 'unreleased', commit: authority.checkoutCommit,
    policyDigest: authority.policyDigest,
    contextFingerprint: canonicalSha256({
      engine: 'docker', dockerContext: process.env.DOCKER_CONTEXT ?? 'default',
      dockerHost: process.env.DOCKER_HOST ?? 'default',
    }),
  });
}

export function completeLegacyFixtureWitness(state, statePath, checkoutRoot) {
  if (state.state.legacyFixtureWitnessState !== 'pending') return state;
  if (state.state.phase !== 'initialized'
      || state.state.authority.authorityMode !== 'deployment_managed_by_subject') {
    throw new Error('pending legacy fixture witness is outside its initialization boundary');
  }
  const authority = state.state.authority;
  const held = acquireProjectMutationLock(
    authority.runtimeDirectory, authority.composeProjectName,
    { operationRunId: authority.operationRunId },
  );
  try {
    const witness = createLegacyFixtureWitness({
      composeProjectName: authority.composeProjectName,
    });
    return transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: state.state.phase,
      updates: {
        legacyFixtureWitnessDigest: witness.digest,
        legacyFixtureWitnessState: 'witnessed',
      },
    });
  } finally {
    releaseProjectMutationLock(
      authority.runtimeDirectory, authority.composeProjectName,
      held.token, authority.operationRunId,
    );
  }
}

export function prepareCiCleanupLifecycle({
  checkoutRoot, runtimeDirectory, lane, authorityMode = 'coordinator_managed',
  legacyFixtureCreationWitness = false, now = new Date(),
}) {
  if (legacyFixtureCreationWitness && authorityMode !== 'deployment_managed_by_subject') {
    throw new Error('legacy fixture witness requires subject-managed deployment authority');
  }
  const authority = ciCleanupAuthority({ checkoutRoot, runtimeDirectory, lane, authorityMode });
  const statePath = coordinatorStatePath(authority.runtimeDirectory);
  if (existsSync(statePath)) {
    let existing = readCoordinatorState(statePath, { checkoutRoot });
    assertCiCleanupAuthority(existing.state, checkoutRoot);
    const durableWitnessRequested = existing.state.legacyFixtureWitnessState !== 'disabled';
    if (durableWitnessRequested !== legacyFixtureCreationWitness) {
      throw new Error('legacy fixture witness request conflicts with durable coordinator state');
    }
    existing = completeLegacyFixtureWitness(existing, statePath, checkoutRoot);
    return resumeCiCleanupLifecycle({ statePath, checkoutRoot, now });
  }
  let state = createCoordinatorState({
    statePath, checkoutRoot, authority, legacyFixtureCreationWitness,
  });
  const envFile = ensureRuntimeInputs(authority);
  const store = new DeploymentStore({
    runtimeDirectory: authority.runtimeDirectory, deploymentId: authority.deploymentId,
  });
  store.initialize({
    projectDirectory: authority.checkoutRoot, composeProjectName: authority.composeProjectName,
    deploymentScope: 'ci_ephemeral', ciRunIdentityDigest: authority.identityDigest,
  });
  if (authority.authorityMode === 'deployment_managed_by_subject') {
    state = completeLegacyFixtureWitness(state, statePath, checkoutRoot);
    const prepared = ensureLifecycleSigners({ state, statePath, checkoutRoot });
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: prepared.state.digest,
      nextPhase: 'subject_ready',
      updates: { resourceCreatedAt: now.toISOString() },
    });
    return Object.freeze({
      ...state,
      environment: subjectEnvironment(state.state, state.path),
      signers: prepared.signers,
    });
  }
  const held = acquireLifecycleLocks(store, authority);
  let deployment;
  let run;
  try {
    const prepared = store.prepareRevision({
      bundle: definitionBundle(authority, envFile), expectedActiveDigest: null,
      operationRunId: authority.operationRunId, lockToken: held.token, now: () => now,
    });
    deployment = store.readManifest(prepared.manifest.generation, { verifySnapshots: true });
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'revision_prepared',
      updates: {
        deploymentManifestPath: path.join(deployment.revisionRoot, 'deployment-manifest.json'),
        deploymentManifestDigest: deployment.manifestDigest,
        generation: deployment.manifest.generation,
        resourceCreatedAt: deployment.manifest.createdAt,
        deploymentPointerDigest: prepared.pendingDigest,
      },
    });
    const finalized = store.finalizePreparedRevision({
      operationRunId: authority.operationRunId, lockToken: held.token,
      expectedPendingDigest: prepared.pendingDigest, now: () => now,
    });
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'revision_prepared',
      updates: { deploymentPointerDigest: finalized.preparedDigest },
    });
    const activated = store.activatePreparedEphemeralRevision({
      operationRunId: authority.operationRunId, lockToken: held.token,
      projectLockToken: held.token, expectedPreparedDigest: finalized.preparedDigest,
      now: () => now,
    });
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'deployment_active',
      updates: { activePointerDigest: activated.activeDigest },
    });
    run = createRunManifest({
      store, checkoutRoot, deploymentManifest: deployment.manifest,
      operationRunId: authority.operationRunId, lockToken: held.token, now,
    });
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'run_active',
      updates: { runManifestPath: run.path, runManifestDigest: run.digest },
    });
  } finally { releaseLifecycleLocks(store, authority, held); }
  const prepared = ensureLifecycleSigners({ state, statePath, checkoutRoot });
  state = prepared.state;
  installEphemeralCiCleanupTrust({
    runtimeDirectory: authority.runtimeDirectory, checkoutRoot, keyRoot: prepared.keyRoot,
    deploymentManifest: deployment.manifest, operationRunId: authority.operationRunId,
    authorizationFingerprint: prepared.signers.authorization.fingerprint,
    evidenceFingerprint: prepared.signers.evidence.fingerprint,
    coordinatorStateDigest: state.state.authorityCoreDigest, now,
  });
  state = transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'trust_installed',
  });
  return Object.freeze({
    ...state, environment: subjectEnvironment(state.state, state.path), signers: prepared.signers,
  });
}

export function bindWitnessFallbackCiCleanupLifecycle({ statePath, checkoutRoot }) {
  let state = readCoordinatorState(statePath, { checkoutRoot });
  const authority = state.state.authority;
  assertCiCleanupAuthority(state.state, checkoutRoot);
  if (state.state.phase !== 'subject_ready'
      || authority.authorityMode !== 'deployment_managed_by_subject'
      || state.state.legacyFixtureWitnessDigest === null) {
    throw new Error('legacy fixture fallback requires unbound witnessed subject authority');
  }
  const envFile = ensureRuntimeInputs(authority);
  const store = new DeploymentStore({
    runtimeDirectory: authority.runtimeDirectory, deploymentId: authority.deploymentId,
  });
  store.initialize({
    projectDirectory: authority.checkoutRoot, composeProjectName: authority.composeProjectName,
    deploymentScope: 'ci_ephemeral', ciRunIdentityDigest: authority.identityDigest,
  });
  const held = acquireLifecycleLocks(store, authority);
  let deployment;
  try {
    const createdAt = new Date(state.state.resourceCreatedAt);
    const prepared = store.prepareRevision({
      bundle: definitionBundle(authority, envFile), expectedActiveDigest: null,
      operationRunId: authority.operationRunId, lockToken: held.token, now: () => createdAt,
    });
    deployment = store.readManifest(prepared.manifest.generation, { verifySnapshots: true });
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'revision_prepared',
      updates: {
        deploymentManifestPath: path.join(deployment.revisionRoot, 'deployment-manifest.json'),
        deploymentManifestDigest: deployment.manifestDigest,
        generation: deployment.manifest.generation,
        deploymentPointerDigest: prepared.pendingDigest,
      },
    });
    const finalized = store.finalizePreparedRevision({
      operationRunId: authority.operationRunId, lockToken: held.token,
      expectedPendingDigest: prepared.pendingDigest, now: () => createdAt,
    });
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'revision_prepared',
      updates: { deploymentPointerDigest: finalized.preparedDigest },
    });
    const activated = store.activatePreparedEphemeralRevision({
      operationRunId: authority.operationRunId, lockToken: held.token,
      projectLockToken: held.token, expectedPreparedDigest: finalized.preparedDigest,
      now: () => createdAt,
    });
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'deployment_active',
      updates: { activePointerDigest: activated.activeDigest },
    });
    const run = createRunManifest({
      store, checkoutRoot, deploymentManifest: deployment.manifest,
      operationRunId: authority.operationRunId, lockToken: held.token, now: createdAt,
    });
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'run_active',
      updates: { runManifestPath: run.path, runManifestDigest: run.digest },
    });
  } finally { releaseLifecycleLocks(store, authority, held); }
  const prepared = ensureLifecycleSigners({ state, statePath, checkoutRoot });
  state = prepared.state;
  installEphemeralCiCleanupTrust({
    runtimeDirectory: authority.runtimeDirectory, checkoutRoot, keyRoot: prepared.keyRoot,
    deploymentManifest: deployment.manifest, operationRunId: authority.operationRunId,
    authorizationFingerprint: prepared.signers.authorization.fingerprint,
    evidenceFingerprint: prepared.signers.evidence.fingerprint,
    coordinatorStateDigest: state.state.authorityCoreDigest, now: new Date(state.state.resourceCreatedAt),
  });
  state = transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'trust_installed',
  });
  return Object.freeze({
    ...state, environment: subjectEnvironment(state.state, state.path), signers: prepared.signers,
  });
}

function initialPendingPointer(state) {
  return {
    pointerVersion: 1, mode: 'deploy', deploymentId: state.authority.deploymentId,
    operationRunId: state.authority.operationRunId, generation: state.generation,
    manifestDigest: state.deploymentManifestDigest, priorActiveDigest: null,
    stage: 'prepared', sequence: 0, createdAt: state.resourceCreatedAt,
    updatedAt: state.resourceCreatedAt,
  };
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  try { return new Date(value).toISOString() === value; } catch { return false; }
}

function proveFinalizedPreparedRevision(state, prepared, store) {
  if (canonicalSha256(initialPendingPointer(state)) !== state.deploymentPointerDigest) {
    throw new Error('cleanup coordinator pending revision evidence is invalid');
  }
  const expected = {
    pointerVersion: 1, deploymentId: state.authority.deploymentId,
    generation: state.generation, manifestDigest: state.deploymentManifestDigest,
    priorActiveDigest: null, preparedAt: prepared.value.preparedAt,
  };
  if (!isCanonicalTimestamp(expected.preparedAt)
      || expected.preparedAt < state.resourceCreatedAt
      || canonicalSha256(expected) !== prepared.digest) {
    throw new Error('finalized prepared cleanup revision does not match pending evidence');
  }
  const revision = store.readManifest(state.generation, { verifySnapshots: true });
  if (revision.manifestDigest !== state.deploymentManifestDigest
      || revision.manifest.createdAt !== state.resourceCreatedAt
      || path.join(revision.revisionRoot, 'deployment-manifest.json')
        !== state.deploymentManifestPath) {
    throw new Error('finalized prepared cleanup revision manifest changed before resume');
  }
}

function adoptFinalizedPreparedRevision({ current, statePath, checkoutRoot, inspection, store }) {
  proveFinalizedPreparedRevision(current.state, inspection.prepared, store);
  return transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'revision_prepared',
    updates: { deploymentPointerDigest: inspection.prepared.digest },
  });
}

function resumeRevision({ state, statePath, checkoutRoot, store, held, envFile, now }) {
  const authority = state.state.authority;
  let current = state;
  let inspection = store.inspect();
  if (current.state.phase === 'initialized') {
    if (!inspection.pending && !inspection.prepared && !inspection.active) {
      store.prepareRevision({
        bundle: definitionBundle(authority, envFile), expectedActiveDigest: null,
        operationRunId: authority.operationRunId, lockToken: held.token, now: () => now,
      });
      inspection = store.inspect();
    }
    const pointer = inspection.pending ?? inspection.prepared;
    if (!pointer || inspection.active) throw new Error('initialized cleanup revision state is ambiguous');
    const deployment = store.readManifest(pointer.value.generation, { verifySnapshots: true });
    current = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'revision_prepared',
      updates: {
        deploymentManifestPath: path.join(deployment.revisionRoot, 'deployment-manifest.json'),
        deploymentManifestDigest: deployment.manifestDigest,
        generation: deployment.manifest.generation,
        resourceCreatedAt: deployment.manifest.createdAt,
        deploymentPointerDigest: pointer.digest,
      },
    });
  }
  if (current.state.phase !== 'revision_prepared') return current;
  inspection = store.inspect();
  if (inspection.pending) {
    if (inspection.pending.digest !== current.state.deploymentPointerDigest) {
      throw new Error('pending cleanup revision changed before resume');
    }
    const finalized = store.finalizePreparedRevision({
      operationRunId: authority.operationRunId, lockToken: held.token,
      expectedPendingDigest: inspection.pending.digest, now: () => now,
    });
    current = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'revision_prepared',
      updates: { deploymentPointerDigest: finalized.preparedDigest },
    });
    inspection = store.inspect();
  }
  if (!inspection.pending && inspection.prepared
      && inspection.prepared.digest !== current.state.deploymentPointerDigest) {
    current = adoptFinalizedPreparedRevision({
      current, statePath, checkoutRoot, inspection, store,
    });
  }
  if (inspection.prepared && inspection.prepared.digest !== current.state.deploymentPointerDigest) {
    throw new Error('prepared cleanup revision changed before resume');
  }
  const activated = store.activatePreparedEphemeralRevision({
    operationRunId: authority.operationRunId, lockToken: held.token,
    projectLockToken: held.token,
    expectedPreparedDigest: current.state.deploymentPointerDigest, now: () => now,
  });
  return transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: 'deployment_active',
    updates: { activePointerDigest: activated.activeDigest },
  });
}

export function resumeCiCleanupLifecycle({ statePath, checkoutRoot, now = new Date() }) {
  let state = readCoordinatorState(statePath, { checkoutRoot });
  assertCiCleanupAuthority(state.state, checkoutRoot);
  state = completeLegacyFixtureWitness(state, statePath, checkoutRoot);
  const authority = state.state.authority;
  if (authority.authorityMode === 'deployment_managed_by_subject'
      && state.state.phase === 'subject_ready') {
    const prepared = ensureLifecycleSigners({ state, statePath, checkoutRoot });
    return Object.freeze({
      ...prepared.state,
      environment: subjectEnvironment(prepared.state.state, prepared.state.path),
      signers: prepared.signers,
    });
  }
  if (authority.authorityMode === 'deployment_managed_by_subject'
      && ['deployment_bound', 'run_active'].includes(state.state.phase)) {
    const store = new DeploymentStore({
      runtimeDirectory: authority.runtimeDirectory, deploymentId: authority.deploymentId,
    });
    const held = acquireLifecycleLocks(store, authority);
    try {
      return bindSubjectManagedCiCleanupLifecycle({
        statePath, checkoutRoot, lockToken: held.token, now,
      });
    } finally { releaseLifecycleLocks(store, authority, held); }
  }
  if (state.state.phase === 'trust_installed') {
    const prepared = ensureLifecycleSigners({ state, statePath, checkoutRoot });
    return Object.freeze({
      ...prepared.state,
      environment: subjectEnvironment(prepared.state.state, prepared.state.path),
      signers: prepared.signers,
    });
  }
  if (!['initialized', 'revision_prepared', 'deployment_active', 'run_active'].includes(state.state.phase)) {
    throw new Error(`cleanup lifecycle cannot prepare from phase ${state.state.phase}`);
  }
  const envFile = ensureRuntimeInputs(authority);
  const store = new DeploymentStore({
    runtimeDirectory: authority.runtimeDirectory, deploymentId: authority.deploymentId,
  });
  store.initialize({
    projectDirectory: authority.checkoutRoot, composeProjectName: authority.composeProjectName,
    deploymentScope: 'ci_ephemeral', ciRunIdentityDigest: authority.identityDigest,
  });
  if (['initialized', 'revision_prepared', 'deployment_active'].includes(state.state.phase)) {
    const held = acquireLifecycleLocks(store, authority);
    try {
      state = resumeRevision({ state, statePath, checkoutRoot, store, held, envFile, now });
      if (state.state.phase === 'deployment_active') {
        const runPath = path.join(
          store.root, 'runs', authority.operationRunId, 'run-manifest.json',
        );
        const run = existsSync(runPath)
          ? readRunManifest(runPath, { checkoutRoot })
          : createRunManifest({
            store, checkoutRoot,
            deploymentManifest: store.readManifest(state.state.generation, { verifySnapshots: true }).manifest,
            operationRunId: authority.operationRunId, lockToken: held.token, now,
          });
        state = transitionCoordinatorState({
          statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'run_active',
          updates: { runManifestPath: run.path, runManifestDigest: run.digest },
        });
      }
    } finally { releaseLifecycleLocks(store, authority, held); }
  }
  const prepared = ensureLifecycleSigners({ state, statePath, checkoutRoot });
  state = prepared.state;
  const deployment = store.readManifest(state.state.generation, { verifySnapshots: true });
  installEphemeralCiCleanupTrust({
    runtimeDirectory: authority.runtimeDirectory, checkoutRoot, keyRoot: prepared.keyRoot,
    deploymentManifest: deployment.manifest, operationRunId: authority.operationRunId,
    authorizationFingerprint: prepared.signers.authorization.fingerprint,
    evidenceFingerprint: prepared.signers.evidence.fingerprint,
    coordinatorStateDigest: state.state.authorityCoreDigest, now,
  });
  state = transitionCoordinatorState({
    statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'trust_installed',
  });
  return Object.freeze({
    ...state, environment: subjectEnvironment(state.state, state.path), signers: prepared.signers,
  });
}

export function finishCiCleanupLifecycle({
  statePath, checkoutRoot, subjectExitStatus, cleanupSuppression = null, now = new Date(),
}) {
  if (!Number.isSafeInteger(subjectExitStatus) || subjectExitStatus < 0 || subjectExitStatus > 255) {
    throw new Error('subjectExitStatus must be an integer from 0 through 255');
  }
  if (cleanupSuppression !== null
      && !['subject_quiescence_failed', 'legacy_fixture_registration_failed'].includes(cleanupSuppression)) {
    throw new Error('cleanupSuppression is invalid');
  }
  let state = readCoordinatorState(statePath, { checkoutRoot });
  if (!['trust_installed', 'subject_terminal', 'deployment_retired'].includes(state.state.phase)) {
    throw new Error('cleanup lifecycle is not ready to finish the subject');
  }
  if (state.state.subjectExitStatus !== null
      && state.state.subjectExitStatus !== subjectExitStatus) {
    throw new Error('subjectExitStatus conflicts with durable cleanup coordinator state');
  }
  if (cleanupSuppression !== null && state.state.cleanupSuppression !== null
      && state.state.cleanupSuppression !== cleanupSuppression) {
    throw new Error('cleanupSuppression conflicts with durable cleanup coordinator state');
  }
  if (state.state.phase === 'deployment_retired') {
    return Object.freeze({
      ...state, runManifest: readRunManifest(state.state.runManifestPath, { checkoutRoot }),
    });
  }
  const authority = state.state.authority;
  const store = new DeploymentStore({
    runtimeDirectory: authority.runtimeDirectory, deploymentId: authority.deploymentId,
  });
  const held = acquireLifecycleLocks(store, authority);
  try {
    let failedSource = null;
    if (authority.authorityMode === 'deployment_managed_by_subject'
        && state.state.activePointerDigest === null) {
      const inspection = store.inspect();
      const exactPointer = (pointer) => pointer
        && pointer.value.generation === state.state.generation
        && pointer.value.manifestDigest === state.state.deploymentManifestDigest;
      const retired = inspection.retired.find(({ value }) => (
        value.retirementVersion === 2
        && value.disposition === 'cleanup_required'
        && value.generation === state.state.generation
        && value.manifestDigest === state.state.deploymentManifestDigest
        && value.operationRunId === authority.operationRunId
      ));
      if (inspection.active && !inspection.pending && !inspection.prepared
          && exactPointer(inspection.active)) {
        state = transitionCoordinatorState({
          statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: state.state.phase,
          updates: { activePointerDigest: inspection.active.digest },
        });
      } else if (!inspection.active && Boolean(inspection.pending) !== Boolean(inspection.prepared)
          && exactPointer(inspection.pending ?? inspection.prepared)) {
        const source = inspection.pending ?? inspection.prepared;
        failedSource = {
          kind: inspection.pending ? 'pending' : 'prepared', digest: source.digest,
        };
      } else if (!inspection.active && !inspection.pending && !inspection.prepared && retired) {
        failedSource = {
          kind: retired.value.sourcePointerKind, digest: retired.value.sourcePointerDigest,
        };
      } else {
        throw new Error('deployment-managed cleanup subject did not activate its bound revision');
      }
    }
    const durableSuppression = state.state.cleanupSuppression ?? cleanupSuppression;
    if (state.state.subjectExitStatus === null
        || state.state.cleanupSuppression !== durableSuppression) {
      state = transitionCoordinatorState({
        statePath, checkoutRoot, expectedDigest: state.digest,
        nextPhase: state.state.phase,
        updates: { subjectExitStatus, cleanupSuppression: durableSuppression },
      });
    }
    let run = readRunManifest(state.state.runManifestPath, { checkoutRoot });
    if (state.state.phase === 'trust_installed') {
      if (run.manifest.terminalAt === null) {
        run = terminalizeRunManifest({
          store, checkoutRoot, operationRunId: authority.operationRunId,
          lockToken: held.token, expectedDigest: state.state.runManifestDigest, now,
        });
      }
      state = transitionCoordinatorState({
        statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'subject_terminal',
        updates: { runManifestDigest: run.digest },
      });
    }
    if (failedSource) {
      store.retireFailedEphemeralRevision({
        operationRunId: authority.operationRunId, lockToken: held.token,
        projectLockToken: held.token, expectedGeneration: state.state.generation,
        expectedManifestDigest: state.state.deploymentManifestDigest,
        expectedSourcePointerKind: failedSource.kind,
        expectedSourcePointerDigest: failedSource.digest,
        expectedRunManifestDigest: run.digest, runManifest: run.manifest, now: () => now,
      });
    } else {
      store.retireEphemeralRevision({
        operationRunId: authority.operationRunId, lockToken: held.token,
        projectLockToken: held.token, expectedGeneration: state.state.generation,
        expectedManifestDigest: state.state.deploymentManifestDigest,
        expectedActivePointerDigest: state.state.activePointerDigest,
        expectedRunManifestDigest: run.digest, runManifest: run.manifest, now: () => now,
      });
    }
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'deployment_retired',
    });
  } finally { releaseLifecycleLocks(store, authority, held); }
  return Object.freeze({ ...state, runManifest: readRunManifest(state.state.runManifestPath, { checkoutRoot }) });
}
