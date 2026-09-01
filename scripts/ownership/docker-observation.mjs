import { canonicalSha256 } from './canonical-json.mjs';
import { commandAmbiguity, runCleanupCommand } from './cleanup-command.mjs';
import { CLEANUP_POLICIES } from './contracts.mjs';
import { DOCKER_DAEMON_AUTHORITY_POLICY, dockerDaemonDriftOperation,
  observeResolvedDockerDaemonEvidence, resolveDockerDaemonContext,
} from './cleanup-execution-context.mjs';
import { commit, enumeration, identifier, timestamp } from './validation.mjs';

export const DOCKER_RESOURCE_CLASSES = [
  'compose_container', 'compose_network', 'compose_volume', 'oci_image', 'buildkit_cache',
];

export const REQUIRED_OWNERSHIP_LABELS = [
  'io.sanctuary.project', 'io.sanctuary.deployment-id', 'io.sanctuary.owner-id',
  'io.sanctuary.resource-class', 'io.sanctuary.lifecycle', 'io.sanctuary.cleanup-policy',
  'io.sanctuary.created-at', 'io.sanctuary.created-by-release',
  'io.sanctuary.created-by-commit', 'io.sanctuary.creation-run-id',
];

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const KINDS = {
  compose_container: { noun: 'container', list: ['container', 'ls', '--all', '--no-trunc'], format: '{{.ID}}' },
  compose_network: { noun: 'network', list: ['network', 'ls', '--no-trunc'], format: '{{.ID}}' },
  compose_volume: { noun: 'volume', list: ['volume', 'ls'], format: '{{.Name}}' },
  oci_image: { noun: 'image', list: ['image', 'ls', '--all', '--no-trunc'], format: '{{.ID}}' },
};

function lines(output) {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function exactObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function allowedSelectorKinds(resourceClass) {
  if (resourceClass === 'buildkit_cache') return ['builder'];
  if (resourceClass === 'oci_image') return ['labels', 'manifestLabels', 'locator', 'reference'];
  return ['labels', 'manifestLabels', 'locator'];
}

const MANIFEST_SELECTOR_LABELS = [
  'io.sanctuary.project', 'io.sanctuary.deployment-id',
  'io.sanctuary.owner-id', 'io.sanctuary.resource-class',
];

function normalizeLabelSelector(labels, resourceClass) {
  exactObject(labels, `${resourceClass} selector labels`);
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0 || entries.some(([key, value]) => !key || typeof value !== 'string' || !value)) {
    throw new TypeError(`${resourceClass} label selector must be nonempty string pairs`);
  }
  if (resourceClass === 'buildkit_cache' || !REQUIRED_OWNERSHIP_LABELS.every((key) => Object.hasOwn(labels, key))) {
    throw new TypeError(`${resourceClass} label selector must contain the complete ownership tuple`);
  }
  if (labels['io.sanctuary.resource-class'] !== resourceClass) {
    throw new TypeError(`${resourceClass} label selector has a mismatched resource class`);
  }
  return { labels: Object.fromEntries(entries) };
}

function normalizeManifestSelector(labels, resourceClass) {
  exactObject(labels, `${resourceClass} manifest selector labels`);
  const keys = Object.keys(labels).sort();
  if (keys.length !== MANIFEST_SELECTOR_LABELS.length
      || keys.some((key, index) => key !== [...MANIFEST_SELECTOR_LABELS].sort()[index])) {
    throw new TypeError(`${resourceClass} manifest selector must contain the exact manifest identity labels`);
  }
  if (Object.values(labels).some((value) => typeof value !== 'string' || value.length === 0)
      || labels['io.sanctuary.resource-class'] !== resourceClass) {
    throw new TypeError(`${resourceClass} manifest selector labels are invalid`);
  }
  return { manifestLabels: Object.fromEntries(Object.entries(labels).sort(([left], [right]) => left.localeCompare(right))) };
}

function validateLocator(value, resourceClass) {
  if (['compose_container', 'compose_network'].includes(resourceClass)
      && !/^[a-f0-9]{12,64}$/.test(value)) throw new TypeError(`${resourceClass} locator must be an immutable ID`);
  if (resourceClass === 'oci_image' && !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new TypeError('oci_image locator must be an immutable content ID');
  }
}

function validateReference(value) {
  const exactDigest = /^[^\s*?\[\]]+@sha256:[a-f0-9]{64}$/.test(value);
  const exactTag = /^[^\s*?\[\]]+:[^\s/:*?\[\]]+$/.test(value);
  if (!exactDigest && !exactTag) throw new TypeError('oci_image reference must be an exact tag or digest without glob syntax');
}

function validateSelectorValue(kind, value, resourceClass) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${resourceClass} selector value must be a nonempty string`);
  }
  if (kind === 'locator') validateLocator(value, resourceClass);
  if (kind === 'reference') validateReference(value);
}

function normalizeSelector(selector, resourceClass) {
  exactObject(selector, `${resourceClass} selector`);
  const keys = ['labels', 'manifestLabels', 'locator', 'reference', 'builder'].filter((key) => selector[key] !== undefined);
  if (keys.length !== 1) throw new TypeError(`${resourceClass} selector must contain exactly one selector kind`);
  const kind = keys[0];
  if (!allowedSelectorKinds(resourceClass).includes(kind)) throw new TypeError(`${kind} is not a valid ${resourceClass} selector`);
  if (kind === 'labels') return normalizeLabelSelector(selector.labels, resourceClass);
  if (kind === 'manifestLabels') return normalizeManifestSelector(selector.manifestLabels, resourceClass);
  const value = selector[keys[0]];
  validateSelectorValue(kind, value, resourceClass);
  return { [kind]: value };
}

export function normalizeDockerSelectors(selectors = {}) {
  exactObject(selectors, 'Docker selectors');
  const normalized = {};
  for (const resourceClass of DOCKER_RESOURCE_CLASSES) {
    const values = selectors[resourceClass] ?? [];
    if (!Array.isArray(values)) throw new TypeError(`${resourceClass} selectors must be an array`);
    normalized[resourceClass] = values.map((selector) => normalizeSelector(selector, resourceClass));
  }
  return normalized;
}

function query(run, engine, args, operation) {
  return run(engine, args, { operation });
}

function listArgs(resourceClass, selector) {
  const kind = KINDS[resourceClass];
  const args = [...kind.list, '--format', kind.format];
  if (selector.labels || selector.manifestLabels) {
    for (const [key, value] of Object.entries(selector.labels ?? selector.manifestLabels)) args.push('--filter', `label=${key}=${value}`);
  } else if (selector.locator) {
    if (resourceClass === 'compose_volume') args.push('--filter', `name=^${selector.locator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    else if (resourceClass !== 'oci_image') args.push('--filter', `id=${selector.locator}`);
  } else if (selector.reference) {
    args.push('--filter', `reference=${selector.reference}`);
  }
  return args;
}

function listedLocators(run, engine, resourceClass, selectors) {
  const union = new Set();
  for (const selector of selectors) {
    const selected = lines(query(run, engine, listArgs(resourceClass, selector), `${resourceClass} list`));
    for (const locator of selector.locator ? selected.filter((entry) => entry === selector.locator) : selected) union.add(locator);
  }
  return [...union].sort();
}

function inspectOne(run, engine, resourceClass, locator) {
  const noun = KINDS[resourceClass].noun;
  const output = query(run, engine, [noun, 'inspect', locator], `${resourceClass} inspect`);
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw Object.assign(new Error('inspect returned malformed JSON'), { category: 'malformed_output', operation: `${resourceClass} inspect` }); }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== 'object') {
    throw Object.assign(new Error('inspect returned an unexpected record count'), { category: 'malformed_output', operation: `${resourceClass} inspect` });
  }
  return parsed[0];
}

function labelsFor(resourceClass, record) {
  const labels = resourceClass === 'compose_container' ? record.Config?.Labels
    : resourceClass === 'oci_image' ? (record.Config?.Labels ?? record.ContainerConfig?.Labels)
      : (record.Labels ?? record.labels);
  return labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : {};
}

function firstDefined(record, keys, fallback) {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return fallback;
}

function volumeFields(record) {
  return {
    Name: firstDefined(record, ['Name', 'name']),
    Driver: firstDefined(record, ['Driver', 'driver']),
    Scope: firstDefined(record, ['Scope', 'scope']),
    Mountpoint: firstDefined(record, ['Mountpoint', 'mountpoint']),
    CreatedAt: firstDefined(record, ['CreatedAt', 'createdAt', 'created'], null),
    Options: firstDefined(record, ['Options', 'options'], null),
  };
}

function volumeIdentity(record) {
  const fields = volumeFields(record);
  const { Name, Driver, Scope, Mountpoint } = fields;
  if (![Name, Driver, Scope, Mountpoint].every((value) => typeof value === 'string' && value.length > 0)) {
    throw Object.assign(new Error('volume inspect lacks fingerprint fields'), { category: 'malformed_output' });
  }
  return canonicalSha256(fields);
}

export function dockerImmutableIdentity(resourceClass, record) {
  if (resourceClass === 'compose_volume') return volumeIdentity(record);
  const identity = record.Id ?? record.ID ?? record.id;
  const valid = resourceClass === 'oci_image' ? /^sha256:[a-f0-9]{64}$/.test(identity) : /^[a-f0-9]{12,64}$/.test(identity);
  if (!valid) throw Object.assign(new Error('inspect lacks an immutable ID'), { category: 'malformed_output' });
  return identity;
}

function ownershipState(labels, resourceClass) {
  const sanctuary = Object.keys(labels).filter((key) => key.startsWith('io.sanctuary.'));
  if (sanctuary.length === 0) return Object.keys(labels).some((key) => key.startsWith('com.docker.compose.')) ? 'legacy_unlabeled' : 'unlabeled';
  const complete = REQUIRED_OWNERSHIP_LABELS.every((key) => typeof labels[key] === 'string' && labels[key].length > 0);
  if (!complete || labels['io.sanctuary.resource-class'] !== resourceClass) return 'malformed';
  try {
    for (const key of ['project', 'deployment-id', 'owner-id', 'lifecycle', 'creation-run-id']) {
      identifier(labels[`io.sanctuary.${key}`], `label ${key}`);
    }
    enumeration(labels['io.sanctuary.cleanup-policy'], 'label cleanup-policy', CLEANUP_POLICIES);
    timestamp(labels['io.sanctuary.created-at'], 'label created-at');
    commit(labels['io.sanctuary.created-by-commit'], 'label created-by-commit');
    if (labels['io.sanctuary.created-by-release'] !== 'unreleased') {
      identifier(labels['io.sanctuary.created-by-release'], 'label created-by-release');
    }
    return 'owned';
  } catch { return 'malformed'; }
}

function registeredMetadata(options, resourceClass, immutableIdentity, locator) {
  const matches = (options.registrations ?? []).filter((entry) => entry.resourceClass === resourceClass
    && entry.immutableIdentity === immutableIdentity
    && (locator === undefined || entry.locator === undefined || entry.locator === locator));
  if (matches.length === 0) return {};
  const referenceIds = [...new Set(matches.flatMap((entry) => entry.referenceIds ?? []))].sort();
  const ownerIds = [...new Set(matches.map((entry) => entry.ownerId).filter(Boolean))].sort();
  const shared = matches.some((entry) => entry.lifecycle === 'shared')
    || new Set(matches.map((entry) => entry.operationRunId).filter(Boolean)).size > 1;
  const retained = matches.some((entry) => entry.cleanupPolicy === 'retain' || entry.cleanupPolicy === 'retain_reconcile');
  return { ...matches.at(-1), referenceIds, ownerIds, lifecycle: shared ? 'shared' : matches.at(-1).lifecycle,
    cleanupPolicy: retained ? 'retain' : matches.at(-1).cleanupPolicy };
}

function registrationProof(registration) {
  if (!registration.resourceClass) return null;
  const keys = [
    'registrationId', 'deploymentId', 'operationRunId', 'ownerId', 'resourceClass',
    'lifecycle', 'cleanupPolicy', 'locatorKind', 'locator', 'immutableIdentity',
    'metadataDigest', 'referenceIds', 'signerKeyId',
  ];
  return Object.fromEntries(keys.filter((key) => registration[key] !== undefined)
    .map((key) => [key, registration[key]]));
}

function classifyShared(result, labels, identity, registration, options) {
  if ((registration.ownerIds?.length ?? 0) > 1 || (registration.referenceIds?.length ?? 0) > 1
      || labels['io.sanctuary.lifecycle'] === 'shared'
      || registration.lifecycle === 'shared' || options.sharedImmutableIdentities?.includes(identity)) result.add('shared');
}

function classifyCurrentAndProtected(result, labels, registration, options) {
  const currentIds = options.currentDeploymentIds ?? (options.currentDeploymentId ? [options.currentDeploymentId] : []);
  if (currentIds.includes(labels['io.sanctuary.deployment-id'])
      || labels['io.sanctuary.lifecycle'] === 'active'
      || registration.lifecycle === 'active') result.add('current');
  if (options.protectedProjects?.includes(labels['io.sanctuary.project']) || registration.protected === true) result.add('protected');
  if (registration.cleanupPolicy === 'retain' || registration.cleanupPolicy === 'retain_reconcile') result.add('protected');
}

function classifyProduction(result, labels, registration, options) {
  if (options.productionProjects?.includes(labels['io.sanctuary.project']) || registration.production === true) {
    result.add('production');
    result.add('protected');
  }
}

function classifyVolume(result, record, identity, registration, options, runtime) {
  const volumeName = record.Name ?? record.name;
  if (runtime.attachmentCount > 0 || registration.data === true || options.dataVolumeNames?.includes(volumeName)) {
    result.add(registration.data === true || options.dataVolumeNames?.includes(volumeName) ? 'data' : 'shared');
  }
  const nonce = registration.creationNonce ?? registration.operationRunId;
  const registered = registration.immutableIdentity === identity && registration.locator === volumeName
    && typeof nonce === 'string' && nonce.length > 0;
  result.add(registered ? 'registered' : 'unregistered');
  if (!registered) result.add('protected');
}

function classifyImage(result, record, identity, registration, runtime) {
  if (runtime.referenceCount > 0) {
    result.add('referenced');
    result.add('shared');
  }
  if (registration.release === true || runtime.tags.some((tag) => !tag.endsWith(':local'))) result.add('protected');
  const registered = registration.immutableIdentity === identity;
  result.add(registered ? 'registered' : 'unregistered');
  if (!registered) result.add('protected');
}

function imageReferenceFields(record) {
  const tags = record.RepoTags ?? [];
  const digests = record.RepoDigests ?? [];
  if (!Array.isArray(tags) || !Array.isArray(digests) || tags.length > 256 || digests.length > 256) {
    throw Object.assign(new Error('image reference fields are malformed or unbounded'), { category: 'malformed_output' });
  }
  if (tags.some((tag) => typeof tag !== 'string' || tag.length === 0 || tag.length > 512)
      || digests.some((digest) => typeof digest !== 'string' || !/^[^\s]+@sha256:[a-f0-9]{64}$/.test(digest))) {
    throw Object.assign(new Error('image reference entries are malformed'), { category: 'malformed_output' });
  }
  return { tags, digests };
}

function classifications(resourceClass, record, labels, identity, locator, options, runtime) {
  const state = ownershipState(labels, resourceClass);
  const result = new Set([state]);
  if (state === 'legacy_unlabeled') result.add('unlabeled');
  const registration = registeredMetadata(options, resourceClass, identity, resourceClass === 'compose_volume' ? locator : undefined);
  classifyShared(result, labels, identity, registration, options);
  classifyCurrentAndProtected(result, labels, registration, options);
  classifyProduction(result, labels, registration, options);
  if (['retain', 'retain_reconcile', 'preserve_ambiguous'].includes(labels['io.sanctuary.cleanup-policy'])) result.add('protected');
  if (resourceClass === 'compose_container' && runtime.running) result.add('running');
  if (resourceClass === 'compose_network' && runtime.endpointCount > 0) result.add('shared');
  if (resourceClass === 'compose_volume') classifyVolume(result, record, identity, registration, options, runtime);
  if (resourceClass === 'oci_image') classifyImage(result, record, identity, registration, runtime);
  if (['unlabeled', 'legacy_unlabeled', 'malformed', 'current', 'shared', 'data'].some((value) => result.has(value))) result.add('protected');
  return [...result].sort();
}

function relationshipState(run, engine, resourceClass, record, identity) {
  if (resourceClass === 'compose_network') {
    const refs = lines(query(run, engine, ['container', 'ls', '--all', '--no-trunc', '--filter', `network=${identity}`, '--format', '{{.ID}}'], 'network endpoint list'));
    return { endpointCount: new Set(refs).size };
  }
  if (resourceClass === 'compose_volume') {
    const refs = lines(query(run, engine, ['container', 'ls', '--all', '--no-trunc', '--filter', `volume=${record.Name ?? record.name}`, '--format', '{{.ID}}'], 'volume attachment list'));
    return { attachmentCount: new Set(refs).size };
  }
  if (resourceClass === 'oci_image') {
    const refs = lines(query(run, engine, ['container', 'ls', '--all', '--no-trunc', '--filter', `ancestor=${identity}`, '--format', '{{.ID}}'], 'image reference list'));
    const { tags, digests } = imageReferenceFields(record);
    const references = [...new Set([...tags, ...digests])].sort();
    const contentDigests = [...new Set([
      identity,
      ...digests.map((reference) => reference.slice(reference.lastIndexOf('@') + 1)),
    ])].filter((digest) => /^sha256:[a-f0-9]{64}$/.test(digest))
      .map((digest) => digest.slice('sha256:'.length)).sort();
    if (references.length > 256 || contentDigests.length > 256) {
      throw Object.assign(new Error('image reference observation exceeds the bounded limit'), { category: 'output_limit', operation: 'image reference inventory' });
    }
    return { referenceCount: new Set(refs).size, references, contentDigests, tags: [...tags].sort() };
  }
  const running = record.State?.Running;
  if (typeof running !== 'boolean') throw Object.assign(new Error('container inspect lacks a boolean running state'), { category: 'malformed_output' });
  return { running };
}

function observeLocator(context, resourceClass, locator) {
  const { run, engine, options } = context;
  const record = inspectOne(run, engine, resourceClass, locator);
  const identity = dockerImmutableIdentity(resourceClass, record);
  if (resourceClass !== 'compose_volume' && /^(?:sha256:)?[a-f0-9]{12,64}$/.test(locator) && locator !== identity) {
    throw Object.assign(new Error('immutable identity changed during inspection'), { category: 'identity_changed' });
  }
  const labels = labelsFor(resourceClass, record);
  const runtime = relationshipState(run, engine, resourceClass, record, identity);
  const registration = registeredMetadata(
    options, resourceClass, identity, resourceClass === 'compose_volume' ? locator : undefined,
  );
  return {
    resourceClass, locator, immutableIdentity: identity, labels,
    ownershipState: ownershipState(labels, resourceClass),
    classifications: classifications(resourceClass, record, labels, identity, locator, options, runtime),
    runtime, registration: registrationProof(registration),
  };
}

function observeClass(context, resourceClass, selectors) {
  const { run, engine, options, ambiguities } = context;
  if (selectors.length === 0) return [];
  let before;
  try { before = listedLocators(run, engine, resourceClass, selectors); } catch (error) {
    ambiguities.push(commandAmbiguity(error, { resourceClass, operation: `${resourceClass} list` }));
    return [];
  }
  const observations = [];
  for (const locator of before) {
    try {
      observations.push(observeLocator(context, resourceClass, locator));
    } catch (error) {
      ambiguities.push(commandAmbiguity(error, { resourceClass, locator, operation: error.operation ?? `${resourceClass} inspect` }));
    }
  }
  try {
    const after = listedLocators(run, engine, resourceClass, selectors);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      ambiguities.push({ category: 'inventory_drift', resourceClass, operation: `${resourceClass} relist` });
    } else {
      const observed = new Map(observations.map((entry) => [entry.locator, entry]));
      for (const locator of after) {
        if (!observed.has(locator)) continue;
        const current = observeLocator(context, resourceClass, locator);
        if (observed.get(locator).immutableIdentity !== current.immutableIdentity) {
          ambiguities.push({ category: 'identity_changed', resourceClass, locator, operation: `${resourceClass} reinspection` });
        } else if (canonicalSha256(observed.get(locator)) !== canonicalSha256(current)) {
          ambiguities.push({ category: 'inventory_drift', resourceClass, locator, operation: `${resourceClass} safety reinspection` });
        }
      }
    }
  } catch (error) {
    ambiguities.push(commandAmbiguity(error, { resourceClass, operation: `${resourceClass} relist` }));
  }
  return observations;
}

function parseBuilder(output, expectedName) {
  const match = output.match(/^Name:\s*(\S+)\s*$/m);
  if (!match || match[1] !== expectedName) throw Object.assign(new Error('builder inspect name mismatch'), { category: 'malformed_output' });
  return { name: match[1], driver: output.match(/^Driver:\s*(\S+)\s*$/m)?.[1] ?? 'unknown' };
}

function observeBuilders(context, selectors) {
  const observations = [];
  for (const selector of selectors) {
    const name = selector.builder;
    try {
      const first = parseBuilder(query(context.run, context.engine, ['buildx', 'inspect', name], 'builder inspect'), name);
      const second = parseBuilder(query(context.run, context.engine, ['buildx', 'inspect', name], 'builder relist'), name);
      if (JSON.stringify(first) !== JSON.stringify(second)) context.ambiguities.push({ category: 'inventory_drift', resourceClass: 'buildkit_cache', locator: name, operation: 'builder relist' });
      const registration = registeredMetadata(context.options, 'buildkit_cache', name);
      const classes = new Set(['registered']);
      if (name === 'default' || registration.default === true) classes.add('default_builder');
      if (registration.dedicated !== true) classes.add('shared');
      classes.add('protected');
      observations.push({ resourceClass: 'buildkit_cache', locator: name, immutableIdentity: name,
        ownershipState: registration.dedicated === true ? 'registered' : 'unregistered', classifications: [...classes].sort(), runtime: first });
    } catch (error) {
      context.ambiguities.push(commandAmbiguity(error, { resourceClass: 'buildkit_cache', locator: name, operation: error.operation ?? 'builder inspect' }));
    }
  }
  return observations;
}

function resolvedObservationAuthority(options, engine, baseRun) {
  const authority = options.daemonAuthority
    ?? resolveDockerDaemonContext({ engine, runCommand: baseRun });
  if (authority?.engine !== engine || authority?.daemonAuthorityPolicy !== DOCKER_DAEMON_AUTHORITY_POLICY
      || !DIGEST_PATTERN.test(authority?.fingerprint ?? '')
      || !DIGEST_PATTERN.test(authority?.daemonFingerprint ?? '')) {
    throw Object.assign(new Error('Docker pinned daemon authority is invalid'), { category: 'identity_changed' });
  }
  const currentDaemon = observeResolvedDockerDaemonEvidence({
    engine, runCommand: baseRun, engineGlobalArgs: authority.engineGlobalArgs,
  });
  if (currentDaemon.fingerprint !== authority.daemonFingerprint) {
    throw Object.assign(new Error('Docker pinned daemon authority changed'), {
      category: 'identity_changed', operation: dockerDaemonDriftOperation(authority, currentDaemon),
    });
  }
  return authority;
}
function unavailableObservation(engine, selectors, ambiguities) {
  return { complete: false, engine, selectors,
    daemonContextFingerprint: canonicalSha256({ engine, authority: 'unavailable' }),
    engineGlobalArgs: [], resources: [], ambiguities,
  };
}
function recheckResolvedDaemon(context, authority) {
  try {
    const daemonAfter = observeResolvedDockerDaemonEvidence({
      engine: context.engine, runCommand: context.baseRun, engineGlobalArgs: authority.engineGlobalArgs,
    });
    if (daemonAfter.fingerprint !== authority.daemonFingerprint) {
      context.ambiguities.push({ category: 'inventory_drift',
        operation: dockerDaemonDriftOperation(authority, daemonAfter) });
    }
  } catch (error) {
    context.ambiguities.push(commandAmbiguity(error, { operation: 'Docker daemon/context authority reinspection' }));
  }
}
/** Produce a read-only, fail-closed observation. No mutation command is expressible here. */
export function observeDockerResources(options = {}) {
  const selectors = normalizeDockerSelectors(options.selectors ?? {});
  const engine = options.engine ?? 'docker';
  if (!['docker', 'podman'].includes(engine)) throw new TypeError('Docker observation engine must be docker or podman');
  const context = {
    engine, options, ambiguities: [],
    baseRun: options.runCommand ?? ((executable, args, commandOptions) => runCleanupCommand(executable, args, { ...options.commandOptions, ...commandOptions })),
  };
  let authority;
  try {
    authority = resolvedObservationAuthority(options, engine, context.baseRun);
    context.run = (executable, args, commandOptions) => context.baseRun(
      executable, [...authority.engineGlobalArgs, ...args], commandOptions,
    );
  } catch (error) {
    context.ambiguities.push(commandAmbiguity(error,
      { operation: error.operation ?? 'Docker daemon/context authority' }));
    return unavailableObservation(engine, selectors, context.ambiguities);
  }
  const resources = Object.keys(KINDS).flatMap((resourceClass) => observeClass(context, resourceClass, selectors[resourceClass]));
  resources.push(...observeBuilders(context, selectors.buildkit_cache));
  recheckResolvedDaemon(context, authority);
  resources.sort((left, right) => `${left.resourceClass}:${left.locator}`.localeCompare(`${right.resourceClass}:${right.locator}`));
  return { complete: context.ambiguities.length === 0, engine, selectors,
    daemonContextFingerprint: authority.fingerprint,
    engineGlobalArgs: authority.engineGlobalArgs, resources, ambiguities: context.ambiguities,
  };
}
