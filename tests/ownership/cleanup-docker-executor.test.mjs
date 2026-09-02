import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDockerMutation, buildDockerPostcondition, executeDockerMutation,
} from '../../scripts/ownership/cleanup-docker-executor.mjs';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

function action(resourceClass, mutation, overrides = {}) {
  const image = resourceClass === 'oci_image';
  const volume = resourceClass === 'compose_volume';
  const identity = image ? `sha256:${HEX_A}` : HEX_A;
  return {
    sequence: 1,
    resourceClass,
    immutableIdentity: identity,
    action: mutation,
    locatorKind: volume ? 'name' : 'engine_id',
    locator: volume ? 'sanctuary-cache' : identity,
    ownershipDigest: HEX_B,
    observationDigest: 'c'.repeat(64),
    dependencyIdentities: [],
    ...overrides,
  };
}

function volumeProof(overrides = {}) {
  return {
    locator: 'sanctuary-cache',
    observedFingerprint: HEX_A,
    registeredCreationNonce: 'creation-run-7',
    observedCreationNonce: 'creation-run-7',
    observedOwnershipDigest: HEX_B,
    attachmentCount: 0,
    ...overrides,
  };
}

test('the allowlist emits only exact non-force Docker argv', () => {
  const cases = [
    [action('compose_container', 'stop'), ['container', 'stop', HEX_A]],
    [action('compose_container', 'remove'), ['container', 'rm', HEX_A]],
    [action('compose_network', 'remove'), ['network', 'rm', HEX_A]],
    [action('compose_volume', 'remove'), ['volume', 'rm', 'sanctuary-cache'], volumeProof()],
    [action('oci_image', 'remove'), ['image', 'rm', HEX_A]],
  ];
  for (const [candidate, expected, proof] of cases) {
    const command = buildDockerMutation(candidate, { engine: 'podman', freshVolumeProof: proof });
    assert.equal(command.engine, 'podman');
    assert.deepEqual(command.args, expected);
    assert.equal(Object.isFrozen(command.args), true);
    assert.equal(command.args.includes('--force'), false);
    assert.equal(command.args.includes('-f'), false);
  }
});

test('an exact immutable daemon endpoint is pinned ahead of every mutation', () => {
  assert.deepEqual(
    buildDockerMutation(action('compose_network', 'remove'), {
      engine: 'docker', engineGlobalArgs: ['--host', 'unix:///run/docker-fixture.sock'],
    }).args,
    ['--host', 'unix:///run/docker-fixture.sock', 'network', 'rm', HEX_A],
  );
  assert.deepEqual(
    buildDockerMutation(action('compose_network', 'remove'), {
      engine: 'podman', engineGlobalArgs: ['--url', 'unix:///run/podman-fixture.sock'],
    }).args,
    ['--url', 'unix:///run/podman-fixture.sock', 'network', 'rm', HEX_A],
  );
  for (const [engine, engineGlobalArgs] of [
    ['docker', ['--url', 'unix:///run/fixture.sock']],
    ['podman', ['--host', 'unix:///run/fixture.sock']],
    ['docker', ['--host']],
    ['docker', ['--host', 'ssh://operator@example.test/run/docker.sock']],
    ['docker', ['--host', 'unix:///run/fixture.sock?redirect=1']],
    ['docker', ['--host', 'unix:///run/fixture.sock', '--context', 'other']],
  ]) {
    assert.throws(
      () => buildDockerMutation(action('compose_network', 'remove'), { engine, engineGlobalArgs }),
      /engineGlobalArgs/,
    );
  }
});

test('wrong class, action, locator kind, and non-exact IDs are refused', () => {
  const refused = [
    action('buildkit_cache', 'remove'),
    action('git_worktree', 'remove'),
    action('temporary_artifact', 'remove'),
    action('compose_network', 'stop'),
    action('compose_volume', 'stop'),
    action('oci_image', 'stop'),
    action('compose_container', 'reconcile'),
    action('compose_container', 'remove', { locatorKind: 'name' }),
    action('compose_network', 'remove', { locator: HEX_A.slice(0, 12), immutableIdentity: HEX_A.slice(0, 12) }),
    action('compose_container', 'remove', { locator: `-${HEX_A.slice(1)}`, immutableIdentity: `-${HEX_A.slice(1)}` }),
    action('oci_image', 'remove', { locator: HEX_A, immutableIdentity: HEX_A }),
    action('oci_image', 'remove', { locator: `sha256:${HEX_A}`, immutableIdentity: `sha256:${HEX_B}` }),
  ];
  for (const candidate of refused) assert.throws(() => buildDockerMutation(candidate), TypeError);
});

test('extra force or option-shaped action data cannot reach the supervisor', () => {
  assert.throws(
    () => buildDockerMutation({ ...action('compose_container', 'remove'), force: true }),
    /must contain exactly/,
  );
  assert.throws(
    () => buildDockerMutation(action('compose_volume', 'remove', { locator: '--force' }), {
      freshVolumeProof: volumeProof({ locator: '--force' }),
    }),
    /exact volume name/,
  );
  assert.throws(() => buildDockerMutation(action('compose_container', 'remove'), { engine: 'docker\0--force' }), /engine/);
  assert.throws(() => buildDockerMutation(action('compose_container', 'remove'), { engine: '/tmp/docker' }), /engine/);
  assert.throws(() => buildDockerMutation(action('compose_container', 'remove'), { engine: 'sh' }), /engine/);
});

test('volume removal requires matched fresh fingerprint, nonce, ownership, and zero attachments', () => {
  const candidate = action('compose_volume', 'remove');
  assert.throws(() => buildDockerMutation(candidate), /fresh volume proof/);
  const invalidProofs = [
    volumeProof({ locator: 'other-volume' }),
    volumeProof({ observedFingerprint: HEX_B }),
    volumeProof({ observedOwnershipDigest: HEX_A }),
    volumeProof({ registeredCreationNonce: '' }),
    volumeProof({ observedCreationNonce: 'replacement-run' }),
    volumeProof({ attachmentCount: 1 }),
    volumeProof({ attachmentCount: '0' }),
    { ...volumeProof(), fresh: true },
  ];
  for (const proof of invalidProofs) {
    assert.throws(() => buildDockerMutation(candidate, { freshVolumeProof: proof }), TypeError);
  }
  assert.deepEqual(
    buildDockerMutation(candidate, { freshVolumeProof: volumeProof() }).args,
    ['volume', 'rm', 'sanctuary-cache'],
  );
});

test('execution calls the injected supervisor once and exposes no raw output', async () => {
  const calls = [];
  const result = await executeDockerMutation(action('compose_container', 'remove'), {
    engine: 'podman',
    supervisorOptions: { timeoutMs: 123 },
    supervisor: async (...args) => {
      calls.push(args);
      return { outcome: 'command_failed', exitCode: 17, stdout: 'secret', stderr: 'private' };
    },
  });
  assert.deepEqual(calls, [[
    'podman', ['container', 'rm', HEX_A], { timeoutMs: 123 },
  ]]);
  assert.deepEqual(result, { outcome: 'command_failed', reconciliationRequired: true });
  assert.doesNotMatch(JSON.stringify(result), /secret|private|stdout|stderr/);
  assert.equal(Object.isFrozen(result), true);
});

test('invalid actions are refused before the supervisor is entered', async () => {
  let calls = 0;
  const supervisor = async () => { calls += 1; return { outcome: 'success' }; };
  await assert.rejects(
    executeDockerMutation(action('buildkit_cache', 'remove'), { supervisor }),
    /no Docker mutation adapter/,
  );
  await assert.rejects(
    executeDockerMutation(action('compose_volume', 'remove'), { supervisor }),
    /fresh volume proof/,
  );
  assert.equal(calls, 0);
});

test('every supervisor result is categorical and requires authoritative reconciliation', async () => {
  const candidate = action('compose_network', 'remove');
  const outcomes = [
    'success', 'command_failed', 'timeout', 'cancelled', 'output_limit',
    'command_unavailable', 'permission_denied', 'spawn_failed', 'quiescence_failed',
  ];
  for (const outcome of outcomes) {
    assert.deepEqual(
      await executeDockerMutation(candidate, { supervisor: async () => ({ outcome }) }),
      { outcome, reconciliationRequired: true },
    );
  }
  assert.deepEqual(
    await executeDockerMutation(candidate, { supervisor: async () => ({ outcome: 'invented', output: 'secret' }) }),
    { outcome: 'quiescence_failed', reconciliationRequired: true },
  );
  assert.deepEqual(
    await executeDockerMutation(candidate, { supervisor: async () => { throw new Error('secret'); } }),
    { outcome: 'quiescence_failed', reconciliationRequired: true },
  );
});

test('postcondition contracts probe the exact approved identity', () => {
  const stopped = buildDockerPostcondition(action('compose_container', 'stop'));
  assert.deepEqual(stopped, {
    kind: 'exact_container_stopped_or_absent',
    resourceClass: 'compose_container',
    locatorKind: 'engine_id',
    locator: HEX_A,
    immutableIdentity: HEX_A,
    queryArgs: ['container', 'inspect', HEX_A],
    satisfiedBy: ['absent', 'same_identity_stopped'],
  });

  const removed = buildDockerPostcondition(action('oci_image', 'remove'));
  assert.deepEqual(removed.queryArgs, ['image', 'inspect', HEX_A]);
  assert.deepEqual(removed.satisfiedBy, ['absent']);

  const volume = buildDockerPostcondition(action('compose_volume', 'remove'), {
    freshVolumeProof: volumeProof(),
  });
  assert.deepEqual(volume.queryArgs, ['volume', 'inspect', 'sanctuary-cache']);
  assert.deepEqual(volume.satisfiedBy, ['absent', 'different_fingerprint_at_name']);
  assert.equal(Object.isFrozen(volume.queryArgs), true);
  assert.equal(Object.isFrozen(volume.satisfiedBy), true);
});
