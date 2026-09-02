import assert from 'node:assert/strict';
import test from 'node:test';
import { CleanupCommandError, runCleanupCommand } from '../../scripts/ownership/cleanup-command.mjs';
import {
  dockerImmutableIdentity,
  normalizeDockerSelectors,
  observeDockerResources,
} from '../../scripts/ownership/docker-observation.mjs';
import { resolveDockerDaemonContext } from '../../scripts/ownership/cleanup-execution-context.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const N = 'c'.repeat(64);
const IMAGE = `sha256:${'d'.repeat(64)}`;
const withoutPinnedContext = (args) => (args[0] === '--host' ? args.slice(2) : args);
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

function fixtureRun({
  drift = false, malformed = false, volumeIdentityDrift = false,
  safetyDrift = null, lifecycle = 'active', imageTags, imageDigests,
  imageLabels, imageContainerReferences, imageListTags, imageListDigests,
} = {}) {
  const calls = [];
  let containerLists = 0;
  let containerInspections = 0;
  let networkReferences = 0;
  let volumeReferences = 0;
  let imageReferences = 0;
  let imageInspections = 0;
  let imageWitnesses = 0;
  let volumeInspections = 0;
  function run(engine, args) {
    const effectiveArgs = withoutPinnedContext(args);
    calls.push({ engine, args, effectiveArgs });
    const joined = effectiveArgs.join(' ');
    if (joined === 'context show') return 'default\n';
    if (joined.startsWith('version --format') || joined.startsWith('info --format')) return '{"authority":"fixture"}\n';
    if (joined.startsWith('context inspect default --format')) return JSON.stringify({
      Name: 'default', Endpoints: { docker: { Host: 'unix:///run/docker-fixture.sock', SkipTLSVerify: false } },
      TLSMaterial: {},
    });
    if (joined.startsWith('container ls') && joined.includes('label=io.sanctuary.owner-id=one')) {
      containerLists += 1;
      return drift && containerLists > 1 ? `${A}\n${B}\n` : `${A}\n`;
    }
    if (joined.startsWith('container ls') && joined.includes('label=io.sanctuary.owner-id=two')) return `${B}\n`;
    if (joined.startsWith('network ls')) return `${N}\n`;
    if (joined.startsWith('volume ls')) return 'sanctuary_postgres_data\n';
    if (joined.startsWith('image ls') && joined.includes('label=io.sanctuary.build-id=')) {
      imageWitnesses += 1;
      const tags = safetyDrift === 'image_tag' && imageWitnesses > 1
        ? ['sanctuary:local', 'sanctuary:release'] : (imageListTags ?? imageTags ?? ['sanctuary:local']);
      const digests = imageListDigests ?? imageDigests ?? [];
      return [
        ...tags.map((tag) => {
          const separator = tag.lastIndexOf(':');
          return `${IMAGE}\t${tag.slice(0, separator)}\t${tag.slice(separator + 1)}\t<none>`;
        }),
        ...digests.map((digest) => {
          const separator = digest.lastIndexOf('@');
          return `${IMAGE}\t${digest.slice(0, separator)}\t<none>\t${digest.slice(separator + 1)}`;
        }),
      ].join('\n');
    }
    if (joined.startsWith('image ls')) return `${IMAGE}\n`;
    if (joined.startsWith('container ls') && joined.includes('volume=')) {
      volumeReferences += 1;
      return safetyDrift === 'volume_attachment' && volumeReferences > 1 ? `${A}\n${B}\n` : `${A}\n`;
    }
    if (joined.startsWith('container ls') && joined.includes('ancestor=')) {
      imageReferences += 1;
      if (imageContainerReferences !== undefined) return imageContainerReferences.join('\n');
      return safetyDrift === 'image_reference' && imageReferences > 1 ? `${A}\n${B}\n` : `${B}\n`;
    }
    if (joined.startsWith('container ls') && joined.includes('network=')) {
      networkReferences += 1;
      return safetyDrift === 'network_endpoint' && networkReferences > 1 ? `${A}\n${B}\n` : `${A}\n`;
    }
    if (joined === `container inspect ${A}`) {
      containerInspections += 1;
      const labels = tuple('compose_container', {
        'io.sanctuary.lifecycle': lifecycle,
        ...(safetyDrift === 'ownership_label' && containerInspections > 1
          ? { 'io.sanctuary.cleanup-policy': 'retain' } : {}),
      });
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
        ? ['sanctuary:local', 'sanctuary:release'] : (imageTags ?? ['sanctuary:local']);
      return JSON.stringify([{
        Id: IMAGE, RepoTags: tags, RepoDigests: imageDigests ?? [`sanctuary@${IMAGE}`],
        Config: { Labels: imageLabels ?? tuple('oci_image') },
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
  assert.deepEqual(network.classifications, ['legacy_unlabeled', 'protected', 'unlabeled']);
  assert.deepEqual(network.runtime.dependencyIdentities, [A]);
  const volume = result.resources.find((row) => row.resourceClass === 'compose_volume');
  assert.ok(volume.classifications.includes('data'));
  assert.ok(volume.classifications.includes('registered'));
  assert.ok(volume.classifications.includes('protected'));
  assert.match(volume.immutableIdentity, /^[a-f0-9]{64}$/);
  const image = result.resources.find((row) => row.resourceClass === 'oci_image');
  assert.equal(image.classifications.includes('shared'), false);
  assert.equal(image.classifications.includes('referenced'), false);
  assert.deepEqual(image.runtime.dependencyIdentities, [B]);
  assert.deepEqual(image.runtime.references, ['sanctuary:local', `sanctuary@${IMAGE}`]);
  assert.deepEqual(image.runtime.contentDigests, ['d'.repeat(64)]);
  const builder = result.resources.find((row) => row.resourceClass === 'buildkit_cache');
  assert.deepEqual(builder.classifications, ['default_builder', 'protected', 'registered', 'shared']);
  const firstList = fixture.calls.find((call) => call.effectiveArgs[0] === 'container'
    && call.effectiveArgs.includes('label=io.sanctuary.owner-id=one'));
  assert.deepEqual(firstList.args.slice(0, 2), ['--host', 'unix:///run/docker-fixture.sock']);
  assert.ok(firstList.effectiveArgs.includes('label=io.sanctuary.project=sanctuary'));
  assert.ok(firstList.effectiveArgs.includes('label=io.sanctuary.resource-class=compose_container'));
});

test('one exclusive witness registration converts only its exact legacy container to cleanup authority', () => {
  const fixture = fixtureRun();
  const witness = 'f'.repeat(64);
  const result = observeDockerResources({
    selectors: { compose_container: selectors.compose_container }, runCommand: fixture.run,
    legacyFixtureWitnessDigest: witness,
    registrations: [{
      registrationId: '1'.repeat(64), signerKeyId: '2'.repeat(64), metadataDigest: witness,
      deploymentId: 'deploy-fixture', ownerId: 'owner-fixture', operationRunId: 'run-fixture',
      resourceClass: 'compose_container', immutableIdentity: B, locatorKind: 'engine_id',
      locator: B, lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
      referenceIds: ['run-fixture'], createdAt: '2026-08-31T00:00:00.000Z',
      createdByRelease: 'unreleased', createdByCommit: 'e'.repeat(40),
    }],
  });
  const owned = result.resources.find((row) => row.immutableIdentity === A);
  const witnessed = result.resources.find((row) => row.immutableIdentity === B);
  assert.equal(owned.classifications.includes('externally_registered'), false);
  assert.deepEqual(witnessed.classifications,
    ['externally_registered', 'legacy_unlabeled', 'unlabeled']);
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

test('daemon drift reports only the changed authority field name', () => {
  let infoCalls = 0;
  const result = observeDockerResources({
    runCommand(_engine, args) {
      const effectiveArgs = withoutPinnedContext(args);
      const joined = effectiveArgs.join(' ');
      if (joined === 'context show') return 'default\n';
      if (joined.startsWith('context inspect default --format')) return JSON.stringify({
        Name: 'default',
        Endpoints: { docker: { Host: 'unix:///run/docker-fixture.sock', SkipTLSVerify: false } },
        TLSMaterial: {},
      });
      if (joined.startsWith('version --format')) return JSON.stringify({ Server: { Version: '29.0.0' } });
      if (joined.startsWith('info --format')) {
        infoCalls += 1;
        return JSON.stringify({ DockerRootDir: `/private/daemon-${infoCalls}` });
      }
      throw new Error(`unexpected command: ${joined}`);
    },
  });
  assert.equal(result.complete, false);
  assert.equal(result.ambiguities[0].operation, 'Docker daemon/context authority (info.DockerRootDir)');
  assert.doesNotMatch(JSON.stringify(result), /private-daemon/);
});

test('top-level daemon ID churn is non-authoritative but stale authority policy is refused', () => {
  const fixture = fixtureRun();
  let infoCalls = 0;
  const runCommand = (engine, args, options) => {
    const effectiveArgs = withoutPinnedContext(args);
    if (effectiveArgs[0] === 'info') {
      infoCalls += 1;
      return JSON.stringify({ ID: `request-${infoCalls}`, DockerRootDir: '/var/lib/docker' });
    }
    return fixture.run(engine, args, options);
  };
  const stable = observeDockerResources({ runCommand });
  assert.equal(stable.complete, true);
  assert.ok(infoCalls >= 3);
  const authority = resolveDockerDaemonContext({ runCommand });
  const stale = observeDockerResources({
    runCommand, daemonAuthority: { ...authority, daemonAuthorityPolicy: 'legacy.v1' },
  });
  assert.equal(stale.complete, false);
  assert.equal(stale.ambiguities[0].category, 'identity_changed');
  assert.equal(stale.resources.length, 0);
});

test('container observations reject missing or non-boolean running state as malformed', () => {
  for (const running of [undefined, 'false', null, 0]) {
    const fixture = fixtureRun();
    const result = observeDockerResources({
      selectors: { compose_container: selectors.compose_container.slice(0, 1) },
      runCommand(executable, args, options) {
        const output = fixture.run(executable, args, options);
        const effectiveArgs = withoutPinnedContext(args);
        if (effectiveArgs[0] !== 'container' || effectiveArgs[1] !== 'inspect') return output;
        const parsed = JSON.parse(output);
        if (running === undefined) delete parsed[0].State.Running;
        else parsed[0].State.Running = running;
        return JSON.stringify(parsed);
      },
    });
    assert.equal(result.complete, false, String(running));
    assert.equal(result.resources.length, 0, String(running));
    assert.ok(result.ambiguities.every((entry) => entry.category === 'malformed_output'), String(running));
  }
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
  const fixture = fixtureRun({ lifecycle: 'obsolete' });
  const result = observeDockerResources({
    selectors: { compose_container: selectors.compose_container.slice(0, 1) }, runCommand: fixture.run,
  });
  assert.deepEqual(result.resources[0].classifications, ['owned', 'running']);
});

test('active lifecycle ownership is current even without a coarse deployment selector', () => {
  const fixture = fixtureRun();
  const result = observeDockerResources({
    selectors: { compose_container: selectors.compose_container.slice(0, 1) }, runCommand: fixture.run,
  });
  assert.deepEqual(result.resources[0].classifications, ['current', 'owned', 'protected', 'running']);
});

test('shared lifecycle ownership is protected without relying on registration fanout', () => {
  const fixture = fixtureRun({ lifecycle: 'shared' });
  const result = observeDockerResources({
    selectors: { compose_container: selectors.compose_container.slice(0, 1) }, runCommand: fixture.run,
  });
  assert.deepEqual(result.resources[0].classifications, ['owned', 'protected', 'running', 'shared']);
});

test('invalid ownership label values are categorical malformed rows, not schema crashes', () => {
  const fixture = fixtureRun();
  const originalRun = fixture.run;
  const result = observeDockerResources({
    selectors: { compose_container: selectors.compose_container.slice(0, 1) },
    runCommand(executable, args, options) {
      const output = originalRun(executable, args, options);
      const effectiveArgs = withoutPinnedContext(args);
      if (effectiveArgs[0] !== 'container' || effectiveArgs[1] !== 'inspect') return output;
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
      const effectiveArgs = withoutPinnedContext(args);
      if (effectiveArgs[0] !== 'image' || effectiveArgs[1] !== 'inspect') return output;
      const parsed = JSON.parse(output);
      parsed[0].RepoDigests = 'not-an-array';
      return JSON.stringify(parsed);
    },
  });
  assert.equal(result.complete, false);
  assert.equal(result.ambiguities[0].category, 'malformed_output');
  assert.equal(result.resources.length, 0);
});

function replayImageRegistration(labels, extra = {}) {
  return {
    registrationId: '1'.repeat(64), signerKeyId: '2'.repeat(64), metadataDigest: '3'.repeat(64),
    deploymentId: labels['io.sanctuary.deployment-id'],
    operationRunId: labels['io.sanctuary.creation-run-id'],
    ownerId: labels['io.sanctuary.owner-id'], resourceClass: 'oci_image',
    lifecycle: labels['io.sanctuary.lifecycle'], cleanupPolicy: labels['io.sanctuary.cleanup-policy'],
    createdAt: labels['io.sanctuary.created-at'],
    createdByRelease: labels['io.sanctuary.created-by-release'],
    createdByCommit: labels['io.sanctuary.created-by-commit'],
    locatorKind: 'reference', locator: 'wallet-sync-replay:test', immutableIdentity: IMAGE,
    referenceIds: [labels['io.sanctuary.creation-run-id']], ...extra,
  };
}

function replayImageProvenance(extra = {}) {
  return {
    'org.opencontainers.image.source': 'https://github.com/nekoguntai-castle/sanctuary',
    'org.opencontainers.image.version': '0.8.69',
    'org.opencontainers.image.revision': '9'.repeat(40),
    'io.sanctuary.build-id': 'build-lane-run',
    'dev.sanctuary.image-lock-sha256': '8'.repeat(64),
    ...extra,
  };
}

test('one exact consuming-lane registration admits provenance-only replay bytes by immutable ID', () => {
  const authority = tuple('oci_image', {
    'io.sanctuary.deployment-id': 'replay-live-deployment',
    'io.sanctuary.owner-id': 'replay-live-owner',
    'io.sanctuary.lifecycle': 'obsolete',
    'io.sanctuary.creation-run-id': 'replay-live-run',
  });
  const fixture = fixtureRun({
    imageTags: ['wallet-sync-replay:test'], imageDigests: [], imageLabels: replayImageProvenance(),
    imageContainerReferences: [],
  });
  const result = observeDockerResources({
    selectors: { oci_image: [{ reference: 'wallet-sync-replay:test' }] },
    registrations: [replayImageRegistration(authority)], runCommand: fixture.run,
  });
  assert.equal(result.complete, true);
  assert.equal(result.resources[0].locator, IMAGE);
  assert.deepEqual(result.resources[0].classifications, [
    'externally_registered', 'registered', 'unlabeled',
  ]);
});

test('Compose-added image labels do not invalidate exact provenance registration', () => {
  const authority = tuple('oci_image', {
    'io.sanctuary.deployment-id': 'replay-live-deployment',
    'io.sanctuary.owner-id': 'replay-live-owner',
    'io.sanctuary.lifecycle': 'obsolete',
    'io.sanctuary.creation-run-id': 'replay-live-run',
  });
  const fixture = fixtureRun({
    imageTags: ['wallet-sync-replay:test'], imageDigests: [],
    imageLabels: {
      ...replayImageProvenance(),
      'com.docker.compose.project': 'replay-live-project',
      'com.docker.compose.service': 'backend',
    },
    imageContainerReferences: [],
  });
  const result = observeDockerResources({
    selectors: { oci_image: [{ reference: 'wallet-sync-replay:test' }] },
    registrations: [replayImageRegistration(authority)], runCommand: fixture.run,
  });
  assert.deepEqual(result.resources[0].classifications, [
    'externally_registered', 'legacy_unlabeled', 'registered', 'unlabeled',
  ]);
});

test('stable image-list evidence supplies references omitted by image inspect', () => {
  const authority = tuple('oci_image', {
    'io.sanctuary.deployment-id': 'replay-live-deployment',
    'io.sanctuary.owner-id': 'replay-live-owner',
    'io.sanctuary.lifecycle': 'obsolete',
    'io.sanctuary.creation-run-id': 'replay-live-run',
  });
  const fixture = fixtureRun({
    imageTags: [], imageDigests: [], imageListTags: ['wallet-sync-replay:test'],
    imageLabels: replayImageProvenance(), imageContainerReferences: [],
  });
  const result = observeDockerResources({
    selectors: { oci_image: [{ reference: 'wallet-sync-replay:test' }] },
    registrations: [replayImageRegistration(authority)], runCommand: fixture.run,
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.resources[0].runtime.tags, ['wallet-sync-replay:test']);
  assert.deepEqual(result.resources[0].classifications, [
    'externally_registered', 'registered', 'unlabeled',
  ]);

  const aliased = observeDockerResources({
    selectors: { oci_image: [{ reference: 'wallet-sync-replay:test' }] },
    registrations: [replayImageRegistration(authority)],
    runCommand: fixtureRun({
      imageTags: [], imageDigests: [],
      imageListTags: ['wallet-sync-replay:test', 'shared:keep'],
      imageLabels: replayImageProvenance(), imageContainerReferences: [],
    }).run,
  });
  assert.ok(aliased.resources[0].classifications.includes('protected'));
  assert.ok(!aliased.resources[0].classifications.includes('externally_registered'));
});

test('one same-repository Podman digest is intrinsic to the sole registered tag', () => {
  const authority = tuple('oci_image', {
    'io.sanctuary.deployment-id': 'replay-live-deployment',
    'io.sanctuary.owner-id': 'replay-live-owner',
    'io.sanctuary.lifecycle': 'obsolete',
    'io.sanctuary.creation-run-id': 'replay-live-run',
  });
  const fixture = fixtureRun({
    imageTags: ['wallet-sync-replay:test'],
    imageDigests: [`wallet-sync-replay@${IMAGE}`],
    imageLabels: replayImageProvenance(), imageContainerReferences: [],
  });
  const result = observeDockerResources({
    selectors: { oci_image: [{ reference: 'wallet-sync-replay:test' }] },
    registrations: [replayImageRegistration(authority)], runCommand: fixture.run,
  });
  assert.deepEqual(result.resources[0].classifications, [
    'externally_registered', 'registered', 'unlabeled',
  ]);
});

test('one exact engine-ID registration admits only a truly dangling provenance image', () => {
  const authority = tuple('oci_image', {
    'io.sanctuary.deployment-id': 'dangling-live-deployment',
    'io.sanctuary.owner-id': 'dangling-live-owner',
    'io.sanctuary.lifecycle': 'obsolete',
    'io.sanctuary.creation-run-id': 'dangling-live-run',
  });
  const registration = replayImageRegistration(authority, {
    locatorKind: 'engine_id', locator: IMAGE,
  });
  const result = observeDockerResources({
    selectors: { oci_image: [{ locator: IMAGE }] }, registrations: [registration],
    runCommand: fixtureRun({
      imageTags: [], imageDigests: [], imageLabels: replayImageProvenance(),
      imageContainerReferences: [],
    }).run,
  });
  assert.deepEqual(result.resources[0].classifications, [
    'externally_registered', 'registered', 'unlabeled',
  ]);

  for (const item of [
    { name: 'tagged', imageTags: ['unexpected:tag'], imageDigests: [] },
    { name: 'digest-referenced', imageTags: [], imageDigests: [`unexpected@${IMAGE}`] },
  ]) {
    const protectedResult = observeDockerResources({
      selectors: { oci_image: [{ locator: IMAGE }] }, registrations: [registration],
      runCommand: fixtureRun({
        ...item, imageLabels: replayImageProvenance(), imageContainerReferences: [],
      }).run,
    });
    assert.ok(protectedResult.resources[0].classifications.includes('protected'), item.name);
  }
});

test('replay image content remains protected when any reference or ownership proof is extra', () => {
  const authority = tuple('oci_image', { 'io.sanctuary.lifecycle': 'obsolete' });
  const cases = [
    { name: 'tag', fixture: { imageTags: ['wallet-sync-replay:test', 'shared:latest'], imageDigests: [], imageContainerReferences: [] } },
    { name: 'digest', fixture: { imageTags: ['wallet-sync-replay:test'], imageDigests: [`shared@${IMAGE}`], imageContainerReferences: [] } },
    { name: 'provenance', fixture: { imageTags: ['wallet-sync-replay:test'], imageDigests: [], imageContainerReferences: [], imageLabels: replayImageProvenance({ 'org.opencontainers.image.revision': 'invalid' }) } },
    { name: 'runtime ownership', fixture: { imageTags: ['wallet-sync-replay:test'], imageDigests: [], imageContainerReferences: [], imageLabels: tuple('oci_image', { 'io.sanctuary.lifecycle': 'obsolete' }) } },
  ];
  for (const item of cases) {
    const fixture = fixtureRun({ imageLabels: replayImageProvenance(), ...item.fixture });
    const result = observeDockerResources({
      selectors: { oci_image: [{ reference: 'wallet-sync-replay:test' }] },
      registrations: [replayImageRegistration(authority)], runCommand: fixture.run,
    });
    assert.equal(result.complete, true, item.name);
    assert.ok(result.resources[0].classifications.includes('protected'), item.name);
  }
  const sharedFixture = fixtureRun({
    imageTags: ['wallet-sync-replay:test'], imageDigests: [], imageLabels: replayImageProvenance(),
    imageContainerReferences: [],
  });
  const first = replayImageRegistration(authority);
  const shared = observeDockerResources({
    selectors: { oci_image: [{ reference: 'wallet-sync-replay:test' }] },
    registrations: [first, {
      ...first, registrationId: '4'.repeat(64), operationRunId: 'other-run',
      referenceIds: ['other-run'],
    }],
    runCommand: sharedFixture.run,
  });
  assert.ok(shared.resources[0].classifications.includes('shared'));
  assert.ok(shared.resources[0].classifications.includes('protected'));
  const duplicateAuthority = observeDockerResources({
    selectors: { oci_image: [{ reference: 'wallet-sync-replay:test' }] },
    registrations: [first, {
      ...first, registrationId: '5'.repeat(64), locator: 'removed-extra:test',
    }],
    runCommand: fixtureRun({
      imageTags: ['wallet-sync-replay:test'], imageDigests: [], imageLabels: replayImageProvenance(),
      imageContainerReferences: [],
    }).run,
  });
  assert.ok(duplicateAuthority.resources[0].classifications.includes('protected'));
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
  assert.equal(dockerImmutableIdentity('oci_image', { Id: IMAGE.slice('sha256:'.length) }), IMAGE);
});
