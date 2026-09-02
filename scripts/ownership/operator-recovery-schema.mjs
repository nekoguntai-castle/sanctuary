import { canonicalSha256 } from './canonical-json.mjs';
import {
  array, commit, digest, enumeration, identifier, integer, object, string,
  timestamp, unique,
} from './validation.mjs';
import {
  CLEANUP_ACTIONS, CLEANUP_FAILURE_CLASSES, CLEANUP_RESULTS, CLEANUP_STATES,
} from './cleanup-schema-contract.mjs';

export const OPERATOR_RECOVERY_SCHEMA_VERSION = '1.0.0';
export const OPERATOR_RECOVERY_AUTHORITY_KIND = 'operator_lost_authority_recovery';
export const OPERATOR_RECOVERY_TERMINALITY_AUTHORITY = 'operator_assertion_only';

const RESOURCE_CLASSES = Object.freeze(['compose_container', 'compose_network', 'compose_volume']);
const RECEIPT_STATES = CLEANUP_STATES.filter((state) => !['dry_run', 'no_op'].includes(state));
const MAX_TRUST_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_SCOPE_MS = 24 * 60 * 60 * 1000;
const MAX_APPROVAL_MS = 24 * 60 * 60 * 1000;
const MAX_ASSERTION_MS = 24 * 60 * 60 * 1000;
const ENGINE_ID = /^[a-f0-9]{64}$/;
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;

function artifact(value, type, keys) {
  object(value, '$', ['schemaVersion', 'artifactType', ...keys]);
  if (value.schemaVersion !== OPERATOR_RECOVERY_SCHEMA_VERSION || value.artifactType !== type) {
    throw new Error(`$ must be a ${type} ${OPERATOR_RECOVERY_SCHEMA_VERSION} artifact`);
  }
}

function authorityKind(value, path = '$.authorityKind') {
  if (value !== OPERATOR_RECOVERY_AUTHORITY_KIND) {
    throw new Error(`${path} must equal ${OPERATOR_RECOVERY_AUTHORITY_KIND}`);
  }
}

function sortedUniqueDigests(values, path, { min = 0, max = 256 } = {}) {
  array(values, path, { min, max }).forEach((value, index) => digest(value, `${path}[${index}]`));
  unique(values, path);
  if (values.some((value, index) => index > 0 && values[index - 1].localeCompare(value) >= 0)) {
    throw new Error(`${path} must be sorted`);
  }
}

function timeWindow(startValue, endValue, startPath, endPath, maximum) {
  const start = timestamp(startValue, startPath);
  const end = timestamp(endValue, endPath);
  if (end <= start || end - start > maximum) throw new Error(`${endPath} must follow ${startPath} by no more than ${maximum}ms`);
  return { start, end };
}

function assertCurrent(window, now, label) {
  if (now === undefined) return;
  const instant = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(instant) || instant < window.start || instant >= window.end) {
    throw new Error(`${label} is not currently valid`);
  }
}

function validateRoleFingerprints(value) {
  sortedUniqueDigests(value.authorizationFingerprints, '$.authorizationFingerprints', { min: 1, max: 2 });
  sortedUniqueDigests(value.evidenceFingerprints, '$.evidenceFingerprints', { min: 1, max: 2 });
  if (value.authorizationFingerprints.some((entry) => value.evidenceFingerprints.includes(entry))) {
    throw new Error('recovery trust authorization and evidence roles must be distinct');
  }
}

export function validateHostRecoveryTrust(value, { now } = {}) {
  artifact(value, 'operator_recovery_trust', [
    'trustId', 'validFrom', 'validUntil', 'authorizationFingerprints', 'evidenceFingerprints',
  ]);
  identifier(value.trustId, '$.trustId');
  const window = timeWindow(value.validFrom, value.validUntil, '$.validFrom', '$.validUntil', MAX_TRUST_MS);
  validateRoleFingerprints(value);
  assertCurrent(window, now, 'recovery trust');
  return value;
}

export function buildHostRecoveryTrust(input) {
  const value = {
    schemaVersion: OPERATOR_RECOVERY_SCHEMA_VERSION,
    artifactType: 'operator_recovery_trust',
    ...input,
    authorizationFingerprints: [...(input.authorizationFingerprints ?? [])].sort(),
    evidenceFingerprints: [...(input.evidenceFingerprints ?? [])].sort(),
  };
  return validateHostRecoveryTrust(value);
}

function validateAssertionTrust(value, trust) {
  if (!trust) return;
  validateHostRecoveryTrust(trust, { now: value.issuedAt });
  if (value.trustDigest !== canonicalSha256(trust)
      || !trust.authorizationFingerprints.includes(value.signerKeyId)) {
    throw new Error('assertion signer is not authorized by recovery trust');
  }
  if (Date.parse(value.expiresAt) > Date.parse(trust.validUntil)) {
    throw new Error('assertion validity exceeds recovery trust validity');
  }
}

export function validateOperatorRecoveryAssertion(value, { trust, now } = {}) {
  artifact(value, 'operator_recovery_assertion', [
    'authorityKind', 'assertionId', 'project', 'deploymentId', 'ownerId',
    'sourceCommit', 'sourceExecutionId', 'sourceState', 'historicalTerminalityAuthority',
    'issuedAt', 'expiresAt', 'trustDigest', 'providerCorrelationEvidenceDigest',
    'queryResultCoreDigest', 'signerKeyId',
  ]);
  authorityKind(value.authorityKind);
  for (const key of ['assertionId', 'project', 'deploymentId', 'ownerId', 'sourceExecutionId']) {
    identifier(value[key], `$.${key}`);
  }
  commit(value.sourceCommit, '$.sourceCommit');
  enumeration(value.sourceState, '$.sourceState', ['terminal']);
  enumeration(value.historicalTerminalityAuthority, '$.historicalTerminalityAuthority', [
    OPERATOR_RECOVERY_TERMINALITY_AUTHORITY,
  ]);
  const window = timeWindow(value.issuedAt, value.expiresAt, '$.issuedAt', '$.expiresAt', MAX_ASSERTION_MS);
  for (const key of [
    'trustDigest', 'providerCorrelationEvidenceDigest', 'queryResultCoreDigest', 'signerKeyId',
  ]) digest(value[key], `$.${key}`);
  validateAssertionTrust(value, trust);
  assertCurrent(window, now, 'operator recovery assertion');
  return value;
}

export function buildOperatorRecoveryAssertion(input) {
  const { trust, ...fields } = input;
  if (!trust) throw new Error('recovery trust is required to build an operator assertion');
  const value = {
    schemaVersion: OPERATOR_RECOVERY_SCHEMA_VERSION,
    artifactType: 'operator_recovery_assertion', authorityKind: OPERATOR_RECOVERY_AUTHORITY_KIND,
    ...fields,
  };
  return validateOperatorRecoveryAssertion(value, { trust });
}

function validateOwnership(value, path, resourceClass, immutableIdentity) {
  object(value, path, [
    'project', 'deploymentId', 'ownerId', 'resourceClass', 'lifecycle', 'cleanupPolicy',
    'createdAt', 'createdByRelease', 'createdByCommit', 'creationRunId', 'immutableIdentity',
  ]);
  for (const key of ['project', 'deploymentId', 'ownerId', 'creationRunId']) identifier(value[key], `${path}.${key}`);
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  if (value.resourceClass !== resourceClass || value.immutableIdentity !== immutableIdentity) {
    throw new Error(`${path} does not bind the resource identity`);
  }
  if (value.lifecycle !== 'obsolete' || value.cleanupPolicy !== 'exact_delete') {
    throw new Error(`${path} must be obsolete exact_delete ownership`);
  }
  timestamp(value.createdAt, `${path}.createdAt`);
  string(value.createdByRelease, `${path}.createdByRelease`, { max: 128 });
  commit(value.createdByCommit, `${path}.createdByCommit`);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
}

function validateResourceIdentity(value, path) {
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  if (value.resourceClass === 'compose_volume') {
    if (value.locatorKind !== 'name' || !VOLUME_NAME.test(value.locator) || !ENGINE_ID.test(value.immutableIdentity)) {
      throw new Error(`${path} compose_volume identity is invalid`);
    }
  } else if (value.locatorKind !== 'engine_id' || !ENGINE_ID.test(value.locator)
    || value.immutableIdentity !== value.locator) {
    throw new Error(`${path} immutable engine identity is invalid`);
  }
}

function validateRecoveryResource(value, path) {
  const volumeKeys = value?.resourceClass === 'compose_volume' ? ['attestationNonce'] : [];
  object(value, path, [
    'resourceClass', 'locatorKind', 'locator', 'immutableIdentity', 'ownership',
    'ownershipDigest', 'observationDigest', 'dependencyIdentities', 'target', ...volumeKeys,
  ]);
  validateResourceIdentity(value, path);
  validateOwnership(value.ownership, `${path}.ownership`, value.resourceClass, value.immutableIdentity);
  digest(value.ownershipDigest, `${path}.ownershipDigest`);
  if (value.ownershipDigest !== canonicalSha256(value.ownership)) throw new Error(`${path}.ownershipDigest does not match ownership`);
  digest(value.observationDigest, `${path}.observationDigest`);
  sortedUniqueDigests(value.dependencyIdentities, `${path}.dependencyIdentities`, { max: 512 });
  if (value.target !== true) throw new Error(`${path}.target must be true`);
  if (value.resourceClass === 'compose_volume') identifier(value.attestationNonce, `${path}.attestationNonce`);
}

function resourceOrder(left, right) {
  return left.resourceClass.localeCompare(right.resourceClass)
    || left.immutableIdentity.localeCompare(right.immutableIdentity)
    || left.locator.localeCompare(right.locator);
}

function validateScopeResources(value) {
  const resources = array(value.resources, '$.resources', { min: 1, max: 256 });
  resources.forEach((entry, index) => validateRecoveryResource(entry, `$.resources[${index}]`));
  unique(resources.map((entry) => `${entry.resourceClass}:${entry.immutableIdentity}`), '$.resources duplicate identity');
  if (resources.some((entry, index) => index > 0 && resourceOrder(resources[index - 1], entry) >= 0)) {
    throw new Error('$.resources must be sorted');
  }
  for (const entry of resources) {
    if (entry.ownership.project !== value.project || entry.ownership.deploymentId !== value.deploymentId
      || entry.ownership.ownerId !== value.ownerId) throw new Error('$.resources ownership tuple does not match scope');
  }
}

export function validateOperatorRecoveryScope(value, { now, trust, assertion } = {}) {
  artifact(value, 'operator_recovery_scope', [
    'authorityKind', 'scopeId', 'deploymentId', 'operationRunId', 'project', 'ownerId',
    'observedAt', 'expiresAt', 'trustDigest', 'policyDigest', 'daemonContextFingerprint',
    'operatorAssertionDigest', 'providerCorrelationEvidenceDigest', 'queryResultCoreDigest',
    'resources', 'signerKeyId',
  ]);
  authorityKind(value.authorityKind);
  for (const key of ['scopeId', 'deploymentId', 'operationRunId', 'project', 'ownerId']) identifier(value[key], `$.${key}`);
  const window = timeWindow(value.observedAt, value.expiresAt, '$.observedAt', '$.expiresAt', MAX_SCOPE_MS);
  for (const key of [
    'trustDigest', 'policyDigest', 'daemonContextFingerprint', 'operatorAssertionDigest',
    'providerCorrelationEvidenceDigest', 'queryResultCoreDigest', 'signerKeyId',
  ]) digest(value[key], `$.${key}`);
  validateScopeResources(value);
  validateScopeTrust(value, trust);
  validateScopeAssertion(value, assertion, trust);
  assertCurrent(window, now, 'operator recovery scope');
  return value;
}

function validateScopeTrust(value, trust) {
  if (!trust) return;
  validateHostRecoveryTrust(trust, { now: value.observedAt });
  if (value.trustDigest !== canonicalSha256(trust)
      || !trust.authorizationFingerprints.includes(value.signerKeyId)) {
    throw new Error('scope signer is not authorized by recovery trust');
  }
  if (Date.parse(value.expiresAt) > Date.parse(trust.validUntil)) {
    throw new Error('scope validity exceeds recovery trust validity');
  }
}

function validateScopeAssertion(value, assertion, trust) {
  if (!assertion) return;
  validateOperatorRecoveryAssertion(assertion, { trust, now: value.observedAt });
  if (value.operatorAssertionDigest !== canonicalSha256(assertion)
      || value.providerCorrelationEvidenceDigest !== assertion.providerCorrelationEvidenceDigest
      || value.queryResultCoreDigest !== assertion.queryResultCoreDigest
      || value.project !== assertion.project || value.deploymentId !== assertion.deploymentId
      || value.ownerId !== assertion.ownerId || value.signerKeyId !== assertion.signerKeyId
      || value.resources.some((entry) => entry.ownership.createdByCommit !== assertion.sourceCommit
        || entry.ownership.creationRunId !== assertion.sourceExecutionId)) {
    throw new Error('scope does not bind the operator assertion');
  }
  if (Date.parse(value.expiresAt) > Date.parse(assertion.expiresAt)) {
    throw new Error('scope validity exceeds operator assertion validity');
  }
}

export function buildOperatorRecoveryScope(input) {
  const { trust, assertion, ...fields } = input;
  if (!trust || !assertion) {
    throw new Error('recovery trust and operator assertion are required to build a scope');
  }
  const value = {
    schemaVersion: OPERATOR_RECOVERY_SCHEMA_VERSION,
    artifactType: 'operator_recovery_scope', authorityKind: OPERATOR_RECOVERY_AUTHORITY_KIND,
    ...fields, resources: [...(fields.resources ?? [])].sort(resourceOrder),
  };
  return validateOperatorRecoveryScope(value, { trust, assertion });
}

function validateAction(value, path) {
  object(value, path, [
    'sequence', 'resourceClass', 'immutableIdentity', 'action', 'locatorKind', 'locator',
    'ownershipDigest', 'observationDigest', 'dependencyIdentities',
  ]);
  integer(value.sequence, `${path}.sequence`, { min: 1 });
  validateResourceIdentity(value, path);
  enumeration(value.action, `${path}.action`, CLEANUP_ACTIONS);
  if (value.resourceClass === 'compose_container' ? !['stop', 'remove'].includes(value.action) : value.action !== 'remove') {
    throw new Error(`${path}.action is invalid for ${value.resourceClass}`);
  }
  digest(value.ownershipDigest, `${path}.ownershipDigest`);
  digest(value.observationDigest, `${path}.observationDigest`);
  sortedUniqueDigests(value.dependencyIdentities, `${path}.dependencyIdentities`, { max: 512 });
}

function validateActions(actions, path = '$.actions') {
  array(actions, path, { min: 1, max: 512 }).forEach((entry, index) => {
    validateAction(entry, `${path}[${index}]`);
    if (entry.sequence !== index + 1) throw new Error(`${path} sequences must be contiguous`);
  });
  unique(actions.map((entry) => `${entry.resourceClass}:${entry.immutableIdentity}:${entry.action}`), `${path} duplicate action`);
}

function validateScopeActions(actions, scope) {
  const expected = new Map(scope.resources.map((entry) => [
    `${entry.resourceClass}:${entry.immutableIdentity}`, entry,
  ]));
  for (const action of actions) {
    const resource = expected.get(`${action.resourceClass}:${action.immutableIdentity}`);
    if (!resource || action.locatorKind !== resource.locatorKind || action.locator !== resource.locator
        || action.ownershipDigest !== resource.ownershipDigest
        || action.observationDigest !== resource.observationDigest
        || (action.action === 'stop' && action.dependencyIdentities.length !== 0)
        || (action.action === 'remove'
          && canonicalSha256(action.dependencyIdentities) !== canonicalSha256(resource.dependencyIdentities))) {
      throw new Error('approval action does not exactly bind a scope resource');
    }
  }
  for (const resource of scope.resources) {
    const actionsForResource = actions.filter((entry) => entry.resourceClass === resource.resourceClass
      && entry.immutableIdentity === resource.immutableIdentity).map((entry) => entry.action).sort();
    const required = resource.resourceClass === 'compose_container' ? ['remove', 'stop'] : ['remove'];
    if (canonicalSha256(actionsForResource) !== canonicalSha256(required)) {
      throw new Error('approval actions do not cover every scope resource');
    }
  }
}

export function validateOperatorRecoveryApproval(value, { scope, trust, now } = {}) {
  artifact(value, 'operator_recovery_approval', [
    'authorityKind', 'scopeDigest', 'trustDigest', 'deploymentId', 'operationRunId',
    'issuedAt', 'expiresAt', 'nonce', 'planDigest', 'dryRunReceiptDigest',
    'contextFingerprint', 'actions', 'actionsDigest', 'permittedClasses',
    'permittedActionCount', 'signerKeyId',
  ]);
  authorityKind(value.authorityKind);
  for (const key of ['scopeDigest', 'trustDigest', 'planDigest', 'dryRunReceiptDigest', 'contextFingerprint', 'actionsDigest', 'signerKeyId']) digest(value[key], `$.${key}`);
  for (const key of ['deploymentId', 'operationRunId', 'nonce']) identifier(value[key], `$.${key}`);
  const window = timeWindow(value.issuedAt, value.expiresAt, '$.issuedAt', '$.expiresAt', MAX_APPROVAL_MS);
  validateActions(value.actions);
  if (value.actionsDigest !== canonicalSha256(value.actions)) throw new Error('$.actionsDigest does not match actions');
  const classes = [...new Set(value.actions.map((entry) => entry.resourceClass))].sort();
  if (JSON.stringify(value.permittedClasses) !== JSON.stringify(classes)) throw new Error('$.permittedClasses must exactly match action classes');
  if (value.permittedActionCount !== value.actions.length) throw new Error('$.permittedActionCount must equal actions length');
  if (scope) {
    validateOperatorRecoveryScope(scope, { trust });
    if (value.scopeDigest !== canonicalSha256(scope) || value.trustDigest !== scope.trustDigest
      || value.deploymentId !== scope.deploymentId || value.operationRunId !== scope.operationRunId) {
      throw new Error('approval scopeDigest or scope binding does not match');
    }
    if (value.signerKeyId !== scope.signerKeyId) throw new Error('approval authorization signer does not match scope');
    validateScopeActions(value.actions, scope);
  }
  assertCurrent(window, now, 'operator recovery approval');
  return value;
}

export function buildOperatorRecoveryApproval(input) {
  const { scope, trust, ...fields } = input;
  if (!scope || !trust) throw new Error('scope and recovery trust are required to build an approval');
  const actions = [...(fields.actions ?? [])];
  const value = {
    schemaVersion: OPERATOR_RECOVERY_SCHEMA_VERSION,
    artifactType: 'operator_recovery_approval', authorityKind: OPERATOR_RECOVERY_AUTHORITY_KIND,
    actionsDigest: canonicalSha256(actions),
    permittedClasses: [...new Set(actions.map((entry) => entry.resourceClass))].sort(),
    permittedActionCount: actions.length,
    ...fields, actions,
  };
  return validateOperatorRecoveryApproval(value, { scope, trust });
}

function validateReceiptResult(value, path, action) {
  object(value, path, [
    'sequence', 'resourceClass', 'immutableIdentity', 'result', 'failureClass',
    'postconditionState', 'postconditionDigest',
  ]);
  integer(value.sequence, `${path}.sequence`, { min: 1 });
  enumeration(value.resourceClass, `${path}.resourceClass`, RESOURCE_CLASSES);
  identifier(value.immutableIdentity, `${path}.immutableIdentity`);
  enumeration(value.result, `${path}.result`, CLEANUP_RESULTS.filter((entry) => entry !== 'pending'));
  enumeration(value.failureClass, `${path}.failureClass`, CLEANUP_FAILURE_CLASSES);
  enumeration(value.postconditionState, `${path}.postconditionState`, ['satisfied', 'failed', 'ambiguous', 'not_run']);
  if (!action || value.sequence !== action.sequence || value.resourceClass !== action.resourceClass
    || value.immutableIdentity !== action.immutableIdentity) throw new Error(`${path} does not match its action`);
  const successful = ['cleaned', 'absent'].includes(value.result);
  if (successful !== (value.failureClass === 'none' && value.postconditionState === 'satisfied')) {
    throw new Error(`${path} result, failure, and postcondition are inconsistent`);
  }
  if (!successful && value.failureClass === 'none') {
    throw new Error(`${path} unsuccessful result requires a failure class`);
  }
  if (value.postconditionState === 'satisfied') digest(value.postconditionDigest, `${path}.postconditionDigest`);
  else if (value.postconditionDigest !== null) throw new Error(`${path}.postconditionDigest must be null without satisfaction`);
}

function successfulReceipt(value) {
  return ['cleaned', 'recovered'].includes(value.state)
    && value.results.length === value.actions.length
    && value.results.every((entry) => ['cleaned', 'absent'].includes(entry.result)
      && entry.failureClass === 'none' && entry.postconditionState === 'satisfied');
}

function validateReceiptTiming(value, now) {
  const started = timestamp(value.operationStartedAt, '$.operationStartedAt');
  const ended = timestamp(value.operationEndedAt, '$.operationEndedAt');
  if (ended < started) throw new Error('$.operationEndedAt must not precede operationStartedAt');
  const instant = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (now !== undefined && (!Number.isFinite(instant) || ended > instant)) {
    throw new Error('receipt ends in the future or comparison time is invalid');
  }
}

function validateReceiptBindings(value, scope, approval, trust) {
  if (scope) validateOperatorRecoveryScope(scope, { trust });
  if (approval) validateOperatorRecoveryApproval(approval, { scope, trust });
  if (scope && (value.scopeDigest !== canonicalSha256(scope) || value.trustDigest !== scope.trustDigest
    || value.deploymentId !== scope.deploymentId || value.operationRunId !== scope.operationRunId
    || value.project !== scope.project
    || value.originalProviderCorrelationEvidenceDigest !== scope.providerCorrelationEvidenceDigest
    || value.queryResultCoreDigest !== scope.queryResultCoreDigest)) {
    throw new Error('receipt does not bind scope');
  }
  if (approval && (value.approvalDigest !== canonicalSha256(approval)
    || value.planDigest !== approval.planDigest)) throw new Error('receipt does not bind approval');
}

function validateReceiptTrust(value, trust) {
  if (!trust) return;
  validateHostRecoveryTrust(trust);
  if (value.trustDigest !== canonicalSha256(trust)
      || !trust.evidenceFingerprints.includes(value.signerKeyId)) {
    throw new Error('receipt signer is not authorized by recovery trust');
  }
}

export function validateOperatorRecoveryExecutionReceipt(value, { scope, approval, trust, now } = {}) {
  artifact(value, 'operator_recovery_execution_receipt', [
    'authorityKind', 'scopeDigest', 'approvalDigest', 'trustDigest', 'planDigest',
    'originalProviderCorrelationEvidenceDigest', 'revalidatedProviderCorrelationEvidenceDigest',
    'queryResultCoreDigest', 'finalObservationDigest', 'journalDigest',
    'deploymentId', 'operationRunId', 'project', 'state', 'operationStartedAt',
    'operationEndedAt', 'actions', 'results', 'signerKeyId',
  ]);
  authorityKind(value.authorityKind);
  for (const key of [
    'scopeDigest', 'approvalDigest', 'trustDigest', 'planDigest',
    'originalProviderCorrelationEvidenceDigest', 'revalidatedProviderCorrelationEvidenceDigest',
    'queryResultCoreDigest', 'finalObservationDigest', 'journalDigest', 'signerKeyId',
  ]) digest(value[key], `$.${key}`);
  if (value.revalidatedProviderCorrelationEvidenceDigest
      === value.originalProviderCorrelationEvidenceDigest) {
    throw new Error('receipt requires fresh provider correlation revalidation evidence');
  }
  for (const key of ['deploymentId', 'operationRunId', 'project']) identifier(value[key], `$.${key}`);
  enumeration(value.state, '$.state', RECEIPT_STATES);
  validateReceiptTiming(value, now);
  validateActions(value.actions);
  const results = array(value.results, '$.results', { max: value.actions.length });
  if (results.length !== value.actions.length) throw new Error('$.results must correspond one-to-one with actions');
  results.forEach((entry, index) => validateReceiptResult(entry, `$.results[${index}]`, value.actions[index]));
  if (['cleaned', 'recovered'].includes(value.state) && !successfulReceipt(value)) {
    throw new Error('cleaned or recovered receipts require successful results');
  }
  validateReceiptBindings(value, scope, approval, trust);
  validateReceiptTrust(value, trust);
  return value;
}

export function buildOperatorRecoveryExecutionReceipt(input) {
  const { scope, approval, trust, ...fields } = input;
  if (!scope || !approval || !trust) {
    throw new Error('scope, approval, and recovery trust are required to build an execution receipt');
  }
  const value = {
    schemaVersion: OPERATOR_RECOVERY_SCHEMA_VERSION,
    artifactType: 'operator_recovery_execution_receipt',
    authorityKind: OPERATOR_RECOVERY_AUTHORITY_KIND, ...fields,
  };
  return validateOperatorRecoveryExecutionReceipt(value, { scope, approval, trust });
}

function closeoutPair(scope, receipt, trust) {
  validateOperatorRecoveryScope(scope, { trust });
  validateOperatorRecoveryExecutionReceipt(receipt, { scope, trust });
  if (!successfulReceipt(receipt)) throw new Error('closeout requires a successful receipt');
  return {
    scopeId: scope.scopeId, scopeDigest: canonicalSha256(scope),
    receiptDigest: canonicalSha256(receipt), deploymentId: scope.deploymentId,
    operationRunId: scope.operationRunId, project: scope.project,
    trustDigest: scope.trustDigest, receiptState: receipt.state,
  };
}

function validateCloseoutPair(value, path) {
  object(value, path, [
    'scopeId', 'scopeDigest', 'receiptDigest', 'deploymentId', 'operationRunId',
    'project', 'trustDigest', 'receiptState',
  ]);
  for (const key of ['scopeId', 'deploymentId', 'operationRunId', 'project']) identifier(value[key], `${path}.${key}`);
  digest(value.scopeDigest, `${path}.scopeDigest`);
  digest(value.receiptDigest, `${path}.receiptDigest`);
  digest(value.trustDigest, `${path}.trustDigest`);
  enumeration(value.receiptState, `${path}.receiptState`, ['cleaned', 'recovered']);
}

export function validateOperatorRecoveryCloseout(value, { trust, now } = {}) {
  artifact(value, 'operator_recovery_closeout', [
    'incidentId', 'trustDigest', 'finalizedAt', 'pairs',
    'exclusionSentinelBeforeDigest', 'exclusionSentinelAfterDigest',
    'outOfScopeObservationDigest', 'signerKeyId',
  ]);
  identifier(value.incidentId, '$.incidentId');
  for (const key of ['trustDigest', 'exclusionSentinelBeforeDigest', 'exclusionSentinelAfterDigest', 'outOfScopeObservationDigest', 'signerKeyId']) digest(value[key], `$.${key}`);
  const finalizedAt = timestamp(value.finalizedAt, '$.finalizedAt');
  if (now !== undefined && finalizedAt > (now instanceof Date ? now.getTime() : new Date(now).getTime())) throw new Error('closeout is finalized in the future');
  const pairs = array(value.pairs, '$.pairs', { min: 4, max: 4 });
  pairs.forEach((entry, index) => validateCloseoutPair(entry, `$.pairs[${index}]`));
  if (pairs.some((entry) => entry.trustDigest !== value.trustDigest)) throw new Error('closeout pairs do not bind one recovery trust');
  unique(pairs.map((entry) => entry.scopeDigest), '$.pairs scope digest');
  unique(pairs.map((entry) => entry.receiptDigest), '$.pairs receipt digest');
  unique(pairs.map((entry) => entry.project), '$.pairs project');
  if (pairs.some((entry, index) => index > 0 && pairs[index - 1].project.localeCompare(entry.project) >= 0)) throw new Error('$.pairs must be sorted by project');
  if (value.exclusionSentinelBeforeDigest !== value.exclusionSentinelAfterDigest) throw new Error('closeout exclusion sentinels changed');
  if (trust) {
    validateHostRecoveryTrust(trust);
    if (value.trustDigest !== canonicalSha256(trust)
        || !trust.evidenceFingerprints.includes(value.signerKeyId)) {
      throw new Error('closeout signer is not authorized by recovery trust');
    }
  }
  return value;
}

export function buildOperatorRecoveryCloseout(input) {
  if (!input.trust) throw new Error('recovery trust is required to build a closeout');
  const pairs = (input.pairs ?? []).map(({ scope, receipt }) => closeoutPair(scope, receipt, input.trust))
    .sort((left, right) => left.project.localeCompare(right.project));
  const { pairs: ignored, trust, ...fields } = input;
  return validateOperatorRecoveryCloseout({
    schemaVersion: OPERATOR_RECOVERY_SCHEMA_VERSION,
    artifactType: 'operator_recovery_closeout', ...fields, pairs,
  }, { trust });
}
