import { canonicalSha256 } from './canonical-json.mjs';
import { runCleanupCommand } from './cleanup-command.mjs';
import { resolveDockerDaemonContext } from './cleanup-execution-context.mjs';
import { dockerImmutableIdentity } from './docker-observation.mjs';
import { registerResource } from './registration.mjs';

const KINDS = Object.freeze([
  ['compose_container', 'container', ['container', 'ls', '--all', '--no-trunc'], '{{.ID}}'],
  ['compose_network', 'network', ['network', 'ls', '--no-trunc'], '{{.ID}}'],
  ['compose_volume', 'volume', ['volume', 'ls'], '{{.Name}}'],
]);
const REGISTRATION_DEADLINE_MS = 120_000;

function deadlineRunner(run, deadline) {
  return (engine, args, options = {}) => {
    const remaining = deadline - Date.now();
    if (remaining < 1) throw new Error('legacy fixture retirement deadline expired');
    return run(engine, args, {
      ...options, timeoutMs: Math.min(options.timeoutMs ?? 30_000, remaining),
    });
  };
}

function lines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseInspect(output, label) {
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw new Error(`${label} returned malformed JSON`); }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== 'object') {
    throw new Error(`${label} returned an unexpected record count`);
  }
  return parsed[0];
}

function labelsFor(resourceClass, record) {
  const labels = resourceClass === 'compose_container' ? record.Config?.Labels : record.Labels;
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    throw new Error(`${resourceClass} lacks Compose labels`);
  }
  return labels;
}

function assertComposeLineage(resourceClass, labels, project) {
  const suffix = resourceClass.slice('compose_'.length);
  if (labels['com.docker.compose.project'] !== project
      || typeof labels[`com.docker.compose.${suffix === 'container' ? 'service' : suffix}`] !== 'string'
      || labels[`com.docker.compose.${suffix === 'container' ? 'service' : suffix}`].length === 0) {
    throw new Error(`${resourceClass} does not have exact Compose lineage for ${project}`);
  }
}

function observeProject(project, authority, run = runCleanupCommand) {
  const resources = [];
  for (const [resourceClass, noun, list, format] of KINDS) {
    const listed = lines(run(authority.engine, [
      ...authority.engineGlobalArgs, ...list,
      '--filter', `label=com.docker.compose.project=${project}`, '--format', format,
    ], { operation: `${resourceClass} fixture list` }));
    if (listed.length > 512) throw new Error(`${resourceClass} fixture list exceeds its bound`);
    for (const locator of listed) {
      const record = parseInspect(run(authority.engine, [
        ...authority.engineGlobalArgs, noun, 'inspect', locator,
      ], { operation: `${resourceClass} fixture inspect` }), `${resourceClass} inspect`);
      const labels = labelsFor(resourceClass, record);
      assertComposeLineage(resourceClass, labels, project);
      const immutableIdentity = dockerImmutableIdentity(resourceClass, record);
      if ((resourceClass === 'compose_volume' && record.Name !== locator)
          || (resourceClass !== 'compose_volume' && immutableIdentity !== locator)) {
        throw new Error(`${resourceClass} list and inspect identities disagree`);
      }
      resources.push({ resourceClass, locator: resourceClass === 'compose_volume' ? locator : immutableIdentity,
        immutableIdentity, labels,
        running: resourceClass === 'compose_container' ? record.State?.Running === true : null });
    }
  }
  return resources.sort((left, right) => `${left.resourceClass}:${left.immutableIdentity}`
    .localeCompare(`${right.resourceClass}:${right.immutableIdentity}`));
}

export function createLegacyFixtureWitness({ composeProjectName, run = runCleanupCommand }) {
  const boundedRun = deadlineRunner(run, Date.now() + REGISTRATION_DEADLINE_MS);
  const snapshots = [0, 1].map(() => {
    const authority = resolveDockerDaemonContext({ engine: 'docker', runCommand: boundedRun });
    return {
      daemonContextFingerprint: authority.fingerprint,
      resources: observeProject(composeProjectName, authority, boundedRun),
      engineGlobalArgs: authority.engineGlobalArgs,
    };
  });
  if (snapshots.some((snapshot) => snapshot.resources.length !== 0)) {
    throw new Error('legacy fixture creation witness requires an empty exact Compose project');
  }
  if (canonicalSha256(snapshots[0]) !== canonicalSha256(snapshots[1])) {
    throw new Error('legacy fixture creation witness changed between complete snapshots');
  }
  const authority = snapshots[1];
  return Object.freeze({
    digest: canonicalSha256({
      kind: 'ci_legacy_fixture_absence', composeProjectName,
      daemonContextFingerprint: authority.daemonContextFingerprint, resources: [],
    }),
    daemonContextFingerprint: authority.daemonContextFingerprint,
    engineGlobalArgs: authority.engineGlobalArgs,
  });
}

function registrationInput(resource, state) {
  const authority = state.authority;
  return {
    deploymentId: authority.deploymentId, operationRunId: authority.operationRunId,
    ownerId: authority.ownerId, resourceClass: resource.resourceClass,
    lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: state.resourceCreatedAt, createdByRelease: 'unreleased',
    createdByCommit: authority.checkoutCommit,
    locatorKind: resource.resourceClass === 'compose_volume' ? 'name' : 'engine_id',
    locator: resource.locator, immutableIdentity: resource.immutableIdentity,
    metadataDigest: state.legacyFixtureWitnessDigest,
    referenceIds: [authority.operationRunId],
  };
}

function dependencies(resource, authority, run) {
  if (resource.resourceClass === 'compose_network') {
    return lines(run(authority.engine, [...authority.engineGlobalArgs,
      'container', 'ls', '--all', '--no-trunc', '--filter', `network=${resource.immutableIdentity}`,
      '--format', '{{.ID}}'], { operation: 'legacy fixture network endpoint list' }));
  }
  if (resource.resourceClass === 'compose_volume') {
    return lines(run(authority.engine, [...authority.engineGlobalArgs,
      'container', 'ls', '--all', '--no-trunc', '--filter', `volume=${resource.locator}`,
      '--format', '{{.ID}}'], { operation: 'legacy fixture volume attachment list' }));
  }
  return [];
}

export function registerLegacyFixtureResources({
  state, run = runCleanupCommand, register = registerResource,
}) {
  if (!state.legacyFixtureWitnessDigest) return Object.freeze({ registrations: [] });
  const boundedRun = deadlineRunner(run, Date.now() + REGISTRATION_DEADLINE_MS);
  const resolved = resolveDockerDaemonContext({ engine: 'docker', runCommand: boundedRun });
  const witnessAuthority = {
    engine: 'docker', engineGlobalArgs: resolved.engineGlobalArgs,
  };
  const expectedWitness = canonicalSha256({
    kind: 'ci_legacy_fixture_absence', composeProjectName: state.authority.composeProjectName,
    daemonContextFingerprint: resolved.fingerprint, resources: [],
  });
  if (expectedWitness !== state.legacyFixtureWitnessDigest) {
    throw new Error('legacy fixture Docker authority changed after the creation witness');
  }
  const resources = observeProject(state.authority.composeProjectName, witnessAuthority, boundedRun);
  const candidateContainers = new Set(resources
    .filter((resource) => resource.resourceClass === 'compose_container')
    .map((resource) => resource.immutableIdentity));
  for (const resource of resources) {
    const foreignDependencies = dependencies(resource, witnessAuthority, boundedRun)
      .filter((identity) => !candidateContainers.has(identity));
    if (foreignDependencies.length !== 0) {
      throw new Error(`${resource.resourceClass} has foreign live dependencies before planning`);
    }
  }
  const fresh = observeProject(state.authority.composeProjectName, witnessAuthority, boundedRun);
  if (canonicalSha256(fresh) !== canonicalSha256(resources)) {
    throw new Error('legacy fixture identities changed during registration preflight');
  }
  const root = `${state.authority.runtimeDirectory}/ownership`;
  const registrations = resources.map((resource) => register(
    registrationInput(resource, state), { root, checkoutRoot: state.authority.checkoutRoot },
  ));
  return Object.freeze({ registrations });
}
