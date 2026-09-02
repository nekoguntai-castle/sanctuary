import { canonicalSha256 } from './canonical-json.mjs';
import { ARTIFACT_SCHEMA_VERSIONS, validateArtifact } from './schemas.mjs';

const ACTION_ORDER = Object.freeze({ stop: 0, remove: 1, reconcile: 2, retain: 3 });
const SELF_CLEANUP_PROHIBITED = new Set(['cleanup_evidence', 'provider_publication']);

function classOrder(resourceClasses) {
  const byId = new Map(resourceClasses.map((entry) => [entry.classId, entry]));
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(classId) {
    if (visited.has(classId)) return;
    if (visiting.has(classId)) throw new Error(`resource dependency cycle at ${classId}`);
    const resource = byId.get(classId);
    if (!resource) throw new Error(`unknown resource class ${classId}`);
    visiting.add(classId);
    resource.dependsOn.forEach(visit);
    visiting.delete(classId);
    visited.add(classId);
    ordered.push(classId);
  }
  [...byId.keys()].sort().forEach(visit);
  return new Map(ordered.map((classId, index) => [classId, index]));
}

function plannedActions(resource, policy) {
  if (resource.disposition !== 'eligible') return [];
  if (SELF_CLEANUP_PROHIBITED.has(resource.resourceClass)) {
    throw new Error(`${resource.resourceClass} is a protected cleanup artifact and cannot be deleted`);
  }
  if (!Array.isArray(policy.cleanupPolicies) || !policy.cleanupPolicies.includes('exact_delete')) {
    throw new Error(`eligible ${resource.resourceClass} cannot be deleted by its ownership policy`);
  }
  if (resource.resourceClass === 'compose_container') return ['stop', 'remove'];
  if (resource.resourceClass === 'collector_process') return ['stop'];
  return ['remove'];
}

function compareActions(order, left, right) {
  return (order.get(left.resourceClass) - order.get(right.resourceClass))
    || left.immutableIdentity.localeCompare(right.immutableIdentity)
    || ACTION_ORDER[left.action] - ACTION_ORDER[right.action];
}

function actionFrom(resource, action) {
  if (resource.ownershipDigest === null) throw new Error('eligible resource requires an ownership digest');
  return {
    resourceClass: resource.resourceClass,
    immutableIdentity: resource.immutableIdentity,
    action,
    locatorKind: resource.locatorKind,
    locator: resource.locator,
    ownershipDigest: resource.ownershipDigest,
    observationDigest: resource.observationDigest,
    dependencyIdentities: action === 'remove'
      && ['compose_network', 'compose_volume', 'oci_image'].includes(resource.resourceClass)
      ? [...resource.dependencyIdentities] : [],
  };
}

function assertPlannedDependencies(actions) {
  const stopped = new Set();
  const removed = new Set();
  for (const action of actions) {
    if (action.resourceClass === 'compose_container' && action.action === 'stop') {
      stopped.add(action.immutableIdentity);
    } else if (action.resourceClass === 'compose_container' && action.action === 'remove') {
      if (!stopped.has(action.immutableIdentity)) {
        throw new Error('container removal lacks its approved stop dependency');
      }
      removed.add(action.immutableIdentity);
    } else if (['compose_network', 'compose_volume', 'oci_image'].includes(action.resourceClass)
        && action.dependencyIdentities.some((identity) => !removed.has(identity))) {
      throw new Error(`${action.resourceClass} cleanup dependency lacks an approved container removal`);
    }
  }
}

function inventoryBinding(inventory) {
  return {
    deploymentId: inventory.deploymentId,
    operationRunId: inventory.operationRunId,
    policyDigest: inventory.policyDigest,
    deploymentManifestDigest: inventory.deploymentManifestDigest,
    runManifestDigest: inventory.runManifestDigest,
    contextFingerprint: inventory.contextFingerprint,
  };
}

export function buildCleanupPlan(inventory, ownershipContract, {
  policyDigest,
} = {}) {
  validateArtifact(inventory);
  if (policyDigest !== inventory.policyDigest) throw new Error('ownership contract digest does not match inventory policy');
  const order = classOrder(ownershipContract.resourceClasses);
  const policies = new Map(ownershipContract.resourceClasses.map((entry) => [entry.classId, entry]));
  const hasAmbiguity = !inventory.complete
    || inventory.ambiguities.length > 0
    || inventory.resources.some((entry) => entry.disposition === 'ambiguous');
  const candidates = hasAmbiguity ? [] : inventory.resources
    .flatMap((resource) => plannedActions(resource, policies.get(resource.resourceClass))
      .map((action) => actionFrom(resource, action)))
    .sort((left, right) => compareActions(order, left, right));
  const actions = candidates.map((action, index) => ({ sequence: index + 1, ...action }));
  assertPlannedDependencies(actions);
  const plan = {
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.cleanup_plan,
    artifactType: 'cleanup_plan',
    ...inventoryBinding(inventory),
    createdAt: inventory.observedAt,
    inventoryDigest: canonicalSha256(inventory),
    actions,
  };
  validateArtifact(plan);
  return plan;
}

function refusalRows(inventory) {
  const rows = inventory.resources
    .filter((resource) => resource.disposition === 'refused' || resource.disposition === 'ambiguous')
    .flatMap((resource) => resource.failureClasses.map((failureClass) => ({
      resourceClass: resource.resourceClass,
      immutableIdentity: resource.immutableIdentity,
      failureClass,
    })));
  const adapterRows = inventory.ambiguities.map((ambiguity) => ({
    resourceClass: ambiguity.resourceClass ?? 'cleanup_evidence',
    immutableIdentity: `scope-${canonicalSha256(ambiguity).slice(0, 32)}`,
    failureClass: ambiguity.failureClass,
  }));
  const unique = new Map([...rows, ...adapterRows].map((entry) => [
    `${entry.resourceClass}:${entry.immutableIdentity}:${entry.failureClass}`, entry,
  ]));
  return [...unique.values()].sort((left, right) => (
    left.resourceClass.localeCompare(right.resourceClass)
    || left.immutableIdentity.localeCompare(right.immutableIdentity)
    || left.failureClass.localeCompare(right.failureClass)
  ));
}

function planningState(inventory, plan, refusals) {
  if (!inventory.complete || inventory.ambiguities.length > 0
    || inventory.resources.some((entry) => entry.disposition === 'ambiguous')) return 'ambiguous';
  if (refusals.length > 0) return 'refused';
  return plan.actions.length === 0 ? 'no_op' : 'dry_run';
}

export function buildPlanningReceipt(inventory, plan, {
  signerKeyId,
  now = () => new Date(),
} = {}) {
  validateArtifact(inventory);
  validateArtifact(plan);
  if (plan.inventoryDigest !== canonicalSha256(inventory)) throw new Error('plan does not bind the supplied inventory');
  const refusals = refusalRows(inventory);
  const state = planningState(inventory, plan, refusals);
  const finalizedAt = now().toISOString();
  const receipt = {
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.cleanup_receipt,
    artifactType: 'cleanup_receipt',
    phase: 'planning',
    deploymentId: plan.deploymentId,
    operationRunId: plan.operationRunId,
    state,
    operationStartedAt: inventory.observedAt,
    operationEndedAt: finalizedAt,
    receiptCoreFinalizedAt: finalizedAt,
    policyDigest: plan.policyDigest,
    deploymentManifestDigest: plan.deploymentManifestDigest,
    runManifestDigest: plan.runManifestDigest,
    planDigest: canonicalSha256(plan),
    approvalDigest: null,
    approvalStateDigest: null,
    inventoryBeforeDigest: plan.inventoryDigest,
    inventoryAfterDigest: null,
    journalDigest: null,
    journalBytes: 0,
    journalRecords: 0,
    actions: plan.actions,
    results: plan.actions.map(({ sequence, resourceClass, immutableIdentity }) => ({
      sequence, resourceClass, immutableIdentity, result: 'pending', failureClass: 'none',
    })),
    refusals,
    signerKeyId,
  };
  validateArtifact(receipt, { now: now() });
  return receipt;
}
