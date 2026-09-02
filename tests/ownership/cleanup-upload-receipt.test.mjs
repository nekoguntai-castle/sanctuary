import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { buildCleanupUploadReceipt } from '../../scripts/ownership/cleanup-upload-receipt.mjs';
import { buildPlanningReceipt } from '../../scripts/ownership/cleanup-planner.mjs';

const HASH = 'a'.repeat(64);

function planningFixture() {
  const action = {
    sequence: 1, resourceClass: 'compose_container', immutableIdentity: 'container-1',
    action: 'remove', locatorKind: 'engine_id', locator: 'private-container-id',
    ownershipDigest: HASH, observationDigest: HASH, dependencyIdentities: [],
  };
  const inventory = {
    schemaVersion: '1.2.0', artifactType: 'inventory', deploymentId: 'deploy-1',
    operationRunId: 'run-1', generation: 1, observedAt: new Date().toISOString(),
    complete: true, policyDigest: HASH, deploymentManifestDigest: HASH,
    runManifestDigest: HASH, contextFingerprint: HASH, resources: [], ambiguities: [],
  };
  const plan = {
    schemaVersion: '1.1.0', artifactType: 'cleanup_plan', deploymentId: 'deploy-1',
    operationRunId: 'run-1', createdAt: inventory.observedAt,
    inventoryDigest: canonicalSha256(inventory), policyDigest: HASH,
    deploymentManifestDigest: HASH, runManifestDigest: HASH, contextFingerprint: HASH,
    actions: [action],
  };
  return buildPlanningReceipt(inventory, plan, { signerKeyId: HASH });
}

test('upload projection removes exact identities and preserves bounded aggregate evidence', () => {
  const projection = buildCleanupUploadReceipt(planningFixture());
  assert.deepEqual(projection.resourceCounts, {
    total: 1, cleaned: 0, retained: 0, refused: 0, ambiguous: 0,
  });
  assert.deepEqual(projection.resultCounts, {
    total: 1, cleaned: 0, retained: 0, refused: 0, ambiguous: 0,
  });
  assert.equal(JSON.stringify(projection).includes('container-1'), false);
  assert.equal(projection.state, 'dry_run');
});

test('upload projection deduplicates resource identities and reports bounded failures', () => {
  const receipt = planningFixture();
  const refused = {
    ...receipt, state: 'refused', actions: [], results: [],
    refusals: [
      { resourceClass: 'compose_container', immutableIdentity: 'same', failureClass: 'shared' },
      { resourceClass: 'compose_container', immutableIdentity: 'same', failureClass: 'query_failed' },
    ],
  };
  const projection = buildCleanupUploadReceipt(refused);
  assert.equal(projection.resourceCounts.total, 1);
  assert.equal(projection.resourceCounts.ambiguous, 1);
  assert.equal(projection.resultCounts.total, 2);
  assert.deepEqual(projection.failureClasses, ['query_failed', 'shared']);
});

test('upload projection rejects non-receipt artifacts', () => {
  assert.throws(() => buildCleanupUploadReceipt({ artifactType: 'inventory' }), /exactly|version|receipt/);
});
