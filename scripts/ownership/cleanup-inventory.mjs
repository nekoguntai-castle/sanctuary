import { canonicalSha256 } from './canonical-json.mjs';
import {
  READ_ONLY_REGISTRATION_CLASSES, classifyCleanupRegistration,
} from './cleanup-registration-adapters.mjs';
import { DOCKER_RESOURCE_CLASSES } from './docker-observation.mjs';
import { readRegistrations } from './registration.mjs';
import { ARTIFACT_SCHEMA_VERSIONS, validateArtifact } from './schemas.mjs';
import { buildCleanupExecutionContext } from './cleanup-execution-context.mjs';

const LABEL = 'io.sanctuary.';
const HARD_REFUSALS = Object.freeze({
  current: 'current', shared: 'shared', protected: 'protected', data: 'data',
  default_builder: 'default_builder', unlabeled: 'unlabeled', malformed: 'malformed',
  unregistered: 'unregistered', referenced: 'referenced',
});
const PROTECTED_PROJECTS = Object.freeze([
  'sanctuary', 'beacon', 'building-monkeys', 'tax-planner', 'swarm-intelligence',
]);

function ownershipFromLabels(resource) {
  if (resource.ownershipState !== 'owned') return null;
  const labels = resource.labels;
  return {
    project: labels[`${LABEL}project`],
    deploymentId: labels[`${LABEL}deployment-id`],
    ownerId: labels[`${LABEL}owner-id`],
    resourceClass: resource.resourceClass,
    lifecycle: labels[`${LABEL}lifecycle`],
    cleanupPolicy: labels[`${LABEL}cleanup-policy`],
    createdAt: labels[`${LABEL}created-at`],
    createdByRelease: labels[`${LABEL}created-by-release`],
    createdByCommit: labels[`${LABEL}created-by-commit`],
    creationRunId: labels[`${LABEL}creation-run-id`],
    immutableIdentity: resource.immutableIdentity,
  };
}

function policyFor(contract, resourceClass) {
  const policy = contract.resourceClasses.find((entry) => entry.classId === resourceClass);
  if (!policy) throw new Error(`resource class is missing from ownership contract: ${resourceClass}`);
  return policy;
}

function addOwnershipFailures(failures, resource) {
  if (['unlabeled', 'legacy_unlabeled'].includes(resource.ownershipState)) failures.add('unlabeled');
  else if (resource.ownershipState !== 'owned') {
    failures.add(resource.ownershipState === 'malformed' ? 'malformed' : 'unregistered');
  }
  for (const classification of resource.classifications) {
    if (HARD_REFUSALS[classification]) failures.add(HARD_REFUSALS[classification]);
  }
}

function registrationIsComplete(resource, ownership) {
  const registration = resource.registration;
  return Boolean(registration)
    && ['registrationId', 'signerKeyId', 'metadataDigest']
      .every((key) => /^[a-f0-9]{64}$/.test(registration[key] ?? ''))
    && registration.resourceClass === resource.resourceClass
    && registration.immutableIdentity === resource.immutableIdentity
    && registration.deploymentId === ownership?.deploymentId
    && registration.ownerId === ownership?.ownerId;
}

function addRegistrationFailures(failures, resource, ownership) {
  if (!['compose_volume', 'oci_image'].includes(resource.resourceClass)) return;
  const complete = registrationIsComplete(resource, ownership);
  if (!complete) failures.add('unregistered');
  const volumeDrift = complete && resource.resourceClass === 'compose_volume'
    && (resource.registration.locator !== resource.locator
      || resource.registration.operationRunId !== ownership?.creationRunId);
  if (volumeDrift) failures.add('identity_changed');
}

function cleanupDisposition(failures, ownership) {
  if (['retain', 'retain_reconcile'].includes(ownership?.cleanupPolicy)) {
    return { disposition: 'retain', failureClasses: ['policy_retained'] };
  }
  if (failures.size > 0) return { disposition: 'refused', failureClasses: [...failures].sort() };
  if (!ownership || ownership.cleanupPolicy !== 'exact_delete') {
    return { disposition: 'ambiguous', failureClasses: ['policy_mismatch'] };
  }
  return { disposition: 'eligible', failureClasses: [] };
}

function dockerDecision(resource, ownership, policy) {
  const failures = new Set();
  addOwnershipFailures(failures, resource);
  addRegistrationFailures(failures, resource, ownership);
  if (resource.resourceClass === 'oci_image' && resource.runtime?.referenceCount > 0) failures.add('referenced');
  if (ownership && !policy.cleanupPolicies.includes(ownership.cleanupPolicy)) failures.add('policy_mismatch');
  return cleanupDisposition(failures, ownership);
}

function dockerLocatorKind(resourceClass) {
  return ['compose_volume', 'buildkit_cache'].includes(resourceClass) ? 'name' : 'engine_id';
}

function observedContainerRunning(resource) {
  return resource.resourceClass === 'compose_container'
    && typeof resource.runtime?.running === 'boolean' ? resource.runtime.running : null;
}

function dockerRow(resource, contract) {
  const ownership = ownershipFromLabels(resource);
  const decision = dockerDecision(resource, ownership, policyFor(contract, resource.resourceClass));
  const references = [...(resource.references ?? resource.runtime?.references ?? [])].sort();
  const contentDigests = [...new Set([
    ...(resource.contentDigests ?? resource.runtime?.contentDigests ?? []),
    ...[resource.registration?.registrationId, resource.registration?.metadataDigest]
      .filter((value) => /^[a-f0-9]{64}$/.test(value ?? '')),
  ])].sort();
  return {
    resourceClass: resource.resourceClass,
    locatorKind: dockerLocatorKind(resource.resourceClass),
    locator: resource.locator,
    immutableIdentity: resource.immutableIdentity,
    ownership,
    ownershipDigest: ownership === null ? null : canonicalSha256(ownership),
    observationDigest: canonicalSha256({
      resourceClass: resource.resourceClass,
      locator: resource.locator,
      immutableIdentity: resource.immutableIdentity,
      ownershipState: resource.ownershipState,
      classifications: resource.classifications,
      runtime: resource.runtime,
      registration: resource.registration ?? null,
      references,
      contentDigests,
    }),
    ...decision,
    references,
    contentDigests,
    running: observedContainerRunning(resource),
    active: resource.classifications.includes('current'),
    protected: resource.classifications.includes('protected'),
    data: resource.classifications.includes('data'),
  };
}

function registeredOwnership(registration, project) {
  return {
    project,
    deploymentId: registration.deploymentId,
    ownerId: registration.ownerId,
    resourceClass: registration.resourceClass,
    lifecycle: registration.lifecycle,
    cleanupPolicy: registration.cleanupPolicy,
    createdAt: registration.createdAt,
    createdByRelease: registration.createdByRelease,
    createdByCommit: registration.createdByCommit,
    creationRunId: registration.operationRunId,
    immutableIdentity: registration.immutableIdentity,
  };
}

function registrationFailure(classification) {
  if (classification.observation.state === 'identity_changed') return 'identity_changed';
  if (classification.observation.state === 'ambiguous') return 'query_failed';
  if (classification.observation.state === 'unverified') return 'unsupported';
  return classification.disposition === 'retain' ? 'policy_retained' : 'unsupported';
}

function registrationRow(classification, contract, project) {
  const { registration } = classification;
  const ownership = registeredOwnership(registration, project);
  const policy = policyFor(contract, registration.resourceClass);
  const policyEnabled = policy.cleanupPolicies.includes(registration.cleanupPolicy);
  const disposition = !policyEnabled ? 'refused' : classification.disposition;
  return {
    resourceClass: registration.resourceClass,
    locatorKind: registration.locatorKind,
    locator: registration.locator,
    immutableIdentity: registration.immutableIdentity,
    ownership,
    ownershipDigest: canonicalSha256(ownership),
    observationDigest: canonicalSha256({
      registrationId: registration.registrationId,
      observation: classification.observation,
      executable: classification.executable,
    }),
    disposition,
    failureClasses: [policyEnabled ? registrationFailure(classification) : 'policy_mismatch'],
    references: [...registration.referenceIds].sort(),
    contentDigests: [registration.metadataDigest].sort(),
    running: null,
    active: registration.lifecycle === 'active',
    protected: registration.cleanupPolicy === 'retain' || registration.cleanupPolicy === 'retain_reconcile',
    data: false,
  };
}

function ambiguityRow(ambiguity) {
  const failureClass = ambiguity.category === 'malformed_output' ? 'malformed'
    : ['inventory_drift', 'identity_changed'].includes(ambiguity.category) ? 'identity_changed'
      : ambiguity.category === 'command_unavailable' ? 'unsupported' : 'query_failed';
  return {
    adapter: 'docker-compose-oci-buildkit-read-only',
    resourceClass: ambiguity.resourceClass ?? null,
    failureClass,
    scope: canonicalSha256({
      operation: ambiguity.operation ?? 'query',
      locator: ambiguity.locator ?? null,
      category: ambiguity.category ?? 'query_failed',
    }).slice(0, 32),
  };
}

function registrationAmbiguity(error) {
  return READ_ONLY_REGISTRATION_CLASSES.map((resourceClass) => ({
    adapter: 'signed-registration-read-only',
    resourceClass,
    failureClass: 'query_failed',
    scope: canonicalSha256({ errorClass: error?.code ?? error?.name ?? 'Error' }).slice(0, 32),
  }));
}

function consolidateRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.resourceClass}:${row.immutableIdentity}`;
    const existing = grouped.get(key);
    if (!existing) { grouped.set(key, row); continue; }
    const sameOwnership = existing.ownershipDigest === row.ownershipDigest;
    grouped.set(key, {
      ...existing,
      ownership: sameOwnership ? existing.ownership : null,
      ownershipDigest: sameOwnership ? existing.ownershipDigest : null,
      observationDigest: canonicalSha256([existing.observationDigest, row.observationDigest].sort()),
      disposition: sameOwnership && existing.disposition === row.disposition ? existing.disposition : 'refused',
      failureClasses: [...new Set([
        ...existing.failureClasses, ...row.failureClasses, ...(sameOwnership ? [] : ['shared']),
      ])].sort(),
      references: [...new Set([...existing.references, ...row.references])].sort(),
      contentDigests: [...new Set([...existing.contentDigests, ...row.contentDigests])].sort(),
      active: existing.active || row.active,
      protected: existing.protected || row.protected,
      data: existing.data || row.data,
    });
  }
  return [...grouped.values()];
}

function assertManifestBinding(deploymentManifest, runManifest) {
  validateArtifact(deploymentManifest);
  validateArtifact(runManifest);
  if (runManifest.deploymentId !== deploymentManifest.deploymentId
    || runManifest.generation !== deploymentManifest.generation
    || runManifest.deploymentDigest !== canonicalSha256(deploymentManifest)) {
    throw new Error('run manifest does not bind the deployment manifest');
  }
}

function observeDeploymentState(readDeploymentState) {
  try {
    const value = readDeploymentState();
    return { value, digest: canonicalSha256(value), error: null };
  } catch (error) {
    return { value: null, digest: null, error };
  }
}

function pointerGeneration(pointer) {
  const generation = pointer?.value?.generation ?? pointer?.generation;
  return Number.isSafeInteger(generation) && generation > 0 ? generation : null;
}

function deploymentIsCurrent(state, expectedMutationLockOwnerDigest, targetGeneration) {
  if (!state) return false;
  const lockIsForeign = ['locked', 'ambiguous'].includes(state.mutationLock?.state)
    && state.mutationLock?.ownerDigest !== expectedMutationLockOwnerDigest;
  const activeGeneration = pointerGeneration(state.active);
  const activeIsUnverifiable = Boolean(state.active) && activeGeneration === null;
  return Boolean(state.pending) || Boolean(state.prepared) || activeIsUnverifiable
    || activeGeneration > targetGeneration || lockIsForeign;
}

function deploymentStateAmbiguities(observation, expectedMutationLockOwnerDigest) {
  if (observation.error) return [{
    adapter: 'deployment-state', resourceClass: null, failureClass: 'query_failed',
    scope: canonicalSha256({ errorClass: observation.error.code ?? observation.error.name ?? 'Error' }).slice(0, 32),
  }];
  if (observation.value?.registered === false) return [{
    adapter: 'deployment-state', resourceClass: null, failureClass: 'unsupported', scope: 'unregistered-deployment',
  }];
  if (observation.value?.registered === true
      && ![observation.value.active, observation.value.pending, observation.value.prepared].some(Boolean)) return [{
    adapter: 'deployment-state', resourceClass: null, failureClass: 'unsupported', scope: 'orphaned-deployment-state',
  }];
  if (observation.value?.mutationLock?.state === 'locked'
      && observation.value.mutationLock.ownerDigest !== expectedMutationLockOwnerDigest) return [{
    adapter: 'deployment-state', resourceClass: null, failureClass: 'unsupported', scope: 'deployment-lock-held',
  }];
  if (observation.value?.mutationLock?.state === 'ambiguous') return [{
    adapter: 'deployment-state', resourceClass: null, failureClass: 'query_failed', scope: 'deployment-lock-ambiguous',
  }];
  return [];
}

function loadRegistrations(registrationRoot) {
  if (!registrationRoot) return { registrations: [], error: null };
  try { return { registrations: readRegistrations(registrationRoot), error: null }; }
  catch (error) { return { registrations: [], error }; }
}

function manifestLabels(deploymentManifest, resourceClass) {
  return { manifestLabels: {
    'io.sanctuary.project': deploymentManifest.composeProjectName,
    'io.sanctuary.deployment-id': deploymentManifest.deploymentId,
    'io.sanctuary.owner-id': deploymentManifest.ownerId,
    'io.sanctuary.resource-class': resourceClass,
  } };
}

function authoritativeSelectors(deploymentManifest, registrations) {
  const selectors = Object.fromEntries(DOCKER_RESOURCE_CLASSES.map((resourceClass) => (
    [resourceClass, resourceClass === 'buildkit_cache' ? [] : [manifestLabels(deploymentManifest, resourceClass)]]
  )));
  for (const registration of registrations) {
    if (registration.resourceClass === 'oci_image') {
      selectors.oci_image.push(registration.locatorKind === 'reference'
        ? { reference: registration.locator } : { locator: registration.immutableIdentity });
    }
    if (registration.resourceClass === 'buildkit_cache') selectors.buildkit_cache.push({ builder: registration.locator });
  }
  for (const legacy of deploymentManifest.legacyResources) {
    const locator = legacy.resourceClass === 'compose_volume' ? legacy.locator : legacy.immutableIdentity;
    selectors[legacy.resourceClass].push({ locator });
  }
  return selectors;
}

export function buildCleanupInventoryExecutionContext({
  deploymentManifest, registrations = [], engine = 'docker', daemonContextFingerprint,
  protectedProjects = [], dataVolumeNames = [], sharedImmutableIdentities = [], selectors,
}) {
  const target = targetRegistrations(registrations, deploymentManifest);
  return buildCleanupExecutionContext({
    engine, daemonContextFingerprint,
    selectors: selectors ?? authoritativeSelectors(deploymentManifest, target),
    protectedProjects: [...new Set([...PROTECTED_PROJECTS, ...protectedProjects])].sort(),
    dataVolumeNames, sharedImmutableIdentities, registrations: target,
  });
}

function legacyIdentityAmbiguities(resources, deploymentManifest) {
  const ambiguities = [];
  for (const resource of resources) {
    const expected = deploymentManifest.legacyResources.find((legacy) => (
      legacy.resourceClass === resource.resourceClass
      && (resource.resourceClass === 'compose_volume'
        ? legacy.locator === resource.locator : legacy.immutableIdentity === resource.locator)
    ));
    const legacyChanged = expected && (expected.immutableIdentity !== resource.immutableIdentity
      || !['unlabeled', 'legacy_unlabeled'].includes(resource.ownershipState));
    if (legacyChanged) ambiguities.push({
      category: 'identity_changed', operation: `${resource.resourceClass} legacy identity`,
      resourceClass: resource.resourceClass, locator: resource.locator,
    });
  }
  return ambiguities;
}

function targetRegistrations(registrations, deploymentManifest) {
  return registrations.filter((entry) => entry.deploymentId === deploymentManifest.deploymentId
    && entry.ownerId === deploymentManifest.ownerId);
}

function dockerRegistrations(registrations, deploymentManifest) {
  return targetRegistrations(registrations, deploymentManifest).map((entry) => {
    const sameIdentity = registrations.filter((candidate) => candidate.resourceClass === entry.resourceClass
      && candidate.immutableIdentity === entry.immutableIdentity);
    const owners = [...new Set(sameIdentity.map((candidate) => `${candidate.deploymentId}:${candidate.ownerId}`))].sort();
    const references = [...new Set(sameIdentity.flatMap((candidate) => candidate.referenceIds))].sort();
    return {
      ...entry,
      ownerIds: owners,
      referenceIds: references,
      lifecycle: owners.length > 1 ? 'shared' : entry.lifecycle,
      protected: owners.length > 1 || ['retain', 'retain_reconcile'].includes(entry.cleanupPolicy),
    };
  });
}

async function collectAdapters({ deploymentManifest, dockerAdapter, dockerOptions, registrationRoot, registrationOptions }) {
  const verified = loadRegistrations(registrationRoot);
  const target = targetRegistrations(verified.registrations, deploymentManifest);
  const selectors = authoritativeSelectors(deploymentManifest, target);
  const docker = Promise.resolve().then(() => dockerAdapter.inventory({
    ...dockerOptions,
    selectors,
    registrations: dockerRegistrations(verified.registrations, deploymentManifest),
  }));
  const registrations = Promise.resolve().then(() => {
    if (verified.error) throw verified.error;
    const selected = new Set(registrationOptions.resourceClasses ?? READ_ONLY_REGISTRATION_CLASSES);
    return target.filter((entry) => selected.has(entry.resourceClass))
      .map((entry) => classifyCleanupRegistration(entry, registrationOptions));
  });
  const [dockerResult, registrationResult] = await Promise.allSettled([docker, registrations]);
  return { dockerResult, registrationResult, target, selectors };
}

export async function inventoryCleanupResources({
  deploymentManifest,
  runManifest,
  ownershipContract,
  ownershipContractDigest,
  dockerAdapter,
  dockerOptions = {},
  registrationRoot,
  registrationOptions = {},
  readDeploymentState = () => null,
  expectedMutationLockOwnerDigest = null,
  now = () => new Date(),
} = {}) {
  assertManifestBinding(deploymentManifest, runManifest);
  if (ownershipContractDigest !== deploymentManifest.policyDigest) {
    throw new Error('ownership contract digest does not match deployment manifest policy');
  }
  if (!dockerAdapter || typeof dockerAdapter.inventory !== 'function') throw new Error('Docker inventory adapter is required');
  const beforeState = observeDeploymentState(readDeploymentState);
  const currentDeploymentIds = (runManifest.terminalAt === null
    || deploymentIsCurrent(
      beforeState.value, expectedMutationLockOwnerDigest, deploymentManifest.generation,
    ))
    ? [deploymentManifest.deploymentId] : [];
  const protectedProjects = [...new Set([
    ...PROTECTED_PROJECTS, ...(dockerOptions.protectedProjects ?? []),
  ])].sort();
  const { dockerResult, registrationResult, target, selectors } = await collectAdapters({
    dockerAdapter,
    deploymentManifest,
    dockerOptions: { ...dockerOptions, currentDeploymentIds, protectedProjects },
    registrationRoot,
    registrationOptions,
  });
  const afterState = observeDeploymentState(readDeploymentState);
  const ambiguities = deploymentStateAmbiguities(beforeState, expectedMutationLockOwnerDigest);
  const dockerResources = dockerResult.status === 'fulfilled' ? dockerResult.value.resources : [];
  if (dockerResult.status === 'fulfilled') ambiguities.push(
    ...dockerResult.value.ambiguities.map(ambiguityRow),
    ...legacyIdentityAmbiguities(dockerResources, deploymentManifest).map(ambiguityRow),
  );
  else ambiguities.push(...DOCKER_RESOURCE_CLASSES.map((resourceClass) => ambiguityRow({
    category: 'query_failed', operation: 'docker adapter', resourceClass,
  })));
  const officialAdapter = dockerAdapter.id === 'docker-compose-oci-buildkit-read-only';
  if (officialAdapter && dockerResult.status === 'fulfilled'
      && (!dockerResult.value.daemonContextFingerprint || !dockerResult.value.selectors)) {
    ambiguities.push(ambiguityRow({
      category: 'query_failed', operation: 'Docker execution authority', resourceClass: null,
    }));
  }
  const registrations = registrationResult.status === 'fulfilled' ? registrationResult.value : [];
  if (registrationResult.status === 'rejected') ambiguities.push(...registrationAmbiguity(registrationResult.reason));
  ambiguities.push(...deploymentStateAmbiguities(afterState, expectedMutationLockOwnerDigest));
  if (beforeState.digest !== afterState.digest) ambiguities.push({
    adapter: 'deployment-state', resourceClass: null, failureClass: 'identity_changed',
    scope: (beforeState.digest ?? canonicalSha256({ state: 'unavailable' })).slice(0, 32),
  });
  const resources = consolidateRows([
    ...dockerResources.map((resource) => dockerRow(resource, ownershipContract)),
    ...registrations.filter((entry) => entry.disposition !== 'absent')
      .map((entry) => registrationRow(entry, ownershipContract, deploymentManifest.composeProjectName)),
  ]).sort((left, right) => `${left.resourceClass}:${left.immutableIdentity}:${left.locator}`
    .localeCompare(`${right.resourceClass}:${right.immutableIdentity}:${right.locator}`));
  const executionContext = buildCleanupInventoryExecutionContext({
    deploymentManifest, registrations: target,
    engine: dockerResult.status === 'fulfilled' ? (dockerResult.value.engine ?? dockerOptions.engine ?? 'docker') : (dockerOptions.engine ?? 'docker'),
    daemonContextFingerprint: dockerResult.status === 'fulfilled'
      ? (dockerResult.value.daemonContextFingerprint ?? canonicalSha256({ adapter: 'injected-test-double' }))
      : canonicalSha256({ engine: dockerOptions.engine ?? 'docker', authority: 'query_failed' }),
    selectors: dockerResult.status === 'fulfilled' ? (dockerResult.value.selectors ?? selectors) : selectors,
    protectedProjects,
    dataVolumeNames: dockerOptions.dataVolumeNames ?? [],
    sharedImmutableIdentities: dockerOptions.sharedImmutableIdentities ?? [],
  });
  const inventory = {
    schemaVersion: ARTIFACT_SCHEMA_VERSIONS.inventory,
    artifactType: 'inventory',
    deploymentId: deploymentManifest.deploymentId,
    operationRunId: runManifest.operationRunId,
    generation: deploymentManifest.generation,
    observedAt: now().toISOString(),
    complete: ambiguities.length === 0,
    policyDigest: deploymentManifest.policyDigest,
    deploymentManifestDigest: canonicalSha256(deploymentManifest),
    runManifestDigest: canonicalSha256(runManifest),
    contextFingerprint: executionContext.fingerprint,
    resources,
    ambiguities,
  };
  validateArtifact(inventory);
  return inventory;
}
