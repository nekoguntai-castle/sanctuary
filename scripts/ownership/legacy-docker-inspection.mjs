import { execFileSync } from 'node:child_process';

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

function parseJson(output, label) {
  try { return JSON.parse(output); } catch { throw new Error(`${label} returned malformed JSON`); }
}

function rows(output) {
  return output.split('\n').filter(Boolean).map((line) => line.split('\t'));
}

function composeResourceNames(config, kind) {
  const entries = config?.[kind];
  if (entries === undefined) return new Set();
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error(`Compose config ${kind} are malformed`);
  return new Set(Object.entries(entries).map(([key, value]) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Compose config ${kind}.${key} is malformed`);
    return value.name ?? key;
  }));
}

function relevantContainer(row, config, projectName) {
  const [id, name, composeProject] = row;
  if (composeProject === projectName) return { id, name };
  const services = config?.services ?? {};
  for (const [serviceName, service] of Object.entries(services)) {
    if (service?.container_name === name) return { id, name };
    const escapedProject = projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedService = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^${escapedProject}[-_]${escapedService}[-_][1-9][0-9]*$`).test(name)) return { id, name };
  }
  return null;
}

function inspectOne(kind, locator) {
  const commandKind = kind === 'container' ? 'container' : kind;
  const parsed = parseJson(docker([commandKind, 'inspect', locator]), `${kind} inspect`);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== 'object') {
    throw new Error(`${kind} inspect returned an unexpected record count`);
  }
  const labels = kind === 'container' ? parsed[0].Config?.Labels : parsed[0].Labels;
  return labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : {};
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

/**
 * Refuse a first manifest when exact resources already exist without the full,
 * matching ownership tuple. This function is deliberately inspection-only.
 */
export function assertFirstManifestDockerResources({ definition, composeArgs, deploymentId, ownerId, projectLabel }) {
  const args = ['compose', ...composeArgs, 'config', '--format', 'json'];
  const config = parseJson(docker(args), 'Docker Compose config');
  const volumeNames = composeResourceNames(config, 'volumes');
  const networkNames = composeResourceNames(config, 'networks');
  const allVolumes = rows(docker(['volume', 'ls', '--format', '{{.Name}}\t{{.Label "com.docker.compose.project"}}']));
  const allNetworks = rows(docker(['network', 'ls', '--format', '{{.ID}}\t{{.Name}}\t{{.Label "com.docker.compose.project"}}']));
  const allContainers = rows(docker(['container', 'ls', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Label "com.docker.compose.project"}}']));
  const findings = [];
  const base = {
    'io.sanctuary.project': projectLabel,
    'io.sanctuary.deployment-id': deploymentId,
    'io.sanctuary.owner-id': ownerId,
  };

  for (const [name, composeProject] of allVolumes.sort((left, right) => left[0].localeCompare(right[0]))) {
    if (!volumeNames.has(name) && composeProject !== definition.composeProjectName) continue;
    findings.push(...labelProblems('volume', name, inspectOne('volume', name), {
      ...base, 'io.sanctuary.resource-class': 'compose_volume', 'io.sanctuary.cleanup-policy': 'preserve_ambiguous',
    }));
  }
  for (const [id, name, composeProject] of allNetworks.sort((left, right) => left[1].localeCompare(right[1]))) {
    if (!networkNames.has(name) && composeProject !== definition.composeProjectName) continue;
    findings.push(...labelProblems('network', name, inspectOne('network', id), {
      ...base, 'io.sanctuary.resource-class': 'compose_network', 'io.sanctuary.cleanup-policy': 'exact_delete',
    }));
  }
  for (const row of allContainers) {
    const resource = relevantContainer(row, config, definition.composeProjectName);
    if (!resource) continue;
    findings.push(...labelProblems('container', resource.name, inspectOne('container', resource.id), {
      ...base, 'io.sanctuary.resource-class': 'compose_container', 'io.sanctuary.cleanup-policy': 'exact_delete',
    }));
  }

  if (findings.length > 0) {
    throw new Error(`first deployment manifest refused existing legacy Docker resources:\n- ${findings.join('\n- ')}\nNo resources were relabeled, recreated, or adopted.`);
  }
  return { inspected: true };
}
