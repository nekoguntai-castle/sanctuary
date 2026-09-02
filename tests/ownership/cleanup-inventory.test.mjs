import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { inventoryCleanupResources } from '../../scripts/ownership/cleanup-inventory.mjs';
import { buildCleanupPlan, buildPlanningReceipt } from '../../scripts/ownership/cleanup-planner.mjs';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerResource } from '../../scripts/ownership/registration.mjs';

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

test('exclusive witness registrations add exact Compose selectors without manifest legacy rows', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'witness-selectors-'));
  const checkoutRoot = path.join(root, 'checkout');
  const registrationRoot = path.join(root, 'ownership');
  mkdirSync(checkoutRoot, { mode: 0o700 });
  const witness = 'e'.repeat(64);
  const deployment = deploymentManifest();
  const identities = {
    compose_container: '1'.repeat(64), compose_network: '2'.repeat(64),
    compose_volume: '3'.repeat(64),
  };
  for (const [resourceClass, immutableIdentity] of Object.entries(identities)) {
    registerResource({
      deploymentId: deployment.deploymentId, operationRunId: 'cleanup-1',
      ownerId: deployment.ownerId, resourceClass, lifecycle: 'obsolete',
      cleanupPolicy: 'exact_delete', createdAt: deployment.createdAt,
      createdByRelease: 'unreleased', createdByCommit: COMMIT,
      locatorKind: resourceClass === 'compose_volume' ? 'name' : 'engine_id',
      locator: resourceClass === 'compose_volume' ? 'witness_data' : immutableIdentity,
      immutableIdentity, metadataDigest: witness, referenceIds: ['cleanup-1'],
    }, { root: registrationRoot, checkoutRoot });
  }
  let selected;
  await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH, registrationRoot,
    dockerOptions: { legacyFixtureWitnessDigest: witness },
    dockerAdapter: { inventory: (options) => {
      selected = options.selectors;
      return { complete: true, ambiguities: [], resources: [] };
    } },
    readDeploymentState: () => ({ active: 'generation-2' }),
  });
  assert.ok(selected.compose_container.some((entry) => entry.locator === identities.compose_container));
  assert.ok(selected.compose_network.some((entry) => entry.locator === identities.compose_network));
  assert.ok(selected.compose_volume.some((entry) => entry.locator === 'witness_data'));
});

test('owned dependencies are plan-bound while preserve volumes are retained without blocking cleanup', async () => {
  const deployment = deploymentManifest();
  const containerId = '1'.repeat(64);
  const networkId = '2'.repeat(64);
  const volumeId = '3'.repeat(64);
  const disposableVolumeId = '6'.repeat(64);
  const imageId = `sha256:${'7'.repeat(64)}`;
  const ownedLabels = {
    ...labels(), 'io.sanctuary.deployment-id': deployment.deploymentId,
  };
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: { inventory: () => ({ complete: true, ambiguities: [], resources: [
      {
        resourceClass: 'compose_container', locator: containerId, immutableIdentity: containerId,
        labels: ownedLabels, ownershipState: 'owned', classifications: ['owned', 'running'],
        runtime: { running: true },
      },
      {
        resourceClass: 'compose_network', locator: networkId, immutableIdentity: networkId,
        labels: { ...ownedLabels, 'io.sanctuary.resource-class': 'compose_network' },
        ownershipState: 'owned', classifications: ['owned'],
        runtime: { endpointCount: 1, dependencyIdentities: [containerId] },
      },
      {
        resourceClass: 'compose_volume', locator: 'persistent-data', immutableIdentity: volumeId,
        labels: {
          ...ownedLabels, 'io.sanctuary.resource-class': 'compose_volume',
          'io.sanctuary.cleanup-policy': 'preserve_ambiguous',
        },
        ownershipState: 'owned', classifications: ['owned', 'protected', 'unregistered'],
        runtime: { attachmentCount: 1, dependencyIdentities: [containerId] },
      },
      {
        resourceClass: 'compose_volume', locator: 'disposable-cache',
        immutableIdentity: disposableVolumeId,
        labels: { ...ownedLabels, 'io.sanctuary.resource-class': 'compose_volume' },
        ownershipState: 'owned', classifications: ['owned', 'registered'],
        registration: {
          registrationId: '8'.repeat(64), signerKeyId: '9'.repeat(64),
          metadataDigest: 'a'.repeat(64), resourceClass: 'compose_volume',
          immutableIdentity: disposableVolumeId, deploymentId: deployment.deploymentId,
          ownerId: deployment.ownerId, locator: 'disposable-cache', operationRunId: 'creator-1',
        },
        runtime: { attachmentCount: 1, dependencyIdentities: [containerId] },
      },
      {
        resourceClass: 'oci_image', locator: imageId, immutableIdentity: imageId,
        labels: { ...ownedLabels, 'io.sanctuary.resource-class': 'oci_image' },
        ownershipState: 'owned', classifications: ['owned', 'registered'],
        registration: {
          registrationId: 'b'.repeat(64), signerKeyId: 'c'.repeat(64),
          metadataDigest: 'd'.repeat(64), resourceClass: 'oci_image',
          immutableIdentity: imageId, deploymentId: deployment.deploymentId,
          ownerId: deployment.ownerId,
        },
        runtime: {
          referenceCount: 1, dependencyIdentities: [containerId],
          references: ['fixture:local'], contentDigests: ['7'.repeat(64)], tags: ['fixture:local'],
        },
      },
    ] }) },
    readDeploymentState: () => null,
    now: () => new Date('2026-08-30T00:00:04.000Z'),
  });
  const retained = inventory.resources.find((row) => row.resourceClass === 'compose_volume');
  const network = inventory.resources.find((row) => row.resourceClass === 'compose_network');
  assert.equal(retained.disposition, 'retain');
  assert.deepEqual(retained.failureClasses, ['policy_retained']);
  assert.deepEqual(network.dependencyIdentities, [containerId]);
  assert.equal(network.disposition, 'eligible');
  const plan = buildCleanupPlan(inventory, ownershipContract, { policyDigest: HASH });
  const networkAction = plan.actions.find((entry) => entry.resourceClass === 'compose_network');
  assert.deepEqual(networkAction.dependencyIdentities, [containerId]);
  assert.deepEqual(plan.actions.find((entry) => entry.resourceClass === 'compose_volume')
    .dependencyIdentities, [containerId]);
  assert.deepEqual(plan.actions.find((entry) => entry.resourceClass === 'oci_image')
    .dependencyIdentities, [containerId]);
  assert.equal(buildPlanningReceipt(inventory, plan, {
    signerKeyId: HASH, now: () => new Date('2026-08-30T00:00:10.000Z'),
  }).state, 'dry_run');
});

test('a foreign network dependency remains a hard non-mutating refusal', async () => {
  const deployment = deploymentManifest();
  const networkId = '4'.repeat(64);
  const foreignContainerId = '5'.repeat(64);
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: { inventory: () => ({ complete: true, ambiguities: [], resources: [{
      resourceClass: 'compose_network', locator: networkId, immutableIdentity: networkId,
      labels: {
        ...labels(), 'io.sanctuary.deployment-id': deployment.deploymentId,
        'io.sanctuary.resource-class': 'compose_network',
      },
      ownershipState: 'owned', classifications: ['owned'],
      runtime: { endpointCount: 1, dependencyIdentities: [foreignContainerId] },
    }] }) },
    readDeploymentState: () => null,
  });
  assert.equal(inventory.resources[0].disposition, 'refused');
  assert.deepEqual(inventory.resources[0].failureClasses, ['shared']);
  assert.deepEqual(buildCleanupPlan(inventory, ownershipContract, { policyDigest: HASH }).actions, []);
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

test('inventory admits only the exact cleanup controller lock owner', async () => {
  const deployment = deploymentManifest();
  const ownerDigest = 'e'.repeat(64);
  const readDeploymentState = () => ({
    registered: true,
    active: { value: { generation: deployment.generation } },
    pending: null,
    prepared: null,
    mutationLock: { state: 'locked', ownerDigest },
  });
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH, dockerAdapter: adapter(), readDeploymentState,
    expectedMutationLockOwnerDigest: ownerDigest,
  });
  assert.equal(inventory.complete, true);
  assert.equal(inventory.resources[0].disposition, 'eligible');

  const foreign = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH, dockerAdapter: adapter(), readDeploymentState,
    expectedMutationLockOwnerDigest: 'f'.repeat(64),
  });
  assert.equal(foreign.complete, false);
  assert.ok(foreign.ambiguities.some((entry) => entry.scope === 'deployment-lock-held'));
});

test('same-generation state admits obsolete ownership while active lifecycle remains protected', async () => {
  const deployment = deploymentManifest();
  let currentDeploymentIds;
  const obsoleteLabels = {
    ...labels(), 'io.sanctuary.deployment-id': deployment.deploymentId,
  };
  const activeLabels = {
    ...obsoleteLabels, 'io.sanctuary.lifecycle': 'active',
    'io.sanctuary.creation-run-id': 'active-run',
  };
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: { inventory(options) {
      currentDeploymentIds = options.currentDeploymentIds;
      return { complete: true, ambiguities: [], resources: [
        {
          resourceClass: 'compose_container', locator: 'obsolete-container',
          immutableIdentity: 'obsolete-container', labels: obsoleteLabels,
          ownershipState: 'owned', classifications: ['owned'], runtime: { running: false },
        },
        {
          resourceClass: 'compose_container', locator: 'active-container',
          immutableIdentity: 'active-container', labels: activeLabels,
          ownershipState: 'owned', classifications: ['current', 'owned', 'protected'],
          runtime: { running: false },
        },
      ] };
    } },
    readDeploymentState: () => ({
      registered: true,
      active: { value: { generation: deployment.generation } },
      pending: null, prepared: null,
    }),
  });
  assert.deepEqual(currentDeploymentIds, []);
  assert.equal(inventory.complete, true);
  const obsolete = inventory.resources.find((entry) => entry.locator === 'obsolete-container');
  const active = inventory.resources.find((entry) => entry.locator === 'active-container');
  assert.equal(obsolete.disposition, 'eligible');
  assert.equal(active.disposition, 'refused');
  assert.ok(active.failureClasses.includes('current'));
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

test('a legacy locator cannot authorize a resource claimed by another ownership tuple', async () => {
  const deployment = {
    ...deploymentManifest(),
    legacyResources: [{
      resourceClass: 'compose_network', locator: 'old-network', composeResource: 'default',
      immutableIdentity: '2'.repeat(64), cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled',
    }],
  };
  const foreignLabels = {
    ...labels(), 'io.sanctuary.resource-class': 'compose_network',
    'io.sanctuary.deployment-id': 'foreign-deployment', 'io.sanctuary.owner-id': 'foreign-owner',
  };
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: { inventory: () => ({ complete: true, ambiguities: [], resources: [{
      resourceClass: 'compose_network', locator: '2'.repeat(64), immutableIdentity: '2'.repeat(64),
      labels: foreignLabels, ownershipState: 'owned', classifications: ['owned'],
      runtime: { endpointCount: 0 },
    }] }) },
    readDeploymentState: () => ({ active: { value: { generation: deployment.generation } } }),
  });
  assert.equal(inventory.complete, false);
  assert.ok(inventory.ambiguities.some((entry) => entry.failureClass === 'identity_changed'));
});

test('OCI plans retain the exact inspected image ID as an engine locator', async () => {
  const deployment = deploymentManifest();
  const imageId = `sha256:${'5'.repeat(64)}`;
  const imageLabels = { ...labels(),
    'io.sanctuary.resource-class': 'oci_image',
    'io.sanctuary.deployment-id': deployment.deploymentId,
  };
  const inventory = await inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: { inventory: () => ({ complete: true, ambiguities: [], resources: [{
      resourceClass: 'oci_image', locator: imageId, immutableIdentity: imageId, labels: imageLabels,
      ownershipState: 'owned', classifications: ['owned'],
      registration: {
        registrationId: '6'.repeat(64), signerKeyId: '7'.repeat(64),
        metadataDigest: '8'.repeat(64), resourceClass: 'oci_image', immutableIdentity: imageId,
        deploymentId: deployment.deploymentId, ownerId: deployment.ownerId,
      },
      runtime: { referenceCount: 0, references: [], contentDigests: ['5'.repeat(64)], tags: [] },
    }] }) },
    readDeploymentState: () => null,
  });
  const plan = buildCleanupPlan(inventory, ownershipContract, { policyDigest: HASH });
  assert.equal(plan.actions[0].locatorKind, 'engine_id');
  assert.equal(plan.actions[0].locator, imageId);
});

test('provenance-only image derives lane-local cleanup ownership with dependency safety', async () => {
  const deployment = deploymentManifest();
  const imageId = `sha256:${'9'.repeat(64)}`;
  const containerId = '4'.repeat(64);
  const registration = {
    registrationId: '1'.repeat(64), signerKeyId: '2'.repeat(64), metadataDigest: '3'.repeat(64),
    resourceClass: 'oci_image', immutableIdentity: imageId,
    deploymentId: deployment.deploymentId, ownerId: deployment.ownerId,
    operationRunId: 'replay-live-run', lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: '2026-08-30T00:00:00.000Z', createdByRelease: 'v0.8.69',
    createdByCommit: COMMIT, locatorKind: 'reference', locator: 'wallet-sync-replay:live',
    referenceIds: ['replay-live-run'],
  };
  const image = (dependencyIdentities) => ({
    resourceClass: 'oci_image', locator: imageId, immutableIdentity: imageId,
    labels: {
      'org.opencontainers.image.source': 'https://github.com/nekoguntai-castle/sanctuary',
      'org.opencontainers.image.version': '0.8.69',
      'org.opencontainers.image.revision': '7'.repeat(40),
      'io.sanctuary.build-id': 'distinct-build-lane',
      'dev.sanctuary.image-lock-sha256': '8'.repeat(64),
    },
    ownershipState: 'unlabeled',
    classifications: ['externally_registered', 'registered', 'unlabeled'],
    registration,
    runtime: {
      referenceCount: dependencyIdentities.length, dependencyIdentities,
      references: ['wallet-sync-replay:live'], contentDigests: ['9'.repeat(64)],
      tags: ['wallet-sync-replay:live'], digests: [],
    },
  });
  const container = {
    resourceClass: 'compose_container', locator: containerId, immutableIdentity: containerId,
    labels: { ...labels(), 'io.sanctuary.deployment-id': deployment.deploymentId },
    ownershipState: 'owned', classifications: ['owned', 'running'], runtime: { running: true },
  };
  const collect = (resources) => inventoryCleanupResources({
    deploymentManifest: deployment, runManifest: runManifest(deployment), ownershipContract,
    ownershipContractDigest: HASH,
    dockerAdapter: { inventory: () => ({ complete: true, ambiguities: [], resources }) },
    readDeploymentState: () => null,
  });
  const ownedDependency = await collect([container, image([containerId])]);
  const imageRow = ownedDependency.resources.find((row) => row.resourceClass === 'oci_image');
  assert.equal(imageRow.disposition, 'eligible');
  assert.equal(imageRow.ownership.deploymentId, deployment.deploymentId);
  assert.equal(imageRow.ownership.ownerId, deployment.ownerId);
  assert.equal(imageRow.ownership.creationRunId, 'replay-live-run');
  const plan = buildCleanupPlan(ownedDependency, ownershipContract, { policyDigest: HASH });
  assert.equal(plan.actions.find((action) => action.resourceClass === 'oci_image').locator, imageId);

  const foreignDependency = await collect([image(['5'.repeat(64)])]);
  assert.equal(foreignDependency.resources[0].disposition, 'refused');
  assert.deepEqual(foreignDependency.resources[0].failureClasses, ['shared']);
});
