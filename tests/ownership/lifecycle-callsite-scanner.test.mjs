import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  phase5MigrationBlockers, phase6MigrationBlockers,
  scanLifecycleCallsites, validateLifecycleCallsites,
} from '../../scripts/ownership/check-lifecycle-callsites.mjs';

const CHECKOUT = path.resolve('.');

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lifecycle-scanner-'));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), contents);
  }
  return { root, files: Object.keys(files) };
}

function row(pathname, resourceClass, disposition = 'migrate', safetyContract = 'Must migrate through exact signed cleanup authority.') {
  return { path: pathname, resourceClass, operation: 'cleanup', disposition, safetyContract };
}

test('scanner finds shell, Compose, argv, API, coordinator, and broad prune lifecycle sites', () => {
  const source = fixture({
    'direct.sh': '# docker system prune\ndocker volume rm exact\ndocker compose -p exact down -v\n',
    'argv.mjs': "run(['docker', 'network', 'rm', id]);\nfetch(`/containers/${id}/stop`, { method: 'POST' });\n",
    'coordinator.yml': 'run: scripts/ci/cleanup-ci-callsite.sh run --lane exact\n',
    'prune.sh': 'timeout 30 docker builder prune --force\n',
  });
  const scan = scanLifecycleCallsites(source);
  assert.deepEqual(scan.findings.map(({ path: pathname, resourceClass, operation }) => ({
    path: pathname, resourceClass, operation,
  })), [
    row('argv.mjs', 'compose_container'), row('argv.mjs', 'compose_network'),
    row('coordinator.yml', 'compose_container'), row('coordinator.yml', 'compose_network'),
    row('coordinator.yml', 'compose_volume'), row('direct.sh', 'compose_container'),
    row('direct.sh', 'compose_network'), row('direct.sh', 'compose_volume'),
    row('prune.sh', 'buildkit_cache'),
  ].map(({ path: pathname, resourceClass, operation }) => ({ path: pathname, resourceClass, operation })));
  assert.deepEqual(scan.broadPrunes, [{ path: 'prune.sh', kind: 'builder_prune' }]);
});

test('scanner finds Docker Engine API and nested argv creation forms', () => {
  const source = fixture({
    'api.mjs': `fetch('/v1.47/networks/create', { method: 'POST' });
fetch('/volumes/create', { method: 'POST' });
fetch('/images/create?fromImage=exact', { method: 'POST' });
fetch('/v1.47/build', { method: 'POST' });
`,
    'argv.mjs': `run(['podman', 'image', 'load', '--input', archive]);
run(['podman', 'buildx', 'build', '--load', '.']);
`,
  });
  assert.deepEqual(scanLifecycleCallsites(source).findings, [
    { path: 'api.mjs', resourceClass: 'buildkit_cache', operation: 'create', mechanism: 'producer' },
    { path: 'api.mjs', resourceClass: 'compose_network', operation: 'create', mechanism: 'producer' },
    { path: 'api.mjs', resourceClass: 'compose_volume', operation: 'create', mechanism: 'producer' },
    { path: 'api.mjs', resourceClass: 'oci_image', operation: 'create', mechanism: 'producer' },
    { path: 'argv.mjs', resourceClass: 'buildkit_cache', operation: 'create', mechanism: 'producer' },
    { path: 'argv.mjs', resourceClass: 'oci_image', operation: 'create', mechanism: 'producer' },
  ]);
});

test('scanner finds multiline Docker Engine API deletion forms', () => {
  const source = fixture({
    'api-delete.mjs': `await fetch(
  \`${'${DOCKER_PROXY_URL}'}/containers/${'${id}'}\`,
  { method: 'DELETE' },
);
await fetch('/v1.47/networks/exact', { method: 'DELETE' });
await fetch('/volumes/exact', { method: 'DELETE' });
await fetch('/images/exact:tag', { method: 'DELETE' });
`,
  });
  assert.deepEqual(scanLifecycleCallsites(source).findings, [
    { path: 'api-delete.mjs', resourceClass: 'compose_container', operation: 'cleanup', mechanism: 'direct' },
    { path: 'api-delete.mjs', resourceClass: 'compose_network', operation: 'cleanup', mechanism: 'direct' },
    { path: 'api-delete.mjs', resourceClass: 'compose_volume', operation: 'cleanup', mechanism: 'direct' },
    { path: 'api-delete.mjs', resourceClass: 'oci_image', operation: 'cleanup', mechanism: 'direct' },
  ]);
});

test('broad name-prefix and age-selected deletion cannot hide behind a registry row', () => {
  const source = fixture({
    'broad.sh': `docker rm -f $(docker ps -aq --filter 'name=sanctuary-prefix-')
docker image rm $(docker image ls -q --filter 'until=24h')
`,
    'exact.sh': `docker rm -f $(docker ps -aq --filter 'name=^/sanctuary-exact$')
`,
  });
  const scan = scanLifecycleCallsites(source);
  assert.deepEqual(scan.broadPrunes, [
    { path: 'broad.sh', kind: 'name_prefix_delete' },
    { path: 'broad.sh', kind: 'age_filtered_delete' },
  ]);
});

test('Docker global options cannot hide lifecycle mutations or broad cleanup', () => {
  const source = fixture({
    'context-prune.sh': 'docker --context default system prune --all --force\n',
    'host-prefix.sh': `docker -H unix:///var/run/docker.sock rm -f \
      $(docker -H unix:///var/run/docker.sock ps -aq --filter 'name=sanctuary-prefix-')\n`,
  });
  const scan = scanLifecycleCallsites(source);
  assert.deepEqual(scan.broadPrunes, [
    { path: 'context-prune.sh', kind: 'system_prune' },
    { path: 'host-prefix.sh', kind: 'name_prefix_delete' },
  ]);
  assert.ok(scan.findings.some((entry) => entry.path === 'host-prefix.sh'
    && entry.resourceClass === 'compose_container' && entry.operation === 'cleanup'));
});

test('scanner inventories executable heredoc producers but ignores data heredocs', () => {
  const source = fixture({
    '.github/workflows/podman-socket-canary.yml': `
run: |
  scripts/ci/cleanup-ci-callsite.sh run --lane exact -- bash -euo pipefail <<'SUBJECT'
  source scripts/ownership/producer-hooks.sh
  ownership_label_args compose_container exact_delete
  docker run --rm "\${OWNERSHIP_LABEL_ARGS[@]}" exact-image verify
  cat > /tmp/compose.yml <<'COMPOSE'
  # docker system prune
  COMPOSE
  docker compose -f /tmp/compose.yml -p exact up -d
  SUBJECT
`,
  });
  const scan = scanLifecycleCallsites(source);
  assert.deepEqual(scan.findings.map(({ resourceClass, operation, mechanism }) => ({
    resourceClass, operation, mechanism,
  })), [
    { resourceClass: 'compose_container', operation: 'cleanup', mechanism: 'cleanup_coordinator' },
    { resourceClass: 'compose_network', operation: 'cleanup', mechanism: 'cleanup_coordinator' },
    { resourceClass: 'compose_volume', operation: 'cleanup', mechanism: 'cleanup_coordinator' },
    { resourceClass: 'compose_container', operation: 'create', mechanism: 'cleanup_coordinator' },
    { resourceClass: 'compose_network', operation: 'create', mechanism: 'cleanup_coordinator' },
    { resourceClass: 'compose_volume', operation: 'create', mechanism: 'cleanup_coordinator' },
  ]);
  assert.deepEqual(scan.broadPrunes, []);
});

test('registry comparison is bidirectional and rejects broad cleanup', () => {
  const finding = {
    path: 'cleanup.sh', resourceClass: 'compose_container', operation: 'cleanup', mechanism: 'direct',
  };
  const inventory = { schemaVersion: '1.0.0', callsites: [row('cleanup.sh', 'compose_container')] };
  assert.deepEqual(validateLifecycleCallsites({
    inventory, scan: { findings: [finding], broadPrunes: [] }, phase: 4,
  }), {
    callsites: 1, broadPrunes: 0, migrations: 1,
  });
  assert.throws(() => validateLifecycleCallsites({
    inventory, scan: { findings: [finding], broadPrunes: [] },
  }), /unresolved Phase 5 Docker lifecycle migration/);
  assert.throws(() => validateLifecycleCallsites({
    inventory: { ...inventory, callsites: [] }, scan: { findings: [finding], broadPrunes: [] },
  }), /unclassified lifecycle callsite/);
  assert.throws(() => validateLifecycleCallsites({
    inventory, scan: { findings: [], broadPrunes: [] },
  }), /stale lifecycle callsite/);
  assert.throws(() => validateLifecycleCallsites({
    inventory, scan: { findings: [finding], broadPrunes: [{ path: 'cleanup.sh', kind: 'system_prune' }] },
  }), /broad Docker cleanup is forbidden/);
  assert.throws(() => validateLifecycleCallsites({
    inventory: {
      ...inventory,
      callsites: [row('cleanup.sh', 'compose_container', 'exempt', 'Direct exact-name cleanup is claimed as exempt here.')],
    },
    scan: { findings: [finding], broadPrunes: [] },
  }), /direct Docker cleanup cannot be exempt/);
});

test('same-invocation daemon-atomic removal is a narrow typed exemption', () => {
  const source = fixture({
    'probe.sh': 'docker run --rm exact-image verify\n',
  });
  const scan = scanLifecycleCallsites(source);
  assert.equal(scan.findings[0].mechanism, 'daemon_atomic');
  assert.doesNotThrow(() => validateLifecycleCallsites({
    inventory: {
      schemaVersion: '1.0.0',
      callsites: scan.findings.map((finding) => ({
        ...row('probe.sh', 'compose_container', 'exempt',
          'The foreground daemon atomically removes only the container created by this invocation.'),
        operation: finding.operation,
      })),
    }, scan,
  }));
});

test('attached runs are creates and only explicit foreground forms are daemon-atomic', () => {
  const source = fixture({
    'foreground.sh': 'docker run --rm exact-image verify\n',
    'argv.mjs': "docker(['run', '--rm', 'exact-image', 'verify']);\n",
    'prefix.ts': "return [{ command: 'docker', prefixArgs: ['run', '--rm', '--network', 'none', image] }];\n",
    'timed.sh': 'timeout 30s docker run --rm exact-image verify\n',
    'array.sh': `run_args=(
  run --rm exact-image verify
)
docker "\${run_args[@]}"
`,
  });
  const creates = new Map(scanLifecycleCallsites(source).findings
    .filter((finding) => finding.operation === 'create')
    .map((finding) => [finding.path, finding.mechanism]));
  assert.equal(creates.get('foreground.sh'), 'daemon_atomic');
  assert.equal(creates.get('argv.mjs'), 'daemon_atomic');
  assert.equal(creates.get('prefix.ts'), 'daemon_atomic');
  assert.equal(creates.get('timed.sh'), 'producer');
  assert.equal(creates.get('array.sh'), 'producer');
});

test('registered transient and immutable resource lifecycles are narrow typed exemptions', () => {
  const source = fixture({
    'transient.sh': `container_id="$(docker run --rm --detach image)"
retire_registered_transient "$container_id"
`,
    'create-transient.sh': `create_args=(
  create --rm --cidfile "$cidfile" --name "$container_name" image
)
container_id="$(docker "\${create_args[@]}")"
retire_registered_transient "$container_id"
docker stop "$container_id"
`,
    'image.sh': `register_owned_resource oci_image obsolete exact_delete name "$image" "$cleanup_image_id" "$run"
docker image rm "$cleanup_image_id"
docker image inspect "$cleanup_image_id"
`,
    'image-helper.sh': `register_owned_resource oci_image obsolete exact_delete name "$image" "$cleanup_image_id" "$run"
image_id_is_absent() {
  exact_id="$1"
  docker image inspect "$exact_id"
  docker image ls --no-trunc --format '{{.ID}}'
}
docker image rm "$cleanup_image_id"
image_id_is_absent "$cleanup_image_id"
`,
    'image-reference-helper.sh': `register_owned_resource oci_image obsolete exact_delete name "$python_image" "$cleanup_image_id" "$run"
image_reference_is_absent() {
  exact_reference="$1"
  exact_id="$2"
  docker image inspect --format '{{.Id}}' "$exact_reference"
  docker image ls --no-trunc --filter "reference=$exact_reference" --format '{{.ID}}'
}
docker image rm "$python_image"
image_reference_is_absent "$python_image" "$cleanup_image_id"
`,
    'volume.sh': `register_owned_resource compose_volume obsolete exact_delete name "$cache_volume" "$identity" "$run"
docker volume inspect "$cache_volume"
docker volume rm "$cache_volume"
docker volume inspect "$cache_volume"
`,
    'grafana.sh': `ownership_label_args compose_container exact_delete
inspect_control_helper "$helper_id"
retire_control_helper "$helper_id"
container_id_is_absent "$helper_id"
docker container rm "$helper_id"
`,
  });
  const scan = scanLifecycleCallsites(source);
  assert.equal(scan.findings.find((entry) => entry.path === 'transient.sh').mechanism,
    'registered_transient');
  assert.equal(scan.findings.find((entry) => entry.path === 'create-transient.sh').mechanism,
    'registered_transient');
  assert.equal(scan.findings.find((entry) => entry.path === 'image.sh').mechanism,
    'registered_exact');
  assert.equal(scan.findings.find((entry) => entry.path === 'image-helper.sh').mechanism,
    'registered_exact');
  assert.equal(scan.findings.find((entry) => entry.path === 'image-reference-helper.sh').mechanism,
    'registered_exact');
  assert.equal(scan.findings.find((entry) => entry.path === 'volume.sh').mechanism,
    'registered_exact');
  assert.equal(scan.findings.find((entry) => entry.path === 'grafana.sh').mechanism,
    'registered_transient');
  assert.doesNotThrow(() => validateLifecycleCallsites({
    inventory: {
      schemaVersion: '1.0.0',
      callsites: scan.findings.map((entry) => ({
        ...row(entry.path, entry.resourceClass, entry.operation === 'create' ? 'migrate' : 'exempt',
          'The exact registered identity is re-inspected and its absence is verified.'),
        operation: entry.operation,
      })),
    },
    scan, phase: 4,
  }));
});

test('registered lifecycle exemptions do not hide unrelated direct deletions', () => {
  const source = fixture({
    'mixed-transient.sh': `container_id="$(docker run --rm --detach image)"
retire_registered_transient "$container_id"
docker stop "$container_id"
docker rm -f "$UNREGISTERED"
`,
    'mixed-image.sh': `register_owned_resource oci_image obsolete exact_delete name "$image" "$cleanup_image_id" "$run"
docker image rm "$cleanup_image_id"
docker image inspect "$cleanup_image_id"
docker image rm "$foreign_image_id"
`,
    'mixed-image-helper.sh': `register_owned_resource oci_image obsolete exact_delete name "$image" "$cleanup_image_id" "$run"
image_id_is_absent() {
  exact_id="$1"
  docker image inspect "$exact_id"
  docker image ls --no-trunc --format '{{.ID}}'
}
docker image rm "$cleanup_image_id"
image_id_is_absent "$cleanup_image_id"
docker image rm "$foreign_image_id"
`,
    'mixed-image-reference.sh': `register_owned_resource oci_image obsolete exact_delete name "$python_image" "$cleanup_image_id" "$run"
image_reference_is_absent() {
  exact_reference="$1"
  exact_id="$2"
  docker image inspect --format '{{.Id}}' "$exact_reference"
  docker image ls --no-trunc --filter "reference=$exact_reference" --format '{{.ID}}'
}
docker image rm "$python_image"
image_reference_is_absent "$python_image" "$cleanup_image_id"
docker image rm "$foreign_tag"
`,
    'mixed-volume.sh': `register_owned_resource compose_volume obsolete exact_delete name "$cache_volume" "$identity" "$run"
docker volume inspect "$cache_volume"
docker volume rm "$cache_volume"
docker volume inspect "$cache_volume"
docker volume rm "$foreign_volume"
`,
  });
  const scan = scanLifecycleCallsites(source);
  assert.deepEqual(scan.findings.filter((entry) => entry.operation === 'cleanup')
    .map((entry) => [entry.path, entry.resourceClass, entry.mechanism]), [
    ['mixed-image-helper.sh', 'oci_image', 'direct'],
    ['mixed-image-reference.sh', 'oci_image', 'direct'],
    ['mixed-image.sh', 'oci_image', 'direct'],
    ['mixed-transient.sh', 'compose_container', 'direct'],
    ['mixed-volume.sh', 'compose_volume', 'direct'],
  ]);
  assert.throws(() => validateLifecycleCallsites({
    inventory: {
      schemaVersion: '1.0.0',
      callsites: scan.findings.map((entry) => row(
        entry.path, entry.resourceClass, 'exempt',
        'The registered lifecycle is exact but an unrelated deletion is also present.',
      )),
    },
    scan,
  }), /direct Docker cleanup cannot be exempt/);
});

test('Compose image cleanup exemption requires bounded exact-set recovery', () => {
  const exactLifecycle = `
ownership_image_id_from_inspect() { :; }
ownership_bounded_image_inspect() { :; }
ownership_bounded_image_list() { :; }
ownership_timeout_window_before_deadline() { printf '0.300s'; }
ownership_bounded_image_remove() {
  timeout --foreground --kill-after=0.1s 0.300s docker image rm "$image_ref"
}
wait_for_ci_compose_image_refs() { :; }
register_exact_built_image() { register_owned_resource oci_image "$image_ref"; }
retire_exact_built_image() { ownership_bounded_image_remove "$deadline" "$image_ref"; }
`;
  const safe = scanLifecycleCallsites(fixture({
    'scripts/ownership/compose-image-registration.sh': exactLifecycle,
  }));
  assert.equal(safe.findings.find((entry) => entry.operation === 'cleanup').mechanism,
    'registered_exact');

  const missingBound = scanLifecycleCallsites(fixture({
    'scripts/ownership/compose-image-registration.sh': exactLifecycle
      .replace('wait_for_ci_compose_image_refs() { :; }\n', ''),
  }));
  assert.equal(missingBound.findings.find((entry) => entry.operation === 'cleanup').mechanism,
    'direct');

  const rawRetirement = scanLifecycleCallsites(fixture({
    'scripts/ownership/compose-image-registration.sh': exactLifecycle
      .replace(
        'timeout --foreground --kill-after=0.1s 0.300s docker image rm "$image_ref"',
        'docker image rm "$image_ref"',
      ),
  }));
  assert.equal(rawRetirement.findings.find((entry) => entry.operation === 'cleanup').mechanism,
    'direct');

  const secondRawRetirement = scanLifecycleCallsites(fixture({
    'scripts/ownership/compose-image-registration.sh': `${exactLifecycle}\ndocker image rm "$image_ref";\n`,
  }));
  assert.equal(secondRawRetirement.findings.find((entry) => entry.operation === 'cleanup').mechanism,
    'direct');
});

test('reference-only Docker mutations require an explicit application lifecycle boundary', () => {
  const finding = {
    path: 'tor.ts', resourceClass: 'compose_container', operation: 'cleanup', mechanism: 'direct',
  };
  const scan = { findings: [finding], broadPrunes: [] };
  assert.throws(() => validateLifecycleCallsites({
    inventory: { schemaVersion: '1.0.0', callsites: [row('tor.ts', 'compose_container', 'reference_only')] }, scan,
  }), /application lifecycle/);
  assert.doesNotThrow(() => validateLifecycleCallsites({
    inventory: {
      schemaVersion: '1.0.0',
      callsites: [row('tor.ts', 'compose_container', 'reference_only', 'Exact ID stop remains inside the Tor application lifecycle.')],
    }, scan: { findings: [{ ...finding, mechanism: 'application_api' }], broadPrunes: [] },
  }));
});

test('raw Docker producers cannot claim an application lifecycle by prose alone', () => {
  const source = fixture({ 'raw-create.sh': 'docker volume create bypass\n' });
  const scan = scanLifecycleCallsites(source);
  assert.throws(() => validateLifecycleCallsites({
    inventory: {
      schemaVersion: '1.0.0',
      callsites: [{
        path: 'raw-create.sh', resourceClass: 'compose_volume', operation: 'create',
        disposition: 'reference_only',
        safetyContract: 'This claims an application lifecycle without a recognized boundary.',
      }],
    },
    scan,
  }), /not an application lifecycle reference/);
});

test('Phase 5 rejects unresolved Docker creation and registration migrations', () => {
  const creation = {
    path: 'build.sh', resourceClass: 'oci_image', operation: 'create',
    disposition: 'migrate', safetyContract: 'Register the exact immutable image identity.',
  };
  assert.throws(() => validateLifecycleCallsites({
    inventory: { schemaVersion: '1.0.0', callsites: [creation] },
    scan: { findings: [], broadPrunes: [] },
  }), /unresolved Phase 5 Docker lifecycle migration: build\.sh:oci_image:create/);
  assert.deepEqual(phase5MigrationBlockers(
    { callsites: [creation] }, { findings: [], broadPrunes: [] },
  ), ['build.sh:oci_image:create']);
});

test('persistent Docker creation is mechanically inventoried and bidirectional', () => {
  const source = fixture({
    'create.sh': `
docker container create --name exact image
docker volume create exact-volume
docker network create exact-network
docker buildx build --load --tag exact:image .
docker load --input exact.tar
docker compose -p exact up -d --build
`,
  });
  const scan = scanLifecycleCallsites(source);
  assert.deepEqual(scan.findings, [
    { path: 'create.sh', resourceClass: 'buildkit_cache', operation: 'create', mechanism: 'producer' },
    { path: 'create.sh', resourceClass: 'compose_container', operation: 'create', mechanism: 'producer' },
    { path: 'create.sh', resourceClass: 'compose_network', operation: 'create', mechanism: 'producer' },
    { path: 'create.sh', resourceClass: 'compose_volume', operation: 'create', mechanism: 'producer' },
    { path: 'create.sh', resourceClass: 'oci_image', operation: 'create', mechanism: 'producer' },
  ]);
  const callsites = scan.findings.map((finding) => ({
    path: finding.path, resourceClass: finding.resourceClass, operation: finding.operation,
    disposition: 'exempt', safetyContract: 'Exact labeled creation is recovered and registered by immutable identity.',
  }));
  assert.throws(() => validateLifecycleCallsites({
    inventory: { schemaVersion: '1.0.0', callsites }, scan,
  }), /unverified Docker producer cannot be exempt/);
  assert.throws(() => validateLifecycleCallsites({
    inventory: { schemaVersion: '1.0.0', callsites: callsites.slice(0, 1) }, scan,
  }), /unclassified lifecycle callsite/);
  assert.throws(() => validateLifecycleCallsites({
    inventory: { schemaVersion: '1.0.0', callsites },
    scan: { findings: scan.findings.slice(0, 1), broadPrunes: [] },
  }), /stale lifecycle callsite/);
});

test('arbitrary builders and detached run --rm producers are not daemon-atomic exemptions', () => {
  const source = fixture({
    'builder.sh': 'docker buildx build --load --tag exact:image .\n',
    'detached.sh': 'docker run --rm --detach exact:image\ndocker stop "$container_id"\n',
  });
  const scan = scanLifecycleCallsites(source);
  assert.equal(scan.findings.find((finding) => finding.path === 'builder.sh'
    && finding.resourceClass === 'buildkit_cache').mechanism, 'producer');
  assert.equal(scan.findings.find((finding) => finding.path === 'detached.sh'
    && finding.operation === 'create').mechanism, 'producer');
  assert.equal(scan.findings.find((finding) => finding.path === 'detached.sh'
    && finding.operation === 'cleanup').mechanism, 'direct');
});

test('stale exempt Docker creation rows are rejected even when their path has no finding', () => {
  assert.throws(() => validateLifecycleCallsites({
    inventory: {
      schemaVersion: '1.0.0',
      callsites: [{
        path: 'missing.sh', resourceClass: 'oci_image', operation: 'create',
        disposition: 'exempt', safetyContract: 'No discovered producer exists.',
      }],
    },
    scan: { findings: [], broadPrunes: [] }, phase: 4,
  }), /stale lifecycle callsite/);
});

test('file-wide coordinator and registration markers do not exempt mixed raw producers', () => {
  const source = fixture({
    'mixed-coordinator.sh': `
scripts/ci/cleanup-ci-callsite.sh auto-run --lane exact -- docker volume create registered
docker volume create bypass
`,
    'mixed-registration.sh': `
register_owned_resource compose_volume obsolete exact_delete name registered identity run
docker volume create registered
docker volume create bypass
`,
  });
  const scan = scanLifecycleCallsites(source);
  assert.deepEqual(scan.findings.filter((finding) => finding.operation === 'create')
    .map(({ path: pathname, mechanism }) => [pathname, mechanism]), [
    ['mixed-coordinator.sh', 'producer'],
    ['mixed-registration.sh', 'producer'],
  ]);
  const callsites = scan.findings.map((finding) => ({
    path: finding.path, resourceClass: finding.resourceClass, operation: finding.operation,
    disposition: 'exempt', safetyContract: 'A file-wide marker cannot prove every producer path.',
  }));
  assert.throws(() => validateLifecycleCallsites({
    inventory: { schemaVersion: '1.0.0', callsites }, scan,
  }), /unverified Docker producer cannot be exempt/);
});

test('allowlisted coordinator subjects require an authority boundary before creation', () => {
  const source = fixture({
    'scripts/ci/run-compose-e2e-subject.sh': `
if [ "\${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then exit 2; fi
docker compose up -d --build
`,
  });
  const scan = scanLifecycleCallsites(source);
  assert.deepEqual(scan.findings.filter((finding) => finding.operation === 'create')
    .map(({ resourceClass, mechanism }) => [resourceClass, mechanism]), [
    ['buildkit_cache', 'retained_shared_cache'],
    ['compose_container', 'cleanup_coordinator'],
    ['compose_network', 'cleanup_coordinator'],
    ['compose_volume', 'cleanup_coordinator'],
    ['oci_image', 'cleanup_coordinator'],
  ]);

  const bypass = fixture({
    'scripts/ci/run-compose-e2e-subject.sh': `
docker volume create before-authority
if [ "\${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then exit 2; fi
`,
  });
  assert.equal(scanLifecycleCallsites(bypass).findings[0].mechanism, 'producer');

  const mixedAfterBoundary = fixture({
    'scripts/ci/run-compose-e2e-subject.sh': `
if [ "\${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
  exec scripts/ci/cleanup-ci-callsite.sh auto-run --lane exact -- "$0"
fi
docker run --detach --name bypass image
`,
  });
  assert.equal(scanLifecycleCallsites(mixedAfterBoundary).findings
    .find((finding) => finding.operation === 'create').mechanism, 'producer');

  const mixedBuildAfterBoundary = fixture({
    'scripts/ci/run-jade-emulator-proof.sh': `
if [ "\${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
  exec scripts/ci/cleanup-ci-callsite.sh auto-run --lane exact -- "$0"
fi
docker buildx build --load --tag bypass .
`,
  });
  assert.equal(scanLifecycleCallsites(mixedBuildAfterBoundary).findings
    .find((finding) => finding.resourceClass === 'oci_image').mechanism, 'producer');

  const mixedVolumeAfterBoundary = fixture({
    'scripts/ci/run-compose-e2e-subject.sh': `
if [ "\${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then
  exec scripts/ci/cleanup-ci-callsite.sh auto-run --lane exact -- "$0"
fi
docker volume create bypass
`,
  });
  assert.equal(scanLifecycleCallsites(mixedVolumeAfterBoundary).findings
    .find((finding) => finding.resourceClass === 'compose_volume'
      && finding.operation === 'create').mechanism, 'producer');

  const componentBypass = fixture({
    'tests/install/utils/helpers.sh': `
docker run --rm -d bypass
echo 'refused: signed cleanup coordinator is required'
`,
  });
  assert.equal(scanLifecycleCallsites(componentBypass).findings
    .find((finding) => finding.operation === 'create').mechanism, 'producer');

  for (const bypassSource of [
    'SANCTUARY_CLEANUP_COORDINATED=1\ndocker compose up -d\n',
    'false && scripts/ci/cleanup-ci-callsite.sh auto-run --lane exact\ndocker compose up -d\n',
    'if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != 1 ]; then :; fi\ndocker compose up -d\n',
    'if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" = 1 ]; then exit 2; fi\ndocker compose up -d\n',
  ]) {
    const markerOnly = fixture({
      'scripts/ci/run-compose-e2e-subject.sh': bypassSource,
    });
    assert.ok(scanLifecycleCallsites(markerOnly).findings
      .filter((finding) => finding.operation === 'create')
      .every((finding) => finding.mechanism === 'producer'));
  }

  const componentMarkerOnly = fixture({
    'tests/install/utils/helpers.sh': `
echo 'refused: signed cleanup coordinator is required'
docker run --rm -d --name bypass image
`,
  });
  assert.equal(scanLifecycleCallsites(componentMarkerOnly).findings
    .find((finding) => finding.operation === 'create').mechanism, 'producer');
});

test('allowlisted registered and application producers still require structural proof', () => {
  const transient = fixture({
    'scripts/ci/run-trezor-emulator-proof.sh': `
ownership_label_args compose_container exact_delete
docker create --rm --cidfile "$cidfile" image
`,
  });
  assert.equal(scanLifecycleCallsites(transient).findings
    .find((finding) => finding.operation === 'create').mechanism, 'producer');

  const application = fixture({
    'server/src/utils/docker/tor.ts': 'fetch(`/containers/create`, { method: "POST" });\n',
  });
  assert.equal(scanLifecycleCallsites(application).findings[0].mechanism, 'producer');

  const torImage = fixture({
    'server/src/utils/docker/tor.ts': `
const ownership = currentTorOwnership();
inspectHasCreatedIdentity(container, ownership);
await fetch(\`${'${DOCKER_PROXY_URL}'}/images/create?fromImage=${'${TOR_REPOSITORY}'}&tag=${'${TOR_DIGEST}'}\`, { method: 'POST' });
await drainDockerPull(response);
`,
  });
  assert.deepEqual(scanLifecycleCallsites(torImage).findings, [{
    path: 'server/src/utils/docker/tor.ts', resourceClass: 'oci_image', operation: 'create',
    mechanism: 'application_api',
  }]);

  const torCleanupBypass = fixture({
    'server/src/utils/docker/tor.ts': `
await fetch(\`${'${DOCKER_PROXY_URL}'}/containers/${'${containerId}'}/stop\`, { method: 'POST' });
`,
  });
  assert.equal(scanLifecycleCallsites(torCleanupBypass).findings[0].mechanism, 'direct');

  const guardedTorCleanup = fixture({
    'server/src/utils/docker/tor.ts': `
const ownership = currentTorOwnership();
inspectHasCreatedIdentity(container, ownership);
await fetch(\`${'${DOCKER_PROXY_URL}'}/containers/${'${containerId}'}/stop\`, { method: 'POST' });
`,
  });
  assert.equal(scanLifecycleCallsites(guardedTorCleanup).findings[0].mechanism,
    'application_api');

  const mixedTransient = fixture({
    'scripts/ci/run-trezor-emulator-proof.sh': `
ownership_label_args compose_container exact_delete
trezor_create_args=(create --rm --cidfile "$cidfile" image)
recover_exact_created_container "$container_name"
assert_registered_transient "$container_id"
retire_registered_transient "$container_id"
docker create --name bypass image
`,
  });
  assert.equal(scanLifecycleCallsites(mixedTransient).findings
    .find((finding) => finding.operation === 'create').mechanism, 'producer');

  const markerOnlyTransient = fixture({
    'scripts/ci/run-trezor-emulator-proof.sh': `
ownership_label_args compose_container exact_delete
recover_exact_created_container "$container_name"
assert_registered_transient "$container_id"
retire_registered_transient "$container_id"
docker create --rm --cidfile "$cidfile" --name bypass image
`,
  });
  assert.equal(scanLifecycleCallsites(markerOnlyTransient).findings
    .find((finding) => finding.operation === 'create').mechanism, 'producer');

  const unrelatedRegisteredTransient = fixture({
    'scripts/ci/run-trezor-emulator-proof.sh': `
ownership_label_args compose_container exact_delete
recover_exact_created_container "$container_name"
register_owned_resource compose_container obsolete exact_delete engine_id exact exact run
assert_registered_transient "$container_id"
retire_registered_transient "$container_id"
container_ownership_labels=("${'${OWNERSHIP_LABEL_ARGS[@]}'}")
docker create --rm --cidfile "$cidfile" --name bypass image
`,
  });
  assert.equal(scanLifecycleCallsites(unrelatedRegisteredTransient).findings
    .find((finding) => finding.operation === 'create').mechanism, 'producer');
});

test('run-compose cleanup exemption requires guarded dispatch before all mutations', () => {
  const guarded = fixture({
    'scripts/ownership/run-compose.sh': `
compose_subcommand() { printf 'unknown\\n'; }
case "$(compose_subcommand "$@")" in
  config|version|ps|images|logs|top|events|port|ls|help) ;;
  *)
    [ "${'${SANCTUARY_CLEANUP_COORDINATED:-0}'}" = 1 ] || { exit 2; }
    ;;
esac
exec docker compose "$@"
`,
  });
  assert.ok(scanLifecycleCallsites(guarded).findings
    .every((finding) => finding.mechanism === 'cleanup_coordinator'));

  for (const bypassSource of [
    `docker volume rm bypass
echo "${'${SANCTUARY_CLEANUP_COORDINATED:-0}'}"
exec docker compose "$@"
`,
    `compose_subcommand() { printf 'unknown\\n'; }
case "$(compose_subcommand "$@")" in
  *) docker volume rm bypass ;;
esac
[ "${'${SANCTUARY_CLEANUP_COORDINATED:-0}'}" = 1 ] || { exit 2; }
exec docker compose "$@"
`,
  ]) {
    const bypass = fixture({ 'scripts/ownership/run-compose.sh': bypassSource });
    assert.ok(scanLifecycleCallsites(bypass).findings
      .filter((finding) => finding.operation === 'cleanup')
      .every((finding) => finding.mechanism === 'direct'));
  }
});

test('allowlisted image registration cannot hide an extra build or load producer', () => {
  const registeredBuild = `
docker buildx build --load --tag "$owned_image_ref" .
recover_exact_runtime_image "$owned_image_ref"
register_exact_built_image "$owned_image_ref" "$owned_image_id"
`;
  const registeredLoad = `
docker load --input "$archive"
recover_and_register_loaded_archive "$archive"
register_loaded_images
`;
  const source = fixture({
    'scripts/ci/build-runtime-image.sh': registeredBuild,
    'scripts/ci/wallet-sync-replay-image.sh': `${registeredBuild}\ndocker load --input "$archive"\nregister_loaded_image "$image_ref" "$root" "$image_id"\n`,
    'scripts/offline/apply-bundle.sh': registeredLoad,
  });
  for (const finding of scanLifecycleCallsites(source).findings
    .filter((entry) => entry.resourceClass === 'oci_image' && entry.operation === 'create')) {
    assert.equal(finding.mechanism, 'registered_exact', finding.path);
  }

  const extra = fixture({
    'scripts/ci/build-runtime-image.sh': `${registeredBuild}\ndocker build --tag bypass .\n`,
    'scripts/offline/apply-bundle.sh': `${registeredLoad}\ndocker load --input bypass.tar\n`,
  });
  assert.ok(scanLifecycleCallsites(extra).findings
    .filter((entry) => entry.resourceClass === 'oci_image' && entry.operation === 'create')
    .every((entry) => entry.mechanism === 'producer'));
});

test('registered replay helpers cannot hide a mixed raw attached run', () => {
  const safe = `
import { createRegisteredReplayResource } from './wallet-sync-replay-creation.mjs';
function createReplayResource(resourceClass, name, args, runtime) {
  return createRegisteredReplayResource(resourceClass, name, args, runtime);
}
return ['docker', 'run', '--detach', '--name', name, image];
`;
  const safeScan = scanLifecycleCallsites(fixture({
    'scripts/perf/wallet-sync-high-fanout-replay.mjs': safe,
  }));
  assert.equal(safeScan.findings.find((entry) => entry.operation === 'create').mechanism,
    'registered_exact');

  const mixedScan = scanLifecycleCallsites(fixture({
    'scripts/perf/wallet-sync-high-fanout-replay.mjs': `${safe}
run(['docker', 'run', '--rm', image], { stdio: 'inherit' });
`,
  }));
  assert.equal(mixedScan.findings.find((entry) => entry.operation === 'create').mechanism,
    'producer');
});

test('Compose manifests synthesize only explicitly stamped resource classes', () => {
  const source = fixture({
    'docker/compose/test.yml': `
x-container-labels:
  io.sanctuary.deployment-id: exact
  io.sanctuary.resource-class: compose_container
x-network-labels:
  io.sanctuary.deployment-id: exact
  io.sanctuary.resource-class: compose_network
`,
  });
  assert.deepEqual(scanLifecycleCallsites(source).findings, [
    {
      path: 'docker/compose/test.yml', resourceClass: 'compose_container',
      operation: 'create', mechanism: 'ownership_manifest',
    },
    {
      path: 'docker/compose/test.yml', resourceClass: 'compose_network',
      operation: 'create', mechanism: 'ownership_manifest',
    },
  ]);
});

test('operator wrapper synthesis requires active deployment and data-delete guards', () => {
  const guarded = fixture({
    'scripts/ownership/run-operator-compose.sh': `
ownership_prepare_operator_compose "$root"
deployment_use_active
echo 'Destructive operator Compose commands require an exact active deployment manifest.'
case "$1" in --confirm-data-delete) ;; esac
docker compose "\${compose_arguments[@]}"
`,
  });
  const scan = scanLifecycleCallsites(guarded);
  assert.equal(scan.findings.length, 8);
  assert.ok(scan.findings.every((finding) => finding.mechanism === 'application_api'
    || finding.mechanism === 'retained_shared_cache'));

  const unguarded = fixture({
    'scripts/ownership/run-operator-compose.sh': 'docker compose "$@"\n',
  });
  assert.deepEqual(scanLifecycleCallsites(unguarded).findings, []);
});

test('tracked lifecycle registry exactly covers Docker and host-artifact surfaces', () => {
  const inventory = JSON.parse(readFileSync(
    path.join(CHECKOUT, 'config/resource-lifecycle-callsites.json'), 'utf8',
  ));
  const scan = scanLifecycleCallsites({ root: CHECKOUT });
  const result = validateLifecycleCallsites({ inventory, scan, phase: 6 });
  assert.equal(result.callsites, scan.findings.length);
  assert.equal(result.broadPrunes, 0);
  assert.equal(result.migrations, 0, 'Phase 5 must leave no unresolved Docker lifecycle migrations');
  const declared = new Map(inventory.callsites.map((entry) => [
    `${entry.path}:${entry.resourceClass}:${entry.operation}`, entry.disposition,
  ]));
  const expectedDisposition = {
    canonical_host_internal: 'exempt', host_migration: 'deferred',
    reference_observation: 'reference_only', test_fixture: 'exempt',
    direct: 'migrate', canonical_executor: 'exempt', cleanup_coordinator: 'exempt',
    daemon_atomic: 'exempt', registered_transient: 'exempt', registered_exact: 'exempt',
    retained_shared_cache: 'exempt', retained_application: 'exempt',
    ownership_manifest: 'exempt', application_api: 'reference_only',
  };
  for (const finding of scan.findings) {
    const key = `${finding.path}:${finding.resourceClass}:${finding.operation}`;
    const disposition = declared.get(key);
    if (finding.operation === 'create') {
      assert.notEqual(disposition, 'migrate', key);
      continue;
    }
    if (finding.mechanism === 'direct' && disposition === 'reference_only') continue;
    assert.equal(disposition, expectedDisposition[finding.mechanism], key);
  }
  const blockers = phase5MigrationBlockers(inventory, scan);
  assert.deepEqual(blockers, []);
  assert.doesNotThrow(() => validateLifecycleCallsites({ inventory, scan }));
});
