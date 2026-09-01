import { canonicalSha256 } from './canonical-json.mjs';
import {
  CLEANUP_FAILURE_CLASSES, CLEANUP_RESULTS, CLEANUP_STATES,
} from './cleanup-schema-contract.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
export const MAX_CLEANUP_ACTIONS = 3_000;
const ACTION_RESULTS = new Set(CLEANUP_RESULTS.filter((value) => value !== 'pending'));
const FAILURE_CLASSES = new Set(CLEANUP_FAILURE_CLASSES);
const MUTATION_OUTCOMES = new Set([
  'not_started', 'success', 'command_failed', 'timeout', 'cancelled', 'output_limit',
  'command_unavailable', 'permission_denied', 'spawn_failed', 'quiescence_failed', 'unknown',
]);
const RECONCILIATION_STATES = new Set(['not_started', 'satisfied', 'absent', 'refused', 'ambiguous']);
const TERMINAL_OUTCOMES = new Set(CLEANUP_STATES.filter((value) => value !== 'dry_run'));

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error(`${label} fields are invalid`);
  }
}

function digest(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (!DIGEST.test(value ?? '')) throw new Error(`${label} must be a SHA-256 digest`);
}

function positive(value, label, { zero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw new Error(`${label} is invalid`);
}

function token(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+~-]{0,511}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function validateGenesis(payload) {
  exact(payload, [
    'actionCount', 'actionDigests', 'actionsDigest', 'contextFingerprint', 'deploymentManifestDigest',
    'inventoryBeforeDigest', 'planDigest', 'runManifestDigest', 'subjectExitStatus',
  ], 'genesis payload');
  positive(payload.actionCount, 'genesis actionCount', { zero: true });
  if (payload.actionCount > MAX_CLEANUP_ACTIONS || !Array.isArray(payload.actionDigests)
      || payload.actionDigests.length !== payload.actionCount) {
    throw new Error('genesis actionDigests do not match the bounded action count');
  }
  payload.actionDigests.forEach((value, index) => digest(value, `genesis actionDigests[${index}]`));
  if (payload.actionsDigest !== canonicalSha256(payload.actionDigests)) {
    throw new Error('genesis actionsDigest does not bind actionDigests');
  }
  for (const key of [
    'actionsDigest', 'contextFingerprint', 'deploymentManifestDigest',
    'inventoryBeforeDigest', 'planDigest', 'runManifestDigest',
  ]) digest(payload[key], `genesis ${key}`);
  if (payload.subjectExitStatus !== null && (!Number.isSafeInteger(payload.subjectExitStatus)
      || payload.subjectExitStatus < 0 || payload.subjectExitStatus > 255)) {
    throw new Error('genesis subjectExitStatus is invalid');
  }
}

function validateIntent(payload) {
  exact(payload, [
    'action', 'actionSequence', 'approvedActionDigest', 'approvedObservationDigest', 'authorityRowDigest',
    'immutableIdentity', 'ownershipDigest', 'predecessorResultDigest', 'resourceClass',
  ], 'intent payload');
  positive(payload.actionSequence, 'intent actionSequence');
  for (const key of ['action', 'immutableIdentity', 'resourceClass']) token(payload[key], `intent ${key}`);
  for (const key of ['approvedActionDigest', 'approvedObservationDigest', 'authorityRowDigest', 'ownershipDigest']) {
    digest(payload[key], `intent ${key}`);
  }
  digest(payload.predecessorResultDigest, 'intent predecessorResultDigest', true);
}

function validateResult(payload) {
  exact(payload, [
    'actionSequence', 'failureClass', 'immutableIdentity', 'intentCheckpointDigest',
    'mutationOutcome', 'postconditionDigest', 'reconciliationState', 'resourceClass', 'result',
  ], 'result payload');
  positive(payload.actionSequence, 'result actionSequence');
  token(payload.resourceClass, 'result resourceClass');
  token(payload.immutableIdentity, 'result immutableIdentity');
  if (!ACTION_RESULTS.has(payload.result)) throw new Error('result payload result is invalid');
  if (!FAILURE_CLASSES.has(payload.failureClass)) throw new Error('result payload failureClass is invalid');
  if (!MUTATION_OUTCOMES.has(payload.mutationOutcome)) throw new Error('result payload mutationOutcome is invalid');
  if (!RECONCILIATION_STATES.has(payload.reconciliationState)) throw new Error('result payload reconciliationState is invalid');
  digest(payload.intentCheckpointDigest, 'result intentCheckpointDigest', true);
  digest(payload.postconditionDigest, 'result postconditionDigest', true);
  const successful = ['cleaned', 'absent', 'retained'].includes(payload.result);
  if (successful !== (payload.failureClass === 'none')) throw new Error('result payload result and failureClass are inconsistent');
  if (['satisfied', 'absent'].includes(payload.reconciliationState) !== (payload.postconditionDigest !== null)) {
    throw new Error('result payload reconciliation and postcondition are inconsistent');
  }
  if (payload.intentCheckpointDigest === null
      && (payload.mutationOutcome !== 'not_started' || payload.reconciliationState !== 'not_started')) {
    throw new Error('a result without intent cannot claim mutation or reconciliation');
  }
  if (successful && (payload.intentCheckpointDigest === null || payload.mutationOutcome === 'not_started'
      || !['satisfied', 'absent'].includes(payload.reconciliationState)
      || payload.postconditionDigest === null)) {
    throw new Error('a successful result requires an exact mutation intent and postcondition');
  }
}

function validateReconciliation(payload) {
  exact(payload, [
    'actionSequence', 'failureClass', 'immutableIdentity', 'intentCheckpointDigest',
    'postconditionDigest', 'resourceClass', 'state',
  ], 'reconciliation payload');
  positive(payload.actionSequence, 'reconciliation actionSequence');
  token(payload.resourceClass, 'reconciliation resourceClass');
  token(payload.immutableIdentity, 'reconciliation immutableIdentity');
  digest(payload.intentCheckpointDigest, 'reconciliation intentCheckpointDigest');
  if (!RECONCILIATION_STATES.has(payload.state) || payload.state === 'not_started') {
    throw new Error('reconciliation payload state is invalid');
  }
  if (!FAILURE_CLASSES.has(payload.failureClass)) throw new Error('reconciliation payload failureClass is invalid');
  digest(payload.postconditionDigest, 'reconciliation postconditionDigest', true);
}

function validateRecovery(payload) {
  exact(payload, [
    'controllerRunId', 'deploymentLockObservationDigest', 'originalOperationRunId',
    'priorJournalHeadDigest', 'projectLockObservationDigest',
  ], 'recovery payload');
  token(payload.controllerRunId, 'recovery controllerRunId');
  token(payload.originalOperationRunId, 'recovery originalOperationRunId');
  for (const key of ['deploymentLockObservationDigest', 'priorJournalHeadDigest', 'projectLockObservationDigest']) {
    digest(payload[key], `recovery ${key}`);
  }
}

function validateCancellation(payload) {
  exact(payload, ['processedActionCount', 'reason'], 'cancellation payload');
  positive(payload.processedActionCount, 'cancellation processedActionCount', { zero: true });
  if (!['interrupt', 'termination', 'hangup', 'abort'].includes(payload.reason)) {
    throw new Error('cancellation payload reason is invalid');
  }
}

function validateTerminal(payload) {
  exact(payload, [
    'inventoryAfterDigest', 'operationEndedAt', 'operationStartedAt',
    'postconditionsDigest', 'receiptCoreFinalizedAt', 'refusalsDigest',
    'resultsDigest', 'subjectExitStatus', 'terminalOutcome',
  ], 'terminal payload');
  for (const key of ['inventoryAfterDigest', 'postconditionsDigest', 'refusalsDigest', 'resultsDigest']) {
    digest(payload[key], `terminal ${key}`);
  }
  if (!TERMINAL_OUTCOMES.has(payload.terminalOutcome)) throw new Error('terminal outcome is invalid');
  for (const key of ['operationStartedAt', 'operationEndedAt', 'receiptCoreFinalizedAt']) {
    const timestamp = new Date(payload[key]);
    if (typeof payload[key] !== 'string' || Number.isNaN(timestamp.getTime())
        || timestamp.toISOString() !== payload[key]) {
      throw new Error(`terminal ${key} is invalid`);
    }
  }
  if (payload.subjectExitStatus !== null && (!Number.isSafeInteger(payload.subjectExitStatus)
      || payload.subjectExitStatus < 0 || payload.subjectExitStatus > 255)) {
    throw new Error('terminal subjectExitStatus is invalid');
  }
}

export function validateCheckpointPayload(checkpointType, payload) {
  if (checkpointType === 'genesis') validateGenesis(payload);
  else if (checkpointType === 'intent') validateIntent(payload);
  else if (checkpointType === 'result') validateResult(payload);
  else if (checkpointType === 'reconciliation') validateReconciliation(payload);
  else if (checkpointType === 'recovery') validateRecovery(payload);
  else if (checkpointType === 'cancellation') validateCancellation(payload);
  else if (checkpointType === 'terminal') validateTerminal(payload);
  else throw new Error('cleanup journal checkpoint type is invalid');
}

function sameAction(left, right) {
  return left.actionSequence === right.actionSequence
    && left.resourceClass === right.resourceClass
    && left.immutableIdentity === right.immutableIdentity;
}

function protocolState(genesis) {
  return {
    genesis, nextAction: 1, openIntent: null, halted: false,
    terminal: false, recoverySeen: false, cancellationSeen: false, results: [],
  };
}

function handleRecovery(state, checkpoint) {
  const { payload } = checkpoint;
  if (payload.priorJournalHeadDigest !== checkpoint.previousDigest
      || payload.originalOperationRunId !== state.genesis.operationRunId) {
    throw new Error('cleanup journal recovery checkpoint binding is invalid');
  }
  state.recoverySeen = true;
}

function handleCancellation(state) {
  if (state.openIntent) throw new Error('cleanup journal cancellation cannot leave an intent unreconciled');
  state.halted = true;
  state.cancellationSeen = true;
}

function handleIntent(state, checkpoint, checkpointDigest) {
  const { payload } = checkpoint;
  if (state.halted || state.openIntent || payload.actionSequence !== state.nextAction
      || payload.actionSequence > state.genesis.payload.actionCount) {
    throw new Error('cleanup journal intent order is invalid');
  }
  if (payload.approvedActionDigest !== state.genesis.payload.actionDigests[payload.actionSequence - 1]) {
    throw new Error('cleanup journal intent does not bind the approved action');
  }
  state.openIntent = { payload, digest: checkpointDigest };
}

function handleReconciliation(state, checkpoint) {
  const { payload } = checkpoint;
  if (!state.openIntent || !sameAction(payload, state.openIntent.payload)
      || payload.intentCheckpointDigest !== state.openIntent.digest) {
    throw new Error('cleanup journal reconciliation does not bind the open intent');
  }
}

function assertHaltedResult(state, payload) {
  if (state.openIntent || payload.intentCheckpointDigest !== null || payload.result !== 'refused'
      || payload.mutationOutcome !== 'not_started' || payload.reconciliationState !== 'not_started') {
    throw new Error('cleanup journal halted action result is invalid');
  }
}

function assertOpenIntentResult(state, payload) {
  if (state.openIntent) {
    if (!sameAction(payload, state.openIntent.payload)
        || payload.intentCheckpointDigest !== state.openIntent.digest) {
      throw new Error('cleanup journal result does not bind the open intent');
    }
  } else if (payload.intentCheckpointDigest !== null) {
    throw new Error('cleanup journal result references a missing intent');
  }
}

function handleResult(state, checkpoint) {
  const { payload } = checkpoint;
  if (payload.actionSequence !== state.nextAction) throw new Error('cleanup journal result order is invalid');
  if (state.halted) assertHaltedResult(state, payload);
  else assertOpenIntentResult(state, payload);
  state.openIntent = null;
  state.nextAction += 1;
  state.results.push(payload);
  if (!['cleaned', 'absent', 'retained'].includes(payload.result)) state.halted = true;
}

function terminalOutcome(state) {
  const ambiguous = state.results.some((entry) => entry.result === 'ambiguous');
  if (ambiguous) return 'ambiguous';
  if (state.cancellationSeen || state.results.some((entry) => entry.failureClass === 'cancelled')) return 'cancelled';
  if (state.genesis.payload.actionCount === 0) return state.recoverySeen ? 'recovered' : 'no_op';
  const successful = state.results.filter((entry) => ['cleaned', 'absent', 'retained'].includes(entry.result)).length;
  if (successful === state.results.length) return state.recoverySeen ? 'recovered' : 'cleaned';
  if (successful > 0) return 'partial';
  return state.results.every((entry) => entry.result === 'refused') ? 'refused' : 'partial';
}

function handleTerminal(state, checkpoint) {
  if (state.openIntent) throw new Error('cleanup journal terminal checkpoint has an unresolved intent');
  if (state.nextAction <= state.genesis.payload.actionCount) {
    throw new Error('cleanup journal terminal checkpoint omits an approved action result');
  }
  if (checkpoint.payload.terminalOutcome !== terminalOutcome(state)) {
    throw new Error('cleanup journal terminal outcome is inconsistent with action results');
  }
  state.terminal = true;
}

function applyProtocolCheckpoint(state, record) {
  const { checkpoint, digest: checkpointDigest } = record;
  if (state.terminal) throw new Error('cleanup journal contains a checkpoint after terminal');
  if (checkpoint.checkpointType === 'recovery') handleRecovery(state, checkpoint);
  else if (checkpoint.checkpointType === 'cancellation') handleCancellation(state);
  else if (checkpoint.checkpointType === 'intent') handleIntent(state, checkpoint, checkpointDigest);
  else if (checkpoint.checkpointType === 'reconciliation') handleReconciliation(state, checkpoint);
  else if (checkpoint.checkpointType === 'result') handleResult(state, checkpoint);
  else if (checkpoint.checkpointType === 'terminal') handleTerminal(state, checkpoint);
}

export function validateJournalProtocol(records) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('cleanup journal has no genesis');
  const state = protocolState(records[0].checkpoint);
  for (let index = 1; index < records.length; index += 1) applyProtocolCheckpoint(state, records[index]);
  return {
    terminal: state.terminal, halted: state.halted,
    cancellationSeen: state.cancellationSeen,
    processedActionCount: state.nextAction - 1, actionCount: state.genesis.payload.actionCount,
  };
}
