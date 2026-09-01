import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { RESOURCE_CLASSES } from './contracts.mjs';
import { publicKeyFingerprint, sha256, verifyDetached } from './crypto.mjs';
import { assertLocalPrivateSafe } from './privacy.mjs';
import { CLEANUP_FAILURE_CLASSES, validateArtifact } from './schemas.mjs';
import { MAX_CLEANUP_JOURNAL_BYTES } from './cleanup-schema-contract.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const TERMINAL_STATES = new Set(['no_op', 'cleaned', 'partial', 'cancelled', 'refused', 'ambiguous', 'recovered']);
const RESULTS = new Set(['cleaned', 'absent', 'retained', 'refused', 'ambiguous', 'failed']);
const POSTCONDITIONS = new Set(['satisfied', 'failed', 'ambiguous', 'not_run']);
const MAX_ROWS = 10_000;

const CORE_KEYS = Object.freeze([
  'schemaVersion', 'artifactType', 'phase', 'deploymentId', 'operationRunId',
  'deploymentGeneration', 'state', 'operationStartedAt', 'operationEndedAt',
  'receiptCoreFinalizedAt', 'policyDigest', 'deploymentManifestDigest',
  'runManifestDigest', 'contextFingerprint', 'planDigest', 'approvalDigest',
  'approvalStateDigest', 'inventoryBeforeDigest', 'inventoryAfterDigest',
  'journalGenesisDigest', 'journalDigest', 'journalBytes', 'journalRecords',
  'actions', 'results', 'refusals', 'postconditions', 'subjectExitStatus',
  'signerKeyId',
]);

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error(`${label} fields are invalid`);
  }
  return value;
}

function assertDigest(value, label) {
  if (!DIGEST.test(value ?? '')) throw new Error(`${label} must be a SHA-256 digest`);
}

function assertId(value, label) {
  if (!ID.test(value ?? '')) throw new Error(`${label} has an invalid format`);
}

function timestamp(value, label) {
  const parsed = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return parsed.getTime();
}

function canonicalCopy(value) {
  return parseStrictJson(canonicalJson(value));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function sameCanonical(left, right) {
  return canonicalSha256(left) === canonicalSha256(right);
}

function assertArtifactBindings(inventoryBefore, inventoryAfter, plan, approval) {
  validateArtifact(inventoryBefore);
  validateArtifact(inventoryAfter);
  validateArtifact(plan);
  validateArtifact(approval, { now: new Date(approval.issuedAt) });
  const beforeDigest = canonicalSha256(inventoryBefore);
  const planDigest = canonicalSha256(plan);
  if (plan.inventoryDigest !== beforeDigest) throw new Error('plan does not bind inventoryBefore');
  if (approval.planDigest !== planDigest) throw new Error('approval does not bind the plan');
  if (!sameCanonical(approval.actions, plan.actions)) throw new Error('approval actions do not match the plan');
  for (const key of [
    'deploymentId', 'operationRunId', 'policyDigest', 'deploymentManifestDigest',
    'runManifestDigest', 'contextFingerprint',
  ]) {
    if (plan[key] !== inventoryBefore[key] || approval[key] !== plan[key]
        || inventoryAfter[key] !== inventoryBefore[key]) {
      throw new Error(`${key} is inconsistent across execution evidence`);
    }
  }
  if (inventoryAfter.generation !== inventoryBefore.generation) {
    throw new Error('deployment generation changed during cleanup execution');
  }
}

function validateTerminalPayload(payload, expected) {
  exactObject(payload, [
    'inventoryAfterDigest', 'operationEndedAt', 'operationStartedAt',
    'postconditionsDigest', 'receiptCoreFinalizedAt', 'refusalsDigest',
    'resultsDigest', 'subjectExitStatus', 'terminalOutcome',
  ], 'terminal journal payload');
  for (const [key, value] of Object.entries(expected)) {
    if (payload[key] !== value) throw new Error(`terminal journal ${key} does not match receipt evidence`);
  }
}

function validateJournal(journal, { approval, inventoryAfter, results, refusals, postconditions,
  state, operationStartedAt, operationEndedAt, receiptCoreFinalizedAt,
  subjectExitStatus, signerKeyId, journalPublicKey }) {
  exactObject(journal, [
    'journalPath', 'genesisDigest', 'expectedHeadDigest', 'headDigest',
    'priorRecordCount', 'priorBytes', 'recordCount', 'bytes', 'checkpoint', 'envelope',
  ], 'journal summary');
  assertDigest(journal.genesisDigest, 'journal genesisDigest');
  assertDigest(journal.headDigest, 'journal headDigest');
  assertDigest(journal.expectedHeadDigest, 'journal expectedHeadDigest');
  if (!Number.isSafeInteger(journal.priorRecordCount) || journal.priorRecordCount < 1
      || journal.recordCount !== journal.priorRecordCount + 1) {
    throw new Error('journal recordCount does not describe one predicted terminal append');
  }
  if (!Number.isSafeInteger(journal.priorBytes) || journal.priorBytes < 1) {
    throw new Error('journal priorBytes are invalid');
  }
  if (!Number.isSafeInteger(journal.bytes) || journal.bytes < 1
      || journal.bytes > MAX_CLEANUP_JOURNAL_BYTES) {
    throw new Error('journal bytes are invalid');
  }
  if (!Number.isSafeInteger(journal.recordCount) || journal.recordCount < 1 || journal.recordCount > MAX_ROWS) {
    throw new Error('journal recordCount is invalid');
  }
  const checkpoint = journal.checkpoint;
  exactObject(checkpoint, [
    'approvalDigest', 'checkpointType', 'deploymentId', 'operationRunId', 'payload',
    'previousDigest', 'recordedAt', 'sequence', 'signerKeyId', 'version',
  ], 'terminal journal checkpoint');
  if (checkpoint.version !== 1 || checkpoint.checkpointType !== 'terminal'
      || checkpoint.sequence !== journal.priorRecordCount
      || checkpoint.previousDigest !== journal.expectedHeadDigest
      || checkpoint.approvalDigest !== canonicalSha256(approval)
      || checkpoint.deploymentId !== approval.deploymentId
      || checkpoint.operationRunId !== approval.operationRunId
      || checkpoint.signerKeyId !== signerKeyId
      || checkpoint.recordedAt !== receiptCoreFinalizedAt) {
    throw new Error('terminal journal checkpoint does not bind the predicted terminal state');
  }
  validateTerminalPayload(checkpoint.payload, {
    terminalOutcome: state,
    inventoryAfterDigest: canonicalSha256(inventoryAfter),
    resultsDigest: canonicalSha256(results),
    refusalsDigest: canonicalSha256(refusals),
    postconditionsDigest: canonicalSha256(postconditions),
    operationStartedAt,
    operationEndedAt,
    receiptCoreFinalizedAt,
    subjectExitStatus,
  });
  exactObject(journal.envelope, ['checkpoint', 'signature'], 'terminal journal envelope');
  if (!sameCanonical(journal.envelope.checkpoint, checkpoint)) {
    throw new Error('terminal journal envelope checkpoint mismatch');
  }
  if (publicKeyFingerprint(journalPublicKey) !== signerKeyId) throw new Error('terminal journal signer mismatch');
  const signature = Buffer.from(journal.envelope.signature, 'base64');
  if (signature.length === 0 || signature.toString('base64') !== journal.envelope.signature) {
    throw new Error('terminal journal signature encoding is invalid');
  }
  verifyDetached(canonicalJson(checkpoint), signature, journalPublicKey, signerKeyId);
  const envelopeBytes = canonicalJson(journal.envelope);
  if (sha256(envelopeBytes) !== journal.headDigest
      || journal.bytes !== journal.priorBytes + envelopeBytes.length + 1) {
    throw new Error('terminal journal predicted digest or byte count mismatch');
  }
}

function validateResult(result, action, index) {
  exactObject(result, ['sequence', 'resourceClass', 'immutableIdentity', 'result', 'failureClass'], `result ${index}`);
  if (result.sequence !== action.sequence || result.resourceClass !== action.resourceClass
      || result.immutableIdentity !== action.immutableIdentity) {
    throw new Error(`result ${index} does not match its ordered action`);
  }
  if (!RESULTS.has(result.result)) throw new Error(`result ${index} has an invalid result`);
  if (!CLEANUP_FAILURE_CLASSES.includes(result.failureClass)) throw new Error(`result ${index} has an invalid failure class`);
  if ((['cleaned', 'absent', 'retained'].includes(result.result)) !== (result.failureClass === 'none')) {
    throw new Error(`result ${index} result and failureClass are inconsistent`);
  }
}

function validateRefusal(refusal, index) {
  exactObject(refusal, ['resourceClass', 'immutableIdentity', 'failureClass'], `refusal ${index}`);
  if (!RESOURCE_CLASSES.includes(refusal.resourceClass)) throw new Error(`refusal ${index} has an invalid resource class`);
  assertId(refusal.immutableIdentity, `refusal ${index} immutableIdentity`);
  if (!CLEANUP_FAILURE_CLASSES.includes(refusal.failureClass) || refusal.failureClass === 'none') {
    throw new Error(`refusal ${index} has an invalid failure class`);
  }
}

function validatePostcondition(postcondition, action, index) {
  exactObject(postcondition, [
    'sequence', 'resourceClass', 'immutableIdentity', 'state', 'failureClass',
  ], `postcondition ${index}`);
  if (postcondition.sequence !== action.sequence || postcondition.resourceClass !== action.resourceClass
      || postcondition.immutableIdentity !== action.immutableIdentity) {
    throw new Error(`postcondition ${index} does not match its ordered action`);
  }
  if (!POSTCONDITIONS.has(postcondition.state)) throw new Error(`postcondition ${index} has an invalid state`);
  if (!CLEANUP_FAILURE_CLASSES.includes(postcondition.failureClass)
      || ((postcondition.state === 'satisfied') !== (postcondition.failureClass === 'none'))) {
    throw new Error(`postcondition ${index} state and failureClass are inconsistent`);
  }
}

function assertSortedRefusals(refusals) {
  const identities = refusals.map((entry) => (
    `${entry.resourceClass}\0${entry.immutableIdentity}\0${entry.failureClass}`
  ));
  if (new Set(identities).size !== identities.length) throw new Error('refusals contain duplicates');
  if (identities.some((entry, index) => index > 0 && identities[index - 1].localeCompare(entry) > 0)) {
    throw new Error('refusals must be sorted');
  }
}

function validateRows(core) {
  for (const key of ['actions', 'results', 'refusals', 'postconditions']) {
    if (!Array.isArray(core[key]) || core[key].length > MAX_ROWS) throw new Error(`${key} are invalid or oversized`);
  }
  if (core.results.length !== core.actions.length || core.postconditions.length !== core.actions.length) {
    throw new Error('results and postconditions must correspond one-to-one with actions');
  }
  core.actions.forEach((entry, index) => {
    if (entry.sequence !== index + 1) throw new Error('actions must be contiguous and ordered');
    validateResult(core.results[index], entry, index);
    validatePostcondition(core.postconditions[index], entry, index);
  });
  core.refusals.forEach(validateRefusal);
  assertSortedRefusals(core.refusals);
}

function hasAmbiguousOutcome(core) {
  return core.results.some((entry) => entry.result === 'ambiguous')
    || core.postconditions.some((entry) => entry.state === 'ambiguous');
}

function hasCancelledOutcome(core) {
  return core.results.some((entry) => entry.failureClass === 'cancelled')
    || core.postconditions.some((entry) => entry.failureClass === 'cancelled');
}

function successfulResultCount(core) {
  return core.results.filter((entry) => (
    ['cleaned', 'absent', 'retained'].includes(entry.result)
  )).length;
}

function allActionsSuccessful(core, successful) {
  return core.actions.length > 0
    && successful === core.actions.length
    && core.postconditions.every((entry) => entry.state === 'satisfied')
    && core.refusals.length === 0;
}

function hasRefusedOutcome(core) {
  return core.refusals.length > 0
    || core.results.some((entry) => entry.result === 'refused');
}

function expectedTerminalStates(core) {
  const ambiguous = hasAmbiguousOutcome(core);
  const cancelled = hasCancelledOutcome(core);
  const successful = successfulResultCount(core);
  if (core.actions.length === 0) {
    if (ambiguous) return new Set(['ambiguous']);
    if (core.refusals.length > 0) return new Set(['refused']);
    return new Set(['no_op', 'recovered', 'cancelled']);
  }
  if (ambiguous) return new Set(['ambiguous']);
  if (cancelled) return new Set(['cancelled']);
  if (allActionsSuccessful(core, successful)) return new Set(['cleaned', 'recovered', 'cancelled']);
  if (successful > 0) return new Set(['partial']);
  if (hasRefusedOutcome(core)) return new Set(['refused']);
  return new Set(['partial']);
}

function validateTerminalState(core) {
  if (!expectedTerminalStates(core).has(core.state)) {
    throw new Error('receipt state is inconsistent with results, refusals, and postconditions');
  }
}

export function validateExecutionReceiptCore(core, { now = new Date() } = {}) {
  exactObject(core, CORE_KEYS, 'execution receipt core');
  if (core.schemaVersion !== '1.2.0' || core.artifactType !== 'cleanup_receipt' || core.phase !== 'execution') {
    throw new Error('execution receipt core type or version is invalid');
  }
  assertId(core.deploymentId, 'receipt deploymentId');
  assertId(core.operationRunId, 'receipt operationRunId');
  if (!Number.isSafeInteger(core.deploymentGeneration) || core.deploymentGeneration < 1) {
    throw new Error('receipt deploymentGeneration is invalid');
  }
  if (!TERMINAL_STATES.has(core.state)) throw new Error('receipt state is not terminal');
  const started = timestamp(core.operationStartedAt, 'receipt operationStartedAt');
  const ended = timestamp(core.operationEndedAt, 'receipt operationEndedAt');
  const finalized = timestamp(core.receiptCoreFinalizedAt, 'receipt receiptCoreFinalizedAt');
  if (started > ended || ended > finalized || finalized > now.getTime()) throw new Error('receipt timestamps are out of order');
  for (const key of [
    'policyDigest', 'deploymentManifestDigest', 'runManifestDigest', 'contextFingerprint',
    'planDigest', 'approvalDigest', 'inventoryBeforeDigest', 'inventoryAfterDigest',
    'journalGenesisDigest', 'journalDigest', 'signerKeyId',
  ]) assertDigest(core[key], `receipt ${key}`);
  if (core.approvalStateDigest !== null) throw new Error('receipt core approvalStateDigest must be null');
  if (!Number.isSafeInteger(core.journalBytes) || core.journalBytes < 1
      || core.journalBytes > MAX_CLEANUP_JOURNAL_BYTES
      || !Number.isSafeInteger(core.journalRecords) || core.journalRecords < 1 || core.journalRecords > MAX_ROWS) {
    throw new Error('receipt journal bounds are invalid');
  }
  if (core.subjectExitStatus !== null && (!Number.isSafeInteger(core.subjectExitStatus)
      || core.subjectExitStatus < 0 || core.subjectExitStatus > 255)) {
    throw new Error('receipt subjectExitStatus must be null or an integer from 0 through 255');
  }
  validateRows(core);
  validateTerminalState(core);
  assertLocalPrivateSafe(core);
  return core;
}

export function buildExecutionReceiptCore({
  inventoryBefore, inventoryAfter, plan, approval, journal,
  results, refusals = [], postconditions, state,
  operationStartedAt, operationEndedAt, receiptCoreFinalizedAt,
  signerKeyId, journalPublicKey, subjectExitStatus = null, now = new Date(),
}) {
  assertArtifactBindings(inventoryBefore, inventoryAfter, plan, approval);
  validateJournal(journal, {
    approval, inventoryAfter, results, refusals, postconditions, state,
    operationStartedAt, operationEndedAt, receiptCoreFinalizedAt,
    subjectExitStatus, signerKeyId, journalPublicKey,
  });
  const receiptCore = canonicalCopy({
    schemaVersion: '1.2.0', artifactType: 'cleanup_receipt', phase: 'execution',
    deploymentId: plan.deploymentId, operationRunId: plan.operationRunId,
    deploymentGeneration: inventoryBefore.generation, state,
    operationStartedAt, operationEndedAt, receiptCoreFinalizedAt,
    policyDigest: plan.policyDigest,
    deploymentManifestDigest: plan.deploymentManifestDigest,
    runManifestDigest: plan.runManifestDigest,
    contextFingerprint: plan.contextFingerprint,
    planDigest: canonicalSha256(plan), approvalDigest: canonicalSha256(approval),
    approvalStateDigest: null,
    inventoryBeforeDigest: canonicalSha256(inventoryBefore),
    inventoryAfterDigest: canonicalSha256(inventoryAfter),
    journalGenesisDigest: journal.genesisDigest, journalDigest: journal.headDigest,
    journalBytes: journal.bytes, journalRecords: journal.recordCount,
    actions: plan.actions, results, refusals, postconditions,
    subjectExitStatus, signerKeyId,
  });
  validateExecutionReceiptCore(receiptCore, { now });
  return deepFreeze({ receiptCore, receiptCoreDigest: canonicalSha256(receiptCore) });
}

function validateFinalizedApprovalState(state, digest, coreDigest, core, now) {
  const keys = [
    'version', 'approvalDigest', 'generation', 'state', 'priorStateDigest',
    'operationRunId', 'journalGenesisDigest', 'finalJournalDigest',
    'inventoryAfterDigest', 'receiptCoreDigest', 'terminalOutcome', 'transitionedAt',
  ];
  exactObject(state, keys, 'finalized approval state');
  if (canonicalSha256(state) !== digest) throw new Error('finalized approval state digest does not match exact bytes');
  if (state.version !== 1 || state.state !== 'finalized' || state.generation !== 3) {
    throw new Error('finalized approval state is invalid');
  }
  const transitioned = timestamp(state.transitionedAt, 'finalized approval state transitionedAt');
  if (transitioned < timestamp(core.receiptCoreFinalizedAt, 'receipt receiptCoreFinalizedAt')
      || transitioned > now.getTime()) {
    throw new Error('finalized approval state transition timestamp is out of order');
  }
  assertDigest(state.priorStateDigest, 'finalized approval state priorStateDigest');
  const bindings = [
    ['approvalDigest', core.approvalDigest],
    ['operationRunId', core.operationRunId],
    ['journalGenesisDigest', core.journalGenesisDigest],
    ['finalJournalDigest', core.journalDigest],
    ['inventoryAfterDigest', core.inventoryAfterDigest],
    ['receiptCoreDigest', coreDigest],
    ['terminalOutcome', core.state],
  ];
  for (const [key, expected] of bindings) {
    if (state[key] !== expected) throw new Error(`finalized approval state ${key} does not match the receipt core`);
  }
}

export function buildFinalExecutionReceipt({
  receiptCore, receiptCoreDigest, finalizedApprovalState, approvalStateDigest,
  now = new Date(),
}) {
  validateExecutionReceiptCore(receiptCore, { now });
  assertDigest(receiptCoreDigest, 'receiptCoreDigest');
  assertDigest(approvalStateDigest, 'approvalStateDigest');
  if (canonicalSha256(receiptCore) !== receiptCoreDigest) throw new Error('receiptCoreDigest does not match the receipt core');
  validateFinalizedApprovalState(
    finalizedApprovalState, approvalStateDigest, receiptCoreDigest, receiptCore, now,
  );
  const receipt = canonicalCopy({
    ...receiptCore, receiptCoreDigest, approvalStateDigest,
    approvalStateGeneration: finalizedApprovalState.generation,
  });
  assertLocalPrivateSafe(receipt);
  return deepFreeze(receipt);
}
