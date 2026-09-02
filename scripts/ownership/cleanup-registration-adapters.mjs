import { inspectRegisteredLocator, readRegistrations } from './registration.mjs';

export const READ_ONLY_REGISTRATION_CLASSES = Object.freeze([
  'collector_process',
  'git_worktree',
  'temporary_artifact',
  'cleanup_evidence',
  'provider_publication',
]);

const READ_ONLY_CLASSES = new Set(READ_ONLY_REGISTRATION_CLASSES);
const RETAIN_CLASSES = new Set(['cleanup_evidence', 'provider_publication']);
const LOCAL_PATH_CLASSES = new Set(['temporary_artifact', 'cleanup_evidence']);
export const HOST_EXECUTION_CLASSES = Object.freeze([
  'collector_process', 'git_worktree', 'temporary_artifact',
]);
const HOST_CLASSES = new Set(HOST_EXECUTION_CLASSES);
const OBSERVATION_STATES = new Set(['current', 'missing', 'identity_changed', 'ambiguous', 'unverified']);

function defaultObservation(registration) {
  if (LOCAL_PATH_CLASSES.has(registration.resourceClass) && registration.locatorKind === 'path') {
    return inspectRegisteredLocator(registration);
  }
  return { state: 'unverified', error: 'no read-only inspector for the registered locator kind' };
}

function normalizeObservation(registration, observation) {
  if (!observation || typeof observation !== 'object' || !OBSERVATION_STATES.has(observation.state)) {
    return { state: 'ambiguous', error: 'registration inspector returned an invalid observation' };
  }
  if (observation.state === 'current'
      && observation.immutableIdentity !== registration.immutableIdentity) {
    return {
      state: 'identity_changed',
      immutableIdentity: observation.immutableIdentity ?? 'missing-observed-identity',
    };
  }
  return observation;
}

function observeRegistration(registration, inspectors) {
  const inspect = inspectors[registration.resourceClass];
  try {
    return normalizeObservation(registration, inspect ? inspect(registration) : defaultObservation(registration));
  } catch (error) {
    return { state: 'ambiguous', error: error.message };
  }
}

function hostDisposition(registration, observation) {
  if (registration.schemaVersion !== '1.1.0' || !registration.executionAuthority) {
    return { disposition: 'refused', reason: `${registration.resourceClass} lacks v1.1 execution authority` };
  }
  if (observation.active === true) {
    return { disposition: 'refused', reason: `${registration.resourceClass} creator run is active` };
  }
  if (observation.state === 'current' && observation.executable === true) {
    return { disposition: 'eligible', reason: `${registration.resourceClass} exact execution authority is terminal` };
  }
  const suffix = observation.state === 'current' ? 'execution authority is incomplete'
    : `identity is ${observation.state}`;
  return { disposition: 'refused', reason: `${registration.resourceClass} ${suffix}` };
}

function disposition(registration, observation) {
  if (observation.state === 'missing') return { disposition: 'absent', reason: 'registered locator is absent' };
  if (HOST_CLASSES.has(registration.resourceClass)) return hostDisposition(registration, observation);
  if (observation.state === 'ambiguous' || observation.state === 'unverified') {
    return { disposition: 'ambiguous', reason: observation.error ?? 'registered locator could not be verified' };
  }
  if (observation.state === 'identity_changed') {
    return { disposition: 'refused', reason: 'registered immutable identity changed' };
  }
  if (RETAIN_CLASSES.has(registration.resourceClass)) {
    return { disposition: 'retain', reason: `${registration.resourceClass} is immutable retained evidence` };
  }
  return { disposition: 'refused', reason: `${registration.resourceClass} cleanup is not enabled` };
}

export function classifyCleanupRegistration(registration, { inspectors = {} } = {}) {
  if (!READ_ONLY_CLASSES.has(registration.resourceClass)) {
    throw new Error(`unsupported read-only registration class: ${registration.resourceClass}`);
  }
  const observation = observeRegistration(registration, inspectors);
  const decision = disposition(registration, observation);
  return {
    registration,
    observation,
    ...decision,
    executable: decision.disposition === 'eligible' && observation.executable === true,
  };
}

export function readCleanupRegistrationAdapters(root, { resourceClasses = READ_ONLY_REGISTRATION_CLASSES, inspectors = {} } = {}) {
  if (!Array.isArray(resourceClasses) || resourceClasses.some((entry) => !READ_ONLY_CLASSES.has(entry))) {
    throw new Error('resourceClasses contains an unsupported read-only registration class');
  }
  const selected = new Set(resourceClasses);
  return readRegistrations(root)
    .filter((registration) => selected.has(registration.resourceClass))
    .map((registration) => classifyCleanupRegistration(registration, { inspectors }));
}
