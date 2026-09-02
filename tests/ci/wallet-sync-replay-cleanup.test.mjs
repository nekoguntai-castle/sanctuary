import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertCoordinatedReplayAuthority,
  buildReplayCleanupEvidence,
  cleanup,
  cleanupReplayResources,
  createReplayResource,
  replayOwnershipLabels,
  runRegisteredReplayContainer,
} from '../../scripts/perf/wallet-sync-high-fanout-replay.mjs';
import { registerReplayResource } from '../../scripts/perf/wallet-sync-replay-ownership.mjs';

const resources = [
  { resourceClass: 'compose_network', name: 'replay-network', immutableIdentity: 'a'.repeat(64) },
  { resourceClass: 'compose_container', name: 'replay-worker', immutableIdentity: 'b'.repeat(64) },
  { resourceClass: 'compose_container', name: 'replay-postgres', immutableIdentity: 'c'.repeat(64) },
];

function inspectedResource(resource, labels = replayOwnershipLabels(resource.resourceClass)) {
  const labelMap = Object.fromEntries(labels.flatMap((value, index, values) => (
    value === '--label' ? [values[index + 1].split(/=(.*)/s).slice(0, 2)] : []
  )));
  return JSON.stringify([resource.resourceClass === 'compose_network'
    ? { Id: resource.immutableIdentity, Name: resource.name, Labels: labelMap }
    : {
      Id: resource.immutableIdentity,
      Name: `/${resource.name}`,
      State: { Status: 'created' },
      Config: { Labels: labelMap },
    }]);
}

test('direct npm replay invocation routes through the canonical cleanup coordinator', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(
    packageJson.scripts['perf:wallet-sync-high-fanout'],
    'scripts/ci/cleanup-ci-callsite.sh auto-run --lane wallet-sync-high-fanout --checkout-root . -- node scripts/perf/wallet-sync-high-fanout-replay.mjs',
  );
});

test('replay CLI fails closed without coordinated signed cleanup authority', () => {
  const previous = {
    coordinated: process.env.SANCTUARY_CLEANUP_COORDINATED,
    root: process.env.SANCTUARY_OWNERSHIP_ROOT,
  };
  try {
    delete process.env.SANCTUARY_CLEANUP_COORDINATED;
    delete process.env.SANCTUARY_OWNERSHIP_ROOT;
    assert.throws(assertCoordinatedReplayAuthority, /canonical cleanup coordinator/);
    process.env.SANCTUARY_CLEANUP_COORDINATED = '1';
    assert.throws(assertCoordinatedReplayAuthority, /canonical cleanup coordinator/);
  } finally {
    if (previous.coordinated === undefined) delete process.env.SANCTUARY_CLEANUP_COORDINATED;
    else process.env.SANCTUARY_CLEANUP_COORDINATED = previous.coordinated;
    if (previous.root === undefined) delete process.env.SANCTUARY_OWNERSHIP_ROOT;
    else process.env.SANCTUARY_OWNERSHIP_ROOT = previous.root;
  }
});

test('replay cleanup is exact, idempotent, fail-closed, and upload-safe', () => {
  assert.deepEqual(cleanupReplayResources([]), {
    schemaVersion: '1.0.0', artifactType: 'replay_cleanup_evidence', state: 'no_op',
    actions: [], results: [], postconditions: [], failureClasses: [],
  });
  const containers = new Set(resources.filter(resource => resource.resourceClass === 'compose_container')
    .map(resource => resource.immutableIdentity));
  const networks = new Set(resources.filter(resource => resource.resourceClass === 'compose_network')
    .map(resource => resource.immutableIdentity));
  const removed = [];
  const cleanupEvidence = cleanup(resources, {
    run: args => {
      if (args[1] === 'container' && args[2] === 'inspect') {
        const id = args.at(-1);
        if (!containers.has(id)) throw new Error(`No such object: ${id}`);
        return inspectedResource(resources.find(resource => resource.immutableIdentity === id));
      }
      if (args[1] === 'rm') {
        const id = args.at(-1);
        removed.push(id);
        containers.delete(id);
        return '';
      }
      if (args[1] === 'network' && args[2] === 'rm') {
        const id = args[3];
        removed.push(id);
        if (!networks.delete(id)) throw new Error('missing network');
        return '';
      }
      if (args[1] === 'network' && args[2] === 'inspect') {
        const id = args.at(-1);
        if (!networks.has(id)) throw new Error(`No such network: ${id}`);
        return inspectedResource(resources.find(resource => resource.immutableIdentity === id));
      }
      throw new Error(`unexpected command: ${args.join(' ')}`);
    },
  });
  assert.equal(cleanupEvidence.state, 'cleaned');
  assert.deepEqual(cleanupEvidence.failureClasses, []);
  assert.deepEqual(cleanupEvidence.results.map(result => result.result), ['cleaned', 'cleaned', 'cleaned']);
  assert.deepEqual(cleanupEvidence.actions.map(action => action.resourceClass), [
    'compose_container', 'compose_container', 'compose_network',
  ]);
  assert.deepEqual(cleanupEvidence.actions.map(action => action.locator), [
    resources[1].immutableIdentity, resources[2].immutableIdentity, resources[0].immutableIdentity,
  ]);
  assert.ok(cleanupEvidence.actions.every(action => action.locatorKind === 'engine_id'));
  assert.deepEqual(new Set(removed), new Set(resources.map(resource => resource.immutableIdentity)));
  assert.equal(containers.size, 0);
  assert.equal(networks.size, 0);

  const repeatedCleanup = cleanup(resources, {
    run: args => {
      if (args[1] === 'container' && args[2] === 'inspect') {
        throw new Error(`No such object: ${args.at(-1)}`);
      }
      if (args[1] === 'network' && args[2] === 'inspect') {
        throw new Error(`No such network: ${args.at(-1)}`);
      }
      throw new Error(`unexpected cleanup of absent resource: ${args.join(' ')}`);
    },
  });
  assert.equal(repeatedCleanup.state, 'cleaned');
  assert.deepEqual(repeatedCleanup.results.map(result => result.result), ['absent', 'absent', 'absent']);

  const identityChanged = cleanup([resources[1]], {
    run: args => {
      if (args[1] === 'container' && args[2] === 'inspect') {
        return inspectedResource({ ...resources[1], immutableIdentity: 'd'.repeat(64) });
      }
      throw new Error('identity-changed resource must not be removed');
    },
  });
  assert.deepEqual(identityChanged.failureClasses, ['identity_changed']);
  const ownershipChanged = cleanup([resources[1]], {
    run: args => {
      if (args[1] === 'container' && args[2] === 'inspect') {
        return inspectedResource(resources[1], [
          '--label', 'io.sanctuary.owner-id=foreign-owner',
        ]);
      }
      throw new Error('ownership-changed resource must not be removed');
    },
  });
  assert.deepEqual(ownershipChanged.failureClasses, ['ownership_changed']);
  let responseLossPresent = true;
  const responseLoss = cleanup([resources[1]], {
    run: args => {
      if (args[1] === 'container' && args[2] === 'inspect') {
        if (!responseLossPresent) throw new Error(`No such object: ${args.at(-1)}`);
        return inspectedResource(resources[1]);
      }
      if (args[1] === 'rm') {
        responseLossPresent = false;
        throw new Error('client lost the remove response');
      }
      throw new Error(`unexpected command: ${args.join(' ')}`);
    },
  });
  assert.equal(responseLoss.state, 'cleaned');
  assert.deepEqual(responseLoss.results.map(result => result.result), ['cleaned']);
  const queryFailed = cleanup([resources[1]], {
    run: () => { throw new Error('Cannot connect to the Docker daemon'); },
  });
  assert.deepEqual(queryFailed.failureClasses, ['query_failed']);

  const failClosedCalls = [];
  const failClosed = cleanup(resources, {
    run: args => {
      failClosedCalls.push(args);
      throw new Error('Cannot connect to the Docker daemon');
    },
  });
  assert.deepEqual(failClosed.results.map(result => result.result), ['ambiguous', 'refused', 'refused']);
  assert.deepEqual(failClosed.failureClasses, ['blocked_by_prior_failure', 'query_failed']);
  assert.equal(failClosedCalls.length, 1);

  const unsupported = cleanup([
    { resourceClass: 'oci_image', immutableIdentity: 'sha256:abc' },
  ], { run: () => { throw new Error('unsupported resources must not reach Docker'); } });
  assert.deepEqual(unsupported.failureClasses, ['unsupported']);
  const uploadSafeEvidence = buildReplayCleanupEvidence(cleanupEvidence, {
    sha256: 'a'.repeat(64), bytes: 10,
  });
  assert.equal(uploadSafeEvidence.evidenceAuthority, 'unsigned_subject_evidence');
  assert.deepEqual(uploadSafeEvidence.resourceCounts, {
    total: 3, cleaned: 3, retained: 0, refused: 0, ambiguous: 0,
  });
  assert.equal(JSON.stringify(uploadSafeEvidence).includes('worker-id'), false);

});

function responseLossRuntime(resourceClass, name, immutableIdentity) {
  const calls = [];
  const registered = [];
  return {
    calls,
    registered,
    runtime: {
      operation(args) {
        calls.push(args);
        if (args[1] === 'create' || (args[1] === 'network' && args[2] === 'create')
          || (args[1] === 'run' && args.includes('--detach'))) {
          throw new Error('client lost the create response');
        }
        if (args.includes('ls')) return `${immutableIdentity}\n`;
        if (args.includes('inspect')) {
          const labels = Object.fromEntries(replayOwnershipLabels(resourceClass)
            .flatMap((value, index, values) => value === '--label'
              ? [values[index + 1].split(/=(.*)/s).slice(0, 2)] : []));
          return JSON.stringify([resourceClass === 'compose_network'
            ? { Id: immutableIdentity, Name: name, Labels: labels }
            : { Id: immutableIdentity, Name: `/${name}`, State: { Status: 'created' }, Config: { Labels: labels } }]);
        }
        throw new Error(`unexpected command: ${args.join(' ')}`);
      },
      onCreated: (...args) => registered.push(args),
    },
    resourceClass,
    name,
  };
}

for (const fixture of [
  { resourceClass: 'compose_container', name: 'replay-worker', createArgs: ['docker', 'create'] },
  { resourceClass: 'compose_network', name: 'replay-network', createArgs: ['docker', 'network', 'create'] },
]) {
  test(`${fixture.resourceClass} create response loss registers one exact ID then preserves failure`, () => {
    const immutableIdentity = fixture.resourceClass === 'compose_network' ? 'b'.repeat(64) : 'a'.repeat(64);
    const recovery = responseLossRuntime(fixture.resourceClass, fixture.name, immutableIdentity);
    assert.throws(() => createReplayResource(
      fixture.resourceClass, fixture.name, fixture.createArgs, recovery.runtime,
    ), /client lost the create response/);
    assert.deepEqual(recovery.registered, [[fixture.resourceClass, fixture.name, immutableIdentity]]);
    const list = recovery.calls[1];
    assert.ok(list.includes('--no-trunc'));
    assert.ok(list.includes(`label=io.sanctuary.resource-class=${fixture.resourceClass}`));
    assert.ok(list.includes('label=io.sanctuary.lifecycle=obsolete'));
    assert.ok(list.includes('label=io.sanctuary.cleanup-policy=exact_delete'));
    assert.equal(recovery.calls.at(-1).at(-1), immutableIdentity);
  });
}

test('create response loss never permits a later mutation', () => {
  const immutableIdentity = 'e'.repeat(64);
  const recovery = responseLossRuntime('compose_container', 'replay-worker', immutableIdentity);
  assert.throws(() => {
    createReplayResource('compose_container', 'replay-worker', ['docker', 'create'], recovery.runtime);
    recovery.runtime.operation(['docker', 'start', immutableIdentity]);
  }, /client lost the create response/);
  assert.equal(recovery.calls.some(args => args.includes('start')), false);
});

test('attached helper response loss registers the exact orphan and never starts it', () => {
  const immutableIdentity = 'f'.repeat(64);
  const recovery = responseLossRuntime('compose_container', 'replay-migration', immutableIdentity);
  assert.throws(() => runRegisteredReplayContainer(
    'replay-migration', ['docker', 'create', '--rm'], recovery.runtime,
  ), /client lost the create response/);
  assert.deepEqual(recovery.registered, [['compose_container', 'replay-migration', immutableIdentity]]);
  assert.equal(recovery.calls.some(args => args.includes('start')), false);
});

test('valid create output is reinspected and a foreign ownership tuple is refused', () => {
  const immutableIdentity = '9'.repeat(64);
  const calls = [];
  assert.throws(() => createReplayResource(
    'compose_container', 'replay-worker', ['docker', 'create'], {
      operation(args) {
        calls.push(args);
        if (args[1] === 'create') return immutableIdentity;
        if (args.includes('ls')) return immutableIdentity;
        if (args.includes('inspect')) return JSON.stringify([{
          Id: immutableIdentity,
          Name: '/replay-worker',
          State: { Status: 'created' },
          Config: { Labels: { 'io.sanctuary.owner-id': 'foreign-owner' } },
        }]);
        throw new Error(`unexpected command: ${args.join(' ')}`);
      },
      onCreated: () => { throw new Error('foreign identity must not register'); },
    },
  ), /recovery identity is ambiguous/);
  assert.equal(calls.some(args => args.includes('start')), false);
});

test('valid foreign create output registers exact-name recovery before refusing', () => {
  const recoveredIdentity = '7'.repeat(64);
  const foreignResponse = '8'.repeat(64);
  const recovery = responseLossRuntime('compose_container', 'replay-worker', recoveredIdentity);
  recovery.runtime.operation = args => {
    recovery.calls.push(args);
    if (args[1] === 'create') return foreignResponse;
    if (args.includes('ls')) return recoveredIdentity;
    if (args.includes('inspect')) return inspectedResource({
      resourceClass: 'compose_container', name: 'replay-worker', immutableIdentity: recoveredIdentity,
    });
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };
  assert.throws(() => createReplayResource(
    'compose_container', 'replay-worker', ['docker', 'create'], recovery.runtime,
  ), /create response disagrees with exact-name recovery/);
  assert.deepEqual(recovery.registered, [[
    'compose_container', 'replay-worker', recoveredIdentity,
  ]]);
  assert.equal(recovery.calls.some(args => args.includes('start')), false);
});

test('create recovery fails closed on an ambiguous ownership match', () => {
  const first = 'c'.repeat(64);
  const second = 'd'.repeat(64);
  assert.throws(() => createReplayResource(
    'compose_network', 'replay-network', ['docker', 'network', 'create'], {
      operation(args) {
        if (args[2] === 'create') throw new Error('client lost the create response');
        if (args.includes('ls')) return `${first}\n${second}\n`;
        throw new Error('ambiguous recovery must not inspect or register');
      },
      onCreated: () => { throw new Error('ambiguous recovery must not register'); },
    },
  ), /recovery identity is ambiguous/);
});

test('create recovery fails closed when the ownership query is unavailable', () => {
  assert.throws(() => createReplayResource(
    'compose_container', 'replay-worker', ['docker', 'create'], {
      operation(args) {
        if (args[1] === 'create') throw new Error('client lost the create response');
        throw new Error('Cannot connect to the Docker daemon');
      },
      onCreated: () => { throw new Error('failed recovery must not register'); },
    },
  ), /recovery query failed/);
});

test('replay resources are obsolete and image cleanup policy is not overridden by the controller', () => {
  const labels = replayOwnershipLabels('compose_container');
  assert.ok(labels.includes('io.sanctuary.lifecycle=obsolete'));
  assert.ok(labels.includes('io.sanctuary.cleanup-policy=exact_delete'));
  const controller = readFileSync(new URL('../../scripts/perf/wallet-sync-high-fanout-replay.mjs', import.meta.url), 'utf8');
  assert.equal(controller.includes('registerReplayImageIdentities'), false);
  assert.doesNotMatch(controller, /registerReplayResource\(['"]oci_image/);
  const imageHelper = readFileSync(new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url), 'utf8');
  assert.match(imageHelper, /register_owned_resource oci_image obsolete[\s\\]+exact_delete/);
  assert.match(imageHelper, /exact_delete reference "\$image_ref" "\$image_id"/);
  assert.doesNotMatch(imageHelper, /ownership_label_args oci_image|OWNERSHIP_LABEL_ARGS/);
  assert.doesNotMatch(imageHelper, /io\.sanctuary\.(?:deployment-id|owner-id|creation-run-id)/);
  assert.equal(imageHelper.match(/\n\s*load_and_register_image /g)?.length, 2);
  assert.doesNotMatch(imageHelper, /register_owned_resource oci_image[^\n]*retain/);
});

test('distinct build provenance cannot replace the consuming lane registration identity', () => {
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    ownership_initialize() { :; }
    docker() { printf 'sha256:%064d\n' 0; }
    register_owned_resource() { printf 'registration=%s\n' "$*"; }
    export SANCTUARY_PROJECT=replay-live-project SANCTUARY_DEPLOYMENT_ID=replay-live-deployment
    export SANCTUARY_OWNER_ID=replay-live-owner SANCTUARY_OPERATION_RUN_ID=replay-live-run
    export SANCTUARY_COMMIT=1111111111111111111111111111111111111111
    register_loaded_image replay:test /tmp "sha256:${'0'.repeat(64)}"
    printf '%s\n' "$SANCTUARY_PROJECT" "$SANCTUARY_DEPLOYMENT_ID" "$SANCTUARY_OWNER_ID" \
      "$SANCTUARY_OPERATION_RUN_ID" "$SANCTUARY_COMMIT"
  `, '_', helper], { encoding: 'utf8' });
  assert.equal(output, `registration=oci_image obsolete exact_delete reference replay:test sha256:${'0'.repeat(64)} replay-live-run\nreplay-live-project\nreplay-live-deployment\nreplay-live-owner\nreplay-live-run\n${'1'.repeat(40)}\n`);
});

for (const lane of ['build', 'load']) {
  test(`${lane} response loss recovers the exact image registration and preserves failure`, () => {
    const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
    const output = execFileSync('bash', ['-c', String.raw`
      set -euo pipefail
      source "$1"
      ownership_initialize() { :; }
      docker() {
        if [ "$1 $2" = 'load --input' ]; then return 23; fi
        if [ "$1 $2" = 'image ls' ]; then printf 'sha256:%064d\n' 0; return; fi
        if [ "$1 $2" = 'image inspect' ]; then
          printf '%s\n' '[{"Id":"sha256:${'0'.repeat(64)}","RepoTags":["replay:test"],"RepoDigests":[],"Config":{"Labels":{"org.opencontainers.image.source":"https://github.com/nekoguntai-castle/sanctuary","org.opencontainers.image.version":"0.8.69","org.opencontainers.image.revision":"${'1'.repeat(40)}","io.sanctuary.build-id":"distinct-build-run","dev.sanctuary.image-lock-sha256":"${'2'.repeat(64)}"}}}]'
          return
        fi
        return 99
      }
      register_owned_resource() { printf 'registration=%s\n' "$*"; }
      export SANCTUARY_OPERATION_RUN_ID="replay-$2-run"
      set +e
      load_and_register_image /tmp/archive replay:test "sha256:${'0'.repeat(64)}" \
        "${'1'.repeat(40)}" "${'2'.repeat(64)}" /tmp
      status=$?
      set -e
      printf 'status=%s\n' "$status"
      test "$status" -eq 23
    `, '_', helper, lane], { encoding: 'utf8' });
    assert.match(output, new RegExp(`registration=oci_image obsolete exact_delete reference replay:test sha256:${'0'.repeat(64)} replay-${lane}-run`));
    assert.match(output, /status=23/);
  });
}

test('response-loss recovery refuses an image with an additional tag', () => {
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    ownership_initialize() { :; }
    docker() {
      if [ "$1 $2" = 'load --input' ]; then return 23; fi
      if [ "$1 $2" = 'image ls' ]; then printf 'sha256:%064d\n' 0; return; fi
      if [ "$1 $2" = 'image inspect' ]; then
        printf '%s\n' '[{"Id":"sha256:${'0'.repeat(64)}","RepoTags":["replay:test","shared:test"],"RepoDigests":[],"Config":{"Labels":{"org.opencontainers.image.source":"https://github.com/nekoguntai-castle/sanctuary","org.opencontainers.image.version":"0.8.69","org.opencontainers.image.revision":"${'1'.repeat(40)}","io.sanctuary.build-id":"build-run","dev.sanctuary.image-lock-sha256":"${'2'.repeat(64)}"}}}]'
        return
      fi
      return 99
    }
    register_owned_resource() { printf 'unexpected-registration\n'; }
    set +e
    load_and_register_image /tmp/archive replay:test "sha256:${'0'.repeat(64)}" \
      "${'1'.repeat(40)}" "${'2'.repeat(64)}" /tmp 2>/dev/null
    status=$?
    set -e
    printf 'status=%s\n' "$status"
  `, '_', helper], { encoding: 'utf8' });
  assert.equal(output, 'status=23\n');
});

test('replay registration signs obsolete exact-delete authority for the immutable engine ID', () => {
  const root = mkdtempSync(join(tmpdir(), 'sanctuary-replay-ownership-'));
  const previous = Object.fromEntries([
    'SANCTUARY_OWNERSHIP_ROOT', 'SANCTUARY_COMMIT', 'SANCTUARY_DEPLOYMENT_ID',
    'SANCTUARY_OWNER_ID', 'SANCTUARY_RELEASE', 'SANCTUARY_OPERATION_RUN_ID',
  ].map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SANCTUARY_OWNERSHIP_ROOT: root,
    SANCTUARY_COMMIT: '1'.repeat(40),
    SANCTUARY_DEPLOYMENT_ID: 'replay-deployment',
    SANCTUARY_OWNER_ID: 'replay-owner',
    SANCTUARY_RELEASE: 'test-release',
    SANCTUARY_OPERATION_RUN_ID: 'replay-run',
  });
  try {
    const immutableIdentity = 'e'.repeat(64);
    registerReplayResource('compose_container', 'replay-worker', immutableIdentity);
    const directory = join(root, 'registrations', 'compose_container');
    const registrationPath = readdirSync(directory).find(name => name.endsWith('.json'));
    const registration = JSON.parse(readFileSync(join(directory, registrationPath), 'utf8'));
    assert.equal(registration.lifecycle, 'obsolete');
    assert.equal(registration.cleanupPolicy, 'exact_delete');
    assert.equal(registration.locatorKind, 'engine_id');
    assert.equal(registration.locator, immutableIdentity);
    assert.equal(registration.immutableIdentity, immutableIdentity);
    assert.match(registration.registrationId, /^[a-f0-9]{64}$/);
    assert.match(registration.signerKeyId, /^[a-f0-9]{64}$/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
