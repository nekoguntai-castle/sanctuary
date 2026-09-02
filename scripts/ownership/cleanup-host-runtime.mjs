import { canonicalSha256 } from './canonical-json.mjs';
import { acquireRegistrationFence, releaseRegistrationFence } from './registration.mjs';
import { validateArtifact } from './schemas.mjs';

export const HOST_RESOURCE_CLASSES = Object.freeze([
  'collector_process', 'git_worktree', 'temporary_artifact',
]);
const HOST_CLASSES = new Set(HOST_RESOURCE_CLASSES);
const DIGEST = /^[a-f0-9]{64}$/;

function refusal(state = 'refused', failureClass = 'identity_changed') {
  return Object.freeze({ state, failureClass });
}

function exactApprovedAction(action, plan) {
  const approved = plan.actions[action?.sequence - 1];
  if (!approved || canonicalSha256(approved) !== canonicalSha256(action)
      || !HOST_CLASSES.has(action.resourceClass)) {
    throw new TypeError('host action does not exactly match the approved plan');
  }
}

function predecessor(action, value) {
  if (action.dependencyIdentities.length === 0) {
    return value === null ? { allowed: true, derived: null } : { allowed: false };
  }
  return DIGEST.test(value ?? '')
    ? { allowed: true, derived: value } : { allowed: false };
}

function findRegistration(action, registrations) {
  const matches = registrations.filter((entry) => entry.schemaVersion === '1.1.0'
    && entry.resourceClass === action.resourceClass
    && entry.immutableIdentity === action.immutableIdentity
    && entry.locatorKind === action.locatorKind && entry.locator === action.locator);
  if (matches.length !== 1) throw new Error('host registration authority is not unique');
  const registration = matches[0];
  if (!registration.executionAuthority
      || !DIGEST.test(registration.registrationId)
      || !DIGEST.test(registration.metadataDigest)) {
    throw new Error('host registration execution authority is incomplete');
  }
  return registration;
}

function matchesActionIdentity(row, action) {
  return row.immutableIdentity === action.immutableIdentity
    && row.locatorKind === action.locatorKind
    && row.locator === action.locator
    && row.ownershipDigest === action.ownershipDigest;
}

function hasEligibleDisposition(row) {
  return row.disposition === 'eligible'
    && row.active === false
    && row.protected === false
    && row.data === false
    && row.failureClasses.length === 0;
}

function containsRegistrationAuthority(row, registration) {
  return row.contentDigests.includes(registration.registrationId)
    && row.contentDigests.includes(registration.metadataDigest);
}

function observationMatchesAction(row, action) {
  return row.observationDigest === action.observationDigest
    && canonicalSha256(row.dependencyIdentities)
      === canonicalSha256(action.dependencyIdentities);
}

function eligibleRow(inventory, action, registration, derived) {
  validateArtifact(inventory);
  if (!inventory.complete || inventory.ambiguities.length > 0) return refusal('ambiguous', 'query_failed');
  const matches = inventory.resources.filter((row) => row.resourceClass === action.resourceClass
    && (row.immutableIdentity === action.immutableIdentity || row.locator === action.locator));
  if (matches.length !== 1) return refusal(matches.length === 0 ? 'refused' : 'ambiguous');
  const row = matches[0];
  if (!matchesActionIdentity(row, action)
      || !hasEligibleDisposition(row)
      || !containsRegistrationAuthority(row, registration)) return refusal();
  const foreignDependency = row.dependencyIdentities.some((identity) => (
    !action.dependencyIdentities.includes(identity)
  ));
  if (foreignDependency) return refusal('refused', 'shared');
  if (derived === null && !observationMatchesAction(row, action)) {
    return refusal();
  }
  return Object.freeze({ state: 'eligible', row, derivedFromResultDigest: derived });
}

async function reloadHostAuthority({
  action, phase, predecessorResultDigest = null, signal,
}, { plan, loadInventory, loadRegistrations }) {
  try {
    if (!['fresh_eligibility', 'pre_mutation_reinspection'].includes(phase)) {
      throw new TypeError('host authority reload phase is invalid');
    }
    exactApprovedAction(action, plan);
    const derivation = predecessor(action, predecessorResultDigest);
    if (!derivation.allowed) return refusal();
    const registration = findRegistration(action, loadRegistrations());
    const inventory = await loadInventory(Object.freeze({
      action, phase, predecessorResultDigest, signal,
    }));
    return eligibleRow(inventory, action, registration, derivation.derived);
  } catch {
    return refusal('ambiguous', 'query_failed');
  }
}

function registrationFence(root, injected) {
  if (typeof injected === 'function') return injected;
  return async (operationRunId, callback) => {
    const owner = acquireRegistrationFence(root, operationRunId);
    try { return await callback(); } finally { releaseRegistrationFence(root, owner); }
  };
}

function categoricalMutation(value) {
  const allowed = new Set([
    'success', 'timeout', 'cancelled', 'permission_denied', 'command_unavailable',
    'spawn_failed', 'unknown',
  ]);
  if (value?.outcome === 'not_started' && typeof value.refusalClass === 'string') return value;
  return { outcome: allowed.has(value?.outcome) ? value.outcome : 'unknown' };
}

function reconciliation(action, value) {
  const states = new Set(['satisfied', 'absent', 'refused', 'ambiguous']);
  if (!value || !states.has(value.state)) {
    return {
      state: 'ambiguous', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: null,
      failureClass: 'query_failed',
    };
  }
  return {
    state: value.state, resourceClass: action.resourceClass,
    immutableIdentity: action.immutableIdentity,
    postconditionDigest: value.postconditionDigest ?? null,
    failureClass: value.failureClass ?? (['satisfied', 'absent'].includes(value.state) ? 'none' : 'query_failed'),
  };
}

/** Join signed host registrations to the canonical action-runner callback ABI. */
export function createCleanupHostRuntime({
  plan, loadInventory, loadRegistrations, registrationRoot,
  hostOperations, withRegistrationFence,
}) {
  if (typeof loadInventory !== 'function' || typeof loadRegistrations !== 'function'
      || !hostOperations || typeof hostOperations.mutate !== 'function'
      || typeof hostOperations.reconcile !== 'function') {
    throw new TypeError('host runtime callbacks are required');
  }
  const context = { plan, loadInventory, loadRegistrations };
  const reloadAuthority = (request) => reloadHostAuthority(request, context);
  const fenced = registrationFence(registrationRoot, withRegistrationFence);
  const mutate = async ({
    action, intentCheckpointDigest, signal, predecessorResultDigest, authorityRowDigest,
  }) => fenced(plan.operationRunId, async () => {
    const fresh = await reloadAuthority({
      action, phase: 'pre_mutation_reinspection', predecessorResultDigest, signal,
    });
    if (fresh.state !== 'eligible' || canonicalSha256(fresh.row) !== authorityRowDigest) {
      return { outcome: 'not_started', refusalClass: fresh.failureClass ?? 'identity_changed' };
    }
    const registration = findRegistration(action, loadRegistrations());
    return categoricalMutation(await hostOperations.mutate(Object.freeze({
      action, registration, intentCheckpointDigest, signal,
    })));
  });
  const reconcile = async ({ action, mutationOutcome, intentCheckpointDigest, signal }) => {
    try {
      exactApprovedAction(action, plan);
      const registration = findRegistration(action, loadRegistrations());
      return reconciliation(action, await hostOperations.reconcile(Object.freeze({
        action, registration, mutationOutcome, intentCheckpointDigest, signal,
      })));
    } catch {
      return reconciliation(action, null);
    }
  };
  return Object.freeze({ reloadAuthority, mutate, reconcile });
}
