import { URL } from 'node:url';

const ACTION_KEYS = Object.freeze([
  'sequence', 'resourceClass', 'immutableIdentity', 'action', 'locatorKind',
  'locator', 'ownershipDigest', 'observationDigest',
]);

const SUPERVISOR_OUTCOMES = new Set([
  'success', 'command_failed', 'timeout', 'cancelled', 'output_limit',
  'command_unavailable', 'permission_denied', 'spawn_failed', 'quiescence_failed',
]);

const EXACT_ENGINE_ID = /^[a-f0-9]{64}$/;
const EXACT_IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(', ')}`);
  }
  return value;
}

function validateDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
}

function validateBaseAction(action) {
  exactObject(action, ACTION_KEYS, 'cleanup action');
  if (!Number.isSafeInteger(action.sequence) || action.sequence < 1) {
    throw new TypeError('cleanup action sequence must be a positive integer');
  }
  for (const key of ['resourceClass', 'immutableIdentity', 'action', 'locatorKind', 'locator']) {
    if (typeof action[key] !== 'string' || action[key].length === 0 || action[key].includes('\0')) {
      throw new TypeError(`cleanup action ${key} must be a nonempty string without NUL bytes`);
    }
  }
  validateDigest(action.ownershipDigest, 'cleanup action ownershipDigest');
  validateDigest(action.observationDigest, 'cleanup action observationDigest');
}

function validateEngineIdAction(action, allowedAction) {
  if (action.action !== allowedAction) {
    throw new TypeError(`${action.resourceClass} does not permit ${action.action}`);
  }
  if (action.locatorKind !== 'engine_id') {
    throw new TypeError(`${action.resourceClass} mutation requires an engine_id locator`);
  }
  if (!EXACT_ENGINE_ID.test(action.locator) || action.immutableIdentity !== action.locator) {
    throw new TypeError(`${action.resourceClass} mutation requires its exact 64-hex immutable ID`);
  }
}

function validateImageAction(action) {
  if (action.action !== 'remove') throw new TypeError(`oci_image does not permit ${action.action}`);
  if (action.locatorKind !== 'engine_id') throw new TypeError('oci_image mutation requires an engine_id locator');
  if (!EXACT_IMAGE_ID.test(action.locator) || action.immutableIdentity !== action.locator) {
    throw new TypeError('oci_image mutation requires its exact sha256 immutable ID');
  }
}

function validateVolumeProof(action, proof) {
  const keys = [
    'locator', 'observedFingerprint', 'registeredCreationNonce',
    'observedCreationNonce', 'observedOwnershipDigest', 'attachmentCount',
  ];
  exactObject(proof, keys, 'fresh volume proof');
  if (!VOLUME_NAME.test(action.locator)) throw new TypeError('compose_volume locator is not an exact volume name');
  if (proof.locator !== action.locator) throw new TypeError('fresh volume proof locator does not match the action');
  if (proof.observedFingerprint !== action.immutableIdentity || !DIGEST.test(proof.observedFingerprint)) {
    throw new TypeError('fresh volume fingerprint does not match the approved identity');
  }
  if (proof.observedOwnershipDigest !== action.ownershipDigest) {
    throw new TypeError('fresh volume ownership does not match the approved ownership');
  }
  if (typeof proof.registeredCreationNonce !== 'string' || proof.registeredCreationNonce.length === 0
      || proof.registeredCreationNonce.includes('\0')
      || proof.observedCreationNonce !== proof.registeredCreationNonce) {
    throw new TypeError('fresh volume creation nonce does not match its registration');
  }
  if (proof.attachmentCount !== 0) throw new TypeError('compose_volume mutation requires zero fresh attachments');
}

function validateVolumeAction(action, proof) {
  if (action.action !== 'remove') throw new TypeError(`compose_volume does not permit ${action.action}`);
  if (action.locatorKind !== 'name') throw new TypeError('compose_volume mutation requires a name locator');
  if (!DIGEST.test(action.immutableIdentity)) {
    throw new TypeError('compose_volume immutable identity must be a fingerprint digest');
  }
  validateVolumeProof(action, proof);
}

function frozenArgs(...values) {
  return Object.freeze(values);
}

function invalidGlobalArgsShape(engine, values) {
  return !Array.isArray(values) || values.length !== 2
    || values[0] !== (engine === 'docker' ? '--host' : '--url')
    || typeof values[1] !== 'string' || values[1].length > 2048
    || !values[1].startsWith('unix:///') || values[1].includes('\0') || /\s/.test(values[1]);
}

function invalidEndpoint(endpoint) {
  return endpoint.protocol !== 'unix:' || !endpoint.pathname.startsWith('/')
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash;
}

function globalArgs(engine, values) {
  if (invalidGlobalArgsShape(engine, values)) {
    throw new TypeError('engineGlobalArgs must pin one exact local Docker or Podman endpoint');
  }
  let endpoint;
  try { endpoint = new URL(values[1]); } catch {
    throw new TypeError('engineGlobalArgs must pin one exact local Docker or Podman endpoint');
  }
  if (invalidEndpoint(endpoint)) {
    throw new TypeError('engineGlobalArgs must pin one exact local Docker or Podman endpoint');
  }
  return values;
}

function mutationArgs(action, freshVolumeProof) {
  if (action.resourceClass === 'compose_container') {
    if (!['stop', 'remove'].includes(action.action)) throw new TypeError(`compose_container does not permit ${action.action}`);
    validateEngineIdAction(action, action.action);
    return frozenArgs('container', action.action === 'stop' ? 'stop' : 'rm', action.locator);
  }
  if (action.resourceClass === 'compose_network') {
    validateEngineIdAction(action, 'remove');
    return frozenArgs('network', 'rm', action.locator);
  }
  if (action.resourceClass === 'compose_volume') {
    validateVolumeAction(action, freshVolumeProof);
    return frozenArgs('volume', 'rm', action.locator);
  }
  if (action.resourceClass === 'oci_image') {
    validateImageAction(action);
    return frozenArgs('image', 'rm', action.locator);
  }
  throw new TypeError(`${action.resourceClass} has no Docker mutation adapter`);
}

function postconditionFor(action) {
  if (action.resourceClass === 'compose_container' && action.action === 'stop') {
    return Object.freeze({
      kind: 'exact_container_stopped_or_absent',
      resourceClass: action.resourceClass,
      locatorKind: 'engine_id',
      locator: action.locator,
      immutableIdentity: action.immutableIdentity,
      queryArgs: frozenArgs('container', 'inspect', action.locator),
      satisfiedBy: Object.freeze(['absent', 'same_identity_stopped']),
    });
  }
  if (action.resourceClass === 'compose_volume') {
    return Object.freeze({
      kind: 'approved_volume_fingerprint_absent',
      resourceClass: action.resourceClass,
      locatorKind: 'name',
      locator: action.locator,
      immutableIdentity: action.immutableIdentity,
      queryArgs: frozenArgs('volume', 'inspect', action.locator),
      satisfiedBy: Object.freeze(['absent', 'different_fingerprint_at_name']),
    });
  }
  const noun = action.resourceClass === 'compose_container' ? 'container'
    : action.resourceClass === 'compose_network' ? 'network' : 'image';
  return Object.freeze({
    kind: 'exact_immutable_id_absent',
    resourceClass: action.resourceClass,
    locatorKind: 'engine_id',
    locator: action.locator,
    immutableIdentity: action.immutableIdentity,
    queryArgs: frozenArgs(noun, 'inspect', action.locator),
    satisfiedBy: Object.freeze(['absent']),
  });
}

/** Build the only Docker/Podman mutation argv forms admitted by cleanup execution. */
export function buildDockerMutation(action, { engine = 'docker', freshVolumeProof, engineGlobalArgs } = {}) {
  validateBaseAction(action);
  if (!['docker', 'podman'].includes(engine)) {
    throw new TypeError('engine must be the canonical docker or podman executable');
  }
  const mutation = mutationArgs(action, freshVolumeProof);
  const args = engineGlobalArgs === undefined
    ? mutation : frozenArgs(...globalArgs(engine, engineGlobalArgs), ...mutation);
  return Object.freeze({ engine, args, postcondition: postconditionFor(action) });
}

/** Return the exact read-only probe contract for an already validated action. */
export function buildDockerPostcondition(action, options = {}) {
  return buildDockerMutation(action, options).postcondition;
}

function categoricalResult(result) {
  const outcome = SUPERVISOR_OUTCOMES.has(result?.outcome) ? result.outcome : 'quiescence_failed';
  return Object.freeze({ outcome, reconciliationRequired: true });
}

/** Execute one exact mutation through an injected bounded process supervisor. */
export async function executeDockerMutation(action, {
  engine = 'docker', supervisor, supervisorOptions, freshVolumeProof, engineGlobalArgs,
} = {}) {
  if (typeof supervisor !== 'function') throw new TypeError('a cleanup mutation supervisor is required');
  const command = buildDockerMutation(action, { engine, freshVolumeProof, engineGlobalArgs });
  try {
    return categoricalResult(await supervisor(command.engine, command.args, supervisorOptions));
  } catch {
    // Once supervision is entered, an exception cannot prove whether the daemon
    // accepted the request. Treat it as ambiguous and require reconciliation.
    return categoricalResult(null);
  }
}
