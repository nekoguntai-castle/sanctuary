import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { publicKeyFingerprint } from '../../scripts/ownership/crypto.mjs';
import {
  buildOperatorRecoveryIncidentObservation, buildVerifiedOperatorRecoveryCloseout,
  observeOperatorRecoveryIncident, verifyPersistedOperatorRecoveryCloseout,
} from '../../scripts/ownership/operator-recovery-closeout.mjs';
import { prepareOperatorRecoverySession } from '../../scripts/ownership/operator-recovery-coordinator.mjs';
import { observeForgejoProviderCorrelation } from '../../scripts/ownership/operator-recovery-correlation.mjs';
import { signOperatorRecoveryArtifact } from '../../scripts/ownership/operator-recovery-evidence.mjs';
import {
  buildHostRecoveryTrust, buildOperatorRecoveryExecutionReceipt,
  validateOperatorRecoveryExecutionReceipt,
} from '../../scripts/ownership/operator-recovery-schema.mjs';

const incident = JSON.parse(readFileSync('config/operator-recovery-incident.json'));
const now = new Date('2026-09-02T14:00:00.000Z');
const daemon = 'd'.repeat(64);

function keys() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...pair, fingerprint: publicKeyFingerprint(pair.publicKey) };
}

function correlationOptions(commit) {
  return {
    providerInstance: 'https://forgejo.example.invalid', repository: 'owner/repo',
    queries: [{ commit, workflowId: 'install-test.yml', jobName: 'Fresh Install E2E Test' }],
    fetchRunsPage: async () => ({ items: [], nextCursor: null, complete: true }),
    fetchRunDetail: async () => { throw new Error('unexpected detail'); },
    fetchJobsPage: async () => { throw new Error('unexpected jobs'); },
    taskSnapshot: [], now: () => now,
  };
}

function rawResource(target, resourceClass, serial) {
  const id = serial.toString(16).padStart(64, '0');
  return {
    resourceClass,
    locator: resourceClass === 'compose_volume' ? `${target.project}_volume_${serial}` : id,
    immutableIdentity: id,
    labels: {
      'io.sanctuary.project': target.project,
      'io.sanctuary.deployment-id': target.deploymentId,
      'io.sanctuary.owner-id': target.ownerId,
      'io.sanctuary.resource-class': resourceClass,
      'io.sanctuary.lifecycle': 'obsolete', 'io.sanctuary.cleanup-policy': 'exact_delete',
      'io.sanctuary.created-at': '2026-09-02T12:00:00.000Z',
      'io.sanctuary.created-by-release': 'unreleased',
      'io.sanctuary.created-by-commit': target.sourceCommit,
      'io.sanctuary.creation-run-id': target.sourceExecutionId,
    },
    ownershipState: 'owned', classifications: ['owned'],
    runtime: {
      endpointCount: 0, attachmentCount: 0, running: false, dependencyIdentities: [],
    },
  };
}

function rawResources(target, index) {
  const classes = [
    ...Array(9).fill('compose_container'),
    ...Array(2).fill('compose_network'),
    ...Array(4).fill('compose_volume'),
  ];
  return classes.map((resourceClass, offset) => rawResource(target, resourceClass, index * 100 + offset));
}

async function signedPair(target, index, trust, authorizationKeys, evidenceKeys) {
  const correlation = await observeForgejoProviderCorrelation(correlationOptions(target.sourceCommit));
  const raw = rawResources(target, index);
  const prepared = await prepareOperatorRecoverySession({
    trust, authorizationKeys, evidenceKeys,
    target: { project: target.project, deploymentId: target.deploymentId, ownerId: target.ownerId },
    expectedCounts: target.expectedCounts,
    policyDigest: 'c'.repeat(64), sourceCommit: target.sourceCommit,
    sourceExecutionId: target.sourceExecutionId, correlationEvidence: correlation,
    observe: async (options) => ({
      complete: true, selectors: options.selectors, daemonContextFingerprint: daemon,
      engineGlobalArgs: [], resources: raw, ambiguities: [],
    }),
    now: () => now,
  });
  const scope = prepared.scopeEnvelope.artifact;
  const approval = prepared.approvalEnvelope.artifact;
  const freshCorrelationEnvelope = signOperatorRecoveryArtifact({
    ...correlation, observedAt: new Date(now.getTime() + 1_000).toISOString(),
    freshUntil: new Date(now.getTime() + 301_000).toISOString(),
  }, {
    privateKey: authorizationKeys.privateKey, publicKey: authorizationKeys.publicKey,
    expectedFingerprint: authorizationKeys.fingerprint,
    validate: (value) => value,
  });
  const receipt = buildOperatorRecoveryExecutionReceipt({
    scope, approval, trust, scopeDigest: canonicalSha256(scope),
    approvalDigest: canonicalSha256(approval), trustDigest: scope.trustDigest,
    planDigest: approval.planDigest,
    originalProviderCorrelationEvidenceDigest: scope.providerCorrelationEvidenceDigest,
    revalidatedProviderCorrelationEvidenceDigest: freshCorrelationEnvelope.artifactDigest,
    queryResultCoreDigest: scope.queryResultCoreDigest,
    finalObservationDigest: 'e'.repeat(64), journalDigest: 'f'.repeat(64),
    deploymentId: scope.deploymentId, operationRunId: scope.operationRunId,
    project: scope.project, state: 'cleaned',
    operationStartedAt: now.toISOString(), operationEndedAt: now.toISOString(),
    actions: approval.actions, results: approval.actions.map((action) => ({
      sequence: action.sequence, resourceClass: action.resourceClass,
      immutableIdentity: action.immutableIdentity, result: 'cleaned', failureClass: 'none',
      postconditionState: 'satisfied', postconditionDigest: 'a'.repeat(64),
    })), signerKeyId: evidenceKeys.fingerprint,
  });
  const receiptEnvelope = signOperatorRecoveryArtifact(receipt, {
    privateKey: evidenceKeys.privateKey, publicKey: evidenceKeys.publicKey,
    expectedFingerprint: evidenceKeys.fingerprint,
    validate: (value) => validateOperatorRecoveryExecutionReceipt(value, { scope, approval, trust }),
  });
  return {
    scopeEnvelope: prepared.scopeEnvelope,
    approvalEnvelope: prepared.approvalEnvelope,
    receiptEnvelope, freshCorrelationEnvelope,
  };
}

function signedObservation(trust, evidenceKeys, resources) {
  const observation = buildOperatorRecoveryIncidentObservation({
    incident, observedAt: now.toISOString(), daemonContextFingerprint: daemon,
    resources, outOfScopeObservation: {
      images: Object.fromEntries(incident.targets.map((entry) => [entry.project, ['retained']])),
      buildkit: ['retained'],
    },
  });
  return signOperatorRecoveryArtifact(observation, {
    privateKey: evidenceKeys.privateKey, publicKey: evidenceKeys.publicKey,
    expectedFingerprint: evidenceKeys.fingerprint,
    validate: (value) => value,
  });
}

function expectedSentinelResources() {
  let serial = 1;
  return incident.exclusionProjects.flatMap((project) => (
    ['compose_container', 'compose_network', 'compose_volume'].flatMap((resourceClass) => (
      Array.from({ length: incident.exclusionExpectedCounts[project][resourceClass] }, () => {
        const identity = serial.toString(16).padStart(64, '0');
        serial += 1;
        return {
          project, resourceClass,
          locator: resourceClass === 'compose_volume' ? `${project}_volume_${serial}` : identity,
          immutableIdentity: identity, observationDigest: identity,
        };
      })
    ))
  ));
}

test('closeout verifies signed approvals, exact four targets, and unchanged exclusion sentinels', async () => {
  const authorizationKeys = keys();
  const evidenceKeys = keys();
  const trust = buildHostRecoveryTrust({
    trustId: 'host-recovery', validFrom: '2026-09-02T13:00:00.000Z',
    validUntil: '2026-09-03T13:00:00.000Z',
    authorizationFingerprints: [authorizationKeys.fingerprint],
    evidenceFingerprints: [evidenceKeys.fingerprint],
  });
  const pairs = await Promise.all(incident.targets.map((target, index) => (
    signedPair(target, index + 1, trust, authorizationKeys, evidenceKeys)
  )));
  const sentinelResources = expectedSentinelResources();
  const before = signedObservation(trust, evidenceKeys, sentinelResources);
  const after = signedObservation(trust, evidenceKeys, sentinelResources);
  const closeout = buildVerifiedOperatorRecoveryCloseout({
    incident, trust, authorizationPublicKey: authorizationKeys.publicKey, evidenceKeys,
    pairs, beforeObservationEnvelope: before, afterObservationEnvelope: after,
    finalizedAt: now.toISOString(),
  });
  assert.equal(closeout.artifact.pairs.length, 4);
  assert.equal(verifyPersistedOperatorRecoveryCloseout({
    closeoutEnvelope: closeout, incident, trust,
    authorizationPublicKey: authorizationKeys.publicKey, evidenceKeys, pairs,
    beforeObservationEnvelope: before, afterObservationEnvelope: after,
  }).incidentId, incident.incidentId);
  assert.throws(() => buildVerifiedOperatorRecoveryCloseout({
    incident, trust, authorizationPublicKey: authorizationKeys.publicKey, evidenceKeys,
    pairs: pairs.slice(0, 3), beforeObservationEnvelope: before,
    afterObservationEnvelope: after, finalizedAt: now.toISOString(),
  }), /exact four|4-4/);
  const changed = signedObservation(trust, evidenceKeys, [{
    ...sentinelResources[0], observationDigest: '9'.repeat(64),
  }, ...sentinelResources.slice(1)]);
  assert.throws(() => buildVerifiedOperatorRecoveryCloseout({
    incident, trust, authorizationPublicKey: authorizationKeys.publicKey, evidenceKeys,
    pairs, beforeObservationEnvelope: before, afterObservationEnvelope: changed,
    finalizedAt: now.toISOString(),
  }), /sentinels changed/);
  assert.throws(() => buildVerifiedOperatorRecoveryCloseout({
    incident, trust, authorizationPublicKey: authorizationKeys.publicKey, evidenceKeys,
    pairs: [{ ...pairs[0], approvalEnvelope: pairs[1].approvalEnvelope }, ...pairs.slice(1)],
    beforeObservationEnvelope: before, afterObservationEnvelope: after,
    finalizedAt: now.toISOString(),
  }), /scopeDigest|signature|artifact/);
});

test('incident observation uses exact read-only project selectors and reports retained build state', () => {
  const calls = [];
  let containerRunning = true;
  let serial = 1;
  const locators = Object.fromEntries(incident.exclusionProjects.map((project) => [project,
    Object.fromEntries(['compose_container', 'compose_network', 'compose_volume'].map((resourceClass) => {
      const values = Array.from({ length: incident.exclusionExpectedCounts[project][resourceClass] }, () => {
        const value = serial.toString(16).padStart(64, '0');
        serial += 1;
        return resourceClass === 'compose_volume' ? `${project}_volume_${value.slice(-4)}` : value;
      });
      return [resourceClass, values];
    })),
  ]));
  const runCommand = (_engine, args) => {
    calls.push(args);
    const joined = args.join(' ');
    if (joined.includes('image ls')) return `sha256:${'a'.repeat(64)}\n`;
    if (joined.includes('buildx ls')) return '{"Name":"default"}\n';
    if (joined.includes('--filter volume=')) return '';
    for (const project of incident.exclusionProjects) {
      if (joined.includes(`label=com.docker.compose.project=${project}`)) {
        const resourceClass = joined.includes('container ls') ? 'compose_container'
          : joined.includes('network ls') ? 'compose_network' : 'compose_volume';
        return `${locators[project][resourceClass].join('\n')}\n`;
      }
      for (const [resourceClass, values] of Object.entries(locators[project])) {
        const locator = values.find((entry) => joined.endsWith(` inspect ${entry}`));
        if (!locator) continue;
        const labels = { 'com.docker.compose.project': project };
        if (resourceClass === 'compose_container') {
          return JSON.stringify([{
            Id: locator, Config: { Labels: labels },
            State: { Running: containerRunning, Status: containerRunning ? 'running' : 'exited' },
          }]);
        }
        if (resourceClass === 'compose_network') {
          return JSON.stringify([{ Id: locator, Labels: labels, Containers: {} }]);
        }
        return JSON.stringify([{
          Name: locator, Driver: 'local', Scope: 'local',
          Mountpoint: `/var/lib/docker/volumes/${locator}/_data`,
          CreatedAt: '2026-09-02T12:00:00Z', Options: {}, Labels: labels,
        }]);
      }
    }
    throw new Error(`unexpected command ${joined}`);
  };
  const observed = observeOperatorRecoveryIncident({
    incident, runCommand, now: () => now,
    resolveDaemonAuthority: () => ({ fingerprint: daemon, engineGlobalArgs: [] }),
  });
  assert.equal(observed.resources.length, 43);
  assert.match(observed.outOfScopeObservationDigest, /^[a-f0-9]{64}$/);
  assert.equal(calls.some((args) => args.includes('rm') || args.includes('stop')), false);
  assert.ok(incident.exclusionProjects.every((project) => calls.some((args) => (
    args.includes(`label=com.docker.compose.project=${project}`)
  ))));
  containerRunning = false;
  const changed = observeOperatorRecoveryIncident({
    incident, runCommand, now: () => now,
    resolveDaemonAuthority: () => ({ fingerprint: daemon, engineGlobalArgs: [] }),
  });
  assert.notEqual(changed.sentinelCoreDigest, observed.sentinelCoreDigest);
});
