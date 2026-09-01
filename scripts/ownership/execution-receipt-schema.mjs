import { canonicalSha256 } from './canonical-json.mjs';
import { RESOURCE_CLASSES } from './contracts.mjs';
import {
  CLEANUP_ACTIONS, CLEANUP_FAILURE_CLASSES, CLEANUP_LOCATOR_KINDS,
  CLEANUP_RESULTS, CLEANUP_STATES, MAX_CLEANUP_JOURNAL_BYTES,
} from './cleanup-schema-contract.mjs';
import {
  array, digest, enumeration, identifier, integer, object, string, timestamp, unique,
} from './validation.mjs';

function cleanupAction(value, path) {
  object(value, path, [
    'sequence', 'resourceClass', 'immutableIdentity', 'action', 'locatorKind',
    'locator', 'ownershipDigest', 'observationDigest',
  ]);
  integer(value.sequence, `${path}.sequence`, { min: 1 });
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.action, `${path}.action`, CLEANUP_ACTIONS);
  enumeration(value.locatorKind, `${path}.locatorKind`, CLEANUP_LOCATOR_KINDS);
  string(value.locator, `${path}.locator`, { max: 1024 });
  digest(value.ownershipDigest, `${path}.ownershipDigest`);
  digest(value.observationDigest, `${path}.observationDigest`);
}

function result(value, path) {
  object(value, path, ['sequence', 'resourceClass', 'immutableIdentity', 'result', 'failureClass']);
  integer(value.sequence, `${path}.sequence`, { min: 1 });
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.result, `${path}.result`, CLEANUP_RESULTS);
  enumeration(value.failureClass, `${path}.failureClass`, CLEANUP_FAILURE_CLASSES);
}

function refusal(value, path) {
  object(value, path, ['resourceClass', 'immutableIdentity', 'failureClass']);
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.failureClass, `${path}.failureClass`, CLEANUP_FAILURE_CLASSES);
  if (value.failureClass === 'none') throw new Error(`${path}.failureClass must describe a refusal`);
}

function postcondition(value, action, path) {
  object(value, path, ['sequence', 'resourceClass', 'immutableIdentity', 'state', 'failureClass']);
  if (value.sequence !== action.sequence || value.resourceClass !== action.resourceClass
      || value.immutableIdentity !== action.immutableIdentity) {
    throw new Error(`${path} must correspond to its ordered action`);
  }
  enumeration(value.state, `${path}.state`, ['satisfied', 'failed', 'ambiguous', 'not_run']);
  enumeration(value.failureClass, `${path}.failureClass`, CLEANUP_FAILURE_CLASSES);
  if ((value.state === 'satisfied') !== (value.failureClass === 'none')) {
    throw new Error(`${path} state and failureClass are inconsistent`);
  }
}

function stateCandidates(value) {
  const ambiguous = value.results.some((entry) => entry.result === 'ambiguous')
    || value.postconditions.some((entry) => entry.state === 'ambiguous');
  const cancelled = value.results.some((entry) => entry.failureClass === 'cancelled')
    || value.postconditions.some((entry) => entry.failureClass === 'cancelled');
  const successful = value.results.filter((entry) => (
    ['cleaned', 'absent', 'retained'].includes(entry.result)
  )).length;
  const allSuccessful = value.actions.length > 0 && successful === value.actions.length
    && value.postconditions.every((entry) => entry.state === 'satisfied')
    && value.refusals.length === 0;
  if (value.actions.length === 0) {
    if (ambiguous) return ['ambiguous'];
    return value.refusals.length > 0 ? ['refused'] : ['no_op', 'recovered', 'cancelled'];
  }
  if (ambiguous) return ['ambiguous'];
  if (cancelled) return ['cancelled'];
  if (allSuccessful) return ['cleaned', 'recovered', 'cancelled'];
  if (successful > 0) return ['partial'];
  if (value.refusals.length > 0 || value.results.some((entry) => entry.result === 'refused')) return ['refused'];
  return ['partial'];
}

export function validateExecutionReceipt(value, now) {
  object(value, '$', [
    'schemaVersion', 'artifactType', 'phase', 'deploymentId', 'operationRunId',
    'deploymentGeneration', 'state', 'operationStartedAt', 'operationEndedAt',
    'receiptCoreFinalizedAt', 'policyDigest', 'deploymentManifestDigest',
    'runManifestDigest', 'contextFingerprint', 'planDigest', 'approvalDigest',
    'approvalStateDigest', 'approvalStateGeneration', 'inventoryBeforeDigest',
    'inventoryAfterDigest', 'journalGenesisDigest', 'journalDigest', 'journalBytes',
    'journalRecords', 'actions', 'results', 'refusals', 'postconditions',
    'subjectExitStatus', 'signerKeyId', 'receiptCoreDigest',
  ]);
  if (value.schemaVersion !== '1.2.0' || value.artifactType !== 'cleanup_receipt'
      || value.phase !== 'execution') throw new Error('execution receipt type or version is invalid');
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  integer(value.deploymentGeneration, '$.deploymentGeneration', { min: 1 });
  enumeration(value.state, '$.state', CLEANUP_STATES.filter((state) => state !== 'dry_run'));
  const started = timestamp(value.operationStartedAt, '$.operationStartedAt');
  const ended = timestamp(value.operationEndedAt, '$.operationEndedAt');
  const finalized = timestamp(value.receiptCoreFinalizedAt, '$.receiptCoreFinalizedAt');
  if (started > ended || ended > finalized || finalized > now.getTime()) {
    throw new Error('receipt timestamps are out of order');
  }
  for (const key of [
    'policyDigest', 'deploymentManifestDigest', 'runManifestDigest', 'contextFingerprint',
    'planDigest', 'approvalDigest', 'approvalStateDigest', 'inventoryBeforeDigest',
    'inventoryAfterDigest', 'journalGenesisDigest', 'journalDigest', 'signerKeyId',
    'receiptCoreDigest',
  ]) digest(value[key], `$.${key}`);
  integer(value.approvalStateGeneration, '$.approvalStateGeneration', { min: 3, max: 3 });
  integer(value.journalBytes, '$.journalBytes', { min: 1, max: MAX_CLEANUP_JOURNAL_BYTES });
  integer(value.journalRecords, '$.journalRecords', { min: 1, max: 10_000 });
  if (value.subjectExitStatus !== null) integer(value.subjectExitStatus, '$.subjectExitStatus', { min: 0, max: 255 });
  const actions = array(value.actions, '$.actions', { max: 3_000 });
  actions.forEach((entry, index) => {
    cleanupAction(entry, `$.actions[${index}]`);
    if (entry.sequence !== index + 1) throw new Error('$.actions sequences must be contiguous from 1');
  });
  const results = array(value.results, '$.results', { max: 3_000 });
  if (results.length !== actions.length) throw new Error('$.results must correspond one-to-one with actions');
  results.forEach((entry, index) => {
    result(entry, `$.results[${index}]`);
    const target = actions[index];
    if (entry.sequence !== target.sequence || entry.resourceClass !== target.resourceClass
        || entry.immutableIdentity !== target.immutableIdentity || entry.result === 'pending') {
      throw new Error(`$.results[${index}] must correspond to its ordered action`);
    }
    if ((['cleaned', 'absent', 'retained'].includes(entry.result)) !== (entry.failureClass === 'none')) {
      throw new Error(`$.results[${index}] result and failureClass are inconsistent`);
    }
  });
  const refusals = array(value.refusals, '$.refusals', { max: 10_000 });
  refusals.forEach((entry, index) => refusal(entry, `$.refusals[${index}]`));
  unique(refusals.map((entry) => `${entry.resourceClass}:${entry.immutableIdentity}:${entry.failureClass}`), '$.refusals identity');
  const refusalOrder = refusals.map((entry) => `${entry.resourceClass}\0${entry.immutableIdentity}\0${entry.failureClass}`);
  if (refusalOrder.some((entry, index) => index > 0 && refusalOrder[index - 1].localeCompare(entry) > 0)) {
    throw new Error('$.refusals must be sorted');
  }
  const postconditions = array(value.postconditions, '$.postconditions', { max: 3_000 });
  if (postconditions.length !== actions.length) throw new Error('$.postconditions must correspond one-to-one with actions');
  postconditions.forEach((entry, index) => postcondition(entry, actions[index], `$.postconditions[${index}]`));
  if (!stateCandidates(value).includes(value.state)) {
    throw new Error('$.state is inconsistent with results, refusals, and postconditions');
  }
  const { receiptCoreDigest, approvalStateGeneration: _generation, ...envelopeCore } = value;
  if (canonicalSha256({ ...envelopeCore, approvalStateDigest: null }) !== receiptCoreDigest) {
    throw new Error('$.receiptCoreDigest must match the null-state execution receipt core');
  }
}
