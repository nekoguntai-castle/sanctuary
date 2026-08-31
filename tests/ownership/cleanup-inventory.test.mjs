import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { inventoryCleanupResources } from '../../scripts/ownership/cleanup-inventory.mjs';
import { buildCleanupPlan } from '../../scripts/ownership/cleanup-planner.mjs';

const HASH = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);

function deploymentManifest() {
  return {
    schemaVersion: '1.0.0', artifactType: 'deployment_manifest', deploymentId: 'deploy-1',
    generation: 2, createdAt: '2026-08-30T00:00:00.000Z', priorActiveDigest: null,
    definitionVersion: 1, ownerId: 'owner-1', release: 'v0.8.69', commit: COMMIT,
    projectDirectory: '/private/project', projectDirectoryIdentity: 'device:inode',
    composeProjectName: 'sanctuary-ci-1', envFile: '/private/sanctuary.env',
    envFileIdentity: 'env:inode', installMode: 'online', profiles: [],
    overlays: [{ sourcePath: '/private/compose.yml', sourceIdentity: 'overlay:inode',
      snapshotPath: 'compose/00-compose.yml', sha256: HASH, kind: 'tracked' }],
    policyDigest: HASH, contextFingerprint: 'c'.repeat(64), definitionDigest: 'd'.repeat(64),
    legacyResources: [],
  };
}

function runManifest(deployment) {
  return {
    schemaVersion: '1.0.0', artifactType: 'run_manifest', deploymentId: deployment.deploymentId,
    operationRunId: 'cleanup-1', ownerId: deployment.ownerId, generation: deployment.generation,
    startedAt: '2026-08-30T00:00:01.000Z', heartbeatAt: '2026-08-30T00:00:02.000Z',
    terminalAt: '2026-08-30T00:00:03.000Z', controllerIdentity: 'controller-1',
    deploymentDigest: canonicalSha256(deployment),
  };
}

function labels() {
  return {
    'io.sanctuary.project': 'sanctuary-ci-1', 'io.sanctuary.deployment-id': 'deploy-old',
    'io.sanctuary.owner-id': 'owner-1', 'io.sanctuary.resource-class': 'compose_container',
    'io.sanctuary.lifecycle': 'obsolete', 'io.sanctuary.cleanup-policy': 'exact_delete',
    'io.sanctuary.created-at': '2026-08-29T00:00:00.000Z',
    'io.sanctuary.created-by-release': 'v0.8.69', 'io.sanctuary.created-by-commit': COMMIT,
    'io.sanctuary.creation-run-id': 'creator-1',
  };
}

const ownershipContract = { resourceClasses: [
  { classId: 'compose_container', cleanupPolicies: ['exact_delete', 'preserve_ambiguous'], dependsOn: [] },
  { classId: 'compose_network', cleanupPolicies: ['exact_delete', 'preserve_ambiguous'], dependsOn: ['compose_container'] },
  { classId: 'compose_volume', cleanupPolicies: ['exact_delete', 'preserve_ambiguous'], dependsOn: ['compose_container'] },
  { classId: 'oci_image', cleanupPolicies: ['exact_delete', 'preserve_ambiguous', 'retain'], dependsOn: ['compose_container'] },
] };

function adapter(overrides = {}) {
  return { inventory: (options) => {
    const row = {
      resourceClass: 'compose_container', locator: 'container-1', immutableIdentity: 'container-1',
      labels: labels(), ownershipState: 'owned', classifications: ['owned', 'running'],
      runtime: { running: true }, ...overrides,
    };
    if (options.currentDeploymentIds.includes(row.labels['io.sanctuary.deployment-id'])) {
      row.classifications = [...new Set([...row.classifications, 'current', 'protected'])].sort();
    }
    return { complete: true, ambiguities: [], resources: [row] };
  } };
}

test('inventory binds manifests, exact ownership and a stable obsolete Docker identity', async () => {
  const deployment = deploymentManifest();
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: adapter(), readDeploymentState: () => ({ active: 'generation-2' }),
    now: () => new Date('2026-08-30T00:00:04.000Z'),
  });
  assert.equal(inventory.complete, true);
  assert.equal(inventory.resources[0].disposition, 'eligible');
  assert.equal(inventory.resources[0].active, false);
  assert.equal(inventory.resources[0].ownership.immutableIdentity, 'container-1');
  const plan = buildCleanupPlan(inventory, ownershipContract, {
    policyDigest: HASH, now: () => new Date('2026-08-30T00:00:05.000Z'),
  });
  assert.deepEqual(plan.actions.map((entry) => entry.action), ['stop', 'remove']);
});

test('deployment pointer drift turns an otherwise valid inventory ambiguous', async () => {
  const deployment = deploymentManifest();
  let observation = 0;
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: adapter(), readDeploymentState: () => ({ observation: observation += 1 }),
    now: () => new Date('2026-08-30T00:00:04.000Z'),
  });
  assert.equal(inventory.complete, false);
  assert.equal(inventory.ambiguities.at(-1).failureClass, 'identity_changed');
  const plan = buildCleanupPlan(inventory, ownershipContract, { policyDigest: HASH });
  assert.deepEqual(plan.actions, []);
});

test('a nonterminal run protects its exact deployment even without an active pointer', async () => {
  const deployment = deploymentManifest();
  const activeRun = { ...runManifest(deployment), terminalAt: null };
  const currentLabels = { ...labels(), 'io.sanctuary.deployment-id': deployment.deploymentId };
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: activeRun, ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: adapter({ labels: currentLabels }), readDeploymentState: () => ({ registered: true }),
    now: () => new Date('2026-08-30T00:00:04.000Z'),
  });
  assert.equal(inventory.resources[0].active, true);
  assert.equal(inventory.resources[0].disposition, 'refused');
  assert.ok(inventory.resources[0].failureClasses.includes('current'));
});

test('an active newer generation protects the stable deployment ID of an older manifest', async () => {
  const deployment = deploymentManifest();
  const currentLabels = { ...labels(), 'io.sanctuary.deployment-id': deployment.deploymentId };
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: adapter({ labels: currentLabels }),
    readDeploymentState: () => ({ registered: true, active: { value: {
      generation: deployment.generation + 1, manifestDigest: 'f'.repeat(64),
    } } }),
    now: () => new Date('2026-08-30T00:00:04.000Z'),
  });
  assert.equal(inventory.resources[0].disposition, 'refused');
  assert.ok(inventory.resources[0].failureClasses.includes('current'));
});

test('inventory refuses a policy contract that is not hash-bound to the deployment', async () => {
  const deployment = deploymentManifest();
  await assert.rejects(() => inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: 'f'.repeat(64), dockerAdapter: adapter(),
  }), /contract digest/);
});

test('a held deployment mutation lock makes inventory ambiguous before any plan action', async () => {
  const deployment = deploymentManifest();
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH, dockerAdapter: adapter(),
    readDeploymentState: () => ({ registered: true, active: { value: { generation: 3 } },
      mutationLock: { state: 'locked' } }),
  });
  assert.equal(inventory.complete, false);
  assert.ok(inventory.ambiguities.some((entry) => entry.scope === 'deployment-lock-held'));
});

test('recorded unlabeled resources add exact legacy selectors and volume replacement is ambiguous', async () => {
  const deployment = {
    ...deploymentManifest(),
    legacyResources: [
      { resourceClass: 'compose_container', locator: 'old-container', composeResource: 'api',
        immutableIdentity: '1'.repeat(64), cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled' },
      { resourceClass: 'compose_network', locator: 'old-network', composeResource: 'default',
        immutableIdentity: '2'.repeat(64), cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled' },
      { resourceClass: 'compose_volume', locator: 'old-volume', composeResource: 'data',
        immutableIdentity: '3'.repeat(64), cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled' },
    ],
  };
  const run = runManifest(deployment);
  let observedSelectors;
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: run, ownershipContract, ownershipContractDigest: HASH,
    dockerAdapter: { inventory(options) {
      observedSelectors = options.selectors;
      return { complete: true, ambiguities: [], resources: [{
        resourceClass: 'compose_volume', locator: 'old-volume', immutableIdentity: '4'.repeat(64),
        labels: { 'com.docker.compose.project': deployment.composeProjectName },
        ownershipState: 'legacy_unlabeled', classifications: ['legacy_unlabeled', 'protected', 'unlabeled'],
        runtime: { attachmentCount: 0 },
      }] };
    } },
    readDeploymentState: () => ({ active: { value: { generation: 9 } } }),
  });
  assert.ok(observedSelectors.compose_container.some((entry) => entry.locator === '1'.repeat(64)));
  assert.ok(observedSelectors.compose_network.some((entry) => entry.locator === '2'.repeat(64)));
  assert.ok(observedSelectors.compose_volume.some((entry) => entry.locator === 'old-volume'));
  assert.equal(inventory.complete, false);
  assert.ok(inventory.ambiguities.some((entry) => entry.failureClass === 'identity_changed'));
});

test('OCI plans retain the exact inspected image ID as an engine locator', async () => {
  const deployment = deploymentManifest();
  const imageId = `sha256:${'5'.repeat(64)}`;
  const imageLabels = { ...labels(),
    'io.sanctuary.resource-class': 'oci_image',
    'io.sanctuary.deployment-id': 'obsolete-deployment',
  };
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: { inventory: () => ({ complete: true, ambiguities: [], resources: [{
      resourceClass: 'oci_image', locator: imageId, immutableIdentity: imageId, labels: imageLabels,
      ownershipState: 'owned', classifications: ['owned'],
      runtime: { referenceCount: 0, references: [], contentDigests: ['5'.repeat(64)], tags: [] },
    }] }) },
    readDeploymentState: () => null,
  });
  const plan = buildCleanupPlan(inventory, ownershipContract, { policyDigest: HASH });
  assert.equal(plan.actions[0].locatorKind, 'engine_id');
  assert.equal(plan.actions[0].locator, imageId);
});
