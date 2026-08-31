import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTIFACT_SCHEMA_VERSIONS,
  validateArtifact,
} from '../../scripts/ownership/schemas.mjs';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';

const HASH = 'a'.repeat(64);
const NOW = new Date('2026-08-30T00:00:10.000Z');

function ownership(overrides = {}) {
  return {
    project: 'sanctuary-ci-1',
    deploymentId: 'deploy-1',
    ownerId: 'owner-1',
    resourceClass: 'compose_container',
    lifecycle: 'obsolete',
    cleanupPolicy: 'exact_delete',
    createdAt: '2026-08-30T00:00:00.000Z',
    createdByRelease: 'v0.8.69',
    createdByCommit: 'b'.repeat(40),
    creationRunId: 'run-created',
    immutableIdentity: 'container-1',
    ...overrides,
  };
}

function inventoryResource(overrides = {}) {
  const tuple = ownership(overrides.ownership ?? {});
  return {
    resourceClass: tuple.resourceClass,
    locatorKind: 'engine_id',
    locator: 'container-1',
    immutableIdentity: tuple.immutableIdentity,
    ownership: tuple,
    ownershipDigest: canonicalSha256(tuple),
    observationDigest: HASH,
    disposition: 'eligible',
    failureClasses: [],
    references: [],
    contentDigests: [],
    active: false,
    protected: false,
    data: false,
    ...overrides,
  };
}

function inventory(overrides = {}) {
  return {
    schemaVersion: '1.1.0',
    artifactType: 'inventory',
    deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1',
    generation: 2,
    observedAt: '2026-08-30T00:00:01.000Z',
    complete: true,
    policyDigest: HASH,
    deploymentManifestDigest: HASH,
    runManifestDigest: HASH,
    contextFingerprint: HASH,
    resources: [inventoryResource()],
    ambiguities: [],
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    sequence: 1,
    resourceClass: 'compose_container',
    immutableIdentity: 'container-1',
    action: 'remove',
    locatorKind: 'engine_id',
    locator: 'container-1',
    ownershipDigest: HASH,
    observationDigest: HASH,
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    schemaVersion: '1.1.0',
    artifactType: 'cleanup_plan',
    deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1',
    createdAt: '2026-08-30T00:00:02.000Z',
    inventoryDigest: HASH,
    policyDigest: HASH,
    deploymentManifestDigest: HASH,
    runManifestDigest: HASH,
    contextFingerprint: HASH,
    actions: [action()],
    ...overrides,
  };
}

function approval(overrides = {}) {
  return {
    schemaVersion: '1.1.0',
    artifactType: 'cleanup_approval',
    deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1',
    issuedAt: '2026-08-30T00:00:03.000Z',
    expiresAt: '2026-08-30T01:00:03.000Z',
    nonce: 'approval-1',
    dryRunReceiptDigest: HASH,
    planDigest: HASH,
    policyDigest: HASH,
    deploymentManifestDigest: HASH,
    runManifestDigest: HASH,
    contextFingerprint: HASH,
    actions: [action()],
    permittedClasses: ['compose_container'],
    permittedActionCount: 1,
    decommission: false,
    signerKeyId: HASH,
    ...overrides,
  };
}

function receipt(state = 'dry_run', overrides = {}) {
  const actions = state === 'dry_run' ? [action()] : [];
  const results = actions.map((entry) => ({
    sequence: entry.sequence,
    resourceClass: entry.resourceClass,
    immutableIdentity: entry.immutableIdentity,
    result: 'pending',
    failureClass: 'none',
  }));
  const refusals = state === 'refused'
    ? [{ resourceClass: 'compose_container', immutableIdentity: 'container-1', failureClass: 'active' }]
    : state === 'ambiguous'
      ? [{ resourceClass: 'compose_container', immutableIdentity: 'adapter-docker', failureClass: 'query_failed' }]
      : [];
  return {
    schemaVersion: '1.1.0',
    artifactType: 'cleanup_receipt',
    phase: 'planning',
    deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1',
    state,
    operationStartedAt: '2026-08-30T00:00:00.000Z',
    operationEndedAt: '2026-08-30T00:00:04.000Z',
    receiptCoreFinalizedAt: '2026-08-30T00:00:05.000Z',
    policyDigest: HASH,
    deploymentManifestDigest: HASH,
    runManifestDigest: HASH,
    planDigest: HASH,
    approvalDigest: null,
    approvalStateDigest: null,
    inventoryBeforeDigest: HASH,
    inventoryAfterDigest: null,
    journalDigest: null,
    journalBytes: 0,
    journalRecords: 0,
    actions,
    results,
    refusals,
    signerKeyId: HASH,
    ...overrides,
  };
}

test('cleanup artifacts advertise v1.1 without changing manifest and registration versions', () => {
  assert.equal(ARTIFACT_SCHEMA_VERSIONS.inventory, '1.1.0');
  assert.equal(ARTIFACT_SCHEMA_VERSIONS.cleanup_plan, '1.1.0');
  assert.equal(ARTIFACT_SCHEMA_VERSIONS.cleanup_approval, '1.1.0');
  assert.equal(ARTIFACT_SCHEMA_VERSIONS.cleanup_receipt, '1.1.0');
  assert.equal(ARTIFACT_SCHEMA_VERSIONS.deployment_manifest, '1.0.0');
  assert.equal(ARTIFACT_SCHEMA_VERSIONS.run_manifest, '1.0.0');
  assert.equal(ARTIFACT_SCHEMA_VERSIONS.resource_registration, '1.0.0');
});

test('inventory binds exact local observations and fail-closed ambiguity state', () => {
  assert.doesNotThrow(() => validateArtifact(inventory()));
  const refused = inventoryResource({
    disposition: 'refused', failureClasses: ['active'], active: true,
  });
  assert.doesNotThrow(() => validateArtifact(inventory({ resources: [refused] })));
  const ambiguous = inventory({
    complete: false,
    resources: [],
    ambiguities: [{ adapter: 'docker', resourceClass: null, failureClass: 'query_failed', scope: 'container-list' }],
  });
  assert.doesNotThrow(() => validateArtifact(ambiguous));
  assert.throws(() => validateArtifact({ ...ambiguous, complete: true }), /complete/);
  assert.throws(() => validateArtifact(inventory({
    resources: [inventoryResource({ ownership: null, ownershipDigest: null })],
  })), /eligible resources require ownership/);
  assert.throws(() => validateArtifact(inventory({
    resources: [inventoryResource({ disposition: 'refused', failureClasses: [] })],
  })), /non-eligible resources require a failure class/);
  assert.throws(() => validateArtifact(inventory({
    resources: [inventoryResource({ disposition: 'refused', failureClasses: ['none'] })],
  })), /cannot contain none/);
  assert.throws(() => validateArtifact(inventory({
    resources: [inventoryResource({ ownershipDigest: 'f'.repeat(64) })],
  })), /canonical ownership/);
});

test('cleanup plans bind exact locators and reject gaps or duplicate target actions', () => {
  assert.doesNotThrow(() => validateArtifact(plan()));
  assert.throws(() => validateArtifact(plan({
    actions: [action({ sequence: 2 })],
  })), /contiguous/);
  assert.throws(() => validateArtifact(plan({
    actions: [action(), action({ sequence: 2 })],
  })), /must not contain duplicates/);
  assert.throws(() => validateArtifact({ ...plan(), unexpected: true }), /exactly/);
});

test('bounded approvals copy exact actions, classes, counts, and signer identity', () => {
  assert.doesNotThrow(() => validateArtifact(approval()));
  assert.throws(() => validateArtifact(approval({ permittedActionCount: 2 })), /actions length/);
  assert.throws(() => validateArtifact(approval({ permittedClasses: ['compose_network'] })), /exactly match/);
  assert.throws(() => validateArtifact(approval({
    expiresAt: '2026-08-31T00:00:04.000Z',
  })), /maximum approval lifetime/);
  assert.throws(() => validateArtifact(approval({ actions: [] })), /1-10000/);
});

test('planning receipts strictly distinguish dry-run, no-op, refused, and ambiguous outcomes', () => {
  for (const state of ['dry_run', 'no_op', 'refused', 'ambiguous']) {
    assert.doesNotThrow(() => validateArtifact(receipt(state), { now: NOW }));
  }
  assert.throws(() => validateArtifact(receipt('dry_run', {
    approvalDigest: HASH,
  }), { now: NOW }), /must be null during planning/);
  assert.throws(() => validateArtifact(receipt('dry_run', {
    journalBytes: 1,
  }), { now: NOW }), /cannot contain a journal/);
  assert.throws(() => validateArtifact(receipt('dry_run', {
    results: [],
  }), { now: NOW }), /one-to-one/);
  assert.throws(() => validateArtifact(receipt('ambiguous', {
    refusals: [{ resourceClass: 'compose_container', immutableIdentity: 'container-1', failureClass: 'active' }],
  }), { now: NOW }), /ambiguity failure class/);
});

test('legacy v1 cleanup receipts remain verifiable', () => {
  const legacy = {
    schemaVersion: '1.0.0',
    artifactType: 'cleanup_receipt',
    deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1',
    state: 'no_op',
    operationStartedAt: '2026-08-30T00:00:00.000Z',
    operationEndedAt: '2026-08-30T00:00:01.000Z',
    receiptCoreFinalizedAt: '2026-08-30T00:00:02.000Z',
    policyDigest: HASH,
    deploymentManifestDigest: HASH,
    runManifestDigest: HASH,
    planDigest: HASH,
    approvalDigest: HASH,
    approvalStateDigest: HASH,
    inventoryBeforeDigest: HASH,
    inventoryAfterDigest: HASH,
    journalDigest: HASH,
    journalBytes: 0,
    journalRecords: 0,
    actions: [],
    results: [],
    refusals: [],
    signerKeyId: HASH,
  };
  assert.doesNotThrow(() => validateArtifact(legacy, { now: NOW }));
});
