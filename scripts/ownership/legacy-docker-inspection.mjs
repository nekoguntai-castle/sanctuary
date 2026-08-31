import { execFileSync } from 'node:child_process';
import { canonicalSha256 } from './canonical-json.mjs';

const REQUIRED_LABELS = [
  'io.sanctuary.project',
  'io.sanctuary.deployment-id',
  'io.sanctuary.owner-id',
  'io.sanctuary.resource-class',
  'io.sanctuary.lifecycle',
  'io.sanctuary.cleanup-policy',
  'io.sanctuary.created-at',
  'io.sanctuary.created-by-release',
  'io.sanctuary.created-by-commit',
  'io.sanctuary.creation-run-id',
];

function docker(args) {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const status = error.status === null || error.status === undefined ? 'unknown' : error.status;
    throw new Error(`read-only Docker inspection failed (${args.slice(0, 3).join(' ')}; exit ${status})`);
  }
}

function dockerComposeWithOverlay(composeArgs, overlay) {
  try {
    return execFileSync('docker', ['compose', ...composeArgs, '-f', '-', 'config', '--format', 'json'], {
      encoding: 'utf8', input: overlay, maxBuffer: 8 * 1024 * 1024, timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('legacy durable-resource compatibility requires Docker Compose 2.24.4 or newer with !override support');
  }
}

function parseJson(output, label) {
  try { return JSON.parse(output); } catch { throw new Error(`${label} returned malformed JSON`); }
}

function rows(output) {
  return output.split('\n').filter(Boolean).map((line) => line.split('\t'));
}

function composeResourceNames(config, kind) {
  const entries = config?.[kind];
  if (entries === undefined) return new Map();
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`Compose config ${kind} are malformed`);
  return new Map(Object.entries(entries).map(([key, value]) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Compose config ${kind}.${key} is malformed`);
    return [value.name ?? key, key];
  }));
}

function relevantContainer(row, config, projectName) {
  const [id, name, composeProject] = row;
  if (composeProject === projectName) {
    const labels = inspectOne('container', id).labels;
    const serviceName = labels['com.docker.compose.service'];
    return { id, name, serviceName: Object.hasOwn(config?.services ?? {}, serviceName) ? serviceName : null };
  }
  const services = config?.services ?? {};
  for (const [serviceName, service] of Object.entries(services)) {
    if (service?.container_name === name) return { id, name, serviceName };
    const escapedProject = projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedService = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^${escapedProject}[-_]${escapedService}[-_][1-9][0-9]*$`).test(name)) return { id, name, serviceName };
  }
  return null;
}

function inspectOne(kind, locator) {
  const commandKind = kind === 'container' ? 'container' : kind;
  const parsed = parseJson(docker([commandKind, 'inspect', locator]), `${kind} inspect`);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== 'object') {
    throw new Error(`${kind} inspect returned an unexpected record count`);
  }
  const record = parsed[0];
  const labels = kind === 'container' ? record.Config?.Labels : record.Labels;
  return {
    record,
    labels: labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : {},
  };
}

function labelProblems(kind, locator, labels, expected) {
  const problems = [];
  for (const label of REQUIRED_LABELS) {
    if (typeof labels[label] !== 'string' || labels[label].length === 0) problems.push(`missing ${label}`);
  }
  for (const [label, value] of Object.entries(expected)) {
    if (labels[label] !== undefined && labels[label] !== value) problems.push(`${label} does not match ${value}`);
  }
  if (labels['io.sanctuary.created-by-commit'] !== undefined
    && !/^[a-f0-9]{40}$/.test(labels['io.sanctuary.created-by-commit'])) problems.push('created-by-commit is not a full commit');
  if (labels['io.sanctuary.created-at'] !== undefined
    && !Number.isFinite(Date.parse(labels['io.sanctuary.created-at']))) problems.push('created-at is invalid');
  return problems.map((problem) => `${kind} ${locator}: ${problem}`);
}

function sanctuaryLabelCount(labels) {
  return Object.keys(labels).filter((label) => label.startsWith('io.sanctuary.')).length;
}

function lineageProblems(kind, locator, labels, projectName, composeResource) {
  const problems = [];
  if (labels['com.docker.compose.project'] !== projectName) {
    problems.push(`com.docker.compose.project does not match ${projectName}`);
  }
  const resourceLabel = kind === 'container' ? 'service' : kind;
  if (!composeResource || labels[`com.docker.compose.${resourceLabel}`] !== composeResource) {
    problems.push(`com.docker.compose.${resourceLabel} does not match ${composeResource ?? '<unknown>'}`);
  }
  return problems.map((problem) => `${kind} ${locator}: ${problem}`);
}

function immutableIdentity(kind, inspected) {
  if (kind === 'container' || kind === 'network') {
    const value = inspected.record.Id;
    if (typeof value !== 'string' || !/^[a-f0-9]{12,64}$/.test(value)) throw new Error(`${kind} inspect lacks an immutable ID`);
    return value;
  }
  const { Name, Driver, Scope, Mountpoint, CreatedAt, Options } = inspected.record;
  if (![Name, Driver, Scope, Mountpoint].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('volume inspect lacks immutable fingerprint fields');
  }
  return canonicalSha256({ Name, Driver, Scope, Mountpoint, CreatedAt: CreatedAt ?? null, Options: Options ?? null });
}

function legacyObservation(kind, locator, composeResource, inspected) {
  return {
    resourceClass: `compose_${kind}`,
    locator,
    composeResource,
    immutableIdentity: immutableIdentity(kind, inspected),
    cleanupPolicy: 'preserve_ambiguous',
    ownershipState: 'unlabeled',
  };
}

function quotedYaml(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || value.includes('\0')) {
    throw new Error(`${label} has an invalid format`);
  }
  return JSON.stringify(value);
}

/**
 * Compose must treat pre-manifest durable resources as external during the
 * compatibility generation. Otherwise adding Sanctuary ownership labels to
 * the current Compose definition causes Compose to recreate networks or offer
 * to recreate volumes before the postcondition verifier can protect them.
 */
export function legacyDurableComposeOverlay(legacyResources) {
  if (!Array.isArray(legacyResources)) throw new Error('legacy resources must be an array');
  const groups = { compose_network: [], compose_volume: [] };
  for (const resource of legacyResources) {
    if (!Object.hasOwn(groups, resource?.resourceClass)) continue;
    if (resource.ownershipState !== 'unlabeled' || resource.cleanupPolicy !== 'preserve_ambiguous') {
      throw new Error('legacy durable resource is not protected unowned evidence');
    }
    groups[resource.resourceClass].push({
      composeResource: quotedYaml(resource.composeResource, 'legacy Compose resource'),
      locator: quotedYaml(resource.locator, 'legacy resource locator'),
    });
  }
  const durable = [...groups.compose_network, ...groups.compose_volume];
  if (durable.length === 0) return null;
  for (const entries of Object.values(groups)) {
    entries.sort((left, right) => left.composeResource.localeCompare(right.composeResource));
    if (new Set(entries.map((entry) => entry.composeResource)).size !== entries.length) {
      throw new Error('legacy durable resources contain a duplicate Compose resource');
    }
  }
  const lines = ['# Generated from immutable legacy resource observations.'];
  for (const [resourceClass, section] of [['compose_network', 'networks'], ['compose_volume', 'volumes']]) {
    const entries = groups[resourceClass];
    if (entries.length === 0) continue;
    lines.push(`${section}:`);
    for (const entry of entries) {
      lines.push(`  ${entry.composeResource}: !override`, `    name: ${entry.locator}`, '    external: true');
    }
  }
  return Buffer.from(`${lines.join('\n')}\n`);
}

function composeDefinitions(config, section) {
  const definitions = config?.[section] ?? {};
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
    throw new Error(`Compose config ${section} are malformed`);
  }
  for (const [key, definition] of Object.entries(definitions)) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new Error(`Compose config ${section}.${key} is malformed`);
    }
  }
  return definitions;
}

function composeLocatorCounts(definitions) {
  const counts = new Map();
  for (const [key, definition] of Object.entries(definitions)) {
    const locator = definition.name ?? key;
    counts.set(locator, (counts.get(locator) ?? 0) + 1);
  }
  return counts;
}

function selectedLegacyResourcesForSection(definitions, resources, section) {
  const selected = [];
  const locatorCounts = composeLocatorCounts(definitions);
  for (const resource of resources) {
    const definition = definitions[resource.composeResource];
    if (!definition) continue;
    const locator = definition.name ?? resource.composeResource;
    if (locator !== resource.locator) {
      throw new Error(`${section}.${resource.composeResource} changed legacy locator from ${resource.locator} to ${locator}`);
    }
    if (locatorCounts.get(locator) !== 1) throw new Error(`${section} alias legacy locator ${locator}`);
    selected.push(resource);
  }
  return selected;
}

function selectedLegacyDurableResources(config, legacyResources) {
  return [['compose_network', 'networks'], ['compose_volume', 'volumes']].flatMap(([resourceClass, section]) => {
    const definitions = composeDefinitions(config, section);
    const resources = legacyResources.filter((entry) => entry.resourceClass === resourceClass);
    return selectedLegacyResourcesForSection(definitions, resources, section);
  });
}

function assertExternalCompatibility(config, resources) {
  for (const resource of resources) {
    const section = resource.resourceClass === 'compose_network' ? 'networks' : 'volumes';
    const definition = config?.[section]?.[resource.composeResource];
    if (!definition || definition.name !== resource.locator || definition.external !== true) {
      throw new Error(`legacy ${section}.${resource.composeResource} did not resolve to its exact external locator`);
    }
    const forbidden = ['labels', 'driver', 'driver_opts', 'internal', 'attachable', 'enable_ipv4', 'enable_ipv6'];
    if (forbidden.some((key) => Object.hasOwn(definition, key))) {
      throw new Error(`legacy ${section}.${resource.composeResource} retained managed resource attributes`);
    }
  }
}

export function resolveLegacyDurableComposeOverlay({ composeArgs, legacyResources }) {
  const durable = legacyResources.filter((entry) => ['compose_network', 'compose_volume'].includes(entry.resourceClass));
  if (durable.length === 0) return null;
  const baseConfig = parseJson(docker(['compose', ...composeArgs, 'config', '--format', 'json']), 'Docker Compose config');
  const selected = selectedLegacyDurableResources(baseConfig, durable);
  const overlay = legacyDurableComposeOverlay(selected);
  if (!overlay) return null;
  const merged = parseJson(dockerComposeWithOverlay(composeArgs, overlay), 'Docker Compose compatibility config');
  assertExternalCompatibility(merged, selected);
  return overlay;
}

function inspectResource({
  kind, locator, inspectLocator = locator, composeResource, expected, projectName,
  allowUnlabeledUpgrade, findings, legacyResources,
}) {
  const inspected = inspectOne(kind, inspectLocator);
  const lineage = lineageProblems(kind, locator, inspected.labels, projectName, composeResource);
  if (allowUnlabeledUpgrade && sanctuaryLabelCount(inspected.labels) === 0) {
    if (lineage.length > 0) findings.push(...lineage);
    else legacyResources.push(legacyObservation(kind, locator, composeResource, inspected));
    return inspected;
  }
  findings.push(...lineage);
  const ownershipProblems = labelProblems(kind, locator, inspected.labels, expected);
  findings.push(...ownershipProblems);
  if (ownershipProblems.length === 0) {
    findings.push(`${kind} ${locator}: labels alone cannot establish ownership without a deployment manifest`);
  }
  return inspected;
}

/**
 * Refuse a first manifest when exact resources already exist without the full,
 * matching ownership tuple. This function is deliberately inspection-only.
 */
export function assertFirstManifestDockerResources({
  definition, composeArgs, deploymentId, ownerId, projectLabel, allowUnlabeledUpgrade = false,
}) {
  const args = ['compose', ...composeArgs, 'config', '--format', 'json'];
  const config = parseJson(docker(args), 'Docker Compose config');
  const volumeNames = composeResourceNames(config, 'volumes');
  const networkNames = composeResourceNames(config, 'networks');
  const allVolumes = rows(docker(['volume', 'ls', '--format', '{{.Name}}\t{{.Label "com.docker.compose.project"}}']));
  const allNetworks = rows(docker(['network', 'ls', '--format', '{{.ID}}\t{{.Name}}\t{{.Label "com.docker.compose.project"}}']));
  const allContainers = rows(docker(['container', 'ls', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Label "com.docker.compose.project"}}']));
  const findings = [];
  const legacyResources = [];
  const base = {
    'io.sanctuary.project': projectLabel,
    'io.sanctuary.deployment-id': deploymentId,
    'io.sanctuary.owner-id': ownerId,
  };

  for (const [name, composeProject] of allVolumes.sort((left, right) => left[0].localeCompare(right[0]))) {
    if (!volumeNames.has(name) && composeProject !== definition.composeProjectName) continue;
    inspectResource({
      kind: 'volume', locator: name, composeResource: volumeNames.get(name), projectName: definition.composeProjectName,
      allowUnlabeledUpgrade, findings, legacyResources,
      expected: { ...base, 'io.sanctuary.resource-class': 'compose_volume', 'io.sanctuary.cleanup-policy': 'preserve_ambiguous' },
    });
  }
  for (const [id, name, composeProject] of allNetworks.sort((left, right) => left[1].localeCompare(right[1]))) {
    if (!networkNames.has(name) && composeProject !== definition.composeProjectName) continue;
    inspectResource({
      kind: 'network', locator: name, inspectLocator: id, composeResource: networkNames.get(name), projectName: definition.composeProjectName,
      allowUnlabeledUpgrade, findings, legacyResources,
      expected: { ...base, 'io.sanctuary.resource-class': 'compose_network', 'io.sanctuary.cleanup-policy': 'exact_delete' },
    });
  }
  for (const row of allContainers) {
    const resource = relevantContainer(row, config, definition.composeProjectName);
    if (!resource) continue;
    inspectResource({
      kind: 'container', locator: resource.name, inspectLocator: resource.id,
      composeResource: resource.serviceName, projectName: definition.composeProjectName,
      allowUnlabeledUpgrade, findings, legacyResources,
      expected: { ...base, 'io.sanctuary.resource-class': 'compose_container', 'io.sanctuary.cleanup-policy': 'exact_delete' },
    });
  }

  if (findings.length > 0) {
    throw new Error(`first deployment manifest refused existing legacy Docker resources:\n- ${findings.join('\n- ')}\nNo resources were relabeled, recreated, or adopted.`);
  }
  return { inspected: true, legacyResources };
}

function verifyLegacyDurableResources(legacyResources, definition, findings) {
  for (const observation of legacyResources.filter((entry) => entry.resourceClass !== 'compose_container')) {
    const kind = observation.resourceClass === 'compose_volume' ? 'volume' : 'network';
    const inspected = inspectOne(kind, observation.locator);
    if (immutableIdentity(kind, inspected) !== observation.immutableIdentity) {
      findings.push(`${kind} ${observation.locator}: immutable identity changed`);
    }
    if (sanctuaryLabelCount(inspected.labels) !== 0) {
      findings.push(`${kind} ${observation.locator}: legacy resource was retroactively claimed`);
    }
    findings.push(...lineageProblems(
      kind, observation.locator, inspected.labels, definition.composeProjectName, observation.composeResource,
    ));
  }
}

export function assertLegacyDurablePreconditions({ legacyResources, definition }) {
  const findings = [];
  verifyLegacyDurableResources(legacyResources, definition, findings);
  if (findings.length > 0) throw new Error(`legacy durable-resource precondition failed:\n- ${findings.join('\n- ')}`);
  return { verified: true };
}

function verifyCurrentResources({ kind, names, observations, base, definition, findings }) {
  const resourceClass = `compose_${kind}`;
  const cleanupPolicy = kind === 'volume' ? 'preserve_ambiguous' : 'exact_delete';
  for (const [name, composeResource] of names) {
    const observation = observations.get(`${resourceClass}:${name}`);
    if (observation) {
      if (observation.composeResource !== composeResource) findings.push(`${kind} ${name}: Compose resource identity changed`);
      continue;
    }
    const inspected = inspectOne(kind, name);
    findings.push(...lineageProblems(kind, name, inspected.labels, definition.composeProjectName, composeResource));
    findings.push(...labelProblems(kind, name, inspected.labels, {
      ...base, 'io.sanctuary.resource-class': resourceClass, 'io.sanctuary.cleanup-policy': cleanupPolicy,
    }));
  }
}

function verifyCurrentContainers({ config, definition, observations, base, findings }) {
  const containers = rows(docker(['container', 'ls', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Label "com.docker.compose.project"}}']));
  for (const row of containers) {
    const resource = relevantContainer(row, config, definition.composeProjectName);
    if (!resource || !resource.serviceName) continue;
    const inspected = inspectOne('container', resource.id);
    const observation = [...observations.values()].find((entry) => (
      entry.resourceClass === 'compose_container' && entry.composeResource === resource.serviceName
    ));
    if (observation && immutableIdentity('container', inspected) === observation.immutableIdentity) {
      findings.push(`container ${resource.name}: legacy container was not recreated`);
    }
    findings.push(...lineageProblems('container', resource.name, inspected.labels, definition.composeProjectName, resource.serviceName));
    findings.push(...labelProblems('container', resource.name, inspected.labels, {
      ...base, 'io.sanctuary.resource-class': 'compose_container', 'io.sanctuary.cleanup-policy': 'exact_delete',
    }));
  }
}

export function assertLegacyUpgradePostconditions({
  definition, composeArgs, deploymentId, ownerId, projectLabel, legacyResources,
}) {
  if (!Array.isArray(legacyResources) || legacyResources.length === 0) return { verified: true };
  const config = parseJson(docker(['compose', ...composeArgs, 'config', '--format', 'json']), 'Docker Compose config');
  const volumeNames = composeResourceNames(config, 'volumes');
  const networkNames = composeResourceNames(config, 'networks');
  const observations = new Map(legacyResources.map((entry) => [`${entry.resourceClass}:${entry.locator}`, entry]));
  const base = {
    'io.sanctuary.project': projectLabel,
    'io.sanctuary.deployment-id': deploymentId,
    'io.sanctuary.owner-id': ownerId,
  };
  const findings = [];

  verifyLegacyDurableResources(legacyResources, definition, findings);
  verifyCurrentResources({ kind: 'volume', names: volumeNames, observations, base, definition, findings });
  verifyCurrentResources({ kind: 'network', names: networkNames, observations, base, definition, findings });
  verifyCurrentContainers({ config, definition, observations, base, findings });
  if (findings.length > 0) throw new Error(`legacy upgrade postcondition failed:\n- ${findings.join('\n- ')}`);
  return { verified: true };
}
