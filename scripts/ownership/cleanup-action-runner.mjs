import { canonicalSha256 } from './canonical-json.mjs';
import { CLEANUP_FAILURE_CLASSES } from './schemas.mjs';
import { MAX_CLEANUP_ACTIONS } from './cleanup-journal-protocol.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const MUTATION_OUTCOMES = new Set([
  'success', 'command_failed', 'timeout', 'cancelled', 'output_limit',
  'command_unavailable', 'permission_denied', 'spawn_failed',
  'quiescence_failed', 'unknown',
]);
const RECONCILIATION_STATES = new Set(['satisfied', 'absent', 'refused', 'ambiguous']);
const ADVANCE_AFTER_UNCERTAIN = new Set(['timeout', 'output_limit', 'unknown']);
const CLEAN_FAILURES = new Set(CLEANUP_FAILURE_CLASSES);

function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new TypeError(`${label} must be a SHA-256 digest`);
  return value;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
  return value;
}

function validateActions(actions) {
  if (!Array.isArray(actions) || actions.length > MAX_CLEANUP_ACTIONS) throw new TypeError('actions must be a bounded array');
  const identities = new Set();
  actions.forEach((action, index) => {
    exactKeys(action, [
      'sequence', 'resourceClass', 'immutableIdentity', 'action', 'locatorKind',
      'locator', 'ownershipDigest', 'observationDigest', 'dependencyIdentities',
    ], `action ${index + 1}`);
    if (action.sequence !== index + 1) throw new TypeError('action sequences must be contiguous from one');
    for (const key of ['resourceClass', 'immutableIdentity', 'action', 'locatorKind', 'locator']) {
      if (typeof action[key] !== 'string' || action[key].length === 0 || action[key].length > 1024 || action[key].includes('\0')) {
        throw new TypeError(`action ${index + 1} ${key} is invalid`);
      }
    }
    digest(action.ownershipDigest, `action ${index + 1} ownershipDigest`);
    digest(action.observationDigest, `action ${index + 1} observationDigest`);
    if (!Array.isArray(action.dependencyIdentities) || action.dependencyIdentities.length > 512
        || action.dependencyIdentities.some((identity, dependencyIndex) => !DIGEST.test(identity)
          || (dependencyIndex > 0
            && action.dependencyIdentities[dependencyIndex - 1].localeCompare(identity) >= 0))) {
      throw new TypeError(`action ${index + 1} dependencyIdentities are invalid`);
    }
    const identity = `${action.resourceClass}:${action.immutableIdentity}:${action.action}`;
    if (identities.has(identity)) throw new TypeError('actions contain a duplicate mutation');
    identities.add(identity);
  });
}

function validateFailureClass(value) {
  return CLEAN_FAILURES.has(value) && value !== 'none' ? value : 'query_failed';
}

function authorityFailure(error) {
  return { state: 'ambiguous', failureClass: 'query_failed' };
}

function validateAuthorityRunning(row) {
  if ((row.resourceClass === 'compose_container' && typeof row.running !== 'boolean')
      || (row.resourceClass !== 'compose_container' && row.running !== null)) {
    throw new TypeError('eligible authority row running state is invalid');
  }
}

function validateAuthorityOwnership(row, action) {
  exactKeys(row.ownership, [
    'project', 'deploymentId', 'ownerId', 'resourceClass', 'lifecycle',
    'cleanupPolicy', 'createdAt', 'createdByRelease', 'createdByCommit',
    'creationRunId', 'immutableIdentity',
  ], 'eligible authority ownership');
  if (Object.values(row.ownership).some((value) => typeof value !== 'string' || value.length === 0 || value.length > 1024)
      || row.ownership.resourceClass !== action.resourceClass
      || row.ownership.immutableIdentity !== action.immutableIdentity
      || canonicalSha256(row.ownership) !== row.ownershipDigest) {
    throw new TypeError('eligible authority row ownership digest is invalid');
  }
}

function validateAuthorityEvidence(row, action) {
  if (row.locatorKind !== action.locatorKind || row.locator !== action.locator
      || !Array.isArray(row.references) || row.references.length > 512
      || row.references.some((value) => typeof value !== 'string' || value.length > 512)
      || !Array.isArray(row.dependencyIdentities) || row.dependencyIdentities.length > 512
      || row.dependencyIdentities.some((value, index) => !DIGEST.test(value)
        || (index > 0 && row.dependencyIdentities[index - 1].localeCompare(value) >= 0))
      || !Array.isArray(row.contentDigests) || row.contentDigests.length > 128
      || row.contentDigests.some((value) => typeof value !== 'string' || !DIGEST.test(value))) {
    throw new TypeError('eligible authority row locator or references are invalid');
  }
}

function validateAuthorityRow(row, action) {
  exactKeys(row, [
    'resourceClass', 'locatorKind', 'locator', 'immutableIdentity', 'ownership',
    'ownershipDigest', 'observationDigest', 'disposition', 'failureClasses',
    'references', 'contentDigests', 'dependencyIdentities', 'running', 'active', 'protected', 'data',
  ], 'eligible authority row');
  validateAuthorityOwnership(row, action);
  validateAuthorityEvidence(row, action);
  validateAuthorityRunning(row);
}

async function reload(reloadAuthority, action, phase, predecessorResultDigest, signal) {
  try {
    const response = await reloadAuthority(Object.freeze({
      action, phase, predecessorResultDigest, signal,
    }));
    if (response?.state === 'refused' || response?.state === 'ambiguous') {
      exactKeys(response, ['state', 'failureClass'], 'authority refusal');
      return { state: response.state, failureClass: validateFailureClass(response.failureClass) };
    }
    if (response?.state === 'absent') {
      exactKeys(response, ['state', 'postconditionDigest', 'derivedFromResultDigest'], 'authority absence');
      digest(response.postconditionDigest, 'authority absence postconditionDigest');
      if ((predecessorResultDigest === null && response.derivedFromResultDigest !== null)
          || (predecessorResultDigest !== null
            && response.derivedFromResultDigest !== predecessorResultDigest)) {
        return { state: 'refused', failureClass: 'identity_changed' };
      }
      return { ...response };
    }
    exactKeys(response, ['state', 'row', 'derivedFromResultDigest'], 'authority response');
    if (response.state !== 'eligible') throw new TypeError('authority state is not eligible');
    const row = response.row;
    validateAuthorityRow(row, action);
    if (row.disposition !== 'eligible' || !Array.isArray(row.failureClasses) || row.failureClasses.length !== 0
        || row.resourceClass !== action.resourceClass || row.immutableIdentity !== action.immutableIdentity
        || row.ownershipDigest !== action.ownershipDigest || row.active !== false
        || row.protected !== false || row.data !== false) {
      return { state: 'refused', failureClass: 'identity_changed' };
    }
    digest(row.observationDigest, 'authority observationDigest');
    const derived = response.derivedFromResultDigest;
    if (predecessorResultDigest === null) {
      if (derived !== null || row.observationDigest !== action.observationDigest) {
        return { state: 'refused', failureClass: 'identity_changed' };
      }
    } else if (derived !== predecessorResultDigest) {
      return { state: 'refused', failureClass: 'identity_changed' };
    }
    return { state: 'eligible', row, rowDigest: canonicalSha256(row), derivedFromResultDigest: derived };
  } catch (error) {
    return authorityFailure(error);
  }
}

function checkpointAck(value) {
  exactKeys(value, ['checkpointDigest', 'signed', 'synced'], 'checkpoint acknowledgement');
  digest(value.checkpointDigest, 'checkpointDigest');
  if (value.signed !== true || value.synced !== true) throw new Error('checkpoint is not signed and synced');
  return value.checkpointDigest;
}

async function append(appendCheckpoint, record) {
  return checkpointAck(await appendCheckpoint(Object.freeze(record)));
}

function predecessorDigest(actions, completed, index) {
  const action = actions[index];
  let requiredActions;
  if (action.resourceClass === 'compose_container' && action.action === 'remove') {
    const prior = actions[index - 1];
    requiredActions = prior?.resourceClass === 'compose_container' && prior.action === 'stop'
      && prior.immutableIdentity === action.immutableIdentity ? [prior] : [undefined];
  } else if (action.dependencyIdentities.length > 0) {
    requiredActions = action.dependencyIdentities.map((identity) => actions.slice(0, index)
      .findLast((candidate) => candidate.immutableIdentity === identity
        && (candidate.action === 'remove' || candidate.action === 'stop')));
  } else requiredActions = [];
  if (requiredActions.length === 0) return null;
  if (requiredActions.some((candidate) => candidate === undefined)) return undefined;
  const proof = requiredActions.map((candidate) => {
    const result = completed[candidate.sequence - 1];
    if (!['cleaned', 'absent'].includes(result?.result)
        || typeof result.resultCheckpointDigest !== 'string') return null;
    return {
      sequence: candidate.sequence, resourceClass: candidate.resourceClass,
      immutableIdentity: candidate.immutableIdentity, action: candidate.action,
      resultCheckpointDigest: result.resultCheckpointDigest,
    };
  });
  return proof.some((entry) => entry === null) ? undefined : canonicalSha256(proof);
}

function categoricalMutation(value) {
  if (value?.outcome === 'not_started' && CLEAN_FAILURES.has(value.refusalClass)
      && value.refusalClass !== 'none') {
    return { outcome: 'not_started', refusalClass: value.refusalClass };
  }
  return { outcome: MUTATION_OUTCOMES.has(value?.outcome) ? value.outcome : 'unknown', refusalClass: null };
}

async function mutateOnce(mutate, action, intentCheckpointDigest, signal, authority) {
  try {
    return categoricalMutation(await mutate(Object.freeze({
      action, intentCheckpointDigest, signal,
      predecessorResultDigest: authority.derivedFromResultDigest,
      authorityRowDigest: authority.rowDigest,
    })));
  } catch {
    return { outcome: 'unknown', refusalClass: null };
  }
}

async function reconcileOnce(reconcile, action, mutationOutcome, intentCheckpointDigest, signal) {
  try {
    const value = await reconcile(Object.freeze({ action, mutationOutcome, intentCheckpointDigest, signal }));
    exactKeys(value, ['state', 'resourceClass', 'immutableIdentity', 'postconditionDigest', 'failureClass'], 'reconciliation');
    if (!RECONCILIATION_STATES.has(value.state)
        || value.resourceClass !== action.resourceClass || value.immutableIdentity !== action.immutableIdentity) {
      throw new TypeError('reconciliation does not bind the exact action identity');
    }
    if (value.state === 'satisfied' || value.state === 'absent') {
      digest(value.postconditionDigest, 'postconditionDigest');
      if (value.failureClass !== 'none') throw new TypeError('satisfied reconciliation cannot have a failure');
    } else if (value.postconditionDigest !== null) throw new TypeError('failed reconciliation cannot assert a postcondition');
    return { ...value, failureClass: value.failureClass === 'none' ? 'none' : validateFailureClass(value.failureClass) };
  } catch {
    return {
      state: 'ambiguous', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: null,
      failureClass: 'query_failed',
    };
  }
}

function classify(mutationOutcome, reconciliation, refusalClass = null) {
  if (refusalClass) return { result: 'refused', failureClass: refusalClass, advance: false };
  const exact = reconciliation.state === 'satisfied' || reconciliation.state === 'absent';
  if (mutationOutcome === 'cancelled') return { result: 'failed', failureClass: 'cancelled', advance: false };
  if (mutationOutcome === 'quiescence_failed') return { result: 'ambiguous', failureClass: 'mutation_failed', advance: false };
  if (reconciliation.state === 'refused') return { result: 'refused', failureClass: reconciliation.failureClass, advance: false };
  if (!exact) return { result: 'ambiguous', failureClass: reconciliation.failureClass, advance: false };
  if (mutationOutcome === 'success' || ADVANCE_AFTER_UNCERTAIN.has(mutationOutcome)) {
    return { result: reconciliation.state === 'absent' ? 'absent' : 'cleaned', failureClass: 'none', advance: true };
  }
  return { result: 'failed', failureClass: 'mutation_failed', advance: false };
}

function publicResult(action, fields) {
  return Object.freeze({
    sequence: action.sequence,
    resourceClass: action.resourceClass,
    immutableIdentity: action.immutableIdentity,
    result: fields.result,
    failureClass: fields.failureClass,
    mutationOutcome: fields.mutationOutcome ?? 'not_started',
    reconciliationState: fields.reconciliationState ?? 'not_started',
    intentCheckpointDigest: fields.intentCheckpointDigest ?? null,
    resultCheckpointDigest: fields.resultCheckpointDigest ?? null,
    postconditionDigest: fields.postconditionDigest ?? null,
  });
}

function validatePriorResults(actions, priorResults) {
  if (!Array.isArray(priorResults) || priorResults.length > actions.length) {
    throw new TypeError('priorResults must be an initial bounded action-result prefix');
  }
  return priorResults.map((entry, index) => {
    const action = actions[index];
    exactKeys(entry, [
      'sequence', 'resourceClass', 'immutableIdentity', 'result', 'failureClass',
      'mutationOutcome', 'reconciliationState', 'intentCheckpointDigest',
      'resultCheckpointDigest', 'postconditionDigest',
    ], `prior result ${index + 1}`);
    if (entry.sequence !== action.sequence || entry.resourceClass !== action.resourceClass
        || entry.immutableIdentity !== action.immutableIdentity) {
      throw new TypeError('priorResults do not match the approved action prefix');
    }
    if (!['cleaned', 'absent', 'retained', 'refused', 'ambiguous', 'failed'].includes(entry.result)
        || !CLEAN_FAILURES.has(entry.failureClass)
        || (entry.mutationOutcome !== 'not_started' && !MUTATION_OUTCOMES.has(entry.mutationOutcome))
        || !['not_started', ...RECONCILIATION_STATES].includes(entry.reconciliationState)) {
      throw new TypeError('priorResults contain an invalid categorical result');
    }
    if (entry.intentCheckpointDigest !== null) digest(entry.intentCheckpointDigest, 'prior intentCheckpointDigest');
    digest(entry.resultCheckpointDigest, 'prior resultCheckpointDigest');
    if (entry.postconditionDigest !== null) digest(entry.postconditionDigest, 'prior postconditionDigest');
    return Object.freeze({ ...entry });
  });
}

async function recordResult(appendCheckpoint, action, fields) {
  const payload = {
    actionSequence: action.sequence,
    resourceClass: action.resourceClass, immutableIdentity: action.immutableIdentity,
    result: fields.result, failureClass: fields.failureClass,
    mutationOutcome: fields.mutationOutcome ?? 'not_started',
    reconciliationState: fields.reconciliationState ?? 'not_started',
    intentCheckpointDigest: fields.intentCheckpointDigest ?? null,
    postconditionDigest: fields.postconditionDigest ?? null,
  };
  try {
    const resultCheckpointDigest = await append(appendCheckpoint, {
      checkpointType: 'result', payload,
    });
    return { ...fields, resultCheckpointDigest };
  } catch {
    return { ...fields, result: 'ambiguous', failureClass: 'query_failed', advance: false, resultCheckpointDigest: null };
  }
}

/** Execute an approved action list once, serially and fail-stop. */
export async function runCleanupActions({
  actions, reloadAuthority, appendCheckpoint, mutate, reconcile, signal, priorResults = [],
} = {}) {
  validateActions(actions);
  for (const [name, callback] of Object.entries({ reloadAuthority, appendCheckpoint, mutate, reconcile })) {
    if (typeof callback !== 'function') throw new TypeError(`${name} callback is required`);
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal');
  const results = validatePriorResults(actions, priorResults);
  const priorHalted = results.some((entry) => !['cleaned', 'absent', 'retained'].includes(entry.result));
  for (let index = results.length; index < actions.length && !priorHalted; index += 1) {
    const action = actions[index];
    if (signal?.aborted) {
      const recorded = await recordResult(appendCheckpoint, action, {
        result: 'failed', failureClass: 'cancelled', advance: false,
      });
      results.push(publicResult(action, recorded));
      break;
    }
    const derived = predecessorDigest(actions, results, index);
    if (derived === undefined) {
      const recorded = await recordResult(appendCheckpoint, action, {
        result: 'refused', failureClass: 'identity_changed', advance: false,
      });
      results.push(publicResult(action, recorded));
      break;
    }
    const first = await reload(reloadAuthority, action, 'fresh_eligibility', derived, signal);
    if (!['eligible', 'absent'].includes(first.state)) {
      const recorded = await recordResult(appendCheckpoint, action, {
        result: first.state === 'refused' ? 'refused' : 'ambiguous',
        failureClass: first.failureClass, advance: false,
      });
      results.push(publicResult(action, recorded));
      break;
    }
    let intentCheckpointDigest;
    try {
      intentCheckpointDigest = await append(appendCheckpoint, {
        checkpointType: 'intent', payload: {
          actionSequence: action.sequence,
          resourceClass: action.resourceClass, immutableIdentity: action.immutableIdentity,
          action: action.action,
          authorityRowDigest: first.state === 'absent'
            ? first.postconditionDigest : first.rowDigest,
          predecessorResultDigest: derived, ownershipDigest: action.ownershipDigest,
          approvedObservationDigest: action.observationDigest,
          approvedActionDigest: canonicalSha256(action),
        },
      });
    } catch {
      results.push(publicResult(action, { result: 'ambiguous', failureClass: 'query_failed' }));
      break;
    }
    if (signal?.aborted) {
      const recorded = await recordResult(appendCheckpoint, action, {
        result: 'failed', failureClass: 'cancelled', advance: false, intentCheckpointDigest,
      });
      results.push(publicResult(action, recorded));
      break;
    }
    const second = await reload(reloadAuthority, action, 'pre_mutation_reinspection', derived, signal);
    if (first.state === 'absent') {
      const stableAbsence = second.state === 'absent'
        && second.postconditionDigest === first.postconditionDigest;
      const recorded = await recordResult(appendCheckpoint, action, stableAbsence ? {
        result: 'absent', failureClass: 'none', advance: true,
        reconciliationState: 'absent', intentCheckpointDigest,
        postconditionDigest: second.postconditionDigest,
      } : {
        result: second.state === 'ambiguous' ? 'ambiguous' : 'refused',
        failureClass: ['refused', 'ambiguous'].includes(second.state)
          ? second.failureClass : 'identity_changed',
        advance: false, intentCheckpointDigest,
      });
      results.push(publicResult(action, recorded));
      if (!recorded.advance) break;
      continue;
    }
    if (second.state !== 'eligible' || second.rowDigest !== first.rowDigest) {
      const recorded = await recordResult(appendCheckpoint, action, {
        result: second.state === 'refused' ? 'refused' : 'ambiguous',
        failureClass: ['refused', 'ambiguous'].includes(second.state)
          ? second.failureClass : 'identity_changed',
        advance: false, intentCheckpointDigest,
      });
      results.push(publicResult(action, recorded));
      break;
    }
    if (signal?.aborted) {
      const recorded = await recordResult(appendCheckpoint, action, {
        result: 'failed', failureClass: 'cancelled', advance: false, intentCheckpointDigest,
      });
      results.push(publicResult(action, recorded));
      break;
    }
    const mutation = await mutateOnce(
      mutate, action, intentCheckpointDigest, signal, second,
    );
    const reconciliation = mutation.refusalClass ? {
      state: 'refused', resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, postconditionDigest: null,
      failureClass: mutation.refusalClass,
    } : await reconcileOnce(reconcile, action, mutation.outcome, intentCheckpointDigest, signal);
    const classified = classify(mutation.outcome, reconciliation, mutation.refusalClass);
    const recorded = await recordResult(appendCheckpoint, action, {
      ...classified, mutationOutcome: mutation.outcome, reconciliationState: reconciliation.state,
      intentCheckpointDigest, postconditionDigest: reconciliation.postconditionDigest,
    });
    results.push(publicResult(action, recorded));
    if (!recorded.advance) break;
  }
  const processedActionCount = results.length;
  const stopped = results.at(-1);
  let journalComplete = actions.length === 0 || stopped?.resultCheckpointDigest !== null;
  if (journalComplete && processedActionCount < actions.length) {
    for (const action of actions.slice(processedActionCount)) {
      const recorded = await recordResult(appendCheckpoint, action, {
        result: 'refused', failureClass: stopped?.failureClass ?? 'query_failed', advance: false,
      });
      results.push(publicResult(action, recorded));
      if (recorded.resultCheckpointDigest === null) {
        journalComplete = false;
        break;
      }
    }
  }
  const completed = processedActionCount === actions.length
    && results.every((entry) => ['cleaned', 'absent'].includes(entry.result));
  const terminalState = journalComplete && completed ? 'completed' : (stopped?.result ?? 'completed');
  return Object.freeze({ terminalState, processedActionCount, journalComplete, results: Object.freeze(results) });
}
