import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assertCiCleanupAuthority } from './ci-cleanup-authority.mjs';
import { transitionCoordinatorState, readCoordinatorState } from './ci-cleanup-state.mjs';
import { installEphemeralCiCleanupTrust } from './ci-cleanup-trust.mjs';
import { createEphemeralCleanupSigners } from './cleanup-ephemeral-signers.mjs';
import { sha256 } from './crypto.mjs';
import { assertDeploymentLock } from './deployment-lock.mjs';
import { DeploymentStore } from './deployment-store.mjs';
import { assertProjectMutationLock } from './project-lock.mjs';
import { ensureRegistrationKeys } from './registration.mjs';
import { createRunManifest, readRunManifest } from './run-manifest-store.mjs';

export function subjectEnvironment(state, statePath) {
  const authority = state.authority;
  const imageLockSha256 = sha256(readFileSync(
    path.join(authority.checkoutRoot, 'config/container-image-lock.json'),
  ));
  const version = JSON.parse(readFileSync(
    path.join(authority.checkoutRoot, 'package.json'), 'utf8',
  )).version;
  return Object.freeze({
    COMPOSE_PROJECT_NAME: authority.composeProjectName,
    SANCTUARY_PROJECT: authority.composeProjectName,
    SANCTUARY_PROJECT_DIR: authority.checkoutRoot,
    SANCTUARY_RUNTIME_DIR: authority.runtimeDirectory,
    SANCTUARY_ENV_FILE: path.join(authority.runtimeDirectory, 'sanctuary.env'),
    SANCTUARY_DEPLOYMENT_ID: authority.deploymentId,
    SANCTUARY_OWNER_ID: authority.ownerId,
    SANCTUARY_OPERATION_RUN_ID: authority.operationRunId,
    SANCTUARY_RELEASE: 'unreleased', SANCTUARY_COMMIT: authority.checkoutCommit,
    SANCTUARY_SOURCE_COMMIT: authority.checkoutCommit,
    SANCTUARY_IMAGE_LOCK_SHA256: imageLockSha256,
    SANCTUARY_VERSION: version,
    SANCTUARY_BUILD_ID: `checkout-${authority.checkoutCommit}`,
    SANCTUARY_IMAGE_TAG: authority.composeProjectName,
    SANCTUARY_VOLUME_CLEANUP_POLICY: 'exact_delete',
    SANCTUARY_CLEANUP_CREATED_AT: state.resourceCreatedAt,
    SANCTUARY_RESOURCE_LIFECYCLE: 'obsolete',
    SANCTUARY_OWNERSHIP_ROOT: path.join(authority.runtimeDirectory, 'ownership'),
    SANCTUARY_CLEANUP_COORDINATED: '1',
    SANCTUARY_CLEANUP_AUTHORITY_MODE: authority.authorityMode,
    SANCTUARY_CLEANUP_STATE: statePath,
    SANCTUARY_DEPLOYMENT_SCOPE: 'ci_ephemeral',
    SANCTUARY_CI_RUN_IDENTITY_DIGEST: authority.identityDigest,
  });
}

export function ensureLifecycleSigners({ state, statePath, checkoutRoot }) {
  const keyRoot = path.join(state.state.authority.runtimeDirectory, 'coordinator', 'keys');
  mkdirSync(path.dirname(keyRoot), { recursive: true, mode: 0o700 });
  const signers = createEphemeralCleanupSigners({ keyRoot, checkoutRoot });
  ensureRegistrationKeys(path.join(state.state.authority.runtimeDirectory, 'ownership'));
  let current = state;
  if (current.state.authorizationFingerprint === null) {
    current = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: current.digest, nextPhase: current.state.phase,
      updates: {
        authorizationFingerprint: signers.authorization.fingerprint,
        evidenceFingerprint: signers.evidence.fingerprint,
      },
    });
  } else if (current.state.authorizationFingerprint !== signers.authorization.fingerprint
      || current.state.evidenceFingerprint !== signers.evidence.fingerprint) {
    throw new Error('cleanup signer identities changed before resume');
  }
  return { state: current, signers, keyRoot };
}

function assertBoundPointer(state, store, inspection) {
  const pointers = [inspection.pending, inspection.prepared, inspection.active].filter(Boolean);
  if (pointers.length !== 1
      || pointers[0].value.generation !== state.generation
      || pointers[0].value.manifestDigest !== state.deploymentManifestDigest) {
    throw new Error('subject-managed cleanup bound revision changed before resume');
  }
  const exact = store.readManifest(state.generation, { verifySnapshots: true });
  if (exact.manifestDigest !== state.deploymentManifestDigest
      || exact.manifest.createdAt !== state.resourceCreatedAt) {
    throw new Error('subject-managed cleanup bound manifest changed before resume');
  }
}

function assertPendingManifest(state, authority, deployment, pending) {
  const matches = [
    deployment.manifestDigest === pending.value.manifestDigest,
    deployment.manifest.deploymentId === authority.deploymentId,
    deployment.manifest.ownerId === authority.ownerId,
    deployment.manifest.composeProjectName === authority.composeProjectName,
    deployment.manifest.commit === authority.checkoutCommit,
    deployment.manifest.policyDigest === authority.policyDigest,
    deployment.manifest.createdAt === state.resourceCreatedAt,
    deployment.manifest.priorActiveDigest === null,
  ].every(Boolean);
  if (!matches) throw new Error('subject-managed cleanup manifest does not match coordinator authority');
}

function bindDeploymentState(state, options, deployment, pending) {
  if (state.state.phase === 'subject_ready') {
    return transitionCoordinatorState({
      ...options, expectedDigest: state.digest, nextPhase: 'deployment_bound',
      updates: {
        deploymentManifestPath: path.join(deployment.revisionRoot, 'deployment-manifest.json'),
        deploymentManifestDigest: deployment.manifestDigest,
        generation: deployment.manifest.generation,
        deploymentPointerDigest: pending.digest,
      },
    });
  }
  if (state.state.deploymentManifestDigest !== deployment.manifestDigest
      || state.state.deploymentPointerDigest !== pending.digest) {
    throw new Error('subject-managed cleanup binding changed before resume');
  }
  return state;
}

export function bindSubjectManagedCiCleanupLifecycle({
  statePath, checkoutRoot, lockToken, now = new Date(),
}) {
  let state = readCoordinatorState(statePath, { checkoutRoot });
  assertCiCleanupAuthority(state.state, checkoutRoot);
  const authority = state.state.authority;
  if (authority.authorityMode !== 'deployment_managed_by_subject') {
    throw new Error('cleanup coordinator does not permit a subject-managed deployment');
  }
  if (!['subject_ready', 'deployment_bound', 'run_active', 'trust_installed'].includes(state.state.phase)) {
    throw new Error(`cleanup subject cannot bind from phase ${state.state.phase}`);
  }
  const store = new DeploymentStore({
    runtimeDirectory: authority.runtimeDirectory, deploymentId: authority.deploymentId,
  });
  store.initialize({
    projectDirectory: authority.checkoutRoot, composeProjectName: authority.composeProjectName,
    deploymentScope: 'ci_ephemeral', ciRunIdentityDigest: authority.identityDigest,
  });
  assertDeploymentLock(store.lockPath, lockToken, authority.operationRunId);
  assertProjectMutationLock(
    authority.runtimeDirectory, authority.composeProjectName, lockToken,
    authority.operationRunId,
  );
  const inspection = store.inspect();
  if (state.state.phase === 'trust_installed') {
    assertBoundPointer(state.state, store, inspection);
    const prepared = ensureLifecycleSigners({ state, statePath, checkoutRoot });
    return Object.freeze({
      ...prepared.state,
      environment: subjectEnvironment(prepared.state.state, prepared.state.path),
      signers: prepared.signers,
    });
  }
  if (inspection.active || inspection.prepared || !inspection.pending) {
    throw new Error('subject-managed cleanup binding requires one exact pending revision');
  }
  const deployment = store.readManifest(inspection.pending.value.generation, {
    verifySnapshots: true,
  });
  assertPendingManifest(state.state, authority, deployment, inspection.pending);
  state = bindDeploymentState(
    state, { statePath, checkoutRoot }, deployment, inspection.pending,
  );
  const runPath = path.join(store.root, 'runs', authority.operationRunId, 'run-manifest.json');
  const run = existsSync(runPath)
    ? readRunManifest(runPath, { checkoutRoot })
    : createRunManifest({
      store, checkoutRoot, deploymentManifest: deployment.manifest,
      operationRunId: authority.operationRunId, lockToken, now,
    });
  if (state.state.phase === 'deployment_bound') {
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'run_active',
      updates: { runManifestPath: run.path, runManifestDigest: run.digest },
    });
  }
  const prepared = ensureLifecycleSigners({ state, statePath, checkoutRoot });
  state = prepared.state;
  installEphemeralCiCleanupTrust({
    runtimeDirectory: authority.runtimeDirectory, checkoutRoot, keyRoot: prepared.keyRoot,
    deploymentManifest: deployment.manifest, operationRunId: authority.operationRunId,
    authorizationFingerprint: prepared.signers.authorization.fingerprint,
    evidenceFingerprint: prepared.signers.evidence.fingerprint,
    coordinatorStateDigest: state.state.authorityCoreDigest, now,
  });
  if (state.state.phase === 'run_active') {
    state = transitionCoordinatorState({
      statePath, checkoutRoot, expectedDigest: state.digest, nextPhase: 'trust_installed',
    });
  }
  return Object.freeze({
    ...state, environment: subjectEnvironment(state.state, state.path),
    signers: prepared.signers,
  });
}
