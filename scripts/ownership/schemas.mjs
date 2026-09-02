import {
  array, boolean, commit,
  digest, enumeration, identifier,
  integer,
  object,
  string,
  timestamp,
  unique,
} from './validation.mjs';
import { CLEANUP_POLICIES, RESOURCE_CLASSES } from './contracts.mjs';
import { canonicalSha256 } from './canonical-json.mjs';
import {
  CLEANUP_ACTIONS as ACTIONS, CLEANUP_FAILURE_CLASSES,
  CLEANUP_LOCATOR_KINDS as LOCATOR_KINDS, CLEANUP_RESULTS as RESULTS,
  CLEANUP_STATES as STATES,
} from './cleanup-schema-contract.mjs';
import { validateExecutionReceipt } from './execution-receipt-schema.mjs';
import { validateCoordinationReceipt } from './coordination-receipt-schema.mjs';
import {
  validateDeployment, validateRegistration, validateRun,
} from './manifest-schema-validators.mjs';

export const ARTIFACT_TYPES = [
  'deployment_manifest', 'run_manifest', 'resource_registration', 'inventory', 'cleanup_plan',
  'cleanup_approval', 'approval_state', 'journal_record', 'cleanup_receipt', 'cleanup_receipt_upload',
];
const CLEANUP_SCHEMA_VERSION = '1.1.0';
const CLEANUP_EXECUTION_SCHEMA_VERSION = '1.2.0';
const CLEANUP_COORDINATION_SCHEMA_VERSION = '1.3.0';
const CLEANUP_V11_TYPES = new Set(['inventory', 'cleanup_plan', 'cleanup_approval', 'cleanup_receipt']);
export const ARTIFACT_SCHEMA_VERSIONS = Object.freeze(Object.fromEntries(
  ARTIFACT_TYPES.map((artifactType) => [artifactType, artifactType === 'inventory'
    ? CLEANUP_EXECUTION_SCHEMA_VERSION
    : CLEANUP_V11_TYPES.has(artifactType) ? CLEANUP_SCHEMA_VERSION : '1.0.0']),
));
export { CLEANUP_FAILURE_CLASSES } from './cleanup-schema-contract.mjs';
const FAILURE_CLASSES = CLEANUP_FAILURE_CLASSES;
const DISPOSITIONS = ['eligible', 'retain', 'refused', 'ambiguous'];
const PLANNING_STATES = ['dry_run', 'no_op', 'refused', 'ambiguous'];
const MAX_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

function base(value, type, extraKeys, expectedVersion = ARTIFACT_SCHEMA_VERSIONS[type]) {
  object(value, '$', ['schemaVersion', 'artifactType', ...extraKeys]);
  if (value.schemaVersion !== expectedVersion) throw new Error(`$.schemaVersion must equal ${expectedVersion} for ${type}`);
  if (value.artifactType !== type) throw new Error(`$.artifactType must equal ${type}`);
}

function nullableResourceClass(value, path) { if (value !== null) enumeration(value, path, RESOURCE_CLASSES); }

function sortedUniqueStrings(values, path, validator) {
  values.forEach((value, index) => validator(value, `${path}[${index}]`));
  unique(values, path);
  if (values.some((value, index) => index > 0 && values[index - 1].localeCompare(value) > 0)) {
    throw new Error(`${path} must be sorted`);
  }
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

function cleanupAction(value, path) {
  object(value, path, ['sequence', 'resourceClass', 'immutableIdentity', 'action', 'locatorKind', 'locator', 'ownershipDigest', 'observationDigest', 'dependencyIdentities']);
  integer(value.sequence, `${path}.sequence`, { min: 1 });
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.action, `${path}.action`, ACTIONS);
  enumeration(value.locatorKind, `${path}.locatorKind`, LOCATOR_KINDS);
  string(value.locator, `${path}.locator`, { max: 1024 });
  digest(value.ownershipDigest, `${path}.ownershipDigest`);
  digest(value.observationDigest, `${path}.observationDigest`);
  const dependencies = array(value.dependencyIdentities, `${path}.dependencyIdentities`, { max: 512 });
  sortedUniqueStrings(dependencies, `${path}.dependencyIdentities`, digest);
}

function result(value, path) {
  object(value, path, ['sequence', 'immutableIdentity', 'result', 'failureClass']);
  integer(value.sequence, `${path}.sequence`, { min: 1 });
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.result, `${path}.result`, RESULTS);
  enumeration(value.failureClass, `${path}.failureClass`, FAILURE_CLASSES);
}

function cleanupResult(value, path) {
  object(value, path, ['sequence', 'resourceClass', 'immutableIdentity', 'result', 'failureClass']);
  integer(value.sequence, `${path}.sequence`, { min: 1 });
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.result, `${path}.result`, RESULTS);
  enumeration(value.failureClass, `${path}.failureClass`, FAILURE_CLASSES);
}

function ordered(items, path) {
  items.forEach((entry, index) => {
    if (entry.sequence !== index + 1) throw new Error(`${path} sequences must be contiguous from 1`);
  });
}

function validateInventory(value) {
  base(value, 'inventory', ['deploymentId', 'operationRunId', 'observedAt', 'complete', 'policyDigest', 'resources', 'ambiguities'], '1.0.0');
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
  base(value, 'cleanup_plan', ['deploymentId', 'operationRunId', 'createdAt', 'inventoryDigest', 'policyDigest', 'actions'], '1.0.0');
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  timestamp(value.createdAt, '$.createdAt');
  digest(value.inventoryDigest, '$.inventoryDigest');
  digest(value.policyDigest, '$.policyDigest');
  array(value.actions, '$.actions').forEach((entry, index) => action(entry, `$.actions[${index}]`));
  ordered(value.actions, '$.actions');
}

function validateApproval(value) {
  base(value, 'cleanup_approval', ['deploymentId', 'operationRunId', 'issuedAt', 'expiresAt', 'nonce', 'planDigest', 'policyDigest', 'contextFingerprint', 'permittedClasses', 'permittedActionCount', 'decommission'], '1.0.0');
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
  base(value, 'cleanup_receipt', ['deploymentId', 'operationRunId', 'state', 'operationStartedAt', 'operationEndedAt', 'receiptCoreFinalizedAt', 'policyDigest', 'deploymentManifestDigest', 'runManifestDigest', 'planDigest', 'approvalDigest', 'approvalStateDigest', 'inventoryBeforeDigest', 'inventoryAfterDigest', 'journalDigest', 'journalBytes', 'journalRecords', 'actions', 'results', 'refusals', 'signerKeyId'], '1.0.0');
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

function validateInventoryRunning(value, path, includeRunning) {
  if (!includeRunning) return;
  if (value.resourceClass === 'compose_container') {
    boolean(value.running, `${path}.running`);
    return;
  }
  if (value.running !== null) throw new Error(`${path}.running must be null for non-container resources`);
}

function validateInventoryResource(value, path, { includeRunning = false } = {}) {
  const keys = [
    'resourceClass', 'locatorKind', 'locator', 'immutableIdentity', 'ownership',
    'ownershipDigest', 'observationDigest', 'disposition', 'failureClasses',
    'references', 'contentDigests', 'dependencyIdentities', 'active', 'protected', 'data',
  ];
  object(value, path, includeRunning ? [...keys, 'running'] : keys);
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  enumeration(value.locatorKind, `${path}.locatorKind`, LOCATOR_KINDS);
  string(value.locator, `${path}.locator`, { max: 1024 });
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  if (value.ownership === null) {
    if (value.ownershipDigest !== null) throw new Error(`${path}.ownershipDigest must be null without ownership`);
  } else {
    ownership(value.ownership, `${path}.ownership`);
    if (value.ownership.resourceClass !== value.resourceClass
      || value.ownership.immutableIdentity !== value.immutableIdentity) {
      throw new Error(`${path}.ownership must match the resource class and immutable identity`);
    }
    digest(value.ownershipDigest, `${path}.ownershipDigest`);
    if (value.ownershipDigest !== canonicalSha256(value.ownership)) {
      throw new Error(`${path}.ownershipDigest must match canonical ownership`);
    }
  }
  digest(value.observationDigest, `${path}.observationDigest`);
  enumeration(value.disposition, `${path}.disposition`, DISPOSITIONS);
  const failures = array(value.failureClasses, `${path}.failureClasses`, { max: FAILURE_CLASSES.length });
  sortedUniqueStrings(failures, `${path}.failureClasses`, (entry, entryPath) => (
    enumeration(entry, entryPath, FAILURE_CLASSES)
  ));
  if (failures.includes('none')) throw new Error(`${path}.failureClasses cannot contain none`);
  if (value.disposition === 'eligible' && (failures.length > 0 || value.ownership === null)) {
    throw new Error(`${path} eligible resources require ownership and no failures`);
  }
  if (value.disposition !== 'eligible' && failures.length === 0) {
    throw new Error(`${path} non-eligible resources require a failure class`);
  }
  const references = array(value.references, `${path}.references`, { max: 512 });
  sortedUniqueStrings(references, `${path}.references`, (entry, entryPath) => string(entry, entryPath, { max: 512 }));
  const contentDigests = array(value.contentDigests, `${path}.contentDigests`, { max: 128 });
  sortedUniqueStrings(contentDigests, `${path}.contentDigests`, digest);
  const dependencies = array(value.dependencyIdentities, `${path}.dependencyIdentities`, { max: 512 });
  sortedUniqueStrings(dependencies, `${path}.dependencyIdentities`, digest);
  boolean(value.active, `${path}.active`);
  boolean(value.protected, `${path}.protected`);
  boolean(value.data, `${path}.data`);
  validateInventoryRunning(value, path, includeRunning);
}

function validateAmbiguity(value, path) {
  object(value, path, ['adapter', 'resourceClass', 'failureClass', 'scope']);
  identifier(value.adapter, `${path}.adapter`);
  nullableResourceClass(value.resourceClass, `${path}.resourceClass`);
  enumeration(value.failureClass, `${path}.failureClass`, FAILURE_CLASSES);
  if (!['identity_changed', 'malformed', 'query_failed', 'unsupported'].includes(value.failureClass)) throw new Error(`${path}.failureClass is not an ambiguity class`);
  identifier(value.scope, `${path}.scope`);
}

function validateInventoryV11(value) {
  validateInventoryCurrent(value, CLEANUP_SCHEMA_VERSION, false);
}

function validateInventoryV12(value) {
  validateInventoryCurrent(value, CLEANUP_EXECUTION_SCHEMA_VERSION, true);
}

function validateInventoryCurrent(value, schemaVersion, includeRunning) {
  base(value, 'inventory', [
    'deploymentId', 'operationRunId', 'generation', 'observedAt', 'complete',
    'policyDigest', 'deploymentManifestDigest', 'runManifestDigest',
    'contextFingerprint', 'resources', 'ambiguities',
  ], schemaVersion);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  integer(value.generation, '$.generation', { min: 1 });
  timestamp(value.observedAt, '$.observedAt');
  boolean(value.complete, '$.complete');
  for (const key of ['policyDigest', 'deploymentManifestDigest', 'runManifestDigest', 'contextFingerprint']) digest(value[key], `$.${key}`);
  const resources = array(value.resources, '$.resources', { max: 10_000 });
  resources.forEach((entry, index) => validateInventoryResource(
    entry, `$.resources[${index}]`, { includeRunning },
  ));
  unique(resources.map((entry) => `${entry.resourceClass}:${entry.immutableIdentity}`), '$.resources identity');
  const ambiguities = array(value.ambiguities, '$.ambiguities', { max: 10_000 });
  ambiguities.forEach((entry, index) => validateAmbiguity(entry, `$.ambiguities[${index}]`));
  if (value.complete !== (ambiguities.length === 0)) throw new Error('$.complete must reflect whether ambiguities are empty');
}

function validateCleanupActions(actions, path) {
  actions.forEach((entry, index) => cleanupAction(entry, `${path}[${index}]`));
  ordered(actions, path);
  unique(actions.map((entry) => `${entry.resourceClass}:${entry.immutableIdentity}:${entry.action}`), `${path} identity`);
}

function validatePlanV11(value) {
  base(value, 'cleanup_plan', [
    'deploymentId', 'operationRunId', 'createdAt', 'inventoryDigest', 'policyDigest',
    'deploymentManifestDigest', 'runManifestDigest', 'contextFingerprint', 'actions',
  ], CLEANUP_SCHEMA_VERSION);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  timestamp(value.createdAt, '$.createdAt');
  for (const key of ['inventoryDigest', 'policyDigest', 'deploymentManifestDigest', 'runManifestDigest', 'contextFingerprint']) digest(value[key], `$.${key}`);
  const actions = array(value.actions, '$.actions', { max: 3_000 });
  validateCleanupActions(actions, '$.actions');
}

function validateApprovalV11(value) {
  base(value, 'cleanup_approval', [
    'deploymentId', 'operationRunId', 'issuedAt', 'expiresAt', 'nonce',
    'dryRunReceiptDigest', 'planDigest', 'policyDigest', 'deploymentManifestDigest',
    'runManifestDigest', 'contextFingerprint', 'actions', 'permittedClasses',
    'permittedActionCount', 'decommission', 'signerKeyId',
  ], CLEANUP_SCHEMA_VERSION);
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  const issued = timestamp(value.issuedAt, '$.issuedAt');
  const expires = timestamp(value.expiresAt, '$.expiresAt');
  if (expires <= issued) throw new Error('$.expiresAt must follow issuedAt');
  if (expires - issued > MAX_APPROVAL_TTL_MS) throw new Error('$.expiresAt exceeds the maximum approval lifetime');
  identifier(value.nonce, '$.nonce');
  for (const key of ['dryRunReceiptDigest', 'planDigest', 'policyDigest', 'deploymentManifestDigest', 'runManifestDigest', 'contextFingerprint', 'signerKeyId']) digest(value[key], `$.${key}`);
  const actions = array(value.actions, '$.actions', { min: 1, max: 3_000 });
  validateCleanupActions(actions, '$.actions');
  const permittedClasses = array(value.permittedClasses, '$.permittedClasses', { min: 1, max: RESOURCE_CLASSES.length });
  sortedUniqueStrings(permittedClasses, '$.permittedClasses', (entry, entryPath) => (
    enumeration(entry, entryPath, RESOURCE_CLASSES)
  ));
  const actionClasses = [...new Set(actions.map((entry) => entry.resourceClass))].sort();
  if (actionClasses.length !== permittedClasses.length
    || actionClasses.some((entry, index) => entry !== permittedClasses[index])) {
    throw new Error('$.permittedClasses must exactly match action resource classes');
  }
  integer(value.permittedActionCount, '$.permittedActionCount', { min: 1 });
  if (value.permittedActionCount !== actions.length) throw new Error('$.permittedActionCount must equal actions length');
  boolean(value.decommission, '$.decommission');
}

function validateRefusal(value, path) {
  object(value, path, ['resourceClass', 'immutableIdentity', 'failureClass']);
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.failureClass, `${path}.failureClass`, FAILURE_CLASSES);
  if (value.failureClass === 'none') throw new Error(`${path}.failureClass must describe a refusal`);
}

function validatePlanningReceiptState(value) {
  if (value.results.length !== value.actions.length) throw new Error('$.results must correspond one-to-one with actions');
  value.results.forEach((entry, index) => {
    const target = value.actions[index];
    if (entry.sequence !== target.sequence || entry.resourceClass !== target.resourceClass
      || entry.immutableIdentity !== target.immutableIdentity
      || entry.result !== 'pending' || entry.failureClass !== 'none') {
      throw new Error(`$.results[${index}] must be the pending result for its action`);
    }
  });
  if (value.state === 'dry_run' && (value.actions.length === 0 || value.refusals.length > 0)) {
    throw new Error('dry_run receipts require actions and no refusals');
  }
  if (value.state === 'no_op' && (value.actions.length > 0 || value.refusals.length > 0)) {
    throw new Error('no_op receipts cannot contain actions or refusals');
  }
  if (value.state === 'refused' && value.refusals.length === 0) throw new Error('refused receipts require refusals');
  if (value.state === 'ambiguous') {
    if (value.actions.length > 0 || value.refusals.length === 0) throw new Error('ambiguous receipts require refusals and no actions');
    if (!value.refusals.some((entry) => (
      ['identity_changed', 'malformed', 'query_failed', 'unsupported'].includes(entry.failureClass)
    ))) throw new Error('ambiguous receipts require an ambiguity failure class');
  }
}

function validatePlanningReceipt(value, now) {
  base(value, 'cleanup_receipt', [
    'phase', 'deploymentId', 'operationRunId', 'state', 'operationStartedAt',
    'operationEndedAt', 'receiptCoreFinalizedAt', 'policyDigest',
    'deploymentManifestDigest', 'runManifestDigest', 'planDigest', 'approvalDigest',
    'approvalStateDigest', 'inventoryBeforeDigest', 'inventoryAfterDigest',
    'journalDigest', 'journalBytes', 'journalRecords', 'actions', 'results',
    'refusals', 'signerKeyId',
  ], CLEANUP_SCHEMA_VERSION);
  if (value.phase !== 'planning') throw new Error('$.phase must equal planning');
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  enumeration(value.state, '$.state', PLANNING_STATES);
  const started = timestamp(value.operationStartedAt, '$.operationStartedAt');
  const ended = timestamp(value.operationEndedAt, '$.operationEndedAt');
  const finalized = timestamp(value.receiptCoreFinalizedAt, '$.receiptCoreFinalizedAt');
  if (started > ended || ended > finalized) throw new Error('receipt timestamps are out of order');
  if (finalized > now.getTime()) throw new Error('receipt finalization timestamp is in the future');
  for (const key of ['policyDigest', 'deploymentManifestDigest', 'runManifestDigest', 'planDigest', 'inventoryBeforeDigest', 'signerKeyId']) digest(value[key], `$.${key}`);
  for (const key of ['approvalDigest', 'approvalStateDigest', 'inventoryAfterDigest', 'journalDigest']) {
    if (value[key] !== null) throw new Error(`$.${key} must be null during planning`);
  }
  integer(value.journalBytes, '$.journalBytes');
  integer(value.journalRecords, '$.journalRecords');
  if (value.journalBytes !== 0 || value.journalRecords !== 0) throw new Error('planning receipts cannot contain a journal');
  const actions = array(value.actions, '$.actions', { max: 3_000 });
  validateCleanupActions(actions, '$.actions');
  const results = array(value.results, '$.results', { max: 3_000 });
  results.forEach((entry, index) => cleanupResult(entry, `$.results[${index}]`));
  ordered(results, '$.results');
  const refusals = array(value.refusals, '$.refusals', { max: 10_000 });
  refusals.forEach((entry, index) => validateRefusal(entry, `$.refusals[${index}]`));
  unique(refusals.map((entry) => `${entry.resourceClass}:${entry.immutableIdentity}:${entry.failureClass}`), '$.refusals identity');
  validatePlanningReceiptState({ ...value, actions, results, refusals });
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
  resource_registration: validateRegistration,
  inventory: validateInventory,
  cleanup_plan: validatePlan,
  cleanup_approval: validateApproval,
  approval_state: validateApprovalState,
  journal_record: validateJournal,
  cleanup_receipt: validateReceipt,
  cleanup_receipt_upload: validateUploadReceipt,
};

const CLEANUP_V11_VALIDATORS = {
  resource_registration: validateRegistration,
  inventory: validateInventoryV11,
  cleanup_plan: validatePlanV11,
  cleanup_approval: validateApprovalV11,
  cleanup_receipt: validatePlanningReceipt,
};

const CLEANUP_V12_VALIDATORS = {
  inventory: validateInventoryV12,
  cleanup_receipt: validateExecutionReceipt,
};

const CLEANUP_V13_VALIDATORS = {
  cleanup_receipt: validateCoordinationReceipt,
};

export function validateArtifact(value, { now = new Date() } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('$ must be an object');
  enumeration(value.artifactType, '$.artifactType', ARTIFACT_TYPES);
  const validator = value.schemaVersion === CLEANUP_COORDINATION_SCHEMA_VERSION
    ? CLEANUP_V13_VALIDATORS[value.artifactType]
    : value.schemaVersion === CLEANUP_EXECUTION_SCHEMA_VERSION
      ? CLEANUP_V12_VALIDATORS[value.artifactType]
    : value.schemaVersion === CLEANUP_SCHEMA_VERSION
      ? CLEANUP_V11_VALIDATORS[value.artifactType]
      : VALIDATORS[value.artifactType];
  if (!validator) throw new Error(`$.schemaVersion is not supported for ${value.artifactType}`);
  validator(value, now);
  return value;
}
