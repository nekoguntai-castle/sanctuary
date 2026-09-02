import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tupleKeys = [
  'io.sanctuary.project',
  'io.sanctuary.deployment-id',
  'io.sanctuary.owner-id',
  'io.sanctuary.resource-class',
  'io.sanctuary.lifecycle',
  'io.sanctuary.cleanup-policy',
  'io.sanctuary.created-at',
  'io.sanctuary.created-by-release',
  'io.sanctuary.created-by-commit',
  'io.sanctuary.creation-run-id',
];

const dockerfiles = [
  'server/Dockerfile',
  'gateway/Dockerfile',
  'llm-egress-proxy/Dockerfile',
  'docker/frontend/Dockerfile',
  'docker/grafana-migration/Dockerfile',
];

function composeConfig(...files) {
  const args = ['compose', '--project-directory', root];
  for (const file of files) args.push('-f', resolve(root, file));
  args.push('config', '--no-interpolate', '--format', 'json');
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertOwnership(labels, resourceClass, cleanupPolicy) {
  assert.ok(labels, 'resource must have ownership labels');
  for (const key of tupleKeys) assert.ok(key in labels, `missing ${key}`);
  assert.equal(labels['io.sanctuary.resource-class'], resourceClass);
  const declaredPolicy = labels['io.sanctuary.cleanup-policy'];
  const semanticPolicy = declaredPolicy === '${SANCTUARY_VOLUME_CLEANUP_POLICY:-preserve_ambiguous}'
    ? 'preserve_ambiguous'
    : declaredPolicy;
  assert.equal(semanticPolicy, cleanupPolicy);
}

function assertResources(config, section, resourceClass, cleanupPolicy) {
  for (const [name, resource] of Object.entries(config[section] ?? {})) {
    assertOwnership(resource.labels, resourceClass, cleanupPolicy);
    assert.ok(name, 'resource name is present');
  }
}

test('base Compose stamps the full ownership tuple on created resources', () => {
  const config = composeConfig('docker-compose.yml');
  assertResources(config, 'services', 'compose_container', 'exact_delete');
  assertResources(config, 'networks', 'compose_network', 'exact_delete');
  assertResources(config, 'volumes', 'compose_volume', 'preserve_ambiguous');
});

test('monitoring and Tor resources retain labels through offline overlays', () => {
  const monitoring = composeConfig(
    'docker-compose.yml',
    'docker/compose/monitoring.yml',
    'docker/compose/offline-monitoring.yml',
  );
  assertResources(monitoring, 'services', 'compose_container', 'exact_delete');
  assertResources(monitoring, 'networks', 'compose_network', 'exact_delete');
  assertResources(monitoring, 'volumes', 'compose_volume', 'preserve_ambiguous');

  const tor = composeConfig(
    'docker-compose.yml',
    'docker/compose/tor.yml',
    'docker/compose/offline-tor.yml',
  );
  assertResources(tor, 'services', 'compose_container', 'exact_delete');
  assertResources(tor, 'networks', 'compose_network', 'exact_delete');
  assertResources(tor, 'volumes', 'compose_volume', 'preserve_ambiguous');
});

test('production, SSL, and offline-core overlays preserve base ownership labels', () => {
  for (const overlay of ['prod.yml', 'ssl.yml', 'offline-core.yml']) {
    const config = composeConfig('docker-compose.yml', `docker/compose/${overlay}`);
    assertResources(config, 'services', 'compose_container', 'exact_delete');
    assertResources(config, 'networks', 'compose_network', 'exact_delete');
    assertResources(config, 'volumes', 'compose_volume', 'preserve_ambiguous');
  }
});

test('test Compose stamps ephemeral container and network ownership', () => {
  const config = composeConfig('docker/compose/test.yml');
  assertResources(config, 'services', 'compose_container', 'exact_delete');
  assertResources(config, 'networks', 'compose_network', 'exact_delete');
});

test('production images carry immutable provenance but no runtime ownership', async () => {
  const forbiddenRuntimeLabels = [
    'io.sanctuary.deployment-id',
    'io.sanctuary.owner-id',
    'io.sanctuary.cleanup-policy',
    'io.sanctuary.creation-run-id',
  ];
  for (const dockerfile of dockerfiles) {
    const source = await readFile(resolve(root, dockerfile), 'utf8');
    assert.match(source, /org\.opencontainers\.image\.source=/);
    assert.match(source, /org\.opencontainers\.image\.version=/);
    assert.match(source, /org\.opencontainers\.image\.revision=/);
    assert.match(source, /io\.sanctuary\.build-id=/);
    for (const label of forbiddenRuntimeLabels) assert.doesNotMatch(source, new RegExp(label));
  }
});

test('production Dockerfiles reject empty and unknown release build identity', async () => {
  for (const dockerfile of dockerfiles) {
    const source = await readFile(resolve(root, dockerfile), 'utf8');
    for (const arg of [
      'SANCTUARY_SOURCE_COMMIT',
      'SANCTUARY_IMAGE_LOCK_SHA256',
      'SANCTUARY_BUILD_VERSION',
      'SANCTUARY_BUILD_ID',
    ]) {
      assert.match(source, new RegExp(`test -n "\\$${arg}"`), `${dockerfile} accepts an empty ${arg}`);
      assert.match(
        source,
        new RegExp(`test "\\$${arg}" != unknown`),
        `${dockerfile} accepts unknown ${arg}`,
      );
    }
  }
});
