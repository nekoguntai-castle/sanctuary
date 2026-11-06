import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { createDockerCleanupAdapter } from '../../scripts/ownership/cleanup-docker-adapter.mjs';
import { inventoryCleanupResources } from '../../scripts/ownership/cleanup-inventory.mjs';
import { buildCleanupPlan } from '../../scripts/ownership/cleanup-planner.mjs';

test('canonical Docker inventory recovers a create-before-register crash window by exact manifest labels', async () => {
  const commit = 'a'.repeat(40);
  const policyDigest = 'f'.repeat(64);
  const immutableId = 'b'.repeat(64);
  const manifest = {
    schemaVersion: '1.0.0', artifactType: 'deployment_manifest',
    deploymentId: 'deployment-123', generation: 1, createdAt: '2026-11-04T12:00:00.000Z',
    priorActiveDigest: null, definitionVersion: 1, ownerId: 'owner-1000',
    release: 'unreleased', commit, projectDirectory: '/repo', projectDirectoryIdentity: 'device:inode',
    composeProjectName: 'sanctuary-ci-run-123', envFile: '/tmp/runtime/sanctuary.env',
    envFileIdentity: 'env:inode', installMode: 'online', profiles: [],
    overlays: [{ sourcePath: '/repo/docker-compose.yml', sourceIdentity: 'overlay:inode',
      snapshotPath: 'compose/00-compose.yml', sha256: policyDigest, kind: 'tracked' }],
    policyDigest, contextFingerprint: 'c'.repeat(64), definitionDigest: 'd'.repeat(64), legacyResources: []
  };
  const runManifest = {
    schemaVersion: '1.0.0', artifactType: 'run_manifest', deploymentId: manifest.deploymentId,
    operationRunId: 'run-123', ownerId: manifest.ownerId, generation: 1,
    startedAt: '2026-11-04T12:00:00.000Z', heartbeatAt: '2026-11-04T12:01:00.000Z',
    terminalAt: '2026-11-04T12:02:00.000Z', controllerIdentity: 'ci-controller',
    deploymentDigest: canonicalSha256(manifest)
  };
  const labels = {
    'io.sanctuary.project': manifest.composeProjectName,
    'io.sanctuary.deployment-id': manifest.deploymentId,
    'io.sanctuary.owner-id': manifest.ownerId,
    'io.sanctuary.resource-class': 'compose_container',
    'io.sanctuary.lifecycle': 'obsolete', 'io.sanctuary.cleanup-policy': 'exact_delete',
    'io.sanctuary.created-at': manifest.createdAt, 'io.sanctuary.created-by-release': manifest.release,
    'io.sanctuary.created-by-commit': manifest.commit, 'io.sanctuary.creation-run-id': runManifest.operationRunId
  };
  labels['com.example.sanctuary.sandboxed-playwright'] = 'v1';
  labels['com.example.sanctuary.run-id'] = '123e4567-e89b-42d3-a456-426614174000';
  const foreignCandidates = [
    { id: 'c'.repeat(64), labels: { ...labels, 'io.sanctuary.owner-id': 'foreign-owner' } },
    { id: 'd'.repeat(64), labels: { ...labels, 'io.sanctuary.creation-run-id': 'foreign-run' } },
    { id: 'e'.repeat(64), labels: { ...labels, 'io.sanctuary.created-by-commit': 'f'.repeat(40) } },
    { id: 'f'.repeat(64), labels: Object.fromEntries(Object.entries(labels).filter(([key]) => key !== 'com.example.sanctuary.sandboxed-playwright')) },
    { id: '1'.repeat(64), labels: { ...labels, 'com.example.sanctuary.sandboxed-playwright': 'v2' } },
    { id: '2'.repeat(64), labels: Object.fromEntries(Object.entries(labels).filter(([key]) => key !== 'com.example.sanctuary.run-id')) },
    { id: '3'.repeat(64), labels: { ...labels, 'com.example.sanctuary.run-id': 'not-a-v4-uuid' } },
    { id: '4'.repeat(64), labels: { ...labels, 'com.example.sanctuary.run-id': '123e4567-e89b-12d3-a456-426614174000' } },
  ];
  const runCommand = (_engine, args) => {
    const effective = args[0] === '--host' ? args.slice(2) : args;
    const joined = effective.join(' ');
    if (joined === 'context show') return 'default\n';
    if (joined.startsWith('context inspect default')) return JSON.stringify({
      Name: 'default', Endpoints: { docker: { Host: 'unix:///run/docker-fixture.sock', SkipTLSVerify: false } }, TLSMaterial: {}
    });
    if (joined.startsWith('version --format') || joined.startsWith('info --format')) return JSON.stringify({ authority: 'fixture' });
    if (joined.startsWith('container ls')) {
      const filters = effective.filter(value => value.startsWith('label=')).map(value => value.slice(6));
      const exact = [
        `io.sanctuary.project=${manifest.composeProjectName}`,
        `io.sanctuary.deployment-id=${manifest.deploymentId}`,
        `io.sanctuary.owner-id=${manifest.ownerId}`,
        'io.sanctuary.resource-class=compose_container'
      ].every(value => filters.includes(value));
      const foreignMatches = [
        `io.sanctuary.project=${labels['io.sanctuary.project']}`,
        `io.sanctuary.deployment-id=${labels['io.sanctuary.deployment-id']}`,
        `io.sanctuary.owner-id=foreign-owner`,
        'io.sanctuary.resource-class=compose_container'
      ].every(value => filters.includes(value));
      assert.equal(foreignMatches, false, 'the exact manifest selectors must exclude a foreign owner');
      return exact ? `${immutableId}\n${foreignCandidates.map(candidate => candidate.id).join('\n')}\n` : '';
    }
    if (joined === `container inspect ${immutableId}`) return JSON.stringify([{
      Id: immutableId, State: { Running: true }, Config: { Labels: labels }
    }]);
    const foreign = foreignCandidates.find(candidate => joined === `container inspect ${candidate.id}`);
    if (foreign) return JSON.stringify([{ Id: foreign.id, State: { Running: true }, Config: { Labels: foreign.labels } }]);
    if (joined.startsWith('network ls') || joined.startsWith('volume ls') || joined.startsWith('image ls')) return '';
    throw new Error(`unexpected fixture command ${joined}`);
  };
  const policy = { resourceClasses: [
    { classId: 'compose_container', cleanupPolicies: ['exact_delete'], dependsOn: [] },
    { classId: 'compose_network', cleanupPolicies: ['exact_delete'], dependsOn: ['compose_container'] },
    { classId: 'compose_volume', cleanupPolicies: ['exact_delete'], dependsOn: ['compose_container'] },
    { classId: 'oci_image', cleanupPolicies: ['exact_delete'], dependsOn: ['compose_container'] }
  ] };
  const inventory = await inventoryCleanupResources({
    deploymentManifest: manifest, runManifest, ownershipContract: policy, ownershipContractDigest: policyDigest,
    dockerAdapter: createDockerCleanupAdapter(), dockerOptions: { engine: 'docker', runCommand },
    readDeploymentState: () => null
  });
  assert.equal(inventory.complete, true);
  assert.deepEqual(inventory.resources.map(resource => [resource.immutableIdentity, resource.disposition]), [
    [immutableId, 'eligible'], ...foreignCandidates.map(candidate => [candidate.id, 'refused'])
  ].sort((left, right) => left[0].localeCompare(right[0])));
  for (const candidate of foreignCandidates) {
    const row = inventory.resources.find(resource => resource.immutableIdentity === candidate.id);
    assert.ok(row.failureClasses.includes('identity_changed'));
  }
  assert.deepEqual(buildCleanupPlan(inventory, policy, { policyDigest }).actions.map(action => [action.action, action.locator]), [
    ['stop', immutableId], ['remove', immutableId]
  ]);
  const plannedIds = buildCleanupPlan(inventory, policy, { policyDigest }).actions.map(action => action.locator);
  assert.deepEqual(plannedIds, [immutableId, immutableId]);
});
