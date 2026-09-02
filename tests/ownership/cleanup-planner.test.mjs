import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import {
  buildCleanupApproval, verifyCleanupApproval, verifyReservedCleanupApproval,
} from '../../scripts/ownership/cleanup-approval.mjs';
import { buildCleanupPlan, buildPlanningReceipt } from '../../scripts/ownership/cleanup-planner.mjs';

const HASH = 'a'.repeat(64);
const KEY = 'b'.repeat(64);
const NOW = new Date('2026-08-30T00:00:10.000Z');

function resource(resourceClass, immutableIdentity, overrides = {}) {
  const ownership = {
    project: 'sanctuary-ci-1', deploymentId: 'deploy-1', ownerId: 'owner-1',
    resourceClass, lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: '2026-08-30T00:00:00.000Z', createdByRelease: 'v0.8.69',
    createdByCommit: 'c'.repeat(40), creationRunId: 'creator-1', immutableIdentity,
  };
  return {
    resourceClass, locatorKind: 'engine_id', locator: immutableIdentity, immutableIdentity,
    ownership, ownershipDigest: canonicalSha256(ownership), observationDigest: HASH,
    disposition: 'eligible', failureClasses: [], references: [], contentDigests: [],
    dependencyIdentities: [],
    running: resourceClass === 'compose_container' ? true : null,
    active: false, protected: false, data: false, ...overrides,
  };
}

function inventory(overrides = {}) {
  return {
    schemaVersion: '1.2.0', artifactType: 'inventory', deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1', generation: 2, observedAt: '2026-08-30T00:00:01.000Z',
    complete: true, policyDigest: HASH, deploymentManifestDigest: HASH,
    runManifestDigest: HASH, contextFingerprint: HASH,
    resources: [resource('compose_network', 'network-1'), resource('compose_container', 'container-1')],
    ambiguities: [], ...overrides,
  };
}

const contract = { resourceClasses: [
  { classId: 'compose_container', dependsOn: [], cleanupPolicies: ['exact_delete'] },
  { classId: 'compose_network', dependsOn: ['compose_container'], cleanupPolicies: ['exact_delete'] },
] };

test('planner emits stable dependency and action order with a signed-receipt-ready binding', () => {
  const first = buildCleanupPlan(inventory(), contract, { policyDigest: HASH });
  const second = buildCleanupPlan(inventory(), contract, { policyDigest: HASH });
  assert.deepEqual(first, second);
  assert.deepEqual(first.actions.map((entry) => `${entry.resourceClass}:${entry.action}`), [
    'compose_container:stop', 'compose_container:remove', 'compose_network:remove',
  ]);
  const receipt = buildPlanningReceipt(inventory(), first, { signerKeyId: KEY, now: () => NOW });
  assert.equal(receipt.state, 'dry_run');
  assert.equal(receipt.planDigest, canonicalSha256(first));
  assert.deepEqual(receipt.results.map((entry) => entry.result), ['pending', 'pending', 'pending']);
});

test('planner binds registered host removals to prior collector stop actions', () => {
  const processIdentity = '1'.repeat(64);
  const artifactIdentity = '2'.repeat(64);
  const hostContract = { resourceClasses: [
    { classId: 'collector_process', dependsOn: [], cleanupPolicies: ['exact_delete'] },
    { classId: 'temporary_artifact', dependsOn: ['collector_process'], cleanupPolicies: ['exact_delete'] },
  ] };
  const hostInventory = inventory({ resources: [
    resource('temporary_artifact', artifactIdentity, {
      locatorKind: 'path', dependencyIdentities: [processIdentity],
    }),
    resource('collector_process', processIdentity, { locatorKind: 'authority' }),
  ] });
  const plan = buildCleanupPlan(hostInventory, hostContract, { policyDigest: HASH });
  assert.deepEqual(plan.actions.map(({ resourceClass, action }) => `${resourceClass}:${action}`), [
    'collector_process:stop', 'temporary_artifact:remove',
  ]);
  assert.deepEqual(plan.actions[1].dependencyIdentities, [processIdentity]);
});

test('ambiguity suppresses every action while refusals remain categorical', () => {
  const ambiguousInventory = inventory({
    complete: false,
    resources: [],
    ambiguities: [{ adapter: 'docker', resourceClass: null, failureClass: 'query_failed', scope: 'container-list' }],
  });
  const plan = buildCleanupPlan(ambiguousInventory, contract, { policyDigest: HASH, now: () => NOW });
  const receipt = buildPlanningReceipt(ambiguousInventory, plan, { signerKeyId: KEY, now: () => NOW });
  assert.deepEqual(plan.actions, []);
  assert.equal(receipt.state, 'ambiguous');
  assert.deepEqual(receipt.refusals.map((entry) => entry.failureClass), ['query_failed']);
});

test('approval copies the exact plan and enforces expiry, context, and dry-run scope', () => {
  const plan = buildCleanupPlan(inventory(), contract, { policyDigest: HASH, now: () => NOW });
  const receipt = buildPlanningReceipt(inventory(), plan, { signerKeyId: KEY, now: () => NOW });
  const approval = buildCleanupApproval(plan, receipt, {
    signerKeyId: 'd'.repeat(64), nonce: 'nonce-1',
    expiresAt: '2026-08-30T01:00:10.000Z', now: () => NOW,
  });
  assert.deepEqual(approval.actions, plan.actions);
  assert.deepEqual(approval.permittedClasses, ['compose_container', 'compose_network']);
  assert.doesNotThrow(() => verifyCleanupApproval(approval, plan, receipt, {
    now: new Date('2026-08-30T00:30:00.000Z'), expectedContextFingerprint: HASH,
  }));
  assert.throws(() => verifyCleanupApproval(approval, plan, receipt, {
    now: new Date('2026-08-30T02:00:00.000Z'),
  }), /expired/);
  assert.throws(() => verifyCleanupApproval(approval, plan, receipt, {
    now: new Date('2026-08-30T00:00:09.000Z'),
  }), /not yet valid/);
  assert.doesNotThrow(() => verifyReservedCleanupApproval(approval, plan, receipt, {
    expectedContextFingerprint: HASH,
  }));
});

test('a known policy mismatch produces a signed-receipt-ready refusal instead of ambiguity', () => {
  const refusedResource = resource('compose_container', 'container-1', {
    disposition: 'refused', failureClasses: ['policy_mismatch'],
  });
  const refusedInventory = inventory({ resources: [refusedResource] });
  const plan = buildCleanupPlan(refusedInventory, contract, { policyDigest: HASH });
  const receipt = buildPlanningReceipt(refusedInventory, plan, { signerKeyId: KEY, now: () => NOW });
  assert.equal(receipt.state, 'refused');
  assert.deepEqual(receipt.refusals.map((entry) => entry.failureClass), ['policy_mismatch']);
});

test('planner never turns self-evidence or provider publication into delete actions', () => {
  for (const [resourceClass, locatorKind] of [
    ['cleanup_evidence', 'path'],
    ['provider_publication', 'provider_id'],
  ]) {
    const identity = `${resourceClass}-1`;
    const ownership = {
      ...resource(resourceClass, identity).ownership, cleanupPolicy: 'exact_delete',
    };
    const unsafe = resource(resourceClass, identity, {
      locatorKind, locator: identity, ownership,
      ownershipDigest: canonicalSha256(ownership),
    });
    const policyContract = { resourceClasses: [{
      classId: resourceClass, dependsOn: [], cleanupPolicies: ['exact_delete'],
    }] };
    assert.throws(
      () => buildCleanupPlan(inventory({ resources: [unsafe] }), policyContract, { policyDigest: HASH }),
      new RegExp(`${resourceClass} is a protected cleanup artifact and cannot be deleted`),
    );
  }
});
