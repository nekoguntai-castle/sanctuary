import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { createCleanupHostRuntime } from '../../scripts/ownership/cleanup-host-runtime.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function fixture() {
  const ownership = {
    project: 'sanctuary-ci', deploymentId: 'deploy-1', ownerId: 'owner-1',
    resourceClass: 'temporary_artifact', lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: '2026-09-01T00:00:00.000Z', createdByRelease: 'v0.8.69',
    createdByCommit: 'd'.repeat(40), creationRunId: 'run-1', immutableIdentity: A,
  };
  const row = {
    resourceClass: 'temporary_artifact', locatorKind: 'path', locator: '/private/item',
    immutableIdentity: A, ownership, ownershipDigest: canonicalSha256(ownership),
    observationDigest: B, disposition: 'eligible', failureClasses: [], references: ['run-1'],
    contentDigests: [B, C].sort(), dependencyIdentities: [], running: null,
    active: false, protected: false, data: false,
  };
  const action = {
    sequence: 1, resourceClass: row.resourceClass, immutableIdentity: row.immutableIdentity,
    action: 'remove', locatorKind: row.locatorKind, locator: row.locator,
    ownershipDigest: row.ownershipDigest, observationDigest: row.observationDigest,
    dependencyIdentities: [],
  };
  const inventory = {
    schemaVersion: '1.2.0', artifactType: 'inventory', deploymentId: 'deploy-1',
    operationRunId: 'run-1', generation: 1, observedAt: '2026-09-01T00:00:01.000Z',
    complete: true, policyDigest: B, deploymentManifestDigest: B,
    runManifestDigest: B, contextFingerprint: B, resources: [row], ambiguities: [],
  };
  const registration = {
    schemaVersion: '1.1.0', resourceClass: row.resourceClass,
    immutableIdentity: row.immutableIdentity, locatorKind: row.locatorKind, locator: row.locator,
    registrationId: C, metadataDigest: B, executionAuthority: { kind: 'linux_dirfd_v1' },
  };
  return { action, inventory, registration, row };
}

test('host runtime reloads exact authority under the fence before one mutation', async () => {
  const value = fixture();
  const events = [];
  const runtime = createCleanupHostRuntime({
    plan: { operationRunId: 'run-1', actions: [value.action] },
    loadInventory: async () => value.inventory,
    loadRegistrations: () => [value.registration],
    registrationRoot: '/unused',
    withRegistrationFence: async (_run, callback) => {
      events.push('fence');
      return callback();
    },
    hostOperations: {
      mutate: async ({ intentCheckpointDigest }) => {
        events.push(`mutate:${intentCheckpointDigest}`);
        return { outcome: 'success' };
      },
      reconcile: async () => ({ state: 'absent', postconditionDigest: A, failureClass: 'none' }),
    },
  });
  const authority = await runtime.reloadAuthority({
    action: value.action, phase: 'fresh_eligibility', predecessorResultDigest: null,
  });
  assert.equal(authority.state, 'eligible');
  const mutation = await runtime.mutate({
    action: value.action, intentCheckpointDigest: A,
    predecessorResultDigest: null, authorityRowDigest: canonicalSha256(authority.row),
  });
  assert.deepEqual(mutation, { outcome: 'success' });
  assert.deepEqual(events, ['fence', `mutate:${A}`]);
  assert.deepEqual(await runtime.reconcile({
    action: value.action, mutationOutcome: 'success', intentCheckpointDigest: A,
  }), {
    state: 'absent', resourceClass: 'temporary_artifact', immutableIdentity: A,
    postconditionDigest: A, failureClass: 'none',
  });
});

test('host runtime refuses drift, active rows, and missing dependency proof', async () => {
  const value = fixture();
  const runtimeFor = (row, dependencies = []) => createCleanupHostRuntime({
    plan: { operationRunId: 'run-1', actions: [{ ...value.action, dependencyIdentities: dependencies }] },
    loadInventory: async () => ({ ...value.inventory, resources: [row] }),
    loadRegistrations: () => [value.registration], registrationRoot: '/unused',
    withRegistrationFence: async (_run, callback) => callback(),
    hostOperations: { mutate: async () => ({ outcome: 'success' }), reconcile: async () => null },
  });
  const drifted = runtimeFor({ ...value.row, locator: '/private/replaced' });
  assert.equal((await drifted.reloadAuthority({
    action: value.action, phase: 'fresh_eligibility', predecessorResultDigest: null,
  })).state, 'refused');
  const active = runtimeFor({ ...value.row, active: true });
  assert.equal((await active.reloadAuthority({
    action: value.action, phase: 'fresh_eligibility', predecessorResultDigest: null,
  })).state, 'refused');

  const dependentAction = { ...value.action, dependencyIdentities: [C] };
  const dependent = runtimeFor({ ...value.row, dependencyIdentities: [C] }, [C]);
  assert.equal((await dependent.reloadAuthority({
    action: dependentAction, phase: 'fresh_eligibility', predecessorResultDigest: null,
  })).state, 'refused');
  assert.equal((await dependent.reloadAuthority({
    action: dependentAction, phase: 'fresh_eligibility', predecessorResultDigest: B,
  })).state, 'eligible');
});
