import { createHash } from 'node:crypto';
import { replayOwnershipLabels } from './wallet-sync-replay-ownership.mjs';

function missingDockerIdentity(error) {
  const detail = `${error instanceof Error ? error.message : String(error)}\n${error?.stderr ?? ''}`;
  return /no such (?:object|container|network):|network .* not found/i.test(detail);
}

const INSPECT_ATTEMPTS = 3;
const INSPECT_RETRY_DELAY_MS = 500;

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// The first stderr line of a daemon error, bounded, for the upload-safe
// evidence. Daemon errors name resources and sockets, never secrets.
function failureDetail(error) {
  const text = `${error?.stderr ?? ''}\n${error instanceof Error ? error.message : String(error)}`;
  const line = text.split('\n').map((part) => part.trim())
    .find((part) => part !== '' && !/^Command failed:/.test(part)) ?? 'unknown error';
  return line.slice(0, 200);
}

function inspectCleanupIdentity(resource, operations) {
  const command = resource.resourceClass === 'compose_network'
    ? ['docker', 'network', 'inspect', resource.immutableIdentity]
    : ['docker', 'container', 'inspect', resource.immutableIdentity];
  const sleep = operations.sleep ?? sleepMs;
  let lastError;
  for (let attempt = 1; attempt <= INSPECT_ATTEMPTS; attempt += 1) {
    try {
      return inspectOnce(resource, command, operations);
    } catch (error) {
      if (missingDockerIdentity(error)) return { state: 'absent' };
      lastError = error;
      if (attempt < INSPECT_ATTEMPTS) sleep(INSPECT_RETRY_DELAY_MS);
    }
  }
  return { state: 'ambiguous', failureClass: 'query_failed', failureDetail: failureDetail(lastError) };
}

function inspectOnce(resource, command, operations) {
  {
    const output = JSON.parse(String(operations.run(command) ?? ''));
    if (!Array.isArray(output) || output.length !== 1) {
      return { state: 'ambiguous', failureClass: 'malformed' };
    }
    const [inspected] = output;
    if (inspected.Id !== resource.immutableIdentity) {
      return { state: 'current', failureClass: 'identity_changed' };
    }
    const expectedName = resource.resourceClass === 'compose_network'
      ? resource.name : `/${resource.name}`;
    const labels = resource.resourceClass === 'compose_network'
      ? inspected.Labels : inspected.Config?.Labels;
    const expectedLabels = replayOwnershipLabels(resource.resourceClass);
    const labelsMatch = expectedLabels.every((value, index) => (
      value !== '--label' || labels?.[expectedLabels[index + 1].split('=', 1)[0]]
        === expectedLabels[index + 1].slice(expectedLabels[index + 1].indexOf('=') + 1)
    ));
    if (!resource.name || inspected.Name !== expectedName || !labelsMatch) {
      return { state: 'current', failureClass: 'ownership_changed' };
    }
    return { state: 'current', immutableIdentity: inspected.Id };
  }
}

function cleanupAction(resource, sequence) {
  const ownershipDigest = createHash('sha256')
    .update(`${resource.resourceClass}\0${resource.immutableIdentity}`).digest('hex');
  return {
    sequence,
    resourceClass: resource.resourceClass,
    immutableIdentity: resource.immutableIdentity,
    action: 'remove',
    locatorKind: 'engine_id',
    locator: resource.immutableIdentity,
    ownershipDigest,
    observationDigest: ownershipDigest,
  };
}

function removeCleanupResource(resource, operations) {
  const command = resource.resourceClass === 'compose_network'
    ? ['docker', 'network', 'rm', resource.immutableIdentity]
    : ['docker', 'rm', '--force', resource.immutableIdentity];
  operations.run(command);
}

function cleanupResult(action, result, failureClass = 'none', detail = undefined) {
  return {
    sequence: action.sequence,
    resourceClass: action.resourceClass,
    immutableIdentity: action.immutableIdentity,
    result,
    failureClass,
    ...(detail === undefined ? {} : { failureDetail: detail }),
  };
}

function executeCleanupAction(action, resource, operations) {
  if (!['compose_container', 'compose_network'].includes(resource.resourceClass)) {
    return cleanupResult(action, 'ambiguous', 'unsupported');
  }
  const observed = inspectCleanupIdentity(resource, operations);
  if (observed.state === 'absent') return cleanupResult(action, 'absent');
  if (observed.state === 'ambiguous') {
    return cleanupResult(action, 'ambiguous', observed.failureClass, observed.failureDetail);
  }
  if (observed.failureClass) {
    return cleanupResult(action, 'ambiguous', observed.failureClass);
  }
  if (observed.immutableIdentity !== resource.immutableIdentity) {
    return cleanupResult(action, 'ambiguous', 'identity_changed');
  }
  let mutationFailed = false;
  try {
    removeCleanupResource(resource, operations);
  } catch {
    mutationFailed = true;
  }
  const postcondition = inspectCleanupIdentity(resource, operations);
  if (postcondition.state === 'absent') return cleanupResult(action, 'cleaned');
  const failureClass = postcondition.state === 'ambiguous'
    ? postcondition.failureClass : mutationFailed ? 'mutation_failed' : 'postcondition_failed';
  return cleanupResult(action, 'ambiguous', failureClass, postcondition.failureDetail);
}

export function cleanup(resources, operations) {
  const orderedResources = [...resources].sort((left, right) => (
    Number(left.resourceClass === 'compose_network')
      - Number(right.resourceClass === 'compose_network')
  ));
  const actions = orderedResources.map((resource, index) => cleanupAction(resource, index + 1));
  const results = [];
  let progressionBlocked = false;
  actions.forEach((action, index) => {
    if (progressionBlocked) {
      results.push(cleanupResult(action, 'refused', 'blocked_by_prior_failure'));
      return;
    }
    const result = executeCleanupAction(action, orderedResources[index], operations);
    results.push(result);
    progressionBlocked = !['cleaned', 'absent'].includes(result.result);
  });
  const postconditions = results.map(result => ({
    sequence: result.sequence,
    resourceClass: result.resourceClass,
    immutableIdentity: result.immutableIdentity,
    result: ['cleaned', 'absent'].includes(result.result) ? 'absent' : 'ambiguous',
    failureClass: result.failureClass,
  }));
  const failureClasses = [...new Set(results
    .map(result => result.failureClass).filter(failureClass => failureClass !== 'none'))].sort();
  return {
    schemaVersion: '1.0.0',
    artifactType: 'replay_cleanup_evidence',
    state: failureClasses.length === 0 ? (actions.length === 0 ? 'no_op' : 'cleaned') : 'partial',
    actions,
    results,
    postconditions,
    failureClasses,
  };
}

function emptyCleanupCounts(total) {
  return { total, cleaned: 0, retained: 0, refused: 0, ambiguous: 0 };
}

export function buildReplayCleanupEvidence(cleanupOutcome, rawEvidence) {
  const resultCounts = emptyCleanupCounts(cleanupOutcome.results.length);
  cleanupOutcome.results.forEach(result => {
    if (['cleaned', 'absent'].includes(result.result)) resultCounts.cleaned += 1;
    else if (result.result === 'retained') resultCounts.retained += 1;
    else if (result.result === 'refused') resultCounts.refused += 1;
    else resultCounts.ambiguous += 1;
  });
  const failureDetails = cleanupOutcome.results
    .filter(result => result.failureDetail !== undefined)
    .map(result => ({
      sequence: result.sequence, resourceClass: result.resourceClass,
      failureClass: result.failureClass, detail: result.failureDetail,
    }));
  return {
    schemaVersion: '1.0.0',
    artifactType: 'replay_cleanup_evidence',
    evidenceAuthority: 'unsigned_subject_evidence',
    state: cleanupOutcome.state,
    resourceCounts: { ...resultCounts },
    resultCounts,
    failureClasses: cleanupOutcome.failureClasses,
    ...(failureDetails.length === 0 ? {} : { failureDetails }),
    rawEvidence,
  };
}
