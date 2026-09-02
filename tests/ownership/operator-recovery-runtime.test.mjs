import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import {
  buildOperatorRecoveryActions,
  createOperatorRecoveryRuntime,
} from '../../scripts/ownership/operator-recovery-runtime.mjs';

const container = {
  resourceClass: 'compose_container', locatorKind: 'engine_id',
  locator: 'a'.repeat(64), immutableIdentity: 'a'.repeat(64),
  ownership: { project: 'p', deploymentId: 'd', ownerId: 'o', resourceClass: 'compose_container', lifecycle: 'obsolete', cleanupPolicy: 'exact_delete', createdAt: '2026-09-02T00:00:00.000Z', createdByRelease: 'unreleased', createdByCommit: 'b'.repeat(40), creationRunId: 'r', immutableIdentity: 'a'.repeat(64) },
  ownershipDigest: '1'.repeat(64), observationDigest: '2'.repeat(64), dependencyIdentities: [],
};
const network = {
  ...container, resourceClass: 'compose_network', locator: 'c'.repeat(64),
  immutableIdentity: 'c'.repeat(64), ownershipDigest: '3'.repeat(64),
  observationDigest: '4'.repeat(64), dependencyIdentities: ['a'.repeat(64)],
  ownership: { ...container.ownership, resourceClass: 'compose_network', immutableIdentity: 'c'.repeat(64) },
};
const volume = {
  ...container, resourceClass: 'compose_volume', locatorKind: 'name', locator: 'p_data',
  immutableIdentity: 'd'.repeat(64), ownershipDigest: '5'.repeat(64),
  observationDigest: '6'.repeat(64), dependencyIdentities: ['a'.repeat(64)],
  ownership: { ...container.ownership, resourceClass: 'compose_volume', immutableIdentity: 'd'.repeat(64) },
  attestationNonce: 'recovery-nonce',
};

test('recovery actions preserve container stop/remove then network then volume order', () => {
  const actions = buildOperatorRecoveryActions({ resources: [volume, network, container] });
  assert.deepEqual(actions.map((entry) => `${entry.resourceClass}:${entry.action}`), [
    'compose_container:stop', 'compose_container:remove',
    'compose_network:remove', 'compose_volume:remove',
  ]);
  assert.deepEqual(actions.map((entry) => entry.sequence), [1, 2, 3, 4]);
});

test('runtime binds exact fresh authority and recovery nonce for volume mutation', async () => {
  const actions = buildOperatorRecoveryActions({ resources: [volume] });
  const observed = { ...volume, attachmentCount: 0 };
  const calls = [];
  const runtime = createOperatorRecoveryRuntime({
    scope: { scopeDigest: '7'.repeat(64), daemonContextFingerprint: '8'.repeat(64), resources: [volume] },
    actions,
    observeAction: async () => observed,
    supervisor: async (engine, args) => { calls.push([engine, args]); return { outcome: 'success' }; },
    engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
  });
  const authority = await runtime.reloadAuthority({ action: actions[0], phase: 'fresh_eligibility', predecessorResultDigest: null });
  assert.equal(authority.state, 'eligible');
  const result = await runtime.mutate({ action: actions[0], authorityRowDigest: canonicalSha256(authority.row), predecessorResultDigest: null });
  assert.equal(result.outcome, 'success');
  assert.deepEqual(calls[0], ['docker', ['--host', 'unix:///var/run/docker.sock', 'volume', 'rm', 'p_data']]);
});

test('runtime refuses identity drift before mutation and reconciles exact absence', async () => {
  const actions = buildOperatorRecoveryActions({ resources: [container] });
  let current = { ...container, running: true };
  const runtime = createOperatorRecoveryRuntime({
    scope: { scopeDigest: '7'.repeat(64), daemonContextFingerprint: '8'.repeat(64), resources: [container] },
    actions, observeAction: async () => current,
    supervisor: async () => ({ outcome: 'success' }),
    engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'],
  });
  const first = await runtime.reloadAuthority({ action: actions[0], phase: 'fresh_eligibility', predecessorResultDigest: null });
  current = { ...current, immutableIdentity: 'f'.repeat(64) };
  const drift = await runtime.reloadAuthority({ action: actions[0], phase: 'pre_mutation_reinspection', predecessorResultDigest: null });
  assert.equal(first.state, 'eligible');
  assert.equal(drift.state, 'refused');
  current = null;
  const reconciled = await runtime.reconcile({ action: actions[1], mutationOutcome: 'success' });
  assert.equal(reconciled.state, 'absent');
  assert.equal(reconciled.failureClass, 'none');
});
