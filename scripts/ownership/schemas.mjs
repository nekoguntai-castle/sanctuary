import {
  array,
  boolean,
  canonicalRelativePath,
  commit,
  digest,
  enumeration,
  identifier,
  integer,
  object,
  string,
  timestamp,
  unique,
} from './validation.mjs';
import { CLEANUP_POLICIES, RESOURCE_CLASSES } from './contracts.mjs';

export const ARTIFACT_TYPES = [
  'deployment_manifest', 'run_manifest', 'inventory', 'cleanup_plan',
  'cleanup_approval', 'approval_state', 'journal_record', 'cleanup_receipt', 'cleanup_receipt_upload',
];
const STATES = ['dry_run', 'no_op', 'cleaned', 'partial', 'cancelled', 'refused', 'ambiguous', 'recovered'];
const RESULTS = ['pending', 'cleaned', 'absent', 'retained', 'refused', 'ambiguous', 'failed'];
const ACTIONS = ['stop', 'remove', 'reconcile', 'retain'];
const FAILURE_CLASSES = ['none', 'identity_changed', 'active', 'shared', 'unlabeled', 'malformed', 'query_failed', 'mutation_failed', 'postcondition_failed', 'cancelled'];

function base(value, type, extraKeys) {
  object(value, '$', ['schemaVersion', 'artifactType', ...extraKeys]);
  if (value.schemaVersion !== '1.0.0') throw new Error('$.schemaVersion must equal 1.0.0');
  if (value.artifactType !== type) throw new Error(`$.artifactType must equal ${type}`);
}

function ownership(value, path) {
  object(value, path, ['project', 'deploymentId', 'ownerId', 'resourceClass', 'lifecycle', 'cleanupPolicy', 'createdAt', 'createdByRelease', 'createdByCommit', 'creationRunId', 'immutableIdentity']);
  identifier(value.project, `${path}.project`);
  identifier(value.deploymentId, `${path}.deploymentId`);
  identifier(value.ownerId, `${path}.ownerId`);
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  identifier(value.lifecycle, `${path}.lifecycle`);
  enumeration(value.cleanupPolicy, `${path}.cleanupPolicy`, CLEANUP_POLICIES);
  timestamp(value.createdAt, `${path}.createdAt`);
  string(value.createdByRelease, `${path}.createdByRelease`, { max: 128 });
  if (value.createdByRelease !== 'unreleased') identifier(value.createdByRelease, `${path}.createdByRelease`);
  commit(value.createdByCommit, `${path}.createdByCommit`);
  identifier(value.creationRunId, `${path}.creationRunId`);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
}

function action(value, path) {
  object(value, path, ['sequence', 'resourceClass', 'immutableIdentity', 'action', 'ownershipDigest']);
  integer(value.sequence, `${path}.sequence`, { min: 1 });
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.action, `${path}.action`, ACTIONS);
  digest(value.ownershipDigest, `${path}.ownershipDigest`);
}

function result(value, path) {
  object(value, path, ['sequence', 'immutableIdentity', 'result', 'failureClass']);
  integer(value.sequence, `${path}.sequence`, { min: 1 });
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.result, `${path}.result`, RESULTS);
  enumeration(value.failureClass, `${path}.failureClass`, FAILURE_CLASSES);
}

function ordered(items, path) {
  items.forEach((entry, index) => {
    if (entry.sequence !== index + 1) throw new Error(`${path} sequences must be contiguous from 1`);
  });
}

function validateDeployment(value) {
  base(value, 'deployment_manifest', ['deploymentId', 'ownerId', 'release', 'commit', 'generation', 'createdAt', 'active', 'overlayPaths', 'overlayDigests', 'policyDigest', 'contextFingerprint']);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.ownerId, '$.ownerId');
  string(value.release, '$.release', { max: 128 });
  commit(value.commit, '$.commit');
  integer(value.generation, '$.generation', { min: 1 });
  timestamp(value.createdAt, '$.createdAt');
  boolean(value.active, '$.active');
  array(value.overlayPaths, '$.overlayPaths', { min: 1, max: 32 }).forEach((entry, index) => canonicalRelativePath(entry, `$.overlayPaths[${index}]`));
  array(value.overlayDigests, '$.overlayDigests', { min: value.overlayPaths.length, max: value.overlayPaths.length }).forEach((entry, index) => digest(entry, `$.overlayDigests[${index}]`));
  unique(value.overlayPaths, '$.overlayPaths');
  digest(value.policyDigest, '$.policyDigest');
  digest(value.contextFingerprint, '$.contextFingerprint');
}

function validateRun(value) {
  base(value, 'run_manifest', ['deploymentId', 'operationRunId', 'ownerId', 'generation', 'startedAt', 'heartbeatAt', 'terminalAt', 'controllerIdentity', 'deploymentDigest']);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  identifier(value.ownerId, '$.ownerId');
  integer(value.generation, '$.generation', { min: 1 });
  const started = timestamp(value.startedAt, '$.startedAt');
  const heartbeat = timestamp(value.heartbeatAt, '$.heartbeatAt');
  if (heartbeat < started) throw new Error('$.heartbeatAt must not precede startedAt');
  if (value.terminalAt !== null) {
    const terminal = timestamp(value.terminalAt, '$.terminalAt');
    if (terminal < heartbeat) throw new Error('$.terminalAt must not precede heartbeatAt');
  }
  identifier(value.controllerIdentity, '$.controllerIdentity');
  digest(value.deploymentDigest, '$.deploymentDigest');
}

function validateInventory(value) {
  base(value, 'inventory', ['deploymentId', 'operationRunId', 'observedAt', 'complete', 'policyDigest', 'resources', 'ambiguities']);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  timestamp(value.observedAt, '$.observedAt');
  boolean(value.complete, '$.complete');
  digest(value.policyDigest, '$.policyDigest');
  array(value.resources, '$.resources').forEach((entry, index) => ownership(entry, `$.resources[${index}]`));
  unique(value.resources.map((entry) => `${entry.resourceClass}:${entry.immutableIdentity}`), '$.resources identity');
  array(value.ambiguities, '$.ambiguities').forEach((entry, index) => identifier(entry, `$.ambiguities[${index}]`));
}

function validatePlan(value) {
  base(value, 'cleanup_plan', ['deploymentId', 'operationRunId', 'createdAt', 'inventoryDigest', 'policyDigest', 'actions']);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  timestamp(value.createdAt, '$.createdAt');
  digest(value.inventoryDigest, '$.inventoryDigest');
  digest(value.policyDigest, '$.policyDigest');
  array(value.actions, '$.actions').forEach((entry, index) => action(entry, `$.actions[${index}]`));
  ordered(value.actions, '$.actions');
}

function validateApproval(value) {
  base(value, 'cleanup_approval', ['deploymentId', 'operationRunId', 'issuedAt', 'expiresAt', 'nonce', 'planDigest', 'policyDigest', 'contextFingerprint', 'permittedClasses', 'permittedActionCount', 'decommission']);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  const issued = timestamp(value.issuedAt, '$.issuedAt');
  const expires = timestamp(value.expiresAt, '$.expiresAt');
  if (expires <= issued) throw new Error('$.expiresAt must follow issuedAt');
  identifier(value.nonce, '$.nonce');
  digest(value.planDigest, '$.planDigest');
  digest(value.policyDigest, '$.policyDigest');
  digest(value.contextFingerprint, '$.contextFingerprint');
  array(value.permittedClasses, '$.permittedClasses', { min: 1, max: RESOURCE_CLASSES.length }).forEach((entry, index) => enumeration(entry, `$.permittedClasses[${index}]`, RESOURCE_CLASSES));
  unique(value.permittedClasses, '$.permittedClasses');
  integer(value.permittedActionCount, '$.permittedActionCount');
  boolean(value.decommission, '$.decommission');
}

function validateApprovalState(value) {
  base(value, 'approval_state', ['approvalDigest', 'generation', 'state', 'operationRunId', 'journalDigest', 'receiptCoreDigest', 'transitionedAt']);
  digest(value.approvalDigest, '$.approvalDigest');
  integer(value.generation, '$.generation', { min: 1 });
  enumeration(value.state, '$.state', ['unused', 'reserved', 'finalized']);
  if (value.state === 'unused' && [value.operationRunId, value.journalDigest, value.receiptCoreDigest].some((entry) => entry !== null)) throw new Error('unused approval state cannot bind execution evidence');
  if (value.state !== 'unused') identifier(value.operationRunId, '$.operationRunId');
  for (const [key, entry] of [['journalDigest', value.journalDigest], ['receiptCoreDigest', value.receiptCoreDigest]]) {
    if (entry !== null) digest(entry, `$.${key}`);
  }
  if (value.state === 'finalized' && value.receiptCoreDigest === null) throw new Error('finalized approval state requires receiptCoreDigest');
  if (value.state !== 'unused' && value.journalDigest === null) throw new Error('reserved or finalized approval state requires journalDigest');
  timestamp(value.transitionedAt, '$.transitionedAt');
}

function validateJournal(value) {
  base(value, 'journal_record', ['sequence', 'recordedAt', 'recordType', 'planDigest', 'previousDigest', 'resourceIdentity', 'action', 'result']);
  integer(value.sequence, '$.sequence', { min: 1 });
  timestamp(value.recordedAt, '$.recordedAt');
  enumeration(value.recordType, '$.recordType', ['intent', 'result', 'cancellation', 'finalized']);
  digest(value.planDigest, '$.planDigest');
  if (value.previousDigest !== null) digest(value.previousDigest, '$.previousDigest');
  if (value.resourceIdentity !== null) identifier(value.resourceIdentity, '$.resourceIdentity');
  if (value.action !== null) enumeration(value.action, '$.action', ACTIONS);
  if (value.result !== null) enumeration(value.result, '$.result', RESULTS);
}

function validateReceipt(value, now) {
  base(value, 'cleanup_receipt', ['deploymentId', 'operationRunId', 'state', 'operationStartedAt', 'operationEndedAt', 'receiptCoreFinalizedAt', 'policyDigest', 'deploymentManifestDigest', 'runManifestDigest', 'planDigest', 'approvalDigest', 'approvalStateDigest', 'inventoryBeforeDigest', 'inventoryAfterDigest', 'journalDigest', 'journalBytes', 'journalRecords', 'actions', 'results', 'refusals', 'signerKeyId']);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  enumeration(value.state, '$.state', STATES);
  const started = timestamp(value.operationStartedAt, '$.operationStartedAt');
  const ended = timestamp(value.operationEndedAt, '$.operationEndedAt');
  const finalized = timestamp(value.receiptCoreFinalizedAt, '$.receiptCoreFinalizedAt');
  if (started > ended || ended > finalized) throw new Error('receipt timestamps are out of order');
  if (finalized > now.getTime()) throw new Error('receipt finalization timestamp is in the future');
  ['policyDigest', 'deploymentManifestDigest', 'runManifestDigest', 'planDigest', 'approvalDigest', 'approvalStateDigest', 'inventoryBeforeDigest', 'inventoryAfterDigest', 'journalDigest'].forEach((key) => digest(value[key], `$.${key}`));
  integer(value.journalBytes, '$.journalBytes');
  integer(value.journalRecords, '$.journalRecords');
  array(value.actions, '$.actions').forEach((entry, index) => action(entry, `$.actions[${index}]`));
  array(value.results, '$.results').forEach((entry, index) => result(entry, `$.results[${index}]`));
  ordered(value.actions, '$.actions');
  ordered(value.results, '$.results');
  array(value.refusals, '$.refusals').forEach((entry, index) => enumeration(entry, `$.refusals[${index}]`, FAILURE_CLASSES));
  digest(value.signerKeyId, '$.signerKeyId');
}

function validateUploadReceipt(value) {
  base(value, 'cleanup_receipt_upload', ['privateReceiptDigest', 'state', 'resourceCounts', 'resultCounts', 'failureClasses', 'policyDigest', 'signerKeyId']);
  digest(value.privateReceiptDigest, '$.privateReceiptDigest');
  enumeration(value.state, '$.state', STATES);
  for (const key of ['resourceCounts', 'resultCounts']) {
    object(value[key], `$.${key}`, ['total', 'cleaned', 'retained', 'refused', 'ambiguous']);
    Object.entries(value[key]).forEach(([countKey, count]) => integer(count, `$.${key}.${countKey}`));
  }
  array(value.failureClasses, '$.failureClasses', { max: FAILURE_CLASSES.length }).forEach((entry, index) => enumeration(entry, `$.failureClasses[${index}]`, FAILURE_CLASSES));
  unique(value.failureClasses, '$.failureClasses');
  digest(value.policyDigest, '$.policyDigest');
  digest(value.signerKeyId, '$.signerKeyId');
}

const VALIDATORS = {
  deployment_manifest: validateDeployment,
  run_manifest: validateRun,
  inventory: validateInventory,
  cleanup_plan: validatePlan,
  cleanup_approval: validateApproval,
  approval_state: validateApprovalState,
  journal_record: validateJournal,
  cleanup_receipt: validateReceipt,
  cleanup_receipt_upload: validateUploadReceipt,
};

export function validateArtifact(value, { now = new Date() } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('$ must be an object');
  enumeration(value.artifactType, '$.artifactType', ARTIFACT_TYPES);
  VALIDATORS[value.artifactType](value, now);
  return value;
}
