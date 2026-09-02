import { readFileSync } from 'node:fs';
import path from 'node:path';
import { coordinatorStatePath, readCoordinatorState } from './ci-cleanup-state.mjs';
import { ciCleanupProviderContext } from './ci-cleanup-trust.mjs';
import { sha256 } from './crypto.mjs';
import { resolveProjectIdentity } from './project-identity.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function flag(name) {
  return ['1', 'true', 'yes'].includes((process.env[name] ?? '').toLowerCase());
}

function coordinatedAuthorityMatches(authority, expected) {
  return [
    authority.authorityMode === 'deployment_managed_by_subject',
    ['subject_ready', 'deployment_bound', 'run_active', 'trust_installed'].includes(expected.phase),
    authority.runtimeDirectory === expected.runtimeDirectory,
    authority.checkoutRoot === expected.checkoutRoot,
    authority.deploymentId === expected.deploymentId,
    authority.composeProjectName === expected.composeProjectName,
    authority.ownerId === expected.ownerId,
    authority.operationRunId === expected.operationRunId,
    authority.checkoutCommit === expected.commit,
    authority.policyDigest === expected.policyDigest,
    authority.identityDigest === expected.identityDigest,
    expected.liveIdentityDigest === expected.identityDigest,
  ].every(Boolean);
}

function assertStoreIdentity(identity, expected) {
  const matches = [
    identity.identityVersion === 2,
    identity.deploymentScope === 'ci_ephemeral',
    identity.ciRunIdentityDigest === expected.identityDigest,
    identity.projectDirectory === expected.checkoutRoot,
    identity.composeProjectName === expected.composeProjectName,
  ].every(Boolean);
  if (!matches) throw new Error('coordinated deployment store does not match provider state');
}

function coordinatedExpected(runtimeDirectory, deploymentId, checkoutRoot, state) {
  return {
    phase: state.phase, runtimeDirectory, deploymentId, checkoutRoot,
    composeProjectName: resolveProjectIdentity(),
    ownerId: required('SANCTUARY_OWNER_ID'),
    operationRunId: required('SANCTUARY_OPERATION_RUN_ID'),
    commit: required('SANCTUARY_COMMIT'),
    policyDigest: sha256(readFileSync(
      path.join(checkoutRoot, 'config/resource-ownership-contract.json'),
    )),
    identityDigest: required('SANCTUARY_CI_RUN_IDENTITY_DIGEST'),
    liveIdentityDigest: ciCleanupProviderContext().identityDigest,
  };
}

function assertCreationTimestamp(state) {
  const value = state.resourceCreatedAt;
  if (new Date(value).toISOString() !== value) {
    throw new Error('coordinated deployment creation timestamp is invalid');
  }
  if (required('SANCTUARY_CLEANUP_CREATED_AT') !== value) {
    throw new Error('coordinated deployment creation timestamp does not match provider state');
  }
  return value;
}

export function deploymentIdentityOptions(runtimeDirectory, deploymentId, store) {
  if (!flag('SANCTUARY_CLEANUP_COORDINATED')) {
    return {
      identity: { deploymentScope: 'production', ciRunIdentityDigest: null },
      createdAt: null, state: null,
    };
  }
  if (required('SANCTUARY_CLEANUP_AUTHORITY_MODE') !== 'deployment_managed_by_subject'
      || required('SANCTUARY_DEPLOYMENT_SCOPE') !== 'ci_ephemeral') {
    throw new Error('coordinated deployment requires subject-managed CI-ephemeral authority');
  }
  const checkoutRoot = path.resolve(required('SANCTUARY_PROJECT_DIR'));
  const statePath = path.resolve(required('SANCTUARY_CLEANUP_STATE'));
  if (statePath !== coordinatorStatePath(runtimeDirectory)) {
    throw new Error('coordinated deployment state path does not match its runtime');
  }
  const state = readCoordinatorState(statePath, { checkoutRoot }).state;
  const expected = coordinatedExpected(runtimeDirectory, deploymentId, checkoutRoot, state);
  if (!coordinatedAuthorityMatches(state.authority, expected)) {
    throw new Error('coordinated deployment authority does not match provider state');
  }
  assertStoreIdentity(store.readIdentity(), expected);
  const createdAt = assertCreationTimestamp(state);
  return {
    identity: { deploymentScope: 'ci_ephemeral', ciRunIdentityDigest: expected.identityDigest },
    createdAt, state,
  };
}

export function assertBoundCoordinatedRevision(coordinated, inspection, bundle, store) {
  if (!coordinated.state || coordinated.state.phase === 'subject_ready') return;
  const pointers = [inspection.pending, inspection.prepared, inspection.active].filter(Boolean);
  if (pointers.length !== 1) {
    throw new Error('coordinated deployment bound revision state is ambiguous');
  }
  const pointer = pointers[0];
  if (pointer.value.generation !== coordinated.state.generation
      || pointer.value.manifestDigest !== coordinated.state.deploymentManifestDigest) {
    throw new Error('coordinated deployment bound revision changed');
  }
  const revision = store.readManifest(pointer.value.generation, { verifySnapshots: true });
  if (revision.manifestDigest !== coordinated.state.deploymentManifestDigest
      || revision.manifest.definitionDigest !== bundle.definition.definitionDigest
      || revision.manifest.createdAt !== coordinated.createdAt) {
    throw new Error('coordinated deployment bound definition changed');
  }
}
