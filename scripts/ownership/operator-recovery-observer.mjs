import { randomUUID } from 'node:crypto';
import { canonicalSha256 } from './canonical-json.mjs';
import { runCleanupCommand } from './cleanup-command.mjs';
import { observeDockerResources } from './docker-observation.mjs';

const RECOVERY_CLASSES = Object.freeze([
  'compose_container', 'compose_network', 'compose_volume',
]);
const LABEL = 'io.sanctuary.';
const DIGEST = /^[a-f0-9]{64}$/;
const ENGINE_ID = /^[a-f0-9]{64}$/;
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/;
const MAX_PROJECT_RESOURCES_PER_CLASS = 512;
const MAX_PROJECT_DISCOVERY_BYTES = 65_536;
const UNSAFE = new Set([
  'current', 'shared', 'data', 'malformed', 'unlabeled', 'legacy_unlabeled',
  'production', 'referenced', 'default_builder',
]);

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)
      || Object.keys(target).sort().join('\0') !== ['deploymentId', 'ownerId', 'project'].sort().join('\0')) {
    throw new TypeError('recovery target fields are invalid');
  }
  return Object.freeze({
    project: identifier(target.project, 'project'),
    deploymentId: identifier(target.deploymentId, 'deploymentId'),
    ownerId: identifier(target.ownerId, 'ownerId'),
  });
}

function manifestLabels(target, resourceClass) {
  return { manifestLabels: {
    [`${LABEL}project`]: target.project,
    [`${LABEL}deployment-id`]: target.deploymentId,
    [`${LABEL}owner-id`]: target.ownerId,
    [`${LABEL}resource-class`]: resourceClass,
  } };
}

function composeProjectLabel(target) {
  return `label=com.docker.compose.project=${target.project}`;
}

function projectDiscoveryArgs(resourceClass, target) {
  const common = ['--filter', composeProjectLabel(target), '--format'];
  if (resourceClass === 'compose_container') {
    return ['container', 'ls', '--all', '--no-trunc', ...common, '{{.ID}}'];
  }
  if (resourceClass === 'compose_network') {
    return ['network', 'ls', '--no-trunc', ...common, '{{.ID}}'];
  }
  return ['volume', 'ls', ...common, '{{.Name}}'];
}

function boundedDiscoveryLines(output, resourceClass) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_PROJECT_DISCOVERY_BYTES) {
    throw new Error(`${resourceClass} Compose project discovery exceeded its output bound`);
  }
  const values = output.split(/\r?\n/u).filter(Boolean);
  if (values.length > MAX_PROJECT_RESOURCES_PER_CLASS) {
    throw new Error(`${resourceClass} Compose project discovery exceeded its resource bound`);
  }
  const pattern = resourceClass === 'compose_volume' ? VOLUME_NAME : ENGINE_ID;
  if (values.some((value) => !pattern.test(value))) {
    throw new Error(`${resourceClass} Compose project discovery returned a malformed locator`);
  }
  return Object.freeze([...new Set(values)].sort());
}

export async function discoverComposeProjectFromDocker({
  target, engine, engineGlobalArgs, runCommand,
}) {
  if (typeof runCommand !== 'function') {
    throw new Error('Compose project discovery requires the pinned Docker command runner');
  }
  const entries = await Promise.all(RECOVERY_CLASSES.map(async (resourceClass) => {
    const output = await runCommand(
      engine, [...engineGlobalArgs, ...projectDiscoveryArgs(resourceClass, target)],
      {
        operation: `${resourceClass} Compose project discovery`,
        maxOutputBytes: MAX_PROJECT_DISCOVERY_BYTES,
      },
    );
    return [resourceClass, boundedDiscoveryLines(output, resourceClass)];
  }));
  return Object.freeze(Object.fromEntries(entries));
}

function exactProjectDiscovery(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...RECOVERY_CLASSES].sort().join('\0')) {
    throw new Error('Compose project discovery result fields are invalid');
  }
  return Object.freeze(Object.fromEntries(RECOVERY_CLASSES.map((resourceClass) => {
    if (!Array.isArray(value[resourceClass])
        || value[resourceClass].length > MAX_PROJECT_RESOURCES_PER_CLASS) {
      throw new Error(`${resourceClass} Compose project discovery result is invalid`);
    }
    const pattern = resourceClass === 'compose_volume' ? VOLUME_NAME : ENGINE_ID;
    if (value[resourceClass].some((locator) => typeof locator !== 'string' || !pattern.test(locator))
        || new Set(value[resourceClass]).size !== value[resourceClass].length) {
      throw new Error(`${resourceClass} Compose project discovery locator is invalid`);
    }
    return [resourceClass, Object.freeze([...value[resourceClass]].sort())];
  })));
}

function unionProjectSelectors(target, discovered) {
  const selectors = operatorRecoverySelectors(target);
  return Object.freeze(Object.fromEntries(Object.entries(selectors).map(([resourceClass, values]) => [
    resourceClass,
    RECOVERY_CLASSES.includes(resourceClass)
      ? Object.freeze([...values, ...discovered[resourceClass].map((locator) => ({ locator }))])
      : values,
  ])));
}

function projectDiscoveryFromCustomObservation(raw, target) {
  return Object.fromEntries(RECOVERY_CLASSES.map((resourceClass) => [
    resourceClass,
    raw.resources.filter((resource) => resource.resourceClass === resourceClass
      && resource.labels?.['com.docker.compose.project'] === target.project)
      .map((resource) => resource.locator),
  ]));
}

function validateDiscoverySeed(seed) {
  if (seed?.complete !== true || !Array.isArray(seed.ambiguities) || seed.ambiguities.length !== 0
      || !DIGEST.test(seed.daemonContextFingerprint ?? '') || !Array.isArray(seed.engineGlobalArgs)) {
    throw new Error('recovery tuple discovery observation is incomplete or ambiguous');
  }
}

function projectDiscoveryFunction({
  target, observe, observationOptions, discoverComposeProject, seed,
}) {
  const customObservation = discoverComposeProject === discoverComposeProjectFromDocker
    && observe !== observeDockerResources;
  if (customObservation) return (raw) => projectDiscoveryFromCustomObservation(raw, target);
  const runCommand = observationOptions.runCommand
    ?? (observe === observeDockerResources ? runCleanupCommand : undefined);
  return () => discoverComposeProject({
    target,
    engine: seed.engine ?? observationOptions.engine ?? 'docker',
    engineGlobalArgs: seed.engineGlobalArgs,
    runCommand,
  });
}

function assertSameProjectDiscovery(discovered, confirmed) {
  if (canonicalSha256(discovered) !== canonicalSha256(confirmed)) {
    throw new Error('Compose project changed during recovery observation');
  }
}

async function observeProjectClosedSet({
  target, observe, observationOptions, discoverComposeProject,
}) {
  const tupleSelectors = operatorRecoverySelectors(target);
  const seed = await observe({ ...observationOptions, selectors: tupleSelectors });
  validateDiscoverySeed(seed);
  const discover = projectDiscoveryFunction({
    target, observe, observationOptions, discoverComposeProject, seed,
  });
  const discovered = exactProjectDiscovery(await discover(seed));
  const selectors = unionProjectSelectors(target, discovered);
  const raw = await observe({ ...observationOptions, selectors });
  if (raw?.daemonContextFingerprint !== seed.daemonContextFingerprint) {
    throw new Error('recovery target changed daemon during Compose project discovery');
  }
  const confirmed = exactProjectDiscovery(await discover(raw));
  assertSameProjectDiscovery(discovered, confirmed);
  return raw;
}

export function operatorRecoverySelectors(value) {
  const target = exactTarget(value);
  return Object.freeze({
    compose_container: [manifestLabels(target, 'compose_container')],
    compose_network: [manifestLabels(target, 'compose_network')],
    compose_volume: [manifestLabels(target, 'compose_volume')],
    oci_image: [],
    buildkit_cache: [],
  });
}

function exactCounts(counts) {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)
      || Object.keys(counts).sort().join('\0') !== [...RECOVERY_CLASSES].sort().join('\0')) {
    throw new TypeError('expected recovery counts fields are invalid');
  }
  for (const resourceClass of RECOVERY_CLASSES) {
    if (!Number.isSafeInteger(counts[resourceClass]) || counts[resourceClass] < 0
        || counts[resourceClass] > 512) throw new TypeError(`${resourceClass} count is invalid`);
  }
  return counts;
}

function ownership(resource) {
  const labels = resource.labels ?? {};
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

function assertTargetOwnership(value, target) {
  if (value.project !== target.project || value.deploymentId !== target.deploymentId
      || value.ownerId !== target.ownerId || value.lifecycle !== 'obsolete'
      || value.cleanupPolicy !== 'exact_delete') {
    throw new Error('recovery resource ownership tuple is not the approved obsolete exact-delete target');
  }
}

function assertSafeClassifications(resource) {
  const classifications = resource.classifications ?? [];
  if (!Array.isArray(classifications) || classifications.some((value) => typeof value !== 'string')) {
    throw new Error('recovery resource classifications are malformed');
  }
  const unsafe = classifications.find((value) => UNSAFE.has(value));
  if (unsafe) throw new Error(`recovery resource has unsafe classification: ${unsafe}`);
  const tolerated = new Set(resource.resourceClass === 'compose_volume'
    ? ['owned', 'protected', 'unregistered'] : ['owned', 'running']);
  if (classifications.some((value) => !tolerated.has(value))) {
    throw new Error('recovery resource has unsafe classification');
  }
}

function validateIdentity(resource) {
  if (resource.resourceClass === 'compose_volume') {
    if (!DIGEST.test(resource.immutableIdentity ?? '')
        || typeof resource.locator !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/.test(resource.locator)) {
      throw new Error('recovery volume identity is invalid');
    }
    return;
  }
  if (!DIGEST.test(resource.immutableIdentity ?? '')
      || resource.locator !== resource.immutableIdentity) {
    throw new Error('recovery engine identity is not an exact full ID');
  }
}

function normalizedResource(resource, target, attestationNonce) {
  if (!RECOVERY_CLASSES.includes(resource.resourceClass)) {
    throw new Error('recovery observation contains an out-of-scope resource class');
  }
  if (resource.ownershipState !== 'owned') throw new Error('recovery resource lacks complete ownership labels');
  validateIdentity(resource);
  assertSafeClassifications(resource);
  const authority = ownership(resource);
  assertTargetOwnership(authority, target);
  const dependencyIdentities = [...new Set(resource.runtime?.dependencyIdentities ?? [])].sort();
  if (dependencyIdentities.some((value) => !DIGEST.test(value))) {
    throw new Error('recovery dependency identity is invalid');
  }
  const base = {
    resourceClass: resource.resourceClass,
    locatorKind: resource.resourceClass === 'compose_volume' ? 'name' : 'engine_id',
    locator: resource.locator,
    immutableIdentity: resource.immutableIdentity,
    ownership: authority,
    ownershipDigest: canonicalSha256(authority),
    observationDigest: canonicalSha256(resource),
    dependencyIdentities,
    target: true,
  };
  return resource.resourceClass === 'compose_volume'
    ? { ...base, attestationNonce } : base;
}

function assertCounts(resources, expectedCounts) {
  for (const resourceClass of RECOVERY_CLASSES) {
    const actual = resources.filter((entry) => entry.resourceClass === resourceClass).length;
    if (actual !== expectedCounts[resourceClass]) {
      throw new Error(`${resourceClass} recovery count mismatch: expected ${expectedCounts[resourceClass]}, observed ${actual}`);
    }
  }
}

function assertUnique(resources) {
  const keys = resources.map((entry) => `${entry.resourceClass}:${entry.locator}`);
  if (new Set(keys).size !== keys.length) throw new Error('recovery observation has duplicate resource identities');
}

function assertDependencyClosure(resources) {
  const containers = new Set(resources.filter((entry) => entry.resourceClass === 'compose_container')
    .map((entry) => entry.immutableIdentity));
  for (const resource of resources) {
    if (resource.resourceClass !== 'compose_container'
        && resource.dependencyIdentities.some((identity) => !containers.has(identity))) {
      throw new Error('recovery resource dependency closure includes a foreign container');
    }
  }
}

function normalizedObservation(raw, target, expectedCounts, attestationNonce) {
  if (raw?.complete !== true || !Array.isArray(raw.ambiguities) || raw.ambiguities.length !== 0
      || !DIGEST.test(raw.daemonContextFingerprint ?? '')) {
    throw new Error('recovery observation is incomplete or ambiguous');
  }
  const resources = raw.resources.map((entry) => normalizedResource(entry, target, attestationNonce))
    .sort((left, right) => `${left.resourceClass}:${left.locator}`.localeCompare(`${right.resourceClass}:${right.locator}`));
  assertCounts(resources, expectedCounts);
  assertUnique(resources);
  assertDependencyClosure(resources);
  return Object.freeze({
    daemonContextFingerprint: raw.daemonContextFingerprint,
    engineGlobalArgs: Object.freeze([...(raw.engineGlobalArgs ?? [])]),
    resources: Object.freeze(resources),
  });
}

/** Observe one exact lost-authority stack without making any mutation expressible. */
export async function buildOperatorRecoveryObservation({
  target: rawTarget, expectedCounts: rawCounts,
  observe = observeDockerResources, observationOptions = {},
  discoverComposeProject = discoverComposeProjectFromDocker,
  requireIndependentRefresh = true, attestationNonce = randomUUID(),
} = {}) {
  const target = exactTarget(rawTarget);
  const expectedCounts = exactCounts(rawCounts);
  const first = normalizedObservation(
    await observeProjectClosedSet({ target, observe, observationOptions, discoverComposeProject }),
    target, expectedCounts, attestationNonce,
  );
  if (requireIndependentRefresh) {
    const second = normalizedObservation(
      await observeProjectClosedSet({ target, observe, observationOptions, discoverComposeProject }),
      target, expectedCounts, attestationNonce,
    );
    if (canonicalSha256(first) !== canonicalSha256(second)) {
      throw new Error('recovery target changed between observations');
    }
  }
  return Object.freeze({
    authorityKind: 'operator_lost_authority_recovery',
    target,
    expectedCounts: Object.freeze({ ...expectedCounts }),
    attestationNonce,
    ...first,
    observationDigest: canonicalSha256({
      daemonContextFingerprint: first.daemonContextFingerprint,
      resources: first.resources,
    }),
  });
}

/** Reobserve only the journal-permitted survivor projection before recovery mutation. */
export async function buildOperatorRecoverySurvivorObservation({
  target: rawTarget, allowedResources, optionalResourceKey = null,
  relaxedResourceKeys = [], stoppedResourceKeys = [],
  observe = observeDockerResources, observationOptions = {},
  discoverComposeProject = discoverComposeProjectFromDocker,
} = {}) {
  const target = exactTarget(rawTarget);
  if (!Array.isArray(allowedResources)) throw new Error('recovery survivor projection is invalid');
  const raw = await observeProjectClosedSet({
    target, observe, observationOptions, discoverComposeProject,
  });
  const counts = Object.fromEntries(RECOVERY_CLASSES.map((resourceClass) => [
    resourceClass, raw.resources.filter((entry) => entry.resourceClass === resourceClass).length,
  ]));
  const volumeNonce = allowedResources.find((entry) => entry.resourceClass === 'compose_volume')
    ?.attestationNonce ?? randomUUID();
  const observed = normalizedObservation(raw, target, counts, volumeNonce);
  const resourceKey = (entry) => `${entry.resourceClass}:${entry.immutableIdentity}`;
  const relaxed = new Set(relaxedResourceKeys);
  const stopped = new Set(stoppedResourceKeys);
  const allowed = new Map(allowedResources.map((entry) => [
    resourceKey(entry), entry,
  ]));
  const present = new Set(observed.resources.map(resourceKey));
  const optionalContainerIdentity = optionalResourceKey?.startsWith('compose_container:')
    ? optionalResourceKey.slice('compose_container:'.length) : null;
  const optionalContainerAbsent = optionalContainerIdentity !== null
    && !present.has(optionalResourceKey);
  for (const resource of observed.resources) {
    const key = resourceKey(resource);
    const scopedExpected = allowed.get(key);
    const expected = scopedExpected && optionalContainerAbsent ? {
      ...scopedExpected,
      dependencyIdentities: scopedExpected.dependencyIdentities.filter((identity) => (
        identity !== optionalContainerIdentity
      )),
    } : scopedExpected;
    const comparable = (entry) => Object.fromEntries(Object.entries(entry)
      .filter(([name]) => name !== 'observationDigest'));
    const optionalDependencyChanged = expected && scopedExpected
      && expected.dependencyIdentities.length !== scopedExpected.dependencyIdentities.length;
    if (!expected || (relaxed.has(key) || optionalDependencyChanged
      ? canonicalSha256(comparable(resource)) !== canonicalSha256(comparable(expected))
      : canonicalSha256(resource) !== canonicalSha256(expected))) {
      throw new Error('operator recovery survivor projection contains drift or an extra resource');
    }
    const rawResource = raw.resources.find((entry) => resourceKey(entry) === key);
    if (stopped.has(key) && rawResource?.runtime?.running !== false) {
      throw new Error('operator recovery stopped survivor is not stopped');
    }
  }
  const missingRequired = allowedResources.some((entry) => (
    resourceKey(entry) !== optionalResourceKey && !present.has(resourceKey(entry))
  ));
  if (missingRequired) throw new Error('operator recovery survivor projection is missing a required resource');
  return observed;
}

function exactActionSelectors(action) {
  const selectors = Object.fromEntries([
    ...RECOVERY_CLASSES, 'oci_image', 'buildkit_cache',
  ].map((resourceClass) => [resourceClass, []]));
  selectors[action.resourceClass] = [{ locator: action.locator }];
  return selectors;
}

/** Reinspect one approved identity on the already-pinned daemon. */
export async function observeOperatorRecoveryAction({
  action, target: rawTarget, scopeResource, daemonContextFingerprint,
  observe = (options) => observeDockerResources(options), observationOptions = {},
} = {}) {
  const target = exactTarget(rawTarget);
  const raw = await observe({
    ...observationOptions, selectors: exactActionSelectors(action),
  });
  if (raw?.complete !== true || raw.ambiguities?.length !== 0
      || raw.daemonContextFingerprint !== daemonContextFingerprint) {
    throw new Error('exact recovery action observation is incomplete or changed daemon');
  }
  if (raw.resources.length === 0) return null;
  if (raw.resources.length !== 1) throw new Error('exact recovery action selector is ambiguous');
  const normalized = normalizedResource(
    raw.resources[0], target, scopeResource?.attestationNonce,
  );
  return Object.freeze({
    ...normalized,
    running: raw.resources[0].runtime?.running ?? null,
    attachmentCount: raw.resources[0].runtime?.attachmentCount ?? null,
  });
}

function closedObservation(raw, daemonContextFingerprint) {
  if (raw?.complete !== true || raw.ambiguities?.length !== 0
      || raw.daemonContextFingerprint !== daemonContextFingerprint) {
    throw new Error('operator recovery final observation is incomplete or changed daemon');
  }
  if (raw.resources.length !== 0) throw new Error('operator recovery target residue remains');
  return canonicalSha256({
    daemonContextFingerprint: raw.daemonContextFingerprint,
    selectors: raw.selectors,
    resources: raw.resources,
  });
}

/** Prove the exact in-scope project/class selectors are empty after execution. */
export async function verifyOperatorRecoveryClosed({
  target: rawTarget, daemonContextFingerprint,
  observe = observeDockerResources, observationOptions = {},
  discoverComposeProject = discoverComposeProjectFromDocker,
} = {}) {
  const target = exactTarget(rawTarget);
  const first = closedObservation(
    await observeProjectClosedSet({ target, observe, observationOptions, discoverComposeProject }),
    daemonContextFingerprint,
  );
  const second = closedObservation(
    await observeProjectClosedSet({ target, observe, observationOptions, discoverComposeProject }),
    daemonContextFingerprint,
  );
  if (first !== second) throw new Error('operator recovery final observation changed');
  return Object.freeze({ closed: true, observationDigest: first });
}
