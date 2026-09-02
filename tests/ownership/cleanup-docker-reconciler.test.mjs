import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { runCleanupActions } from '../../scripts/ownership/cleanup-action-runner.mjs';
import {
  createDockerActionReconciler, createDockerAuthorityReloader,
  reconcileDockerAction, reloadDockerActionAuthority,
} from '../../scripts/ownership/cleanup-docker-reconciler.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const CONTEXT = 'd'.repeat(64);

function ownership(resourceClass, immutableIdentity) {
  return {
    project: 'fixture', deploymentId: 'deploy-1', ownerId: 'owner-1', resourceClass,
    lifecycle: 'obsolete', cleanupPolicy: 'exact_delete', createdAt: '2026-08-31T00:00:00.000Z',
    createdByRelease: 'unreleased', createdByCommit: 'f'.repeat(40),
    creationRunId: 'create-1', immutableIdentity,
  };
}

function action(sequence, resourceClass, mutation, overrides = {}) {
  const volume = resourceClass === 'compose_volume';
  const image = resourceClass === 'oci_image';
  const immutableIdentity = image ? `sha256:${A}` : A;
  const owner = ownership(resourceClass, immutableIdentity);
  return {
    sequence, resourceClass, immutableIdentity, action: mutation,
    locatorKind: volume ? 'name' : 'engine_id', locator: volume ? 'cache-volume' : immutableIdentity,
    ownershipDigest: canonicalSha256(owner), observationDigest: B,
    dependencyIdentities: [], ...overrides,
  };
}

function row(candidate, overrides = {}) {
  const owner = ownership(candidate.resourceClass, candidate.immutableIdentity);
  return {
    resourceClass: candidate.resourceClass, locatorKind: candidate.locatorKind,
    locator: candidate.locator, immutableIdentity: candidate.immutableIdentity,
    ownership: owner, ownershipDigest: canonicalSha256(owner), observationDigest: candidate.observationDigest,
    disposition: 'eligible', failureClasses: [], references: [], contentDigests: [],
    dependencyIdentities: [],
    running: candidate.resourceClass === 'compose_container' ? true : null,
    active: false, protected: false, data: false, ...overrides,
  };
}

function inventory(resources, overrides = {}) {
  return {
    schemaVersion: '1.2.0', artifactType: 'inventory', deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1', generation: 1, observedAt: '2026-08-31T00:00:01.000Z',
    complete: true, policyDigest: A, deploymentManifestDigest: A, runManifestDigest: A,
    contextFingerprint: CONTEXT, resources, ambiguities: [], ...overrides,
  };
}

function volumeProof(candidate, overrides = {}) {
  return {
    resourceClass: 'compose_volume', locatorKind: 'name', locator: candidate.locator,
    immutableIdentity: candidate.immutableIdentity, ownershipDigest: candidate.ownershipDigest,
    ownership: ownership(candidate.resourceClass, candidate.immutableIdentity),
    registrationId: B, metadataDigest: C, signerKeyId: CONTEXT,
    creationNonce: 'create-1', ...overrides,
  };
}

function selectorsFor(candidate) {
  return {
    compose_container: candidate.resourceClass === 'compose_container' ? [{ locator: candidate.locator }] : [],
    compose_network: candidate.resourceClass === 'compose_network' ? [{ locator: candidate.locator }] : [],
    compose_volume: candidate.resourceClass === 'compose_volume' ? [{ locator: candidate.locator }] : [],
    oci_image: candidate.resourceClass === 'oci_image' ? [{ locator: candidate.locator }] : [],
    buildkit_cache: [],
  };
}

function observation(candidate, resources = [], overrides = {}) {
  return {
    complete: true, daemonContextFingerprint: CONTEXT,
    selectors: selectorsFor(candidate), resources, ambiguities: [], ...overrides,
  };
}

test('authority reload returns exactly one fully eligible approved row', async () => {
  const candidate = action(1, 'compose_network', 'remove');
  const calls = [];
  const reload = createDockerAuthorityReloader({
    approvedActions: [candidate],
    loadInventory: async (request) => { calls.push(request); return inventory([row(candidate)]); },
  });
  const result = await reload({
    action: candidate, phase: 'fresh_eligibility', predecessorResultDigest: null,
  });
  assert.deepEqual(result, { state: 'eligible', row: row(candidate), derivedFromResultDigest: null });
  assert.equal(calls.length, 1);
  assert.equal(Object.isFrozen(calls[0]), true);
});

test('authority reloader supports an approved no-op action list', () => {
  assert.doesNotThrow(() => createDockerAuthorityReloader({
    approvedActions: [], loadInventory: async () => inventory([]),
  }));
});

test('only the immediate matching container stop-to-remove derivation is admitted', async () => {
  const stop = action(1, 'compose_container', 'stop');
  const remove = action(2, 'compose_container', 'remove', { observationDigest: C });
  const predecessor = 'e'.repeat(64);
  const derivedRow = row(remove, { observationDigest: 'f'.repeat(64) });
  const loadInventory = async () => inventory([derivedRow]);
  assert.deepEqual(await reloadDockerActionAuthority({
    action: remove, phase: 'fresh_eligibility', predecessorResultDigest: predecessor,
    approvedActions: [stop, remove], loadInventory,
  }), { state: 'eligible', row: derivedRow, derivedFromResultDigest: predecessor });
  assert.deepEqual(await reloadDockerActionAuthority({
    action: remove, phase: 'fresh_eligibility', predecessorResultDigest: null,
    approvedActions: [stop, remove], loadInventory,
  }), { state: 'refused', failureClass: 'identity_changed' });
  const network = action(1, 'compose_network', 'remove');
  assert.deepEqual(await reloadDockerActionAuthority({
    action: network, phase: 'fresh_eligibility', predecessorResultDigest: predecessor,
    approvedActions: [network], loadInventory: async () => inventory([row(network)]),
  }), { state: 'refused', failureClass: 'identity_changed' });
});

test('network, volume, and image transitions require exact approved container removals', async () => {
  const stop = action(1, 'compose_container', 'stop');
  const remove = action(2, 'compose_container', 'remove');
  const predecessor = 'e'.repeat(64);
  for (const [resourceClass, proofLoader] of [
    ['compose_network', undefined],
    ['compose_volume', async ({ action: candidate }) => volumeProof(candidate)],
    ['oci_image', undefined],
  ]) {
    const dependent = action(3, resourceClass, 'remove', { dependencyIdentities: [A] });
    const approvedActions = [stop, remove, dependent];
    const clearedRow = row(dependent, {
      observationDigest: C, dependencyIdentities: [],
      ...(resourceClass === 'compose_volume' ? { contentDigests: [B, C] } : {}),
    });
    assert.deepEqual(await reloadDockerActionAuthority({
      action: dependent, phase: 'fresh_eligibility', predecessorResultDigest: predecessor,
      approvedActions, loadInventory: async () => inventory([clearedRow]),
      ...(proofLoader ? { loadVolumeRegistrationProof: proofLoader } : {}),
    }), { state: 'eligible', row: clearedRow, derivedFromResultDigest: predecessor });

    const absent = await reloadDockerActionAuthority({
      action: dependent, phase: 'fresh_eligibility', predecessorResultDigest: predecessor,
      approvedActions, loadInventory: async () => inventory([]),
      ...(proofLoader ? { loadVolumeRegistrationProof: proofLoader } : {}),
    });
    if (resourceClass === 'compose_volume') {
      assert.deepEqual(absent, { state: 'refused', failureClass: 'identity_changed' });
    } else {
      assert.equal(absent.state, 'absent');
      assert.match(absent.postconditionDigest, /^[a-f0-9]{64}$/);
      assert.equal(absent.derivedFromResultDigest, predecessor);
    }

    const foreignRow = row(dependent, {
      observationDigest: C, dependencyIdentities: [C],
      ...(resourceClass === 'compose_volume' ? { contentDigests: [B, C] } : {}),
    });
    assert.deepEqual(await reloadDockerActionAuthority({
      action: dependent, phase: 'fresh_eligibility', predecessorResultDigest: predecessor,
      approvedActions, loadInventory: async () => inventory([foreignRow]),
      ...(proofLoader ? { loadVolumeRegistrationProof: proofLoader } : {}),
    }), { state: 'refused', failureClass: 'shared' });
  }
});

test('authority reload fails closed on partial, duplicate, drifted, or unsafe inventories', async () => {
  const candidate = action(1, 'compose_network', 'remove');
  const cases = [
    [inventory([], { complete: false, ambiguities: [{ adapter: 'docker', resourceClass: 'compose_network', failureClass: 'query_failed', scope: 'query' }] }), 'ambiguous'],
    [inventory([]), 'refused'],
    [inventory([row(candidate), row(candidate)]), 'ambiguous'],
    [inventory([row(candidate, { observationDigest: C })]), 'refused'],
    [inventory([row(candidate, { protected: true, disposition: 'refused', failureClasses: ['protected'] })]), 'refused'],
  ];
  for (const [loaded, expectedState] of cases) {
    const result = await reloadDockerActionAuthority({
      action: candidate, phase: 'pre_mutation_reinspection', approvedActions: [candidate],
      loadInventory: async () => loaded,
    });
    assert.equal(result.state, expectedState);
    assert.equal(Object.hasOwn(result, 'message'), false);
  }
  assert.deepEqual(await reloadDockerActionAuthority({
    action: candidate, phase: 'fresh_eligibility', approvedActions: [candidate],
    loadInventory: async () => { throw new Error('private daemon output'); },
  }), { state: 'ambiguous', failureClass: 'query_failed' });
});

function authorityRow(candidate, overrides = {}) {
  const registrationDigests = candidate.resourceClass === 'compose_volume' ? [B, C] : [];
  return row(candidate, { contentDigests: registrationDigests, ...overrides });
}

function predicateFlipCases(sequence) {
  const network = () => action(sequence, 'compose_network', 'remove');
  const changedOwner = { ...ownership('compose_network', A), ownerId: 'owner-2' };
  const replacement = action(sequence, 'compose_network', 'remove', {
    immutableIdentity: C, locator: C,
    ownershipDigest: canonicalSha256(ownership('compose_network', C)),
  });
  return [
    ['immutable ID', network(), () => inventory([row(replacement)]), 'identity_changed'],
    ['ownership label', network(), (candidate) => inventory([authorityRow(candidate, {
      ownership: changedOwner, ownershipDigest: canonicalSha256(changedOwner),
    })]), 'identity_changed'],
    ['image reference', action(sequence, 'oci_image', 'remove'), (candidate) => inventory([
      authorityRow(candidate, {
        references: ['fixture:retained'], protected: true,
        disposition: 'refused', failureClasses: ['referenced'],
      }),
    ]), 'referenced'],
    ['volume attachment', action(sequence, 'compose_volume', 'remove'), (candidate) => inventory([
      authorityRow(candidate, {
        references: [B], protected: true, disposition: 'refused', failureClasses: ['shared'],
      }),
    ]), 'shared'],
    ['network endpoint', network(), (candidate) => inventory([authorityRow(candidate, {
      references: [B], protected: true, disposition: 'refused', failureClasses: ['shared'],
    })]), 'shared'],
    ['shared owner', network(), (candidate) => inventory([authorityRow(candidate, {
      protected: true, disposition: 'refused', failureClasses: ['shared'],
    })]), 'shared'],
    ['current deployment', network(), (candidate) => inventory([authorityRow(candidate, {
      active: true, protected: true, disposition: 'refused', failureClasses: ['current'],
    })]), 'current'],
    ['lifecycle completion', network(), (candidate) => inventory([authorityRow(candidate, {
      active: true, protected: true, disposition: 'refused', failureClasses: ['active'],
    })]), 'active'],
  ];
}

async function exercisePredicateFlip({ boundary, flip }) {
  const [name, candidate, changedInventory, expectedFailure] = flip;
  const first = action(1, 'compose_network', 'remove', {
    immutableIdentity: B, locator: B,
    ownershipDigest: canonicalSha256(ownership('compose_network', B)),
  });
  const actions = boundary === 'first' ? [candidate] : [first, candidate];
  const changedAtLoad = boundary === 'first' ? 1 : 3;
  const checkpoints = [];
  const mutations = [];
  let loads = 0;
  const result = await runCleanupActions({
    actions,
    reloadAuthority: createDockerAuthorityReloader({
      approvedActions: actions,
      loadInventory: async ({ action: current }) => {
        loads += 1;
        return loads === changedAtLoad ? changedInventory(current)
          : inventory([authorityRow(current)]);
      },
      loadVolumeRegistrationProof: async ({ action: current }) => volumeProof(current),
    }),
    appendCheckpoint: async (checkpoint) => {
      checkpoints.push(checkpoint);
      return { checkpointDigest: canonicalSha256(checkpoint), signed: true, synced: true };
    },
    mutate: async ({ action: current }) => {
      mutations.push(current.sequence);
      return { outcome: 'success' };
    },
    reconcile: async ({ action: current }) => ({
      state: 'absent', resourceClass: current.resourceClass,
      immutableIdentity: current.immutableIdentity, postconditionDigest: C,
      failureClass: 'none',
    }),
  });
  const expectedMutations = boundary === 'first' ? [] : [1];
  assert.deepEqual(mutations, expectedMutations, `${name} at ${boundary} boundary`);
  assert.equal(result.results.at(-1).result, 'refused', `${name} at ${boundary} boundary`);
  assert.equal(result.results.at(-1).failureClass, expectedFailure, `${name} at ${boundary} boundary`);
  assert.equal(checkpoints.some((entry) => entry.checkpointType === 'intent'
    && entry.payload.actionSequence === candidate.sequence), false, `${name} intent`);
}

test('every required predicate flip refuses before mutation at first and later action boundaries', async () => {
  for (const boundary of ['first', 'between']) {
    const sequence = boundary === 'first' ? 1 : 2;
    for (const flip of predicateFlipCases(sequence)) {
      await exercisePredicateFlip({ boundary, flip });
    }
  }
});

test('volume authority requires exact registration digests and creation nonce', async () => {
  const candidate = action(1, 'compose_volume', 'remove');
  const proof = volumeProof(candidate);
  const volumeRow = row(candidate, { contentDigests: [B, C] });
  const base = {
    action: candidate, phase: 'fresh_eligibility', approvedActions: [candidate],
    loadInventory: async () => inventory([volumeRow]),
  };
  assert.deepEqual(await reloadDockerActionAuthority({
    ...base, loadVolumeRegistrationProof: async () => proof,
  }), { state: 'eligible', row: volumeRow, derivedFromResultDigest: null });
  assert.deepEqual(await reloadDockerActionAuthority(base), { state: 'refused', failureClass: 'unregistered' });
  assert.deepEqual(await reloadDockerActionAuthority({
    ...base, loadVolumeRegistrationProof: async () => volumeProof(candidate, { creationNonce: '' }),
  }), { state: 'refused', failureClass: 'unregistered' });
  assert.deepEqual(await reloadDockerActionAuthority({
    ...base, loadVolumeRegistrationProof: async () => volumeProof(candidate, { immutableIdentity: C }),
  }), { state: 'refused', failureClass: 'identity_changed' });
  assert.deepEqual(await reloadDockerActionAuthority({
    ...base, loadVolumeRegistrationProof: async () => volumeProof(candidate, { creationNonce: 'other-run' }),
  }), { state: 'refused', failureClass: 'unregistered' });
});

test('reconciliation uses exact selectors and returns only bounded action-runner fields', async () => {
  const candidate = action(1, 'compose_network', 'remove');
  let request;
  const reconcile = createDockerActionReconciler({
    observeAction: async (value) => { request = value; return observation(candidate); },
  });
  const result = await reconcile({ action: candidate, mutationOutcome: 'success', intentCheckpointDigest: C });
  assert.equal(result.state, 'absent');
  assert.equal(result.failureClass, 'none');
  assert.match(result.postconditionDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(request.selectors.compose_network, [{ locator: A }]);
  assert.deepEqual(request.selectors.compose_container, []);
  assert.deepEqual(Object.keys(result).sort(), [
    'failureClass', 'immutableIdentity', 'postconditionDigest', 'resourceClass', 'state',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /stdout|stderr|private/);
});

test('container stop requires the exact ID to be stopped or absent', async () => {
  const candidate = action(1, 'compose_container', 'stop');
  const stopped = await reconcileDockerAction({
    action: candidate, observeAction: async () => observation(candidate, [{
      resourceClass: 'compose_container', locator: A, immutableIdentity: A, runtime: { running: false },
    }]),
  });
  assert.equal(stopped.state, 'satisfied');
  const running = await reconcileDockerAction({
    action: candidate, observeAction: async () => observation(candidate, [{
      resourceClass: 'compose_container', locator: A, immutableIdentity: A, runtime: { running: true },
    }]),
  });
  assert.deepEqual(running, {
    state: 'refused', resourceClass: 'compose_container', immutableIdentity: A,
    postconditionDigest: null, failureClass: 'postcondition_failed',
  });
});

test('remove reconciliation refuses survivors and ambiguity while retaining volume replacements', async () => {
  const network = action(1, 'compose_network', 'remove');
  assert.equal((await reconcileDockerAction({
    action: network, observeAction: async () => observation(network, [{
      resourceClass: 'compose_network', locator: A, immutableIdentity: A, runtime: { endpointCount: 0 },
    }]),
  })).failureClass, 'postcondition_failed');
  assert.deepEqual(await reconcileDockerAction({
    action: network, observeAction: async () => { throw new Error('raw output'); },
  }), {
    state: 'ambiguous', resourceClass: 'compose_network', immutableIdentity: A,
    postconditionDigest: null, failureClass: 'query_failed',
  });
  assert.equal((await reconcileDockerAction({
    action: network,
    observeAction: async () => observation(network, [], { selectors: selectorsFor(action(1, 'compose_container', 'stop')) }),
  })).state, 'ambiguous');
  assert.equal((await reconcileDockerAction({
    action: network,
    observeAction: async () => observation(network, [{
      resourceClass: 'compose_container', locator: A, immutableIdentity: A,
    }]),
  })).state, 'ambiguous');

  const volume = action(1, 'compose_volume', 'remove');
  const proof = volumeProof(volume);
  const replaced = await reconcileDockerAction({
    action: volume, loadVolumeRegistrationProof: async () => proof,
    observeAction: async () => observation(volume, [{
      resourceClass: 'compose_volume', locator: volume.locator,
      immutableIdentity: C, runtime: { attachmentCount: 0 },
    }]),
  });
  assert.equal(replaced.state, 'satisfied');
  assert.match(replaced.postconditionDigest, /^[a-f0-9]{64}$/);
  assert.equal((await reconcileDockerAction({
    action: volume, loadVolumeRegistrationProof: async () => proof,
    observeAction: async () => observation(volume, [{
      resourceClass: 'compose_volume', locator: volume.locator,
      immutableIdentity: 'malformed-replacement', runtime: { attachmentCount: 0 },
    }]),
  })).state, 'ambiguous');
  assert.deepEqual(await reconcileDockerAction({
    action: volume, observeAction: async () => observation(volume),
  }), {
    state: 'refused', resourceClass: 'compose_volume', immutableIdentity: A,
    postconditionDigest: null, failureClass: 'unregistered',
  });
});
