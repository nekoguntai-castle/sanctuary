import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gitHead } from './ci-cleanup-authority.mjs';
import { coordinatorStatePath, readCoordinatorState } from './ci-cleanup-state.mjs';
import { authorityBinding, boundTo, readUpgradeTarget } from './ci-cleanup-upgrade-target.mjs';
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

// The revision being prepared is bound either to the source commit the
// authority was prepared from or, for a declared upgrade lane (#1028), to the
// candidate the lane declared. In an upgrade lane the checkout's live HEAD must
// be one of those two commits and the subject's claim must name one of them.
// The claim and HEAD may legitimately differ here: a persisted runtime env
// still carries the source commit until setup.sh refreshes it from HEAD after
// taking the deployment lock. Which commit a bound manifest carries is settled
// at bind against live HEAD, never by this claim alone.
function revisionBindingMatches(authority, expected, state) {
  const revision = { commit: expected.commit, policyDigest: expected.policyDigest };
  const bindings = [authorityBinding(authority)];
  const target = readUpgradeTarget(state, expected.checkoutRoot);
  if (target === null) return boundTo(bindings[0], revision);
  bindings.push(target);
  const head = gitHead(expected.checkoutRoot);
  return bindings.some((binding) => boundTo(binding, revision))
    && bindings.some((binding) => binding.commit === head);
}

// Names the predicates that fail so a refusal is diagnosable from the lane
// log without exposing any value: the subject only learns which comparison
// disagreed, never what the coordinator expected.
function coordinatedAuthorityMismatches(authority, expected, state) {
  return Object.entries({
    authorityMode: authority.authorityMode === 'deployment_managed_by_subject',
    phase: ['subject_ready', 'deployment_bound', 'run_active', 'trust_installed'].includes(expected.phase),
    runtimeDirectory: authority.runtimeDirectory === expected.runtimeDirectory,
    checkoutRoot: authority.checkoutRoot === expected.checkoutRoot,
    deploymentId: authority.deploymentId === expected.deploymentId,
    composeProjectName: authority.composeProjectName === expected.composeProjectName,
    ownerId: authority.ownerId === expected.ownerId,
    operationRunId: authority.operationRunId === expected.operationRunId,
    revisionBinding: revisionBindingMatches(authority, expected, state),
    identityDigest: authority.identityDigest === expected.identityDigest,
    liveIdentity: expected.liveIdentityDigest === expected.identityDigest,
  }).filter(([, matches]) => !matches).map(([name]) => name);
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
  const mismatches = coordinatedAuthorityMismatches(state.authority, expected, state);
  if (mismatches.length > 0) {
    throw new Error(`coordinated deployment authority does not match provider state (${mismatches.join(', ')})`);
  }
  assertStoreIdentity(store.readIdentity(), expected);
  const createdAt = assertCreationTimestamp(state);
  return {
    identity: { deploymentScope: 'ci_ephemeral', ciRunIdentityDigest: expected.identityDigest },
    createdAt, state,
  };
}

// The pointer shapes a coordinated deployment may be in. Only a declared
// upgrade may hold two pointers: the source revision and the candidate's
// successor, which coexist until the successor activates (#1028).
function boundPointerShape(state, inspection, target) {
  const isBound = (pointer) => pointer.value.generation === state.generation
    && pointer.value.manifestDigest === state.deploymentManifestDigest;
  const pointers = [inspection.pending, inspection.prepared, inspection.active].filter(Boolean);
  const others = pointers.filter((pointer) => !isBound(pointer));
  if (pointers.length - others.length !== 1 || others.length > (target === null ? 0 : 1)) {
    throw new Error(pointers.length === 1 ? 'coordinated deployment bound revision changed'
      : 'coordinated deployment bound revision state is ambiguous');
  }
  return { other: others[0] ?? null, activeIsBound: Boolean(inspection.active) && isBound(inspection.active) };
}

// After the rebind: the bound successor is pending and the source it
// supersedes is still active.
function supersededSourceIsActive(revision, inspection, other, bundle) {
  return other === inspection.active
    && revision.manifest.priorActiveDigest === other.value.manifestDigest
    && revision.manifest.definitionDigest === bundle.definition.definitionDigest;
}

// Before the rebind: the bound source is active and the candidate's successor
// has been prepared but not yet bound.
function preparedSuccessorMatches(state, revision, inspection, shape, bundle, store, target) {
  if (shape.other !== inspection.pending || !shape.activeIsBound
      || !boundTo(authorityBinding(state.authority), revision.manifest)) return false;
  const successor = store.readManifest(shape.other.value.generation, { verifySnapshots: true });
  return successor.manifestDigest === shape.other.value.manifestDigest
    && successor.manifest.generation === state.generation + 1
    && successor.manifest.priorActiveDigest === state.deploymentManifestDigest
    && boundTo(target, successor.manifest)
    && successor.manifest.definitionDigest === bundle.definition.definitionDigest;
}

// The bound source revision is active and the candidate is about to prepare
// the one successor the lane declared.
function successorAboutToPrepare(state, revision, shape, bundle, target) {
  return target !== null && shape.activeIsBound
    && boundTo(authorityBinding(state.authority), revision.manifest)
    && bundle.definition.commit === target.commit;
}

export function assertBoundCoordinatedRevision(coordinated, inspection, bundle, store) {
  if (!coordinated.state || coordinated.state.phase === 'subject_ready') return;
  const state = coordinated.state;
  const target = readUpgradeTarget(state, state.authority.checkoutRoot);
  const shape = boundPointerShape(state, inspection, target);
  const revision = store.readManifest(state.generation, { verifySnapshots: true });
  if (revision.manifestDigest !== state.deploymentManifestDigest
      || revision.manifest.createdAt !== coordinated.createdAt) {
    throw new Error('coordinated deployment bound definition changed');
  }
  if (shape.other !== null) {
    if (supersededSourceIsActive(revision, inspection, shape.other, bundle)
        || preparedSuccessorMatches(state, revision, inspection, shape, bundle, store, target)) return;
    throw new Error('coordinated deployment bound revision state is ambiguous');
  }
  if (revision.manifest.definitionDigest === bundle.definition.definitionDigest
      || successorAboutToPrepare(state, revision, shape, bundle, target)) return;
  throw new Error('coordinated deployment bound definition changed');
}
