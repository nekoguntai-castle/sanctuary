import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const scripts = [
  ['ops:alert-receiver:phase2', 'phase2-alert-smoke', 'scripts/ops/phase2-alert-receiver-smoke.mjs'],
  ['ops:gateway-audit:phase2', 'phase2-gateway-audit', 'scripts/ops/phase2-gateway-audit-compose-smoke.mjs'],
  ['perf:phase3:compose-smoke', 'phase3-compose-smoke', 'scripts/perf/phase3-compose-benchmark-smoke.mjs'],
];

test('Docker-producing phase smoke package commands always select signed cleanup', () => {
  for (const [name, lane, subject] of scripts) {
    const command = packageJson.scripts[name];
    assert.match(command, /^scripts\/ci\/cleanup-ci-callsite\.sh auto-run /);
    assert.match(command, new RegExp(`--lane ${lane}\\b`));
    let lifecycle = `-- node ${subject}`;
    if (name === 'ops:gateway-audit:phase2') {
      lifecycle = '-- scripts/ci/run-ci-compose-subject.sh '
        + '--expected-image sanctuary-backend --expected-image sanctuary-gateway '
        + `-- node ${subject}`;
    } else if (name === 'perf:phase3:compose-smoke') {
      lifecycle = '-- scripts/ci/run-ci-compose-subject.sh '
        + '--expected-image sanctuary-backend --expected-image sanctuary-frontend '
        + `--expected-image sanctuary-gateway -- node ${subject}`;
    }
    assert.ok(command.endsWith(lifecycle));
  }
});

test('main Compose smoke subjects share exact image and volume registration', () => {
  const wrapper = readFileSync('scripts/ci/run-ci-compose-subject.sh', 'utf8');
  const hooks = readFileSync('scripts/ownership/producer-hooks.sh', 'utf8');
  const images = readFileSync('scripts/ownership/compose-image-registration.sh', 'utf8');
  const e2e = readFileSync('scripts/ci/run-compose-e2e-subject.sh', 'utf8');
  const dockerTest = readFileSync('scripts/ci/run-docker-test-subject.sh', 'utf8');
  assert.match(wrapper, /ownership_initialize_build_identity/);
  assert.match(wrapper, /export_lane_image_tag/);
  assert.match(wrapper, /trap finalize_registration EXIT/);
  assert.match(wrapper, /register_ci_compose_resources/);
  assert.match(images, /register_exact_built_image/);
  assert.match(images, /wait_for_ci_compose_image_refs/);
  assert.match(e2e, /--expected-image sanctuary-backend/);
  assert.match(e2e, /--expected-image sanctuary-llm-egress-proxy/);
  assert.match(dockerTest, /--allow-no-owned-images --/);
  assert.match(hooks, /register_owned_resource compose_volume obsolete exact_delete name/);
  assert.match(hooks, /io\.sanctuary\.creation-run-id/);
});

test('main Compose wrapper attempts exact registration when its subject is interrupted', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'compose-subject-signal-'));
  chmodSync(root, 0o700);
  const bin = path.join(root, 'bin');
  const calls = path.join(root, 'docker.calls');
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$COMPOSE_SIGNAL_CALLS"
exit 0
`, { mode: 0o700 });
  const result = spawnSync('scripts/ci/run-ci-compose-subject.sh', [
    '--allow-no-owned-images', '--', 'bash', '-c', 'kill -TERM "$PPID"; exit 0',
  ], {
    cwd: '.', encoding: 'utf8',
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`,
      COMPOSE_SIGNAL_CALLS: calls, SANCTUARY_CLEANUP_COORDINATED: '1',
      COMPOSE_PROJECT_NAME: 'signal-compose', SANCTUARY_PROJECT: 'signal-compose',
      SANCTUARY_DEPLOYMENT_ID: 'deploy-signal-compose', SANCTUARY_OWNER_ID: 'owner-signal',
      SANCTUARY_OPERATION_RUN_ID: 'run-signal-compose', SANCTUARY_RELEASE: 'unreleased',
      SANCTUARY_COMMIT: 'a'.repeat(40), SANCTUARY_CLEANUP_CREATED_AT: '2026-09-01T00:00:00.000Z',
      SANCTUARY_RESOURCE_LIFECYCLE: 'obsolete', SANCTUARY_OWNERSHIP_ROOT: path.join(root, 'ownership'),
    },
  });
  assert.equal(result.signal, 'SIGTERM', result.stderr);
  const dockerCalls = readFileSync(calls, 'utf8');
  assert.match(dockerCalls, /image ls .*io\.sanctuary\.build-id/);
  assert.match(dockerCalls, /volume ls .*io\.sanctuary\.creation-run-id=run-signal-compose/);
});

test('bounded image provenance and retirement admit a responsive post-build daemon', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'compose-image-latency-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'image.state');
  const calls = path.join(root, 'docker.calls');
  const imageId = `sha256:${'7'.repeat(64)}`;
  const imageRef = 'localhost/sanctuary-latency-proof:test';
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(state, 'present\n');
writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$LATENCY_DOCKER_CALLS"
case "$1 $2" in
  "image inspect")
    sleep 0.05
    [ "$(cat "$LATENCY_IMAGE_STATE")" = present ] || exit 1
    jq -cn --arg id "$LATENCY_IMAGE_ID" --arg ref "$LATENCY_IMAGE_REF" \\
      '[{Id:$id,Created:"2026-09-01T00:00:00Z",RepoTags:[$ref],Config:{Labels:{"io.sanctuary.build-id":"latency-build"}}}]'
    ;;
  "image rm") sleep 0.05; printf 'absent\\n' > "$LATENCY_IMAGE_STATE" ;;
  "image ls")
    # Docker 29 can hold its image-store lock for longer than the old 900ms
    # per-call slice after a large Buildx --load and image removal.
    sleep 1.2
    if [ "$(cat "$LATENCY_IMAGE_STATE")" = present ]; then
      printf '%s\\n' "$LATENCY_IMAGE_ID"
    fi
    ;;
  *) exit 2 ;;
esac
`, { mode: 0o700 });
  const result = spawnSync('bash', ['-c', `
set -euo pipefail
source scripts/ownership/compose-image-registration.sh
observed="$(recover_exact_loaded_image "$LATENCY_IMAGE_REF" latency-build)"
[ "$observed" = "$LATENCY_IMAGE_ID" ]
retire_exact_built_image "$LATENCY_IMAGE_REF" "$LATENCY_IMAGE_ID" latency-build
`], {
    cwd: '.', encoding: 'utf8', timeout: 10_000,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`,
      LATENCY_DOCKER_CALLS: calls, LATENCY_IMAGE_STATE: state,
      LATENCY_IMAGE_ID: imageId, LATENCY_IMAGE_REF: imageRef,
    },
  });
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(state, 'utf8'), 'absent\n');
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
    `image inspect ${imageRef}`, `image inspect ${imageRef}`,
    `image inspect ${imageRef}`, `image rm ${imageRef}`,
    `image ls --no-trunc --filter reference=${imageRef} --format {{.ID}}`,
  ]);
});

test('late Docker stalls cannot consume the coordinator grace or replace subject failure', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'compose-subject-deadline-'));
  chmodSync(root, 0o700);
  const bin = path.join(root, 'bin');
  const pids = path.join(root, 'docker.pids');
  const calls = path.join(root, 'docker.calls');
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$COMPOSE_DEADLINE_CALLS"
stall() {
  printf '%s\\n' "$$" >> "$COMPOSE_DEADLINE_PIDS"
  sleep 30 & child=$!
  trap 'kill "$child" 2>/dev/null; wait "$child" 2>/dev/null; exit 143' TERM INT HUP
  wait "$child"
}
image_id="sha256:$(printf '6%.0s' {1..64})"
case "$1 $2" in
  "image ls")
    if [[ "$*" == *"label=io.sanctuary.build-id"* ]]; then
      printf '%s\\t%s\\n' "$image_id" 'sanctuary-backend:deadline-compose'
    else
      printf '%s\\n' "$image_id"
    fi
    ;;
  "image inspect")
    printf '[{"Id":"%s","Created":"2026-09-01T00:00:00Z","RepoTags":["sanctuary-backend:deadline-compose","shared:keep"],"Config":{"Labels":{"io.sanctuary.build-id":"run-deadline"}}}]\\n' "$image_id"
    ;;
  "volume ls"|"image rm") stall ;;
esac
exit 0
`, { mode: 0o700 });
  const started = Date.now();
  const result = spawnSync('scripts/ci/run-ci-compose-subject.sh', [
    '--expected-image', 'sanctuary-backend', '--', 'bash', '-c', 'exit 37',
  ], {
    cwd: '.', encoding: 'utf8', timeout: 5_000,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`,
      COMPOSE_DEADLINE_PIDS: pids, COMPOSE_DEADLINE_CALLS: calls,
      SANCTUARY_CLEANUP_COORDINATED: '1',
      COMPOSE_PROJECT_NAME: 'deadline-compose', SANCTUARY_PROJECT: 'deadline-compose',
      SANCTUARY_DEPLOYMENT_ID: 'deploy-deadline-compose', SANCTUARY_OWNER_ID: 'owner-deadline',
      SANCTUARY_OPERATION_RUN_ID: 'run-deadline', SANCTUARY_RELEASE: 'unreleased',
      SANCTUARY_COMMIT: 'a'.repeat(40), SANCTUARY_CLEANUP_CREATED_AT: '2026-09-01T00:00:00.000Z',
      SANCTUARY_RESOURCE_LIFECYCLE: 'obsolete', SANCTUARY_OWNERSHIP_ROOT: path.join(root, 'ownership'),
    },
  });
  const elapsed = Date.now() - started;
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 37, result.stderr);
  assert.ok(elapsed < 4_500, `late registration consumed ${elapsed}ms`);
  const dockerCalls = readFileSync(calls, 'utf8');
  assert.match(dockerCalls, /(?:volume ls|image rm sanctuary-backend:deadline-compose)/);
  const stalledPids = readFileSync(pids, 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(stalledPids.length >= 1, 'the fixture did not enter a supervised Docker stall');
  for (const pid of stalledPids) {
    assert.throws(() => process.kill(Number(pid), 0), { code: 'ESRCH' });
  }
});

test('local Docker package and run-tests entrypoints use the same coordinator lifecycle', () => {
  const subject = readFileSync('scripts/ci/run-docker-test-subject.sh', 'utf8');
  const runner = readFileSync('scripts/run-tests.sh', 'utf8');
  for (const name of ['test:docker', 'test:docker:backend', 'test:docker:frontend',
    'test:docker:coverage']) {
    assert.match(packageJson.scripts[name], /scripts\/ci\/run-docker-test-subject\.sh/);
  }
  assert.match(subject, /cleanup-ci-callsite\.sh" auto-run/);
  assert.match(subject, /run-ci-compose-subject\.sh/);
  assert.doesNotMatch(runner, /scripts\/ownership\/run-compose\.sh/);
  assert.match(runner, /scripts\/ci\/run-docker-test-subject\.sh/);
});

test('install Compose subject refuses direct mutation before touching the workspace', () => {
  const result = spawnSync('scripts/ci/run-compose-e2e-subject.sh', [
    '--workspace', '.', '--mode', 'install-stack', '--run-health', 'false', '--run-auth', 'false',
  ], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires the signed cleanup coordinator/);
});

test('phase smoke subjects fail closed and contain no direct Compose cleanup', () => {
  for (const [, , subject] of scripts) {
    const source = readFileSync(subject, 'utf8');
    assert.match(source, /SANCTUARY_CLEANUP_COORDINATED/);
    assert.doesNotMatch(source, /SANCTUARY_LOCAL_SMOKE/);
    assert.doesNotMatch(source, /runCompose\(\['down'/);
    const result = spawnSync(process.execPath, [subject], {
      encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires the signed cleanup coordinator package command/);
  }
});

test('Compose smoke subjects register exact images before use and defer retirement to the outer owner', () => {
  for (const subject of [
    'scripts/ops/phase2-gateway-audit-compose-smoke.mjs',
    'scripts/perf/phase3-compose-benchmark-smoke.mjs',
  ]) {
    const source = readFileSync(subject, 'utf8');
    assert.match(source, /register_ci_compose_resources --defer-image-reference-retirement/);
    assert.ok(source.indexOf('registerComposeResources();') < source.indexOf("recordStep('compose stack started'"));
  }
});

test('auto-run keeps provider and local executions coordinator-bound', () => {
  const facade = readFileSync('scripts/ci/cleanup-ci-callsite.sh', 'utf8');
  assert.match(facade, /if \[ "\$MODE" = auto-run \]/);
  assert.match(facade, /source "\$SCRIPT_DIR\/provider-context\.sh"/);
  assert.match(facade, /provider auto-run requires provider temp, run ID, and run attempt context/);
  assert.match(facade, /MODE=run/);
  assert.match(facade, /SANCTUARY_LOCAL_CLEANUP_AUTHORITY=1/);
  assert.match(facade, /MODE=run/);

  const fakeRoot = mkdtempSync(path.join(os.tmpdir(), 'phase-smoke-auto-run-'));
  chmodSync(fakeRoot, 0o700);
  const bin = path.join(fakeRoot, 'bin');
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = --host ]; then shift 2; fi
case "\${1:-} \${2:-}" in
  "context show") printf 'default\\n' ;;
  "version --format"|"info --format") printf '{}\\n' ;;
  "context inspect") printf '%s\\n' '{"Name":"default","Endpoints":{"docker":{"Host":"unix:///run/docker-local-smoke.sock","SkipTLSVerify":false}},"TLSMaterial":{}}' ;;
esac
`, { mode: 0o700 });

  const local = spawnSync('scripts/ci/cleanup-ci-callsite.sh', [
    'auto-run', '--lane', 'local-smoke-proof', '--checkout-root', '.', '--',
    process.execPath, '-e', 'process.exit(process.env.SANCTUARY_CLEANUP_COORDINATED === "1" ? 0 : 9)',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`,
      CI: 'false', GITHUB_ACTIONS: 'false', FORGEJO_ACTIONS: 'false', FORGEJO_SERVER_URL: '',
    },
  });
  assert.equal(local.status, 0, local.stderr);
  const completed = JSON.parse(local.stdout.trim());
  assert.equal(completed.cleanupState, 'no_op');
  assert.match(completed.statePath, /sanctuary-cleanup-local\.[^/]+\/runtime\/coordinator-state\.json$/);
  const state = JSON.parse(readFileSync(completed.statePath, 'utf8'));
  assert.equal(state.authority.provider, 'local');
  const trustPath = path.join(
    path.dirname(completed.statePath), 'ownership', 'deployments',
    state.authority.deploymentId, 'cleanup-trust.json',
  );
  assert.equal(JSON.parse(readFileSync(trustPath, 'utf8')).authority.authorityKind, 'local_ephemeral');

  const provider = spawnSync('scripts/ci/cleanup-ci-callsite.sh', [
    'auto-run', '--lane', 'provider-smoke-proof', '--checkout-root', '.', '--',
    process.execPath, '-e', 'process.exit(0)',
  ], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', FORGEJO_ACTIONS: 'false' },
  });
  assert.notEqual(provider.status, 0);
  assert.match(provider.stderr, /provider auto-run requires provider temp, run ID, and run attempt context/);

  const providerRoot = mkdtempSync(path.join(os.tmpdir(), 'phase-smoke-provider-run-'));
  chmodSync(providerRoot, 0o700);
  const spoofed = spawnSync('scripts/ci/cleanup-ci-callsite.sh', [
    'auto-run', '--lane', 'provider-authority-proof', '--checkout-root', '.', '--',
    process.execPath, '-e', 'process.exit(0)',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`,
      CI: 'true', GITHUB_ACTIONS: 'true', FORGEJO_ACTIONS: 'true',
      GITHUB_RUN_ID: 'real-99', GITHUB_RUN_ATTEMPT: '3', RUNNER_TEMP: providerRoot,
      SANCTUARY_CI_PROVIDER_OVERRIDE: 'local',
      SANCTUARY_CI_RUN_ID_OVERRIDE: 'override-spoof',
      SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE: '9',
      SANCTUARY_CI_TEMP_DIR_OVERRIDE: '/tmp/spoof',
    },
  });
  assert.equal(spoofed.status, 0, spoofed.stderr);
  const spoofedResult = JSON.parse(spoofed.stdout.trim());
  const spoofedState = JSON.parse(readFileSync(spoofedResult.statePath, 'utf8'));
  assert.equal(spoofedState.authority.provider, 'forgejo');
  assert.equal(spoofedState.authority.runId, 'real-99');
  assert.equal(spoofedState.authority.runAttempt, '3');
  assert.match(spoofedResult.statePath, new RegExp(`^${providerRoot}/sanctuary-cleanup/real-99-3/`));
});

test('alert receiver stamps generated Compose resources and Phase 6 deletion remains bounded', () => {
  const alert = readFileSync(scripts[0][2], 'utf8');
  const gateway = readFileSync(scripts[1][2], 'utf8');
  const benchmark = readFileSync(scripts[2][2], 'utf8');
  assert.match(alert, /io\.sanctuary\.resource-class: compose_container/);
  assert.match(alert, /io\.sanctuary\.resource-class: compose_network/);
  assert.match(alert, /labels: \*container-ownership/);
  assert.match(alert, /labels: \*network-ownership/);
  assert.match(alert, /rmSync\(tempDir, \{ recursive: true, force: true \}\)/);
  assert.match(benchmark, /rmSync\(sslDir, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(gateway, /rmSync\(/);
});
