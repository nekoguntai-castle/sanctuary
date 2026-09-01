import { canonicalSha256 } from './canonical-json.mjs';
import { MAX_CLEANUP_ACTIONS } from './cleanup-journal-protocol.mjs';
import { validateArtifact } from './schemas.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const ENGINE_ID = /^[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;
const PHASES = new Set(['fresh_eligibility', 'pre_mutation_reinspection']);
const ACTION_KEYS = [
  'sequence', 'resourceClass', 'immutableIdentity', 'action', 'locatorKind',
  'locator', 'ownershipDigest', 'observationDigest',
];
const VOLUME_PROOF_KEYS = [
  'resourceClass', 'locatorKind', 'locator', 'immutableIdentity', 'ownershipDigest',
  'ownership', 'registrationId', 'metadataDigest', 'signerKeyId', 'creationNonce',
];

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new TypeError(`${label} fields are invalid`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`${label} must be a SHA-256 digest`);
}

function validateAction(action) {
  exactObject(action, ACTION_KEYS, 'Docker cleanup action');
  if (!Number.isSafeInteger(action.sequence) || action.sequence < 1) throw new TypeError('action sequence is invalid');
  digest(action.ownershipDigest, 'action ownershipDigest');
  digest(action.observationDigest, 'action observationDigest');
  const pair = `${action.resourceClass}:${action.action}`;
  if (!['compose_container:stop', 'compose_container:remove', 'compose_network:remove',
    'compose_volume:remove', 'oci_image:remove'].includes(pair)) {
    throw new TypeError('action is not an allowed Docker mutation');
  }
  if (action.resourceClass === 'compose_volume') {
    if (action.locatorKind !== 'name' || !VOLUME_NAME.test(action.locator)
        || !DIGEST.test(action.immutableIdentity)) throw new TypeError('volume action identity is invalid');
    return;
  }
  const pattern = action.resourceClass === 'oci_image' ? IMAGE_ID : ENGINE_ID;
  if (action.locatorKind !== 'engine_id' || !pattern.test(action.locator)
      || action.locator !== action.immutableIdentity) throw new TypeError('Docker action immutable ID is invalid');
}

function validateApprovedActions(actions) {
  if (!Array.isArray(actions) || actions.length > MAX_CLEANUP_ACTIONS) {
    throw new TypeError('approvedActions must be a bounded array');
  }
  actions.forEach((action, index) => {
    validateAction(action);
    if (action.sequence !== index + 1) throw new TypeError('approvedActions must be contiguous and ordered');
  });
  return actions;
}

function exactApprovedAction(action, approvedActions) {
  const expected = approvedActions[action.sequence - 1];
  if (!expected || canonicalSha256(expected) !== canonicalSha256(action)) {
    throw new TypeError('action does not exactly match approvedActions');
  }
}

function isStopRemovePair(prior, action) {
  return prior?.resourceClass === 'compose_container' && prior.action === 'stop'
    && action.resourceClass === 'compose_container' && action.action === 'remove'
    && prior.immutableIdentity === action.immutableIdentity;
}

function predecessorDerivation(action, approvedActions, predecessorResultDigest) {
  if (predecessorResultDigest === null) {
    const prior = approvedActions[action.sequence - 2];
    if (isStopRemovePair(prior, action)) return { allowed: false, derived: null };
    return { allowed: true, derived: null };
  }
  if (typeof predecessorResultDigest !== 'string' || !DIGEST.test(predecessorResultDigest)) {
    return { allowed: false, derived: null };
  }
  const prior = approvedActions[action.sequence - 2];
  const allowed = isStopRemovePair(prior, action);
  return { allowed, derived: allowed ? predecessorResultDigest : null };
}

function registrationIdentityFailure(action, proof) {
  return proof.resourceClass !== 'compose_volume' || proof.locatorKind !== 'name'
    || proof.locator !== action.locator || proof.immutableIdentity !== action.immutableIdentity
    || proof.ownershipDigest !== action.ownershipDigest;
}

function registrationOwnershipFailure(action, proof) {
  return !proof.ownership || typeof proof.ownership !== 'object' || Array.isArray(proof.ownership)
    || canonicalSha256(proof.ownership) !== proof.ownershipDigest
    || proof.ownership.resourceClass !== action.resourceClass
    || proof.ownership.immutableIdentity !== action.immutableIdentity;
}

function registrationNonceFailure(proof) {
  return typeof proof.creationNonce !== 'string' || proof.creationNonce.length === 0
    || proof.creationNonce.length > 128 || proof.creationNonce.includes('\0')
    || proof.creationNonce !== proof.ownership.creationRunId;
}

function registrationFailure(action, proof) {
  try { exactObject(proof, VOLUME_PROOF_KEYS, 'volume registration proof'); } catch { return 'unregistered'; }
  for (const key of ['ownershipDigest', 'registrationId', 'metadataDigest', 'signerKeyId']) {
    try { digest(proof[key], `volume proof ${key}`); } catch { return 'unregistered'; }
  }
  if (registrationIdentityFailure(action, proof)) return 'identity_changed';
  if (registrationOwnershipFailure(action, proof)) return 'identity_changed';
  if (registrationNonceFailure(proof)) return 'unregistered';
  return null;
}

async function volumeProofFor(action, loadVolumeRegistrationProof, signal) {
  if (action.resourceClass !== 'compose_volume') return { proof: null, failureClass: null };
  if (typeof loadVolumeRegistrationProof !== 'function') return { proof: null, failureClass: 'unregistered' };
  try {
    const proof = await loadVolumeRegistrationProof(Object.freeze({ action, signal }));
    return { proof, failureClass: registrationFailure(action, proof) };
  } catch {
    return { proof: null, failureClass: 'query_failed' };
  }
}

function ambiguityFailure(ambiguities) {
  const categories = new Set(ambiguities.map((entry) => entry?.failureClass ?? entry?.category));
  if (categories.has('identity_changed') || categories.has('inventory_drift')) return 'identity_changed';
  if (categories.has('malformed') || categories.has('malformed_output')) return 'malformed';
  if (categories.has('unsupported') || categories.has('command_unavailable')) return 'unsupported';
  return 'query_failed';
}

function rowFailure(row, action) {
  if (row.resourceClass !== action.resourceClass || row.immutableIdentity !== action.immutableIdentity
      || row.locatorKind !== action.locatorKind || row.locator !== action.locator
      || row.ownershipDigest !== action.ownershipDigest) return 'identity_changed';
  if (row.disposition !== 'eligible' || row.active || row.protected || row.data
      || !Array.isArray(row.failureClasses) || row.failureClasses.length !== 0) {
    return row.failureClasses?.[0] ?? 'identity_changed';
  }
  return null;
}

function validateReloadRequest(action, phase, approvedActions, loadInventory) {
  validateAction(action);
  validateApprovedActions(approvedActions);
  exactApprovedAction(action, approvedActions);
  if (!PHASES.has(phase)) throw new TypeError('authority reload phase is invalid');
  if (typeof loadInventory !== 'function') throw new TypeError('loadInventory callback is required');
}

async function inventoryForReload({ action, phase, predecessorResultDigest, signal, loadInventory }) {
  try {
    const inventory = await loadInventory(Object.freeze({ action, phase, predecessorResultDigest, signal }));
    validateArtifact(inventory);
    return { inventory };
  } catch {
    return { failure: Object.freeze({ state: 'ambiguous', failureClass: 'query_failed' }) };
  }
}

function eligibleInventoryRow(inventory, action) {
  if (!inventory.complete || inventory.ambiguities.length > 0) return {
    failure: Object.freeze({ state: 'ambiguous', failureClass: ambiguityFailure(inventory.ambiguities) }),
  };
  const matches = inventory.resources.filter((row) => row.resourceClass === action.resourceClass
    && (row.immutableIdentity === action.immutableIdentity || row.locator === action.locator));
  if (matches.length !== 1) return { failure: Object.freeze({
    state: matches.length === 0 ? 'refused' : 'ambiguous', failureClass: 'identity_changed',
  }) };
  const failureClass = rowFailure(matches[0], action);
  return failureClass ? { failure: Object.freeze({ state: 'refused', failureClass }) } : { row: matches[0] };
}

/** Reload one exact approved action through the canonical inventory authority. */
export async function reloadDockerActionAuthority({
  action, phase, predecessorResultDigest = null, signal,
  approvedActions, loadInventory, loadVolumeRegistrationProof,
}) {
  try {
    action = Object.freeze({ ...action });
    validateReloadRequest(action, phase, approvedActions, loadInventory);
  } catch {
    return Object.freeze({ state: 'ambiguous', failureClass: 'query_failed' });
  }
  const derivation = predecessorDerivation(action, approvedActions, predecessorResultDigest);
  if (!derivation.allowed) return Object.freeze({ state: 'refused', failureClass: 'identity_changed' });
  const registration = await volumeProofFor(action, loadVolumeRegistrationProof, signal);
  if (registration.failureClass) return Object.freeze({
    state: registration.failureClass === 'query_failed' ? 'ambiguous' : 'refused',
    failureClass: registration.failureClass,
  });
  const loaded = await inventoryForReload({ action, phase, predecessorResultDigest, signal, loadInventory });
  if (loaded.failure) return loaded.failure;
  const selected = eligibleInventoryRow(loaded.inventory, action);
  if (selected.failure) return selected.failure;
  const row = selected.row;
  if (registration.proof && (!row.contentDigests.includes(registration.proof.registrationId)
      || !row.contentDigests.includes(registration.proof.metadataDigest))) {
    return Object.freeze({ state: 'refused', failureClass: 'unregistered' });
  }
  if (derivation.derived === null && row.observationDigest !== action.observationDigest) {
    return Object.freeze({ state: 'refused', failureClass: 'identity_changed' });
  }
  return Object.freeze({ state: 'eligible', row, derivedFromResultDigest: derivation.derived });
}

export function createDockerAuthorityReloader(options) {
  validateApprovedActions(options?.approvedActions);
  if (typeof options?.loadInventory !== 'function') throw new TypeError('loadInventory callback is required');
  const approvedActions = Object.freeze(options.approvedActions.map((action) => Object.freeze({ ...action })));
  return (request) => reloadDockerActionAuthority({
    ...request, approvedActions, loadInventory: options.loadInventory,
    loadVolumeRegistrationProof: options.loadVolumeRegistrationProof,
  });
}

function locatorSelector(locator) {
  return Object.freeze({ locator });
}

function exactSelectors(action) {
  return Object.freeze({
    compose_container: Object.freeze(action.resourceClass === 'compose_container' ? [locatorSelector(action.locator)] : []),
    compose_network: Object.freeze(action.resourceClass === 'compose_network' ? [locatorSelector(action.locator)] : []),
    compose_volume: Object.freeze(action.resourceClass === 'compose_volume' ? [locatorSelector(action.locator)] : []),
    oci_image: Object.freeze(action.resourceClass === 'oci_image' ? [locatorSelector(action.locator)] : []),
    buildkit_cache: Object.freeze([]),
  });
}

function reconciliation(action, state, failureClass, evidence = null) {
  const postconditionDigest = evidence === null ? null : canonicalSha256(evidence);
  return Object.freeze({
    state, resourceClass: action.resourceClass, immutableIdentity: action.immutableIdentity,
    postconditionDigest, failureClass,
  });
}

function selectorsMatch(observed, expected) {
  try {
    return observed && typeof observed === 'object' && !Array.isArray(observed)
      && canonicalSha256(observed) === canonicalSha256(expected);
  } catch { return false; }
}

function observedIdentityIsValid(action, resource) {
  const pattern = action.resourceClass === 'compose_volume' ? DIGEST
    : action.resourceClass === 'oci_image' ? IMAGE_ID : ENGINE_ID;
  return typeof resource?.immutableIdentity === 'string' && pattern.test(resource.immutableIdentity);
}

function presentPostcondition(action, resource, contextFingerprint) {
  const evidence = {
    contextFingerprint, resourceClass: action.resourceClass, locator: action.locator,
    approvedImmutableIdentity: action.immutableIdentity,
    observedImmutableIdentity: resource.immutableIdentity,
  };
  if (action.resourceClass === 'compose_container' && action.action === 'stop') {
    if (resource.immutableIdentity !== action.immutableIdentity) return reconciliation(action, 'refused', 'identity_changed');
    if (typeof resource.runtime?.running !== 'boolean') return reconciliation(action, 'ambiguous', 'malformed');
    if (resource.runtime?.running === false) return reconciliation(action, 'satisfied', 'none', { ...evidence, running: false });
    return reconciliation(action, 'refused', 'postcondition_failed');
  }
  if (action.resourceClass === 'compose_volume' && resource.immutableIdentity !== action.immutableIdentity) {
    return reconciliation(action, 'satisfied', 'none', { ...evidence, replacementRetained: true });
  }
  if (resource.immutableIdentity !== action.immutableIdentity) return reconciliation(action, 'refused', 'identity_changed');
  return reconciliation(action, 'refused', 'postcondition_failed');
}

function observationFailure(observed, selectors, expectedFingerprint) {
  const structurallyInvalid = !observed || observed.complete !== true
    || !Array.isArray(observed.resources) || !Array.isArray(observed.ambiguities)
    || observed.ambiguities.length > 0 || !DIGEST.test(observed.daemonContextFingerprint ?? '')
    || !selectorsMatch(observed.selectors, selectors);
  if (structurallyInvalid) {
    return ambiguityFailure(Array.isArray(observed?.ambiguities) ? observed.ambiguities : []);
  }
  return expectedFingerprint !== undefined
    && observed.daemonContextFingerprint !== expectedFingerprint ? 'identity_changed' : null;
}

function scopedObservationFailure(action, resources) {
  const scoped = resources.every((resource) => resource?.resourceClass === action.resourceClass
    && resource.locator === action.locator && observedIdentityIsValid(action, resource));
  return !scoped || resources.length > 1 ? 'identity_changed' : null;
}

function absentEvidence(action, observed, registration) {
  return {
    contextFingerprint: observed.daemonContextFingerprint,
    resourceClass: action.resourceClass, locator: action.locator,
    immutableIdentity: action.immutableIdentity, postcondition: 'absent',
    ...(registration.proof ? {
      registrationId: registration.proof.registrationId,
      registrationMetadataDigest: registration.proof.metadataDigest,
      creationNonce: registration.proof.creationNonce,
    } : {}),
  };
}

/** Reconcile an exact Docker action using one bounded read-only observation. */
export async function reconcileDockerAction({
  action, mutationOutcome: _mutationOutcome, intentCheckpointDigest: _intentCheckpointDigest,
  signal, observeAction, loadVolumeRegistrationProof, expectedDaemonContextFingerprint,
}) {
  try { action = Object.freeze({ ...action }); validateAction(action); } catch {
    return reconciliation(action, 'ambiguous', 'query_failed');
  }
  const registration = await volumeProofFor(action, loadVolumeRegistrationProof, signal);
  if (registration.failureClass) return reconciliation(
    action, registration.failureClass === 'query_failed' ? 'ambiguous' : 'refused', registration.failureClass,
  );
  if (typeof observeAction !== 'function') return reconciliation(action, 'ambiguous', 'query_failed');
  let observed;
  const selectors = exactSelectors(action);
  try {
    observed = await observeAction(Object.freeze({ action, selectors, signal }));
  } catch {
    return reconciliation(action, 'ambiguous', 'query_failed');
  }
  const observedFailure = observationFailure(observed, selectors, expectedDaemonContextFingerprint);
  if (observedFailure) return reconciliation(action, 'ambiguous', observedFailure);
  const matches = observed.resources;
  const scopedFailure = scopedObservationFailure(action, matches);
  if (scopedFailure) return reconciliation(action, 'ambiguous', scopedFailure);
  if (matches.length === 0) return reconciliation(
    action, 'absent', 'none', absentEvidence(action, observed, registration),
  );
  return presentPostcondition(action, matches[0], observed.daemonContextFingerprint);
}

export function createDockerActionReconciler(options) {
  if (typeof options?.observeAction !== 'function') throw new TypeError('observeAction callback is required');
  return (request) => reconcileDockerAction({
    ...request, observeAction: options.observeAction,
    loadVolumeRegistrationProof: options.loadVolumeRegistrationProof,
    expectedDaemonContextFingerprint: options.expectedDaemonContextFingerprint,
  });
}
