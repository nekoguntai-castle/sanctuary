import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import {
  buildOperatorRecoveryObservation,
  discoverComposeProjectFromDocker,
  observeOperatorRecoveryAction,
  operatorRecoverySelectors,
  verifyOperatorRecoveryClosed,
} from '../../scripts/ownership/operator-recovery-observer.mjs';

const target = Object.freeze({
  project: 'ci-1-fresh-install',
  deploymentId: 'ci-1-fresh-install-deploy',
  ownerId: 'ci-1-fresh-install-owner',
});

function resource(resourceClass, locator, immutableIdentity, overrides = {}) {
  const labels = {
    'com.docker.compose.project': target.project,
    'io.sanctuary.project': target.project,
    'io.sanctuary.deployment-id': target.deploymentId,
    'io.sanctuary.owner-id': target.ownerId,
    'io.sanctuary.resource-class': resourceClass,
    'io.sanctuary.lifecycle': 'obsolete',
    'io.sanctuary.cleanup-policy': 'exact_delete',
    'io.sanctuary.created-at': '2026-09-02T00:00:00.000Z',
    'io.sanctuary.created-by-release': 'unreleased',
    'io.sanctuary.created-by-commit': 'a'.repeat(40),
    'io.sanctuary.creation-run-id': 'ci-1-cleanup',
  };
  return {
    resourceClass, locator, immutableIdentity, labels, ownershipState: 'owned',
    classifications: resourceClass === 'compose_volume'
      ? ['owned', 'protected', 'unregistered'] : ['owned'],
    runtime: resourceClass === 'compose_container' ? { running: true }
      : resourceClass === 'compose_network' ? { endpointCount: 1, dependencyIdentities: ['a'.repeat(64)] }
        : { attachmentCount: 1, dependencyIdentities: ['a'.repeat(64)] },
    ...overrides,
  };
}

const emptyProjectDiscovery = async () => ({
  compose_container: [], compose_network: [], compose_volume: [],
});

function discoveredProject(resources) {
  return async () => Object.fromEntries(
    ['compose_container', 'compose_network', 'compose_volume'].map((resourceClass) => [
      resourceClass,
      resources.filter((entry) => entry.resourceClass === resourceClass).map((entry) => entry.locator),
    ]),
  );
}

function observation(resources) {
  return {
    complete: true, engine: 'docker', selectors: operatorRecoverySelectors(target),
    daemonContextFingerprint: 'd'.repeat(64),
    engineGlobalArgs: ['--host', 'unix:///var/run/docker.sock'], resources, ambiguities: [],
  };
}

test('recovery selectors are bounded to the exact tuple and exclude images/builders', () => {
  const selectors = operatorRecoverySelectors(target);
  for (const resourceClass of ['compose_container', 'compose_network', 'compose_volume']) {
    assert.deepEqual(selectors[resourceClass], [{ manifestLabels: {
      'io.sanctuary.project': target.project,
      'io.sanctuary.deployment-id': target.deploymentId,
      'io.sanctuary.owner-id': target.ownerId,
      'io.sanctuary.resource-class': resourceClass,
    } }]);
  }
  assert.deepEqual(selectors.oci_image, []);
  assert.deepEqual(selectors.buildkit_cache, []);
});

test('builds an exact recovery observation while treating only volume registration refusal as replaced authority', async () => {
  const containerId = 'a'.repeat(64);
  const resources = [
    resource('compose_container', containerId, containerId),
    resource('compose_network', 'b'.repeat(64), 'b'.repeat(64)),
    resource('compose_volume', 'ci-1-fresh-install_data', 'c'.repeat(64)),
  ];
  const result = await buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 1, compose_network: 1, compose_volume: 1 },
    observe: async () => observation(resources),
    discoverComposeProject: discoveredProject(resources),
  });
  assert.equal(result.resources.length, 3);
  assert.equal(result.observationDigest, canonicalSha256({
    daemonContextFingerprint: result.daemonContextFingerprint,
    resources: result.resources,
  }));
  assert.equal(result.resources.at(-1).attestationNonce, result.attestationNonce);
});

test('refuses count mismatch, wrong tuple, unsafe volume classification, and foreign dependency', async () => {
  const containerId = 'a'.repeat(64);
  const base = resource('compose_container', containerId, containerId);
  await assert.rejects(() => buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 2, compose_network: 0, compose_volume: 0 },
    observe: async () => observation([base]),
    discoverComposeProject: discoveredProject([base]),
  }), /count mismatch/);
  await assert.rejects(() => buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 1, compose_network: 0, compose_volume: 0 },
    observe: async () => observation([{ ...base, labels: { ...base.labels, 'io.sanctuary.owner-id': 'wrong-owner' } }]),
    discoverComposeProject: discoveredProject([base]),
  }), /ownership tuple/);
  const unsafeVolume = resource('compose_volume', 'ci-1_data', 'c'.repeat(64), {
    classifications: ['data', 'owned', 'protected', 'unregistered'], runtime: { attachmentCount: 0, dependencyIdentities: [] },
  });
  await assert.rejects(() => buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 0, compose_network: 0, compose_volume: 1 },
    observe: async () => observation([unsafeVolume]),
    discoverComposeProject: discoveredProject([unsafeVolume]),
  }), /unsafe classification/);
  const network = resource('compose_network', 'b'.repeat(64), 'b'.repeat(64), {
    runtime: { endpointCount: 1, dependencyIdentities: ['f'.repeat(64)] },
  });
  await assert.rejects(() => buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 1, compose_network: 1, compose_volume: 0 },
    observe: async () => observation([base, network]),
    discoverComposeProject: discoveredProject([base, network]),
  }), /dependency closure/);
});

test('Compose project discovery exposes partial, wrong-tuple, wrong-class, and extra resources', async () => {
  const approvedId = 'a'.repeat(64);
  const approved = resource('compose_container', approvedId, approvedId);
  const cases = [
    {
      candidate: resource('compose_container', 'b'.repeat(64), 'b'.repeat(64), {
        ownershipState: 'malformed',
        labels: { 'com.docker.compose.project': target.project, 'io.sanctuary.project': target.project },
      }),
      error: /lacks complete ownership labels/,
    },
    {
      candidate: (() => {
        const value = resource('compose_container', 'c'.repeat(64), 'c'.repeat(64));
        return { ...value, labels: { ...value.labels, 'io.sanctuary.deployment-id': 'wrong-deployment' } };
      })(),
      error: /ownership tuple/,
    },
    {
      candidate: (() => {
        const value = resource('compose_network', 'd'.repeat(64), 'd'.repeat(64), {
          ownershipState: 'malformed', runtime: { endpointCount: 0, dependencyIdentities: [] },
        });
        return { ...value, labels: { ...value.labels, 'io.sanctuary.resource-class': 'compose_container' } };
      })(),
      error: /lacks complete ownership labels/,
    },
    {
      candidate: resource('compose_container', 'e'.repeat(64), 'e'.repeat(64)),
      error: /count mismatch/,
    },
  ];

  for (const { candidate, error } of cases) {
    const projectResources = [approved, candidate];
    const observe = async ({ selectors }) => {
      const hasProjectLocators = ['compose_container', 'compose_network', 'compose_volume']
        .some((resourceClass) => selectors[resourceClass].some((selector) => selector.locator));
      return observation(hasProjectLocators ? projectResources : [approved]);
    };
    await assert.rejects(() => buildOperatorRecoveryObservation({
      target, expectedCounts: { compose_container: 1, compose_network: 0, compose_volume: 0 },
      observe, discoverComposeProject: discoveredProject(projectResources),
      requireIndependentRefresh: false,
    }), error);
  }
});

test('default Compose discovery is bounded, exact, and excludes images and builders', async () => {
  const id = 'a'.repeat(64);
  const selected = resource('compose_container', id, id);
  const commands = [];
  const runCommand = async (engine, args, options) => {
    commands.push([engine, args, options]);
    if (args.includes('container')) return `${id}\n`;
    return '';
  };
  const result = await buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 1, compose_network: 0, compose_volume: 0 },
    observe: async () => observation([selected]), observationOptions: { runCommand },
    discoverComposeProject: (options) => discoverComposeProjectFromDocker(options),
    requireIndependentRefresh: false,
  });
  assert.equal(result.resources.length, 1);
  assert.equal(commands.length, 6);
  for (const [, args, options] of commands) {
    assert.ok(args.includes(`label=com.docker.compose.project=${target.project}`));
    assert.ok(!args.includes('image'));
    assert.ok(!args.includes('builder'));
    assert.equal(options.maxOutputBytes, 65_536);
  }

  await assert.rejects(() => buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 0, compose_network: 0, compose_volume: 0 },
    observe: async () => observation([]),
    observationOptions: { runCommand: async () => 'not-an-exact-locator\n' },
    discoverComposeProject: (options) => discoverComposeProjectFromDocker(options),
    requireIndependentRefresh: false,
  }), /malformed locator/);

  let containerLists = 0;
  await assert.rejects(() => buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 0, compose_network: 0, compose_volume: 0 },
    observe: async () => observation([]),
    observationOptions: { runCommand: async (_engine, args) => {
      if (!args.includes('container')) return '';
      containerLists += 1;
      return `${(containerLists === 1 ? 'a' : 'b').repeat(64)}\n`;
    } },
    discoverComposeProject: (options) => discoverComposeProjectFromDocker(options),
    requireIndependentRefresh: false,
  }), /changed during recovery observation/);
});

test('refuses ambiguous observation and unstable exact refresh', async () => {
  await assert.rejects(() => buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 0, compose_network: 0, compose_volume: 0 },
    observe: async () => ({ ...observation([]), complete: false, ambiguities: [{ category: 'inventory_drift' }] }),
    discoverComposeProject: emptyProjectDiscovery,
  }), /incomplete or ambiguous/);
  let calls = 0;
  await assert.rejects(() => buildOperatorRecoveryObservation({
    target, expectedCounts: { compose_container: 1, compose_network: 0, compose_volume: 0 },
    observe: async () => {
      calls += 1;
      const id = (calls <= 2 ? 'a' : 'b').repeat(64);
      return observation([resource('compose_container', id, id)]);
    },
    discoverComposeProject: emptyProjectDiscovery,
    requireIndependentRefresh: true,
  }), /changed between observations/);
});

test('exact action reinspection returns absence and refuses daemon drift', async () => {
  const action = { resourceClass: 'compose_container', locator: 'a'.repeat(64) };
  const absent = await observeOperatorRecoveryAction({
    action, target, scopeResource: {}, daemonContextFingerprint: 'd'.repeat(64),
    observe: async () => observation([]),
  });
  assert.equal(absent, null);
  await assert.rejects(() => observeOperatorRecoveryAction({
    action, target, scopeResource: {}, daemonContextFingerprint: 'e'.repeat(64),
    observe: async () => observation([]),
  }), /changed daemon/);
});

test('closed-set verification requires two empty stable in-scope observations', async () => {
  const closed = await verifyOperatorRecoveryClosed({
    target, daemonContextFingerprint: 'd'.repeat(64),
    observe: async () => observation([]),
    discoverComposeProject: emptyProjectDiscovery,
  });
  assert.equal(closed.closed, true);
  assert.match(closed.observationDigest, /^[a-f0-9]{64}$/);
  await assert.rejects(() => verifyOperatorRecoveryClosed({
    target, daemonContextFingerprint: 'd'.repeat(64),
    observe: async () => observation([resource('compose_container', 'a'.repeat(64), 'a'.repeat(64))]),
    discoverComposeProject: discoveredProject([
      resource('compose_container', 'a'.repeat(64), 'a'.repeat(64)),
    ]),
  }), /residue/);
});

test('final closure repeats Compose project discovery and catches hidden same-project residue', async () => {
  const hiddenId = 'f'.repeat(64);
  const hidden = resource('compose_container', hiddenId, hiddenId, {
    ownershipState: 'malformed',
    labels: { 'com.docker.compose.project': target.project },
  });
  let unionObservations = 0;
  const observe = async ({ selectors }) => {
    const hasHiddenLocator = selectors.compose_container.some((selector) => selector.locator === hiddenId);
    if (hasHiddenLocator) unionObservations += 1;
    return observation(hasHiddenLocator ? [hidden] : []);
  };
  await assert.rejects(() => verifyOperatorRecoveryClosed({
    target, daemonContextFingerprint: 'd'.repeat(64), observe,
    discoverComposeProject: discoveredProject([hidden]),
  }), /residue/);
  assert.equal(unionObservations, 1);
});
