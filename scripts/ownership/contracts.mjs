import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseStrictJson } from './canonical-json.mjs';
import {
  array,
  canonicalRelativePath,
  enumeration,
  identifier,
  object,
  string,
  unique,
} from './validation.mjs';

export const RESOURCE_CLASSES = [
  'wallet_mutation',
  'application_lease_fence',
  'electrum_subscription',
  'scheduled_work',
  'collector_process',
  'compose_container',
  'compose_network',
  'compose_volume',
  'oci_image',
  'buildkit_cache',
  'git_worktree',
  'temporary_artifact',
  'cleanup_evidence',
  'provider_publication',
];
export const CLEANUP_POLICIES = ['application_managed', 'exact_delete', 'preserve_ambiguous', 'retain', 'retain_reconcile'];
export const PROTECTED_COMPOSE_PROJECTS = Object.freeze([
  'sanctuary', 'beacon', 'building-monkeys', 'tax-planner', 'swarm-intelligence',
]);
const OPERATIONS = ['create', 'mutate', 'register', 'cleanup'];
const DISPOSITIONS = ['migrate', 'reference_only', 'exempt', 'deferred'];
const PHASE_SIX_RESOURCE_CLASSES = new Set([
  'collector_process', 'git_worktree', 'temporary_artifact',
]);
const REQUIRED_CALLSITE_PATHS = [
  '.github/workflows/install-test.yml',
  '.github/workflows/podman-socket-canary.yml',
  '.github/workflows/release-candidate.yml',
  '.github/workflows/verify-vectors.yml',
  'scripts/ci/observe-runtime-image-cves.sh',
  'scripts/ci/run-extended-upgrade-fixtures.sh',
  'scripts/ops/grafana-quiescence-records.sh',
  'scripts/ops/run-grafana-password-migration.sh',
  'scripts/perf/wallet-sync-high-fanout-replay.mjs',
  'scripts/run-integration-tests.sh',
  'scripts/setup.sh',
  'scripts/verify-addresses/verify-repeatable.sh',
  'start.sh',
  'tests/install/e2e/upgrade-install.test.sh',
  'tests/install/utils/helpers.sh',
];

function validateResource(entry, index) {
  const path = `$.resourceClasses[${index}]`;
  object(entry, path, ['classId', 'authority', 'selectors', 'canonicalPaths', 'cleanupPolicies', 'dependsOn', 'lifecycleOwner', 'postconditions', 'mutationLocatorFields', 'immutableIdentityFields', 'registration', 'activeCurrentTests', 'privacyClass', 'uploadProjection', 'unregisteredPolicy']);
  enumeration(entry.classId, `${path}.classId`, RESOURCE_CLASSES);
  string(entry.authority, `${path}.authority`, { max: 256 });
  array(entry.selectors, `${path}.selectors`, { min: 1, max: 16 });
  entry.selectors.forEach((value, selectorIndex) => identifier(value, `${path}.selectors[${selectorIndex}]`));
  unique(entry.selectors, `${path}.selectors`);
  array(entry.canonicalPaths, `${path}.canonicalPaths`, { max: 32 });
  entry.canonicalPaths.forEach((value, pathIndex) => canonicalRelativePath(value, `${path}.canonicalPaths[${pathIndex}]`));
  unique(entry.canonicalPaths, `${path}.canonicalPaths`);
  array(entry.cleanupPolicies, `${path}.cleanupPolicies`, { min: 1, max: CLEANUP_POLICIES.length });
  entry.cleanupPolicies.forEach((value, policyIndex) => enumeration(value, `${path}.cleanupPolicies[${policyIndex}]`, CLEANUP_POLICIES));
  unique(entry.cleanupPolicies, `${path}.cleanupPolicies`);
  array(entry.dependsOn, `${path}.dependsOn`, { max: RESOURCE_CLASSES.length });
  entry.dependsOn.forEach((value, dependencyIndex) => enumeration(value, `${path}.dependsOn[${dependencyIndex}]`, RESOURCE_CLASSES));
  unique(entry.dependsOn, `${path}.dependsOn`);
  identifier(entry.lifecycleOwner, `${path}.lifecycleOwner`);
  array(entry.postconditions, `${path}.postconditions`, { min: 1, max: 16 });
  entry.postconditions.forEach((value, conditionIndex) => identifier(value, `${path}.postconditions[${conditionIndex}]`));
  unique(entry.postconditions, `${path}.postconditions`);
  for (const key of ['mutationLocatorFields', 'immutableIdentityFields', 'activeCurrentTests', 'uploadProjection']) {
    array(entry[key], `${path}.${key}`, { min: 1, max: 32 });
    entry[key].forEach((value, valueIndex) => identifier(value, `${path}.${key}[${valueIndex}]`));
    unique(entry[key], `${path}.${key}`);
  }
  enumeration(entry.registration, `${path}.registration`, ['embedded', 'external_signed', 'canonical_application_authority']);
  enumeration(entry.privacyClass, `${path}.privacyClass`, ['restricted_application_identity', 'local_private', 'upload_safe_opaque', 'public_artifact']);
  enumeration(entry.unregisteredPolicy, `${path}.unregisteredPolicy`, ['refuse', 'retain']);
}

function assertAcyclic(resources) {
  const dependencies = new Map(resources.map((entry) => [entry.classId, entry.dependsOn]));
  const visiting = new Set();
  const visited = new Set();
  function visit(classId) {
    if (visiting.has(classId)) throw new Error(`$.resourceClasses dependency cycle includes ${classId}`);
    if (visited.has(classId)) return;
    visiting.add(classId);
    dependencies.get(classId).forEach(visit);
    visiting.delete(classId);
    visited.add(classId);
  }
  resources.forEach((entry) => visit(entry.classId));
}

export function validateOwnershipContract(contract) {
  object(contract, '$', ['schemaVersion', 'labelNamespace', 'resourceClasses']);
  if (contract.schemaVersion !== '1.0.0') throw new Error('$.schemaVersion must equal 1.0.0');
  if (contract.labelNamespace !== 'io.sanctuary') throw new Error('$.labelNamespace must equal io.sanctuary');
  array(contract.resourceClasses, '$.resourceClasses', { min: RESOURCE_CLASSES.length, max: RESOURCE_CLASSES.length });
  contract.resourceClasses.forEach(validateResource);
  const classIds = contract.resourceClasses.map((entry) => entry.classId);
  unique(classIds, '$.resourceClasses.classId');
  RESOURCE_CLASSES.forEach((classId) => {
    if (!classIds.includes(classId)) throw new Error(`$.resourceClasses is missing ${classId}`);
  });
  unique(contract.resourceClasses.flatMap((entry) => entry.selectors), '$.resourceClasses.selectors');
  assertAcyclic(contract.resourceClasses);
  return contract;
}

function validateCallsite(entry, index, knownClasses) {
  const path = `$.callsites[${index}]`;
  object(entry, path, ['path', 'resourceClass', 'operation', 'disposition', 'safetyContract']);
  canonicalRelativePath(entry.path, `${path}.path`);
  enumeration(entry.resourceClass, `${path}.resourceClass`, knownClasses);
  enumeration(entry.operation, `${path}.operation`, OPERATIONS);
  enumeration(entry.disposition, `${path}.disposition`, DISPOSITIONS);
  string(entry.safetyContract, `${path}.safetyContract`, { max: 512 });
  if (entry.disposition === 'exempt' && entry.safetyContract.length < 20) throw new Error(`${path}.safetyContract must justify the exemption`);
  if (entry.disposition === 'deferred'
      && (!PHASE_SIX_RESOURCE_CLASSES.has(entry.resourceClass)
        || !entry.safetyContract.includes('Phase 6'))) {
    throw new Error(`${path}.deferred is reserved for an explicit Phase 6 host-artifact migration`);
  }
}

export function validateCallsiteInventory(inventory, contract) {
  object(inventory, '$', ['schemaVersion', 'callsites']);
  if (inventory.schemaVersion !== '1.0.0') throw new Error('$.schemaVersion must equal 1.0.0');
  array(inventory.callsites, '$.callsites', { min: 1, max: 10_000 });
  const classes = contract.resourceClasses.map((entry) => entry.classId);
  inventory.callsites.forEach((entry, index) => validateCallsite(entry, index, classes));
  unique(inventory.callsites.map((entry) => `${entry.path}:${entry.resourceClass}:${entry.operation}`), '$.callsites identity');
  const declaredPaths = new Set(inventory.callsites.map((entry) => entry.path));
  REQUIRED_CALLSITE_PATHS.forEach((source) => {
    if (!declaredPaths.has(source)) throw new Error(`$.callsites is missing required lifecycle surface ${source}`);
  });
  const declaredClasses = new Set(inventory.callsites.map((entry) => entry.resourceClass));
  classes.forEach((classId) => {
    if (!declaredClasses.has(classId)) throw new Error(`$.callsites is missing resource class ${classId}`);
  });
  return inventory;
}

export function validateApplicationAuthorities(authorities) {
  object(authorities, '$', ['schemaVersion', 'authorities']);
  if (authorities.schemaVersion !== '1.0.0') throw new Error('$.schemaVersion must equal 1.0.0');
  array(authorities.authorities, '$.authorities', { min: 4, max: 4 });
  const applicationClasses = RESOURCE_CLASSES.slice(0, 4);
  authorities.authorities.forEach((entry, index) => {
    const entryPath = `$.authorities[${index}]`;
    object(entry, entryPath, ['classId', 'authority', 'canonicalPaths', 'cleanupPolicy', 'genericCleanupAllowed']);
    enumeration(entry.classId, `${entryPath}.classId`, applicationClasses);
    identifier(entry.authority, `${entryPath}.authority`);
    array(entry.canonicalPaths, `${entryPath}.canonicalPaths`, { min: 1, max: 8 }).forEach((value, pathIndex) => canonicalRelativePath(value, `${entryPath}.canonicalPaths[${pathIndex}]`));
    unique(entry.canonicalPaths, `${entryPath}.canonicalPaths`);
    if (entry.cleanupPolicy !== 'application_managed') throw new Error(`${entryPath}.cleanupPolicy must equal application_managed`);
    if (entry.genericCleanupAllowed !== false) throw new Error(`${entryPath}.genericCleanupAllowed must be false`);
  });
  unique(authorities.authorities.map((entry) => entry.classId), '$.authorities.classId');
  applicationClasses.forEach((classId) => {
    if (!authorities.authorities.some((entry) => entry.classId === classId)) throw new Error(`$.authorities is missing ${classId}`);
  });
  return authorities;
}

export function loadAndValidateContracts(ownershipPath, callsitesPath) {
  const ownership = validateOwnershipContract(parseStrictJson(readFileSync(ownershipPath)));
  const callsites = validateCallsiteInventory(parseStrictJson(readFileSync(callsitesPath)), ownership);
  const root = path.dirname(path.dirname(ownershipPath));
  for (const source of new Set([
    ...ownership.resourceClasses.flatMap((entry) => entry.canonicalPaths),
    ...callsites.callsites.map((entry) => entry.path),
  ])) {
    if (!existsSync(path.join(root, source))) throw new Error(`declared lifecycle source does not exist: ${source}`);
  }
  return { ownership, callsites };
}
