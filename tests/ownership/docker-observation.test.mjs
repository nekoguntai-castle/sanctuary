import assert from 'node:assert/strict';
import test from 'node:test';
import { CleanupCommandError, runCleanupCommand } from '../../scripts/ownership/cleanup-command.mjs';
import {
  dockerImmutableIdentity,
  normalizeDockerSelectors,
  observeDockerResources,
} from '../../scripts/ownership/docker-observation.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const N = 'c'.repeat(64);
const IMAGE = `sha256:${'d'.repeat(64)}`;
const tuple = (resourceClass, extra = {}) => ({
  'io.sanctuary.project': 'sanctuary',
  'io.sanctuary.deployment-id': 'deploy-current',
  'io.sanctuary.owner-id': 'operator',
  'io.sanctuary.resource-class': resourceClass,
  'io.sanctuary.lifecycle': 'active',
  'io.sanctuary.cleanup-policy': 'exact_delete',
  'io.sanctuary.created-at': '2026-08-31T00:00:00.000Z',
  'io.sanctuary.created-by-release': 'unreleased',
  'io.sanctuary.created-by-commit': 'e'.repeat(40),
  'io.sanctuary.creation-run-id': 'run-fixture',
  ...extra,
});

function fixtureRun({ drift = false, malformed = false, volumeIdentityDrift = false, safetyDrift = null } = {}) {
  const calls = [];
  let containerLists = 0;
  let containerInspections = 0;
  let networkReferences = 0;
  let volumeReferences = 0;
  let imageReferences = 0;
  let imageInspections = 0;
  let volumeInspections = 0;
  function run(engine, args) {
    calls.push({ engine, args });
    const joined = args.join(' ');
    if (joined.startsWith('container ls') && joined.includes('label=io.sanctuary.owner-id=one')) {
      containerLists += 1;
      return drift && containerLists > 1 ? `${A}\n${B}\n` : `${A}\n`;
    }
    if (joined.startsWith('container ls') && joined.includes('label=io.sanctuary.owner-id=two')) return `${B}\n`;
    if (joined.startsWith('network ls')) return `${N}\n`;
    if (joined.startsWith('volume ls')) return 'sanctuary_postgres_data\n';
    if (joined.startsWith('image ls')) return `${IMAGE}\n`;
    if (joined.startsWith('container ls') && joined.includes('volume=')) {
      volumeReferences += 1;
      return safetyDrift === 'volume_attachment' && volumeReferences > 1 ? `${A}\n${B}\n` : `${A}\n`;
    }
    if (joined.startsWith('container ls') && joined.includes('ancestor=')) {
      imageReferences += 1;
      return safetyDrift === 'image_reference' && imageReferences > 1 ? `${A}\n${B}\n` : `${B}\n`;
    }
    if (joined.startsWith('container ls') && joined.includes('network=')) {
      networkReferences += 1;
      return safetyDrift === 'network_endpoint' && networkReferences > 1 ? `${A}\n${B}\n` : `${A}\n`;
    }
    if (joined === `container inspect ${A}`) {
      containerInspections += 1;
      const labels = tuple('compose_container', safetyDrift === 'ownership_label' && containerInspections > 1
        ? { 'io.sanctuary.cleanup-policy': 'retain' } : {});
      return malformed ? '{' : JSON.stringify([{ Id: A, State: { Running: true }, Config: { Labels: labels } }]);
    }
    if (joined === `container inspect ${B}`) return JSON.stringify([{ Id: B, State: { Running: false }, Config: { Labels: { 'com.docker.compose.project': 'sanctuary', 'com.docker.compose.service': 'old' } } }]);
    if (joined === `network inspect ${N}`) return JSON.stringify([{ Id: N, Containers: { [A]: {} }, Labels: { 'com.docker.compose.project': 'sanctuary', 'com.docker.compose.network': 'default' } }]);
    if (joined === 'volume inspect sanctuary_postgres_data') {
      volumeInspections += 1;
      return JSON.stringify([{
      Name: 'sanctuary_postgres_data', Driver: 'local', Scope: 'local',
      Mountpoint: volumeIdentityDrift && volumeInspections > 1 ? '/replacement/_data' : '/var/lib/docker/volumes/data/_data', CreatedAt: '2026-08-31T00:00:00Z',
      Options: {}, Labels: tuple('compose_volume', { 'io.sanctuary.cleanup-policy': 'preserve_ambiguous' }),
      }]);
    }
    if (joined === `image inspect ${IMAGE}`) {
      imageInspections += 1;
      const tags = safetyDrift === 'image_tag' && imageInspections > 1
        ? ['sanctuary:local', 'sanctuary:release'] : ['sanctuary:local'];
      return JSON.stringify([{
        Id: IMAGE, RepoTags: tags, RepoDigests: [`sanctuary@${IMAGE}`], Config: { Labels: tuple('oci_image') },
      }]);
    }
    if (joined === 'buildx inspect default') return 'Name: default\nDriver: docker\n';
    throw new Error(`unexpected fixture command: ${engine} ${joined}`);
  }
  return { calls, run };
}

const selectors = {
  compose_container: [
    { labels: tuple('compose_container', { 'io.sanctuary.owner-id': 'one' }) },
    { labels: tuple('compose_container', { 'io.sanctuary.owner-id': 'two' }) },
  ],
  compose_network: [{ locator: N }],
  compose_volume: [{ locator: 'sanctuary_postgres_data' }],
  oci_image: [{ reference: 'sanctuary:test-local' }],
  buildkit_cache: [{ builder: 'default' }],
};

test('exact selectors are unioned, inspections retain immutable IDs, and safety states are classified', () => {
  const fixture = fixtureRun();
  const result = observeDockerResources({
    selectors, runCommand: fixture.run, currentDeploymentId: 'deploy-current',
    dataVolumeNames: ['sanctuary_postgres_data'], registrations: [
      { resourceClass: 'buildkit_cache', immutableIdentity: 'default', default: true, dedicated: false },
      { resourceClass: 'compose_volume', immutableIdentity: dockerImmutableIdentity('compose_volume', {
        Name: 'sanctuary_postgres_data', Driver: 'local', Scope: 'local',
        Mountpoint: '/var/lib/docker/volumes/data/_data', CreatedAt: '2026-08-31T00:00:00Z', Options: {},
      }), locator: 'sanctuary_postgres_data', operationRunId: 'create-volume' },
      { resourceClass: 'oci_image', immutableIdentity: IMAGE, locator: IMAGE, operationRunId: 'build-image' },
    ],
  });
  assert.equal(result.complete, true);
  assert.equal(result.resources.length, 6);
  assert.deepEqual(result.resources.filter((row) => row.resourceClass === 'compose_container').map((row) => row.immutableIdentity), [A, B]);
  const owned = result.resources.find((row) => row.immutableIdentity === A);
  assert.deepEqual(owned.classifications, ['current', 'owned', 'protected', 'running']);
  const legacy = result.resources.find((row) => row.immutableIdentity === B);
  assert.deepEqual(legacy.classifications, ['legacy_unlabeled', 'protected', 'unlabeled']);
  const network = result.resources.find((row) => row.resourceClass === 'compose_network');
  assert.deepEqual(network.classifications, ['legacy_unlabeled', 'protected', 'shared', 'unlabeled']);
  const volume = result.resources.find((row) => row.resourceClass === 'compose_volume');
  assert.ok(volume.classifications.includes('data'));
  assert.ok(volume.classifications.includes('registered'));
  assert.ok(volume.classifications.includes('protected'));
  assert.match(volume.immutableIdentity, /^[a-f0-9]{64}$/);
  const image = result.resources.find((row) => row.resourceClass === 'oci_image');
  assert.ok(image.classifications.includes('shared'));
  assert.ok(image.classifications.includes('referenced'));
  assert.deepEqual(image.runtime.references, ['sanctuary:local', `sanctuary@${IMAGE}`]);
  assert.deepEqual(image.runtime.contentDigests, ['d'.repeat(64)]);
  const builder = result.resources.find((row) => row.resourceClass === 'buildkit_cache');
  assert.deepEqual(builder.classifications, ['default_builder', 'protected', 'registered', 'shared']);
  const firstList = fixture.calls.find((call) => call.args[0] === 'container' && call.args.includes('label=io.sanctuary.owner-id=one'));
  assert.ok(firstList.args.includes('label=io.sanctuary.project=sanctuary'));
  assert.ok(firstList.args.includes('label=io.sanctuary.resource-class=compose_container'));
});

test('list-inspect-relist drift and malformed output become categorical ambiguity', () => {
  const drift = fixtureRun({ drift: true });
  const drifted = observeDockerResources({ selectors: { compose_container: selectors.compose_container.slice(0, 1) }, runCommand: drift.run });
  assert.equal(drifted.complete, false);
  assert.deepEqual(drifted.ambiguities.map((entry) => entry.category), ['inventory_drift']);

  const malformed = fixtureRun({ malformed: true });
  const ambiguous = observeDockerResources({ selectors: { compose_container: selectors.compose_container.slice(0, 1) }, runCommand: malformed.run });
  assert.equal(ambiguous.complete, false);
  assert.equal(ambiguous.ambiguities[0].category, 'malformed_output');
});

test('query failures stay categorical instead of becoming empty inventories', () => {
  const result = observeDockerResources({
    selectors: { compose_network: [{ locator: N }] },
    runCommand() { throw new CleanupCommandError('permission_denied', 'compose_network list'); },
  });
  assert.equal(result.complete, false);
  assert.equal(result.resources.length, 0);
  assert.equal(result.ambiguities[0].category, 'permission_denied');
});

test('a running container from a non-current exact-delete run remains observable as eligible', () => {
  const fixture = fixtureRun();
  const result = observeDockerResources({
    selectors: { compose_container: selectors.compose_container.slice(0, 1) }, runCommand: fixture.run,
  });
  assert.deepEqual(result.resources[0].classifications, ['owned', 'running']);
});

test('invalid ownership label values are categorical malformed rows, not schema crashes', () => {
  const fixture = fixtureRun();
  const originalRun = fixture.run;
  const result = observeDockerResources({
    selectors: { compose_container: selectors.compose_container.slice(0, 1) },
    runCommand(executable, args, options) {
      const output = originalRun(executable, args, options);
      if (args[0] !== 'container' || args[1] !== 'inspect') return output;
      const parsed = JSON.parse(output);
      parsed[0].Config.Labels['io.sanctuary.created-by-commit'] = 'not-a-commit';
      return JSON.stringify(parsed);
    },
  });
  assert.equal(result.resources[0].ownershipState, 'malformed');
  assert.ok(result.resources[0].classifications.includes('protected'));
});

test('JSON-valid malformed image reference fields become categorical ambiguity', () => {
  const fixture = fixtureRun();
  const result = observeDockerResources({
    selectors: { oci_image: selectors.oci_image },
    registrations: [{ resourceClass: 'oci_image', immutableIdentity: IMAGE, locator: IMAGE, operationRunId: 'run' }],
    runCommand(executable, args, options) {
      const output = fixture.run(executable, args, options);
      if (args[0] !== 'image' || args[1] !== 'inspect') return output;
      const parsed = JSON.parse(output);
      parsed[0].RepoDigests = 'not-an-array';
      return JSON.stringify(parsed);
    },
  });
  assert.equal(result.complete, false);
  assert.equal(result.ambiguities[0].category, 'malformed_output');
  assert.equal(result.resources.length, 0);
});

test('volume fingerprints without an exact nonce-bearing registration remain protected', () => {
  const fixture = fixtureRun();
  const result = observeDockerResources({
    selectors: { compose_volume: [{ locator: 'sanctuary_postgres_data' }] }, runCommand: fixture.run,
    registrations: [{ resourceClass: 'compose_volume', immutableIdentity: 'wrong', locator: 'sanctuary_postgres_data', operationRunId: 'run' }],
  });
  assert.equal(result.complete, true);
  assert.ok(result.resources[0].classifications.includes('unregistered'));
  assert.ok(result.resources[0].classifications.includes('protected'));
});

test('same-name volume replacement during relist is immutable-identity drift', () => {
  const fixture = fixtureRun({ volumeIdentityDrift: true });
  const result = observeDockerResources({
    selectors: { compose_volume: [{ locator: 'sanctuary_postgres_data' }] }, runCommand: fixture.run,
  });
  assert.equal(result.complete, false);
  assert.equal(result.ambiguities[0].category, 'identity_changed');
});

test('stable IDs cannot hide concurrent label, attachment, endpoint, or image-reference changes', () => {
  for (const [safetyDrift, selected] of [
    ['ownership_label', { compose_container: selectors.compose_container.slice(0, 1) }],
    ['network_endpoint', { compose_network: selectors.compose_network }],
    ['volume_attachment', { compose_volume: selectors.compose_volume }],
    ['image_reference', { oci_image: selectors.oci_image }],
    ['image_tag', { oci_image: selectors.oci_image }],
  ]) {
    const fixture = fixtureRun({ safetyDrift });
    const result = observeDockerResources({ selectors: selected, runCommand: fixture.run });
    assert.equal(result.complete, false, safetyDrift);
    assert.equal(result.ambiguities[0].category, 'inventory_drift', safetyDrift);
  }
});

test('bounded command runner enforces timeout and output caps without a shell', () => {
  assert.throws(
    () => runCleanupCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 25 }),
    (error) => error.category === 'timeout',
  );
  assert.throws(
    () => runCleanupCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(4096))"], { maxOutputBytes: 128 }),
    (error) => error.category === 'output_limit',
  );
});

test('selector validation rejects intersected kinds and wrong resource kinds', () => {
  assert.throws(() => normalizeDockerSelectors({ compose_container: [{ locator: A, labels: { a: 'b' } }] }), /exactly one/);
  assert.throws(() => normalizeDockerSelectors({ buildkit_cache: [{ locator: 'default' }] }), /not a valid/);
  assert.throws(() => normalizeDockerSelectors({ compose_container: [{ labels: { 'io.sanctuary.project': 'too-broad' } }] }), /complete ownership tuple/);
  assert.throws(() => normalizeDockerSelectors({ oci_image: [{ reference: 'sanctuary:*' }] }), /exact tag or digest/);
  assert.throws(() => dockerImmutableIdentity('compose_container', { Id: 'mutable-name' }), /immutable ID/);
});
