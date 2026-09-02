import { canonicalSha256 } from './canonical-json.mjs';
import { executeDockerMutation } from './cleanup-docker-executor.mjs';
import { runSupervisedCleanupCommand } from './cleanup-supervisor.mjs';

const CLASS_ORDER = Object.freeze({
  compose_container: 0, compose_network: 1, compose_volume: 2,
});
const DIGEST = /^[a-f0-9]{64}$/;

function actionFields(resource, action) {
  return {
    resourceClass: resource.resourceClass,
    immutableIdentity: resource.immutableIdentity,
    action,
    locatorKind: resource.locatorKind,
    locator: resource.locator,
    ownershipDigest: resource.ownershipDigest,
    observationDigest: resource.observationDigest,
    dependencyIdentities: action === 'remove' ? [...resource.dependencyIdentities] : [],
  };
}

function compareResources(left, right) {
  return CLASS_ORDER[left.resourceClass] - CLASS_ORDER[right.resourceClass]
    || left.immutableIdentity.localeCompare(right.immutableIdentity);
}

/** Build the exact action list admitted by lost-authority recovery. */
export function buildOperatorRecoveryActions(observation) {
  if (!observation || !Array.isArray(observation.resources)) {
    throw new TypeError('recovery observation resources are required');
  }
  const actions = [...observation.resources].sort(compareResources).flatMap((resource) => {
    if (!Object.hasOwn(CLASS_ORDER, resource.resourceClass)) {
      throw new TypeError('recovery observation contains an unsupported resource class');
    }
    return resource.resourceClass === 'compose_container'
      ? [actionFields(resource, 'stop'), actionFields(resource, 'remove')]
      : [actionFields(resource, 'remove')];
  });
  return Object.freeze(actions.map((entry, index) => Object.freeze({ sequence: index + 1, ...entry })));
}

function exactApprovedAction(action, actions) {
  const expected = actions[action?.sequence - 1];
  return expected && canonicalSha256(expected) === canonicalSha256(action);
}

function sameIdentity(expected, observed) {
  return observed?.resourceClass === expected.resourceClass
    && observed?.locatorKind === expected.locatorKind
    && observed?.locator === expected.locator
    && observed?.immutableIdentity === expected.immutableIdentity
    && observed?.ownershipDigest === expected.ownershipDigest;
}

function observationDigest(observed) {
  return DIGEST.test(observed?.freshObservationDigest ?? '')
    ? observed.freshObservationDigest
    : DIGEST.test(observed?.observationDigest ?? '')
      ? observed.observationDigest : canonicalSha256(observed);
}

function authorityRow(action, observed, scopeDigest) {
  const running = action.resourceClass === 'compose_container'
    ? (observed.running ?? observed.runtime?.running) : null;
  return Object.freeze({
    resourceClass: action.resourceClass,
    locatorKind: action.locatorKind,
    locator: action.locator,
    immutableIdentity: action.immutableIdentity,
    ownership: observed.ownership,
    ownershipDigest: action.ownershipDigest,
    observationDigest: observationDigest(observed),
    disposition: 'eligible',
    failureClasses: Object.freeze([]),
    references: Object.freeze([]),
    contentDigests: Object.freeze([scopeDigest]),
    dependencyIdentities: Object.freeze([...(observed.dependencyIdentities
      ?? observed.runtime?.dependencyIdentities ?? [])].sort()),
    running,
    active: false,
    protected: false,
    data: false,
  });
}

function stableDependencies(action, row) {
  return row.dependencyIdentities.every((identity) => action.dependencyIdentities.includes(identity));
}

function postcondition(action, state) {
  return Object.freeze({
    state,
    resourceClass: action.resourceClass,
    immutableIdentity: action.immutableIdentity,
    postconditionDigest: canonicalSha256({
      resourceClass: action.resourceClass,
      locator: action.locator,
      immutableIdentity: action.immutableIdentity,
      state,
    }),
    failureClass: 'none',
  });
}

function refusal(action, failureClass = 'identity_changed') {
  return Object.freeze({
    state: 'refused', resourceClass: action.resourceClass,
    immutableIdentity: action.immutableIdentity, postconditionDigest: null, failureClass,
  });
}

function exactScopeDigest(scope) {
  const value = scope?.scopeDigest ?? canonicalSha256(scope);
  if (!DIGEST.test(value)) throw new TypeError('recovery scope digest is invalid');
  return value;
}

function volumeProof(action, observed, expected) {
  const attachments = observed.attachmentCount ?? observed.runtime?.attachmentCount;
  if (attachments !== 0) throw new Error('recovery volume still has attachments');
  const nonce = expected.attestationNonce;
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.includes('\0')) {
    throw new Error('recovery volume attestation nonce is invalid');
  }
  return {
    locator: action.locator,
    observedFingerprint: observed.immutableIdentity,
    registeredCreationNonce: nonce,
    observedCreationNonce: nonce,
    observedOwnershipDigest: action.ownershipDigest,
    attachmentCount: attachments,
  };
}

/** Join recovery authority reinspection to the canonical Docker mutation adapter. */
export function createOperatorRecoveryRuntime({
  scope, actions, observeAction, engine = 'docker', engineGlobalArgs,
  supervisor = runSupervisedCleanupCommand, supervisorOptions = {},
} = {}) {
  if (!Array.isArray(actions) || typeof observeAction !== 'function') {
    throw new TypeError('approved actions and observeAction are required');
  }
  const scopeDigest = exactScopeDigest(scope);
  const resources = new Map(scope.resources.map((entry) => [
    `${entry.resourceClass}:${entry.locator}`, entry,
  ]));
  const observe = async (action) => observeAction(Object.freeze({ action }));

  const reloadAuthority = async ({ action, predecessorResultDigest = null }) => {
    if (!exactApprovedAction(action, actions)) return Object.freeze({ state: 'ambiguous', failureClass: 'query_failed' });
    let observed;
    try { observed = await observe(action); } catch {
      return Object.freeze({ state: 'ambiguous', failureClass: 'query_failed' });
    }
    if (observed === null) {
      if (predecessorResultDigest === null) return Object.freeze({ state: 'refused', failureClass: 'identity_changed' });
      return Object.freeze({
        state: 'absent', postconditionDigest: postcondition(action, 'absent').postconditionDigest,
        derivedFromResultDigest: predecessorResultDigest,
      });
    }
    const expected = resources.get(`${action.resourceClass}:${action.locator}`);
    if (!expected || !sameIdentity(expected, observed)) {
      return Object.freeze({ state: 'refused', failureClass: 'identity_changed' });
    }
    const row = authorityRow(action, observed, scopeDigest);
    if (!stableDependencies(action, row)
        || (predecessorResultDigest === null && row.observationDigest !== action.observationDigest)) {
      return Object.freeze({ state: 'refused', failureClass: 'identity_changed' });
    }
    return Object.freeze({
      state: 'eligible', row,
      derivedFromResultDigest: predecessorResultDigest,
    });
  };

  const mutate = async ({ action, authorityRowDigest }) => {
    let observed;
    try { observed = await observe(action); } catch {
      return { outcome: 'not_started', refusalClass: 'query_failed' };
    }
    const expected = resources.get(`${action.resourceClass}:${action.locator}`);
    if (!expected || !sameIdentity(expected, observed)) {
      return { outcome: 'not_started', refusalClass: 'identity_changed' };
    }
    const row = authorityRow(action, observed, scopeDigest);
    if (canonicalSha256(row) !== authorityRowDigest) {
      return { outcome: 'not_started', refusalClass: 'identity_changed' };
    }
    let freshVolumeProof;
    try {
      freshVolumeProof = action.resourceClass === 'compose_volume'
        ? volumeProof(action, observed, expected) : undefined;
    } catch { return { outcome: 'not_started', refusalClass: 'referenced' }; }
    return executeDockerMutation(action, {
      engine, engineGlobalArgs, supervisor, freshVolumeProof, supervisorOptions,
    });
  };

  const reconcile = async ({ action }) => {
    let observed;
    try { observed = await observe(action); } catch { return refusal(action, 'query_failed'); }
    if (observed === null) return postcondition(action, 'absent');
    const expected = resources.get(`${action.resourceClass}:${action.locator}`);
    if (!expected || !sameIdentity(expected, observed)) return refusal(action);
    const stopped = action.resourceClass === 'compose_container' && action.action === 'stop'
      && (observed.running ?? observed.runtime?.running) === false;
    return stopped ? postcondition(action, 'satisfied') : refusal(action, 'postcondition_failed');
  };

  return Object.freeze({ reloadAuthority, mutate, reconcile });
}
