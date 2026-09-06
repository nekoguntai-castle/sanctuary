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
    sleep: () => {},
  });
  assert.deepEqual(queryFailed.failureClasses, ['query_failed']);

  // Fail-closed: a daemon that cannot be reached is retried for the first
  // resource only; no later resource is ever touched.
  const failClosedCalls = [];
  const failClosed = cleanup(resources, {
    run: args => {
      failClosedCalls.push(args);
      throw new Error('Cannot connect to the Docker daemon');
    },
    sleep: () => {},
  });
  assert.deepEqual(failClosed.results.map(result => result.result), ['ambiguous', 'refused', 'refused']);
  assert.deepEqual(failClosed.failureClasses, ['blocked_by_prior_failure', 'query_failed']);
  assert.equal(failClosedCalls.length, 3);
  assert.ok(failClosedCalls.every(args => args[1] === 'container' && args[2] === 'inspect'
    && args.at(-1) === resources[1].immutableIdentity));

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

test('build stamps the source version from a relative source root', () => {
  // The RC workflow passes `.tmp/wallet-sync-replay/rc10-source` (relative to
  // the checkout) as the rc10 source root. A bare `require(relativePath)` is a
  // module-name lookup, not a file path, so the version stamp failed with
  // MODULE_NOT_FOUND on v0.8.70-rc1 (run 14651) while rc11's `.` still worked.
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), 'sanctuary-replay-source-'));
  try {
    const output = execFileSync('bash', ['-c', String.raw`
      set -euo pipefail
      source "$1"
      cd "$2"
      mkdir -p nested/source
      printf '{"version":"9.8.7"}
' > nested/source/package.json
      replay_source_version nested/source
      printf '
'
      replay_source_version "$2/nested/source"
      printf '
'
    `, '_', helper, root], { encoding: 'utf8' });
    assert.equal(output, '9.8.7\n9.8.7\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loaded image verification accepts the containerd image store identity', () => {
  // v0.8.70-rc2 (run 14664): the runner's Docker 29 daemon uses the containerd
  // image store, which reports a loaded image's ID as its manifest digest and
  // lists a repo digest for it, and (rc3, run 14693) reports the tag and the
  // repo digest fully qualified as docker.io/library/…. The archive-derived config digest is still an
  // exact identity of the same bytes, so the gate must accept either form and
  // register the ID the daemon actually uses.
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const configDigest = `sha256:${'0'.repeat(64)}`;
  const manifestDigest = `sha256:${'3'.repeat(64)}`;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    ownership_initialize() { :; }
    docker_manifest="$3"
    docker() {
      if [ "$1 $2" = 'load --input' ]; then echo "Loaded image: docker.io/library/replay:test"; return; fi
      if [ "$1 $2" = 'image ls' ]; then printf '%s\n' "$docker_manifest"; return; fi
      if [ "$1 $2" = 'image inspect' ]; then
        printf '%s\n' '[{"Id":"'"$docker_manifest"'","RepoTags":["docker.io/library/replay:test"],"RepoDigests":["docker.io/library/replay@'"$docker_manifest"'"],"Config":{"Labels":{"org.opencontainers.image.source":"https://github.com/nekoguntai-castle/sanctuary","org.opencontainers.image.version":"0.8.70","org.opencontainers.image.revision":"${'1'.repeat(40)}","io.sanctuary.build-id":"build-run","dev.sanctuary.image-lock-sha256":"${'2'.repeat(64)}"}}}]'
        return
      fi
      return 99
    }
    register_owned_resource() { printf 'registration=%s
' "$*"; }
    export SANCTUARY_OPERATION_RUN_ID=replay-containerd-run
    load_and_register_image /tmp/archive replay:test "$2"       "${'1'.repeat(40)}" "${'2'.repeat(64)}" /tmp "$3"
    printf 'status=%s
' "$?"
  `, '_', helper, configDigest, manifestDigest], { encoding: 'utf8' });
  assert.match(output, new RegExp(`registration=oci_image obsolete exact_delete reference replay:test ${manifestDigest} replay-containerd-run`));
  assert.match(output, /status=0/);
});

test('loaded image verification still refuses an identity that matches neither digest', () => {
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    ownership_initialize() { :; }
    docker() {
      if [ "$1 $2" = 'load --input' ]; then return; fi
      if [ "$1 $2" = 'image ls' ]; then printf 'sha256:%064d
' 9; return; fi
      if [ "$1 $2" = 'image inspect' ]; then printf '%s\n' '[{"Id":"sha256:${'9'.repeat(64)}","RepoTags":["replay:test"],"RepoDigests":[],"Config":{"Labels":{}}}]'; return; fi
      return 99
    }
    register_owned_resource() { printf 'unexpected-registration
'; }
    set +e
    load_and_register_image /tmp/archive replay:test "sha256:${'0'.repeat(64)}"       "${'1'.repeat(40)}" "${'2'.repeat(64)}" /tmp "sha256:${'3'.repeat(64)}" 2>&1
    printf 'status=%s
' "$?"
  `, '_', helper], { encoding: 'utf8' });
  assert.doesNotMatch(output, /unexpected-registration/);
  assert.match(output, /recovery is ambiguous/);
  assert.match(output, /status=1/);
});

test('loaded image verification still refuses a second tag even when qualified', () => {
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    ownership_initialize() { :; }
    docker() {
      if [ "$1 $2" = 'load --input' ]; then return; fi
      if [ "$1 $2" = 'image ls' ]; then printf 'sha256:%064d\n' 0; return; fi
      if [ "$1 $2" = 'image inspect' ]; then printf '%s\n' '[{"Id":"sha256:${'0'.repeat(64)}","RepoTags":["docker.io/library/replay:test","docker.io/library/shared:test"],"RepoDigests":[],"Config":{"Labels":{}}}]'; return; fi
      return 99
    }
    register_owned_resource() { printf 'unexpected-registration\n'; }
    set +e
    load_and_register_image /tmp/archive replay:test "sha256:${'0'.repeat(64)}" \
      "${'1'.repeat(40)}" "${'2'.repeat(64)}" /tmp 2>&1
    printf 'status=%s\n' "$?"
  `, '_', helper], { encoding: 'utf8' });
  assert.doesNotMatch(output, /unexpected-registration/);
  assert.match(output, /RepoTags/);
  assert.match(output, /status=1/);
});

test('loaded image verification accepts a historical source tree that only labels revision and image lock', () => {
  // The rc10 replay image is built from the pinned historical revision, whose
  // server/Dockerfile labels only org.opencontainers.image.revision and
  // dev.sanctuary.image-lock-sha256 (v0.8.70-rc4, run 14706: "source label").
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    ownership_initialize() { :; }
    docker() {
      if [ "$1 $2" = 'load --input' ]; then return; fi
      if [ "$1 $2" = 'image ls' ]; then printf 'sha256:%064d\n' 0; return; fi
      if [ "$1 $2" = 'image inspect' ]; then printf '%s\n' '[{"Id":"sha256:${'0'.repeat(64)}","RepoTags":["docker.io/library/replay:test"],"RepoDigests":[],"Config":{"Labels":{"org.opencontainers.image.revision":"${'1'.repeat(40)}","dev.sanctuary.image-lock-sha256":"${'2'.repeat(64)}"}}}]'; return; fi
      return 99
    }
    register_owned_resource() { printf 'registration=%s\n' "$*"; }
    export SANCTUARY_OPERATION_RUN_ID=replay-historical-run
    load_and_register_image /tmp/archive replay:test "sha256:${'0'.repeat(64)}" \
      "${'1'.repeat(40)}" "${'2'.repeat(64)}" /tmp
    printf 'status=%s\n' "$?"
  `, '_', helper], { encoding: 'utf8' });
  assert.match(output, /registration=oci_image obsolete exact_delete reference replay:test sha256:0{64} replay-historical-run/);
  assert.match(output, /status=0/);
});

test('loaded image verification still refuses a wrong source label when one is present', () => {
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    ownership_initialize() { :; }
    docker() {
      if [ "$1 $2" = 'load --input' ]; then return; fi
      if [ "$1 $2" = 'image ls' ]; then printf 'sha256:%064d\n' 0; return; fi
      if [ "$1 $2" = 'image inspect' ]; then printf '%s\n' '[{"Id":"sha256:${'0'.repeat(64)}","RepoTags":["replay:test"],"RepoDigests":[],"Config":{"Labels":{"org.opencontainers.image.source":"https://example.invalid/other","org.opencontainers.image.revision":"${'1'.repeat(40)}","dev.sanctuary.image-lock-sha256":"${'2'.repeat(64)}"}}}]'; return; fi
      return 99
    }
    register_owned_resource() { printf 'unexpected-registration\n'; }
    set +e
    load_and_register_image /tmp/archive replay:test "sha256:${'0'.repeat(64)}" \
      "${'1'.repeat(40)}" "${'2'.repeat(64)}" /tmp 2>&1
    printf 'status=%s\n' "$?"
  `, '_', helper], { encoding: 'utf8' });
  assert.doesNotMatch(output, /unexpected-registration/);
  assert.match(output, /source label/);
  assert.match(output, /status=1/);
});

test('build stamps provenance labels so a historical source tree yields a cleanable image', () => {
  // v0.8.70-rc5 (run 14721): both replay images built and registered, but the
  // cleanup coordinator refused the rc10 image (protected/unlabeled/
  // unregistered). An unlabeled image is only externally registered when its
  // labels prove provenance (source, revision, image lock, version, build-id);
  // the pinned rc10 Dockerfile emits only revision and image lock, so the
  // build must stamp all five with --label regardless of the source tree.
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    replay_provenance_label_args "${'1'.repeat(40)}" "${'2'.repeat(64)}" 0.8.70 run-14721-1-images
  `, '_', helper], { encoding: 'utf8' });
  assert.deepEqual(output.split('\n').filter(Boolean), [
    '--label', 'org.opencontainers.image.source=https://github.com/nekoguntai-castle/sanctuary',
    '--label', `org.opencontainers.image.revision=${'1'.repeat(40)}`,
    '--label', `dev.sanctuary.image-lock-sha256=${'2'.repeat(64)}`,
    '--label', 'org.opencontainers.image.version=0.8.70',
    '--label', 'io.sanctuary.build-id=run-14721-1-images',
  ]);
  const source = readFileSync(helper, 'utf8');
  assert.match(source, /docker buildx build \\\n(?:.*\\\n)*?\s+"\$\{provenance_label_args\[@\]\}" \\\n/,
    'build_image must pass the provenance labels to docker buildx build');
});

test('replay cleanup records the daemon error behind a query failure and retries transient ones', () => {
  // v0.8.70-rc6 (run 14734): the rc10 replay's owned cleanup reported
  // "blocked_by_prior_failure,query_failed" and aborted the lane while the
  // signed coordinator cleaned the same four resources. The evidence carried
  // no error text, so the cause is unknown. Record the redacted first line of
  // the daemon error, and retry an inspect that fails for a reason other than
  // absence before classifying it.
  const [network, container] = resources;
  let attempts = 0;
  const transient = cleanup([container], {
    run: args => {
      if (args[1] === 'container' && args[2] === 'inspect') {
        attempts += 1;
        if (attempts === 1) throw new Error('Error response from daemon: context deadline exceeded');
        if (attempts === 2) return inspectedResource(container);
        throw new Error(`No such container: ${args.at(-1)}`);
      }
      if (args[1] === 'rm') return '';
      throw new Error(`unexpected command: ${args.join(' ')}`);
    },
    sleep: () => {},
  });
  assert.equal(transient.state, 'cleaned');
  assert.deepEqual(transient.results.map(result => result.result), ['cleaned']);
  assert.equal(attempts, 3);

  let persistentAttempts = 0;
  const persistent = cleanup([container, network], {
    run: args => {
      if (args[1] === 'container' && args[2] === 'inspect') {
        persistentAttempts += 1;
        const error = new Error('Command failed: docker container inspect');
        error.stderr = 'Error response from daemon: dial unix /var/run/docker.sock: connect: permission denied\nsecond line';
        throw error;
      }
      throw new Error(`unexpected command: ${args.join(' ')}`);
    },
    sleep: () => {},
  });
  assert.equal(persistent.state, 'partial');
  assert.deepEqual(persistent.failureClasses, ['blocked_by_prior_failure', 'query_failed']);
  assert.equal(persistentAttempts, 3);
  assert.equal(persistent.results[0].failureDetail, 'Error response from daemon: dial unix /var/run/docker.sock: connect: permission denied');
  assert.equal(persistent.results[1].failureDetail, undefined);
  const evidence = buildReplayCleanupEvidence(persistent, null);
  assert.deepEqual(evidence.failureDetails, [{
    sequence: 1, resourceClass: 'compose_container', failureClass: 'query_failed',
    detail: 'Error response from daemon: dial unix /var/run/docker.sock: connect: permission denied',
  }]);
});

test('replay cleanup treats Docker 29 containerd-store absence wording as absent', () => {
  // v0.8.70-rc7 (run 14747): the recorded daemon error for the already-removed
  // `--rm` migration container was
  //   Error response from daemon: no container with name or ID "…" found: no such container
  // which the classic `No such container:` pattern did not match, so the
  // absent resource was classified query_failed and blocked the rest.
  const [network, container] = resources;
  const wordings = [
    `Error response from daemon: no container with name or ID "${container.immutableIdentity}" found: no such container`,
    `Error response from daemon: No such container: ${container.immutableIdentity}`,
    `Error: No such object: ${container.immutableIdentity}`,
  ];
  for (const wording of wordings) {
    const evidence = cleanup([container, network], {
      run: args => {
        if (args[1] === 'container' && args[2] === 'inspect') {
          const error = new Error(`Command failed: docker container inspect ${args.at(-1)}`);
          error.stderr = wording;
          throw error;
        }
        if (args[1] === 'network' && args[2] === 'inspect') {
          throw new Error(`Error response from daemon: network ${args.at(-1)} not found`);
        }
        throw new Error(`unexpected command: ${args.join(' ')}`);
      },
      sleep: () => { throw new Error('absence must not be retried'); },
    });
    assert.deepEqual(evidence.results.map(result => result.result), ['absent', 'absent'], wording);
    assert.equal(evidence.state, 'cleaned', wording);
  }
});

test('loaded image verification reports every failing check in one run', () => {
  // v0.8.70-rc2 through rc5 each surfaced exactly one of identity, tags,
  // digests, and labels per release cycle because the gate returned at its
  // first mismatch (issue #1020). One run must name all of them.
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    ownership_initialize() { :; }
    docker() {
      if [ "$1 $2" = 'load --input' ]; then return; fi
      if [ "$1 $2" = 'image ls' ]; then printf 'sha256:%064d\n' 9; return; fi
      if [ "$1 $2" = 'image inspect' ]; then printf '%s\n' '[{"Id":"sha256:${'8'.repeat(64)}","RepoTags":["replay:test","shared:test"],"RepoDigests":["replay@sha256:${'7'.repeat(64)}"],"Config":{"Labels":{"org.opencontainers.image.source":"https://example.invalid/other","org.opencontainers.image.revision":"${'5'.repeat(40)}","dev.sanctuary.image-lock-sha256":"${'6'.repeat(64)}"}}}]'; return; fi
      return 99
    }
    register_owned_resource() { printf 'unexpected-registration\n'; }
    set +e
    load_and_register_image /tmp/archive replay:test "sha256:${'0'.repeat(64)}" \
      "${'1'.repeat(40)}" "${'2'.repeat(64)}" /tmp "sha256:${'3'.repeat(64)}" 2>&1
    printf 'status=%s\n' "$?"
  `, '_', helper], { encoding: 'utf8' });
  assert.doesNotMatch(output, /unexpected-registration/);
  assert.match(output, /7 failing checks/);
  for (const failure of [
    /identity mismatch: daemon lists 'sha256:0{63}9'/, /inspect Id sha256:8{64} differs from listed sha256:0{63}9/,
    /RepoTags \["replay:test","shared:test"\]/, /RepoDigests \["replay@sha256:7{64}"\]/,
    /revision label/, /image-lock label/, /source label/,
  ]) assert.match(output, failure);
  assert.match(output, /status=1/);
});

test('loaded image verification reports every failing check in one run on the containerd image store', () => {
  // Issue #1020 item 3: the classic-store version of this test above proves
  // every check fails independently and is reported together, but every
  // fixture in it is unqualified (bare "replay:test", bare "replay@sha256:…").
  // The containerd store (v0.8.70-rc2/rc3) qualifies RepoTags and RepoDigests
  // as docker.io/library/… and reports the manifest digest as the image ID --
  // the exact shape the qualify()-aware RepoTags/RepoDigests comparison exists
  // for. Repeat the all-seven-checks-fail proof under that shape so a
  // regression in the qualified comparison cannot hide behind
  // classic-only-store coverage.
  const helper = new URL('../../scripts/ci/wallet-sync-replay-image.sh', import.meta.url).pathname;
  const output = execFileSync('bash', ['-c', String.raw`
    set -euo pipefail
    source "$1"
    ownership_initialize() { :; }
    docker() {
      if [ "$1 $2" = 'load --input' ]; then return; fi
      if [ "$1 $2" = 'image ls' ]; then printf 'sha256:%064d\n' 9; return; fi
      if [ "$1 $2" = 'image inspect' ]; then printf '%s\n' '[{"Id":"sha256:${'8'.repeat(64)}","RepoTags":["docker.io/library/replay:test","docker.io/library/shared:test"],"RepoDigests":["docker.io/library/replay@sha256:${'7'.repeat(64)}"],"Config":{"Labels":{"org.opencontainers.image.source":"https://example.invalid/other","org.opencontainers.image.revision":"${'5'.repeat(40)}","dev.sanctuary.image-lock-sha256":"${'6'.repeat(64)}"}}}]'; return; fi
      return 99
    }
    register_owned_resource() { printf 'unexpected-registration\n'; }
    set +e
    load_and_register_image /tmp/archive replay:test "sha256:${'0'.repeat(64)}" \
      "${'1'.repeat(40)}" "${'2'.repeat(64)}" /tmp "sha256:${'3'.repeat(64)}" 2>&1
    printf 'status=%s\n' "$?"
  `, '_', helper], { encoding: 'utf8' });
  assert.doesNotMatch(output, /unexpected-registration/);
  assert.match(output, /7 failing checks/);
  for (const failure of [
    /identity mismatch: daemon lists 'sha256:0{63}9'/, /inspect Id sha256:8{64} differs from listed sha256:0{63}9/,
    /RepoTags \["docker\.io\/library\/replay:test","docker\.io\/library\/shared:test"\]/,
    /RepoDigests \["docker\.io\/library\/replay@sha256:7{64}"\]/,
    /revision label/, /image-lock label/, /source label/,
  ]) assert.match(output, failure);
  assert.match(output, /status=1/);
});
