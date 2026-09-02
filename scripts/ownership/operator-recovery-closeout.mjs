import { canonicalSha256 } from './canonical-json.mjs';
import { publicKeyFingerprint } from './crypto.mjs';
import { runCleanupCommand } from './cleanup-command.mjs';
import { resolveDockerDaemonContext } from './cleanup-execution-context.mjs';
import { dockerImmutableIdentity } from './docker-observation.mjs';
import {
  signOperatorRecoveryArtifact, verifyOperatorRecoveryArtifact,
} from './operator-recovery-evidence.mjs';
import { incidentTarget, validateOperatorRecoveryIncident } from './operator-recovery-incident.mjs';
import { validateProviderCorrelationEvidence } from './operator-recovery-correlation.mjs';
import {
  buildOperatorRecoveryCloseout, validateOperatorRecoveryApproval,
  validateOperatorRecoveryCloseout, validateOperatorRecoveryExecutionReceipt,
  validateOperatorRecoveryScope,
} from './operator-recovery-schema.mjs';

const DIGEST = /^[a-f0-9]{64}$/;
const CLASSES = new Set(['compose_container', 'compose_network', 'compose_volume']);
const DOCKER_NOUNS = Object.freeze({
  compose_container: 'container', compose_network: 'network', compose_volume: 'volume',
});

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error(`${label} fields are invalid`);
  }
  return value;
}

function validateSentinelResource(value, exclusions) {
  exact(value, [
    'resourceClass', 'project', 'locator', 'immutableIdentity', 'observationDigest',
  ], 'exclusion sentinel resource');
  if (!CLASSES.has(value.resourceClass) || !exclusions.includes(value.project)
      || typeof value.locator !== 'string' || value.locator.length === 0
      || !DIGEST.test(value.immutableIdentity ?? '') || !DIGEST.test(value.observationDigest ?? '')) {
    throw new Error('exclusion sentinel resource is invalid');
  }
}

function sentinelCore(value) {
  return {
    daemonContextFingerprint: value.daemonContextFingerprint,
    exclusionProjects: value.exclusionProjects,
    resources: value.resources,
  };
}

function validateOutOfScopeObservation(value, incident) {
  exact(value, ['images', 'buildkit'], 'out-of-scope observation');
  exact(value.images, incident.targets.map((entry) => entry.project), 'out-of-scope image observation');
  for (const entries of [...Object.values(value.images), value.buildkit]) {
    if (!Array.isArray(entries) || entries.length > 512
        || entries.some((entry) => typeof entry !== 'string' || entry.length === 0 || entry.length > 4096)) {
      throw new Error('out-of-scope observation entries are invalid');
    }
  }
}

function validateIncidentObservationIdentity(value, incident) {
  if (value.schemaVersion !== '1.0.0'
      || value.artifactType !== 'operator_recovery_incident_observation'
      || value.incidentId !== incident.incidentId
      || !Number.isFinite(new Date(value.observedAt).getTime())
      || !DIGEST.test(value.daemonContextFingerprint ?? '')
      || !DIGEST.test(value.outOfScopeObservationDigest ?? '')
      || JSON.stringify(value.exclusionProjects) !== JSON.stringify(incident.exclusionProjects)
      || !Array.isArray(value.resources)) {
    throw new Error('operator recovery incident observation is invalid');
  }
}

function validateIncidentObservationResources(value, incident) {
  value.resources.forEach((entry) => validateSentinelResource(entry, incident.exclusionProjects));
  const order = value.resources.map((entry) => `${entry.project}:${entry.resourceClass}:${entry.locator}`);
  if (new Set(order).size !== order.length
      || order.some((entry, index) => index > 0 && order[index - 1].localeCompare(entry) >= 0)) {
    throw new Error('exclusion sentinel resources must be unique and sorted');
  }
  for (const project of incident.exclusionProjects) {
    for (const resourceClass of CLASSES) {
      const count = value.resources.filter((entry) => (
        entry.project === project && entry.resourceClass === resourceClass
      )).length;
      if (count !== incident.exclusionExpectedCounts[project][resourceClass]) {
        throw new Error('exclusion sentinel resource counts do not match the checked incident');
      }
    }
  }
  if (value.sentinelCoreDigest !== canonicalSha256(sentinelCore(value))) {
    throw new Error('exclusion sentinel core digest mismatch');
  }
}

export function validateOperatorRecoveryIncidentObservation(value, { incident } = {}) {
  exact(value, [
    'schemaVersion', 'artifactType', 'incidentId', 'observedAt',
    'daemonContextFingerprint', 'exclusionProjects', 'resources',
    'sentinelCoreDigest', 'outOfScopeObservation', 'outOfScopeObservationDigest',
  ], 'operator recovery incident observation');
  validateOperatorRecoveryIncident(incident);
  validateIncidentObservationIdentity(value, incident);
  validateIncidentObservationResources(value, incident);
  validateOutOfScopeObservation(value.outOfScopeObservation, incident);
  if (value.outOfScopeObservationDigest !== canonicalSha256(value.outOfScopeObservation)) {
    throw new Error('out-of-scope observation digest mismatch');
  }
  return value;
}

export function buildOperatorRecoveryIncidentObservation({ incident, observedAt,
  daemonContextFingerprint, resources, outOfScopeObservation } = {}) {
  const base = {
    schemaVersion: '1.0.0', artifactType: 'operator_recovery_incident_observation',
    incidentId: incident?.incidentId, observedAt, daemonContextFingerprint,
    exclusionProjects: incident?.exclusionProjects,
    resources: [...(resources ?? [])].sort((left, right) => (
      `${left.project}:${left.resourceClass}:${left.locator}`
        .localeCompare(`${right.project}:${right.resourceClass}:${right.locator}`)
    )),
    outOfScopeObservation,
    outOfScopeObservationDigest: canonicalSha256(outOfScopeObservation),
  };
  return validateOperatorRecoveryIncidentObservation({
    ...base, sentinelCoreDigest: canonicalSha256(sentinelCore(base)),
  }, { incident });
}

function outputLines(output) {
  const values = output.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
  if (values.length > 512) throw new Error('operator recovery sentinel observation is oversized');
  return [...new Set(values)].sort();
}

function recordLabels(resourceClass, record) {
  const labels = resourceClass === 'compose_container' ? record.Config?.Labels : record.Labels;
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) {
    throw new Error('operator recovery sentinel inspect lacks labels');
  }
  return labels;
}

function inspectRecord(run, globalArgs, resourceClass, locator) {
  const output = run('docker', [...globalArgs, DOCKER_NOUNS[resourceClass], 'inspect', locator], {
    operation: `operator recovery sentinel ${resourceClass} inspect`,
  });
  let value;
  try { value = JSON.parse(output); } catch { throw new Error('operator recovery sentinel inspect is malformed'); }
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== 'object') {
    throw new Error('operator recovery sentinel inspect record count is invalid');
  }
  return value[0];
}

function boundedIdentities(values, label) {
  const identities = [...new Set(values)].sort();
  if (identities.length > 512 || identities.some((value) => (
    typeof value !== 'string' || !/^[a-f0-9]{12,64}$/.test(value)
  ))) throw new Error(`operator recovery sentinel ${label} identities are invalid`);
  return identities;
}

function sentinelRuntime(resourceClass, record, locator, run, globalArgs) {
  if (resourceClass === 'compose_container') {
    if (typeof record.State?.Running !== 'boolean'
        || typeof record.State?.Status !== 'string' || record.State.Status.length > 64) {
      throw new Error('operator recovery container sentinel runtime is malformed');
    }
    return { running: record.State.Running, status: record.State.Status };
  }
  if (resourceClass === 'compose_network') {
    if (!record.Containers || typeof record.Containers !== 'object'
        || Array.isArray(record.Containers)) {
      throw new Error('operator recovery network sentinel runtime is malformed');
    }
    return { attachmentIdentities: boundedIdentities(
      Object.keys(record.Containers), 'network attachment',
    ) };
  }
  const attached = run('docker', [
    ...globalArgs, 'container', 'ls', '--all', '--no-trunc',
    '--filter', `volume=${locator}`, '--format', '{{.ID}}',
  ], { operation: 'operator recovery volume sentinel attachment list' });
  return { attachmentIdentities: boundedIdentities(outputLines(attached), 'volume attachment') };
}

function observeSentinelResources(incident, run, globalArgs) {
  const resources = [];
  for (const project of incident.exclusionProjects) {
    for (const resourceClass of CLASSES) {
      const noun = DOCKER_NOUNS[resourceClass];
      const list = run('docker', [
        ...globalArgs, noun, 'ls', ...(resourceClass === 'compose_container' ? ['--all'] : []),
        ...(['compose_container', 'compose_network'].includes(resourceClass) ? ['--no-trunc'] : []),
        '--filter', `label=com.docker.compose.project=${project}`,
        '--format', resourceClass === 'compose_volume' ? '{{.Name}}' : '{{.ID}}',
      ], { operation: `operator recovery sentinel ${resourceClass} list` });
      for (const locator of outputLines(list)) {
        const record = inspectRecord(run, globalArgs, resourceClass, locator);
        const labels = recordLabels(resourceClass, record);
        if (labels['com.docker.compose.project'] !== project) {
          throw new Error('operator recovery sentinel escaped its exact Compose project');
        }
        const immutableIdentity = dockerImmutableIdentity(resourceClass, record);
        const runtime = sentinelRuntime(resourceClass, record, locator, run, globalArgs);
        resources.push({
          resourceClass, project, locator, immutableIdentity,
          observationDigest: canonicalSha256({ immutableIdentity, labels, runtime }),
        });
      }
    }
  }
  for (const project of incident.exclusionProjects) {
    for (const resourceClass of CLASSES) {
      const count = resources.filter((entry) => (
        entry.project === project && entry.resourceClass === resourceClass
      )).length;
      if (count !== incident.exclusionExpectedCounts[project][resourceClass]) {
        throw new Error(`operator recovery exclusion count mismatch: ${project} ${resourceClass}`);
      }
    }
  }
  return resources;
}

function observeOutOfScope(incident, run, globalArgs) {
  const images = {};
  for (const target of incident.targets) {
    const output = run('docker', [
      ...globalArgs, 'image', 'ls', '--all', '--no-trunc',
      '--filter', `label=io.sanctuary.build-id=${target.sourceExecutionId}`, '--format', '{{.ID}}',
    ], { operation: 'operator recovery retained image observation' });
    images[target.project] = outputLines(output);
  }
  const buildkit = outputLines(run('docker', [
    ...globalArgs, 'buildx', 'ls', '--format', '{{json .}}',
  ], { operation: 'operator recovery retained BuildKit observation' }));
  return { images, buildkit };
}

/** Observe the two explicit neighbor projects and report, but never target, images/BuildKit. */
export function observeOperatorRecoveryIncident({
  incident, now = () => new Date(),
  runCommand = (engine, args, options) => runCleanupCommand(engine, args, options),
  resolveDaemonAuthority = (options) => resolveDockerDaemonContext(options),
} = {}) {
  validateOperatorRecoveryIncident(incident);
  const daemon = resolveDaemonAuthority({ engine: 'docker', runCommand });
  const resources = observeSentinelResources(incident, runCommand, daemon.engineGlobalArgs);
  const outOfScopeObservation = observeOutOfScope(incident, runCommand, daemon.engineGlobalArgs);
  return buildOperatorRecoveryIncidentObservation({
    incident, observedAt: now().toISOString(), daemonContextFingerprint: daemon.fingerprint,
    resources, outOfScopeObservation,
  });
}

export function verifyOperatorRecoveryExecutionPair({
  pair, incident, trust, authorizationPublicKey, evidencePublicKey,
}) {
  exact(pair, [
    'scopeEnvelope', 'approvalEnvelope', 'receiptEnvelope', 'freshCorrelationEnvelope',
  ], 'closeout pair');
  const authorization = {
    publicKey: authorizationPublicKey, acceptedFingerprints: trust.authorizationFingerprints,
  };
  const evidence = {
    publicKey: evidencePublicKey, acceptedFingerprints: trust.evidenceFingerprints,
  };
  const scope = verifyOperatorRecoveryArtifact(pair.scopeEnvelope, {
    ...authorization, validate: (value) => validateOperatorRecoveryScope(value, { trust }),
  });
  const approval = verifyOperatorRecoveryArtifact(pair.approvalEnvelope, {
    ...authorization, validate: (value) => validateOperatorRecoveryApproval(value, { scope, trust }),
  });
  const receipt = verifyOperatorRecoveryArtifact(pair.receiptEnvelope, {
    ...evidence,
    validate: (value) => validateOperatorRecoveryExecutionReceipt(value, { scope, approval, trust }),
  });
  const freshCorrelation = verifyOperatorRecoveryArtifact(pair.freshCorrelationEnvelope, {
    ...authorization, validate: validateProviderCorrelationEvidence,
  });
  if (pair.freshCorrelationEnvelope.artifactDigest
      !== receipt.revalidatedProviderCorrelationEvidenceDigest
      || freshCorrelation.queryResultCoreDigest !== receipt.queryResultCoreDigest) {
    throw new Error('closeout provider revalidation evidence does not bind the receipt');
  }
  const approved = incidentTarget(incident, {
    target: { project: scope.project, deploymentId: scope.deploymentId, ownerId: scope.ownerId },
    expectedCounts: Object.fromEntries([...CLASSES].map((resourceClass) => [
      resourceClass, scope.resources.filter((entry) => entry.resourceClass === resourceClass).length,
    ])),
    sourceCommit: scope.resources[0]?.ownership.createdByCommit,
    sourceExecutionId: scope.resources[0]?.ownership.creationRunId,
  });
  if (scope.resources.some((entry) => entry.ownership.createdByCommit !== approved.sourceCommit
      || entry.ownership.creationRunId !== approved.sourceExecutionId)) {
    throw new Error('closeout scope resources do not bind one approved source');
  }
  return { scope, receipt };
}

/** Verify every signed incident artifact by role, then sign the exact successful closeout. */
export function buildVerifiedOperatorRecoveryCloseout({
  incident, trust, authorizationPublicKey, evidenceKeys, pairs,
  beforeObservationEnvelope, afterObservationEnvelope, finalizedAt,
} = {}) {
  validateOperatorRecoveryIncident(incident);
  const evidenceVerifier = {
    publicKey: evidenceKeys.publicKey, acceptedFingerprints: trust.evidenceFingerprints,
  };
  const before = verifyOperatorRecoveryArtifact(beforeObservationEnvelope, {
    ...evidenceVerifier,
    validate: (value) => validateOperatorRecoveryIncidentObservation(value, { incident }),
  });
  const after = verifyOperatorRecoveryArtifact(afterObservationEnvelope, {
    ...evidenceVerifier,
    validate: (value) => validateOperatorRecoveryIncidentObservation(value, { incident }),
  });
  if (before.sentinelCoreDigest !== after.sentinelCoreDigest) {
    throw new Error('operator recovery exclusion sentinels changed');
  }
  if (before.outOfScopeObservationDigest !== after.outOfScopeObservationDigest) {
    throw new Error('operator recovery retained image or BuildKit observation changed');
  }
  const verified = (pairs ?? []).map((pair) => verifyOperatorRecoveryExecutionPair({
    pair, incident, trust, authorizationPublicKey, evidencePublicKey: evidenceKeys.publicKey,
  }));
  const expectedProjects = incident.targets.map((entry) => entry.project).sort();
  if (JSON.stringify(verified.map((entry) => entry.scope.project).sort())
      !== JSON.stringify(expectedProjects)) {
    throw new Error('operator recovery closeout does not contain the exact four incident targets');
  }
  const closeout = buildOperatorRecoveryCloseout({
    trust, incidentId: incident.incidentId, trustDigest: canonicalSha256(trust),
    finalizedAt, pairs: verified,
    exclusionSentinelBeforeDigest: before.sentinelCoreDigest,
    exclusionSentinelAfterDigest: after.sentinelCoreDigest,
    outOfScopeObservationDigest: after.outOfScopeObservationDigest,
    signerKeyId: publicKeyFingerprint(evidenceKeys.publicKey),
  });
  return signOperatorRecoveryArtifact(closeout, {
    privateKey: evidenceKeys.privateKey, publicKey: evidenceKeys.publicKey,
    expectedFingerprint: publicKeyFingerprint(evidenceKeys.publicKey),
    validate: (value) => validateOperatorRecoveryCloseout(value, { trust }),
  });
}

/** Verify that a persisted closeout is exactly reproducible from its signed inputs. */
export function verifyPersistedOperatorRecoveryCloseout({ closeoutEnvelope, ...inputs } = {}) {
  const actual = verifyOperatorRecoveryArtifact(closeoutEnvelope, {
    publicKey: inputs.evidenceKeys?.publicKey,
    acceptedFingerprints: inputs.trust?.evidenceFingerprints,
    validate: (value) => validateOperatorRecoveryCloseout(value, { trust: inputs.trust }),
  });
  if (actual.incidentId !== inputs.incident?.incidentId) {
    throw new Error('persisted operator recovery closeout incident changed');
  }
  const rebuilt = buildVerifiedOperatorRecoveryCloseout({
    ...inputs, finalizedAt: actual.finalizedAt,
  });
  if (rebuilt.artifactDigest !== closeoutEnvelope.artifactDigest) {
    throw new Error('persisted operator recovery closeout does not match its signed inputs');
  }
  return actual;
}
