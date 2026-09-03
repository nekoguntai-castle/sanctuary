import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { publicKeyFingerprint } from '../../scripts/ownership/crypto.mjs';
import { observeForgejoProviderCorrelation } from '../../scripts/ownership/operator-recovery-correlation.mjs';
import {
  executePreparedOperatorRecovery, operatorRecoverySurvivorProjection,
  prepareOperatorRecoverySession,
} from '../../scripts/ownership/operator-recovery-coordinator.mjs';
import {
  buildOperatorRecoveryObservation, buildOperatorRecoverySurvivorObservation,
} from '../../scripts/ownership/operator-recovery-observer.mjs';
import { buildHostRecoveryTrust } from '../../scripts/ownership/operator-recovery-schema.mjs';

const target = {
  project: 'ci-1-fresh-install', deploymentId: 'ci-1-deploy', ownerId: 'ci-1-owner',
};
const commit = 'a'.repeat(40);
const networkId = 'b'.repeat(64);
const daemonFingerprint = 'd'.repeat(64);

function keys() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...pair, fingerprint: publicKeyFingerprint(pair.publicKey) };
}

function correlationOptions(now) {
  return {
    providerInstance: 'https://forgejo.example.invalid', repository: 'owner/repo',
    queries: [{ commit, workflowId: 'install-test.yml', jobName: 'Fresh Install E2E Test' }],
    fetchRunsPage: async () => ({ items: [], nextCursor: null, complete: true }),
    fetchRunDetail: async () => { throw new Error('unexpected detail'); },
    fetchJobsPage: async () => { throw new Error('unexpected jobs'); },
    taskSnapshot: [], now,
  };
}

function rawNetwork(identity = networkId) {
  return {
    resourceClass: 'compose_network', locator: identity, immutableIdentity: identity,
    labels: {
      'io.sanctuary.project': target.project,
      'io.sanctuary.deployment-id': target.deploymentId,
      'io.sanctuary.owner-id': target.ownerId,
      'io.sanctuary.resource-class': 'compose_network',
      'io.sanctuary.lifecycle': 'obsolete',
      'io.sanctuary.cleanup-policy': 'exact_delete',
      'io.sanctuary.created-at': '2026-09-02T00:00:00.000Z',
      'io.sanctuary.created-by-release': 'unreleased',
      'io.sanctuary.created-by-commit': commit,
      'io.sanctuary.creation-run-id': 'local-source-1',
    },
    ownershipState: 'owned', classifications: ['owned'],
    runtime: { endpointCount: 0, dependencyIdentities: [] },
  };
}

function rawContainer(running) {
  const value = rawNetwork(networkId);
  return {
    ...value, resourceClass: 'compose_container',
    labels: { ...value.labels, 'io.sanctuary.resource-class': 'compose_container' },
    classifications: running ? ['owned', 'running'] : ['owned'],
    runtime: { running, dependencyIdentities: [] },
  };
}

function rawVolume(name, identity) {
  const value = rawNetwork(networkId);
  return {
    ...value, resourceClass: 'compose_volume', locator: name, immutableIdentity: identity,
    labels: { ...value.labels, 'io.sanctuary.resource-class': 'compose_volume' },
    classifications: ['owned'],
    runtime: { attachmentCount: 0, dependencyIdentities: [] },
  };
}

test('preparation starts correlation freshness and approval TTL after slow observation', async () => {
  const authorizationKeys = keys();
  const evidenceKeys = keys();
  const trust = buildHostRecoveryTrust({
    trustId: 'host-recovery', validFrom: '2026-09-02T09:00:00.000Z',
    validUntil: '2026-09-03T09:00:00.000Z',
    authorizationFingerprints: [authorizationKeys.fingerprint],
    evidenceFingerprints: [evidenceKeys.fingerprint],
  });
  let clock = new Date('2026-09-02T10:00:00.000Z');
  let correlationObservedAt;
  let correlationObservations = 0;
  let preparing = true;
  let present = true;
  const observe = async (options) => {
    if (preparing) clock = new Date('2026-09-02T10:02:00.000Z');
    return {
      complete: true, engine: 'docker', selectors: options.selectors,
      daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
      resources: present ? [rawNetwork()] : [], ambiguities: [],
    };
  };
  const prepared = await prepareOperatorRecoverySession({
    trust, target, expectedCounts: { compose_container: 0, compose_network: 1, compose_volume: 0 },
    policyDigest: canonicalSha256({ contract: 'operator-recovery-v1' }),
    sourceCommit: commit, sourceExecutionId: 'local-source-1',
    observeCorrelation: async () => {
      correlationObservations += 1;
      correlationObservedAt = clock.toISOString();
      return observeForgejoProviderCorrelation(correlationOptions(() => clock));
    },
    authorizationKeys, evidenceKeys,
    observe,
    now: () => clock,
  });

  assert.equal(correlationObservedAt, '2026-09-02T10:02:00.000Z');
  assert.equal(correlationObservations, 1);
  assert.equal(prepared.correlationEnvelope.artifact.observedAt, correlationObservedAt);
  assert.equal(prepared.approvalEnvelope.artifact.issuedAt, correlationObservedAt);
  preparing = false;
  clock = new Date('2026-09-02T10:02:01.000Z');
  const executed = await executePreparedOperatorRecovery({
    prepared, trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock), observe,
    runtimeDirectory: mkdtempSync(path.join(tmpdir(), 'operator-recovery-freshness-')),
    now: () => clock,
    resolveDaemonAuthority: () => ({
      fingerprint: daemonFingerprint, engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
    }),
    supervisor: async () => { present = false; return { outcome: 'success' }; },
  });
  assert.equal(executed.receipt.state, 'cleaned');
});

test('journal projection preserves and validates a container stopped before its remove action', async () => {
  const initial = await buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 1, compose_network: 0, compose_volume: 0 },
    observe: async () => ({
      complete: true, daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: [], resources: [rawContainer(true)], ambiguities: [],
    }),
  });
  const actions = [
    { sequence: 1, action: 'stop', resourceClass: 'compose_container', immutableIdentity: networkId },
    { sequence: 2, action: 'remove', resourceClass: 'compose_container', immutableIdentity: networkId },
  ];
  const journal = { records: [{ checkpoint: { checkpointType: 'result', payload: {
    actionSequence: 1, resourceClass: 'compose_container', immutableIdentity: networkId,
    result: 'cleaned', failureClass: 'none', reconciliationState: 'satisfied',
  } } }] };
  const projection = operatorRecoverySurvivorProjection(journal, initial.resources, actions);
  assert.equal(projection.allowedResources.length, 1);
  assert.deepEqual(projection.stoppedResourceKeys, [`compose_container:${networkId}`]);
  await assert.doesNotReject(buildOperatorRecoverySurvivorObservation({
    target, ...projection,
    observe: async () => ({
      complete: true, daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: [], resources: [rawContainer(false)], ambiguities: [],
    }),
  }));
  await assert.rejects(buildOperatorRecoverySurvivorObservation({
    target, ...projection,
    observe: async () => ({
      complete: true, daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: [], resources: [rawContainer(true)], ambiguities: [],
    }),
  }), /not stopped/);

  const absentJournal = { records: [{ checkpoint: { checkpointType: 'result', payload: {
    actionSequence: 1, resourceClass: 'compose_container', immutableIdentity: networkId,
    result: 'absent', failureClass: 'none', reconciliationState: 'absent',
  } } }] };
  const absentProjection = operatorRecoverySurvivorProjection(
    absentJournal, initial.resources, actions,
  );
  assert.equal(absentProjection.allowedResources.length, 0);
  assert.deepEqual(absentProjection.stoppedResourceKeys, []);
  await assert.doesNotReject(buildOperatorRecoverySurvivorObservation({
    target, ...absentProjection,
    observe: async () => ({
      complete: true, daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: [], resources: [], ambiguities: [],
    }),
  }));
});

test('journal projection permits only removal-implied dependency shrinkage', async () => {
  const network = {
    ...rawNetwork(), runtime: { endpointCount: 1, dependencyIdentities: [networkId] },
  };
  const initial = await buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 1, compose_network: 1, compose_volume: 0 },
    observe: async () => ({
      complete: true, daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: [], resources: [rawContainer(false), network], ambiguities: [],
    }),
  });
  const actions = [{
    sequence: 1, action: 'remove', resourceClass: 'compose_container',
    immutableIdentity: networkId,
  }];
  const resultJournal = { records: [{ checkpoint: { checkpointType: 'result', payload: {
    actionSequence: 1, resourceClass: 'compose_container', immutableIdentity: networkId,
    result: 'cleaned', failureClass: 'none', reconciliationState: 'absent',
  } } }] };
  const projection = operatorRecoverySurvivorProjection(resultJournal, initial.resources, actions);
  const survivingNetwork = { ...network, runtime: { endpointCount: 0, dependencyIdentities: [] } };
  await assert.doesNotReject(buildOperatorRecoverySurvivorObservation({
    target, ...projection,
    observe: async () => ({
      complete: true, daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: [], resources: [survivingNetwork], ambiguities: [],
    }),
  }));

  const intentJournal = { records: [{
    digest: 'f'.repeat(64), checkpoint: { checkpointType: 'intent', payload: {
      actionSequence: 1, action: 'remove', resourceClass: 'compose_container',
      immutableIdentity: networkId,
    } },
  }] };
  const openProjection = operatorRecoverySurvivorProjection(intentJournal, initial.resources, actions);
  await assert.doesNotReject(buildOperatorRecoverySurvivorObservation({
    target, ...openProjection,
    observe: async () => ({
      complete: true, daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: [], resources: [survivingNetwork], ambiguities: [],
    }),
  }));
  await assert.rejects(buildOperatorRecoverySurvivorObservation({
    target, ...projection,
    observe: async () => ({
      complete: true, daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: [], resources: [{
        ...survivingNetwork, runtime: { endpointCount: 1, dependencyIdentities: ['c'.repeat(64)] },
      }], ambiguities: [],
    }),
  }), /foreign container|drift/);
});

test('coordinator prepares without mutation, revalidates under locks, then removes only the exact ID', async () => {
  const authorizationKeys = keys();
  const evidenceKeys = keys();
  const trust = buildHostRecoveryTrust({
    trustId: 'host-recovery', validFrom: '2026-09-02T09:00:00.000Z',
    validUntil: '2026-09-03T09:00:00.000Z',
    authorizationFingerprints: [authorizationKeys.fingerprint],
    evidenceFingerprints: [evidenceKeys.fingerprint],
  });
  let clock = new Date('2026-09-02T10:00:00.000Z');
  const originalCorrelation = await observeForgejoProviderCorrelation(correlationOptions(() => clock));
  let present = true;
  const observe = async (options) => ({
    complete: true, engine: 'docker', selectors: options.selectors,
    daemonContextFingerprint: daemonFingerprint,
    engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
    resources: present ? [rawNetwork()] : [], ambiguities: [],
  });
  const prepared = await prepareOperatorRecoverySession({
    trust, target, expectedCounts: { compose_container: 0, compose_network: 1, compose_volume: 0 },
    policyDigest: canonicalSha256({ contract: 'operator-recovery-v1' }),
    sourceCommit: commit, sourceExecutionId: 'local-source-1',
    correlationEvidence: originalCorrelation, authorizationKeys, evidenceKeys,
    observe, now: () => clock,
  });
  assert.equal(present, true);
  clock = new Date('2026-09-02T10:00:01.000Z');
  let supervisorCalls = 0;
  await assert.rejects(executePreparedOperatorRecovery({
    prepared, trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock),
    observe: async (options) => ({
      complete: true, engine: 'docker', selectors: options.selectors,
      daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
      resources: [rawNetwork(), rawNetwork('c'.repeat(64))], ambiguities: [],
    }),
    runtimeDirectory: mkdtempSync(path.join(tmpdir(), 'operator-recovery-drift-')),
    now: () => clock,
    resolveDaemonAuthority: () => ({
      fingerprint: daemonFingerprint, engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
    }),
    supervisor: async () => { supervisorCalls += 1; return { outcome: 'success' }; },
  }), /count mismatch|changed after approval/);
  assert.equal(supervisorCalls, 0);

  const replacement = await prepareOperatorRecoverySession({
    trust, target, expectedCounts: { compose_container: 0, compose_network: 1, compose_volume: 0 },
    policyDigest: canonicalSha256({ contract: 'operator-recovery-v1' }),
    sourceCommit: commit, sourceExecutionId: 'local-source-1',
    correlationEvidence: originalCorrelation, authorizationKeys, evidenceKeys,
    observe, now: () => new Date('2026-09-02T10:00:00.000Z'),
  });
  await assert.rejects(executePreparedOperatorRecovery({
    prepared: { ...prepared, dryRunEnvelope: replacement.dryRunEnvelope },
    trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock), observe,
    runtimeDirectory: mkdtempSync(path.join(tmpdir(), 'operator-recovery-dry-run-')),
    now: () => clock,
  }), /dry-run does not bind/);

  await assert.rejects(executePreparedOperatorRecovery({
    prepared, trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock), observe,
    runtimeDirectory: mkdtempSync(path.join(tmpdir(), 'operator-recovery-no-journal-')),
    now: () => clock, recover: true,
  }), /journal is missing/);

  const crashRuntime = mkdtempSync(path.join(tmpdir(), 'operator-recovery-terminal-crash-'));
  await assert.rejects(executePreparedOperatorRecovery({
    prepared: replacement, trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock), observe,
    runtimeDirectory: crashRuntime, now: () => clock,
    resolveDaemonAuthority: () => ({
      fingerprint: daemonFingerprint, engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
    }),
    supervisor: async () => { present = false; return { outcome: 'success' }; },
    sessionOptions: {
      afterCheckpoint: async (type) => { if (type === 'terminal') throw new Error('terminal crash'); },
    },
  }), /terminal crash/);
  const terminalRecovered = await executePreparedOperatorRecovery({
    prepared: replacement, trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock), observe,
    runtimeDirectory: crashRuntime, now: () => clock, recover: true,
    resolveDaemonAuthority: () => ({
      fingerprint: daemonFingerprint, engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
    }),
    supervisor: async () => { throw new Error('terminal recovery must not mutate'); },
  });
  assert.equal(terminalRecovered.receipt.state, 'cleaned');

  const partialRuntime = mkdtempSync(path.join(tmpdir(), 'operator-recovery-partial-crash-'));
  let partialResources = [rawNetwork()];
  let crashOnFinal = false;
  const partialObserve = async (options) => {
    if (crashOnFinal && partialResources.length === 0
        && !options.selectors.compose_network?.[0]?.locator) {
      throw new Error('final observation crash');
    }
    return {
      complete: true, engine: 'docker', selectors: options.selectors,
      daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
      resources: partialResources, ambiguities: [],
    };
  };
  await assert.rejects(executePreparedOperatorRecovery({
    prepared: replacement, trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock), observe: partialObserve,
    runtimeDirectory: partialRuntime, now: () => clock,
    resolveDaemonAuthority: () => ({
      fingerprint: daemonFingerprint, engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
    }),
    supervisor: async () => {
      partialResources = []; crashOnFinal = true; return { outcome: 'success' };
    },
  }), /final observation crash/);
  crashOnFinal = false;
  partialResources = [rawNetwork('c'.repeat(64))];
  let recoverySupervisorCalls = 0;
  await assert.rejects(executePreparedOperatorRecovery({
    prepared: replacement, trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock), observe: partialObserve,
    runtimeDirectory: partialRuntime, now: () => clock, recover: true,
    resolveDaemonAuthority: () => ({
      fingerprint: daemonFingerprint, engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
    }),
    supervisor: async () => { recoverySupervisorCalls += 1; return { outcome: 'success' }; },
  }), /survivor projection/);
  assert.equal(recoverySupervisorCalls, 0);
  present = true;
  const runtimeDirectory = mkdtempSync(path.join(tmpdir(), 'operator-recovery-coordinator-'));
  const executed = await executePreparedOperatorRecovery({
    prepared, trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock), observe, runtimeDirectory,
    now: () => clock,
    resolveDaemonAuthority: () => ({
      fingerprint: daemonFingerprint, engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
    }),
    supervisor: async (_engine, args) => {
      assert.deepEqual(args, ['--host', 'unix:///var/run/docker.sock', 'network', 'rm', networkId]);
      present = false;
      return { outcome: 'success' };
    },
  });
  assert.equal(executed.receipt.state, 'cleaned');
  assert.equal(present, false);
  assert.equal(executed.receipt.queryResultCoreDigest, originalCorrelation.queryResultCoreDigest);
});

test('execute accepts compose_volume resources whose name order differs from their identity order', async () => {
  const authorizationKeys = keys();
  const evidenceKeys = keys();
  const trust = buildHostRecoveryTrust({
    trustId: 'host-recovery', validFrom: '2026-09-02T09:00:00.000Z',
    validUntil: '2026-09-03T09:00:00.000Z',
    authorizationFingerprints: [authorizationKeys.fingerprint],
    evidenceFingerprints: [evidenceKeys.fingerprint],
  });
  let clock = new Date('2026-09-02T10:00:00.000Z');
  const originalCorrelation = await observeForgejoProviderCorrelation(correlationOptions(() => clock));
  // Locator (name) order and immutableIdentity (digest) order deliberately disagree:
  // by name, a_vol < b_vol; by digest, b_vol's identity (00...) sorts before a_vol's (ff...).
  const allVolumes = [
    rawVolume('a_vol', 'ff'.repeat(32)),
    rawVolume('b_vol', '00'.repeat(32)),
  ];
  const removed = new Set();
  const observe = async (options) => {
    const present = allVolumes.filter((entry) => !removed.has(entry.locator));
    const volumeLocator = options.selectors?.compose_volume?.[0]?.locator;
    return {
      complete: true, engine: 'docker', selectors: options.selectors,
      daemonContextFingerprint: daemonFingerprint,
      engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
      resources: volumeLocator
        ? present.filter((entry) => entry.locator === volumeLocator) : present,
      ambiguities: [],
    };
  };
  const prepared = await prepareOperatorRecoverySession({
    trust, target, expectedCounts: { compose_container: 0, compose_network: 0, compose_volume: 2 },
    policyDigest: canonicalSha256({ contract: 'operator-recovery-v1' }),
    sourceCommit: commit, sourceExecutionId: 'local-source-1',
    correlationEvidence: originalCorrelation, authorizationKeys, evidenceKeys,
    observe, now: () => clock,
  });
  clock = new Date('2026-09-02T10:00:01.000Z');
  const executed = await executePreparedOperatorRecovery({
    prepared, trust, authorizationKeys, evidenceKeys,
    correlationOptions: correlationOptions(() => clock), observe,
    runtimeDirectory: mkdtempSync(path.join(tmpdir(), 'operator-recovery-volume-order-')),
    now: () => clock,
    resolveDaemonAuthority: () => ({
      fingerprint: daemonFingerprint, engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
    }),
    supervisor: async (engine, args) => {
      removed.add(args[args.length - 1]);
      return { outcome: 'success' };
    },
  });
  assert.equal(executed.receipt.state, 'cleaned');
  assert.equal(removed.size, 2);
});
