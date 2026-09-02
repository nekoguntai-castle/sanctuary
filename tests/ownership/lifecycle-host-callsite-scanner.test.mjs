import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  phase6MigrationBlockers, scanLifecycleCallsites, validateLifecycleCallsites,
} from '../../scripts/ownership/check-lifecycle-callsites.mjs';

const CHECKOUT = path.resolve('.');

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lifecycle-host-scanner-'));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), contents);
  }
  return { root, files: Object.keys(files) };
}

test('registered staging helper requires immediate exact signed registration', () => {
  const canonical = readFileSync(path.join(CHECKOUT, 'scripts/ci/create-registered-staging.sh'), 'utf8');
  const creation = '  artifact=$(mktemp -d "$parent/$label.XXXXXX") || return\n';
  const scan = scanLifecycleCallsites(fixture({
    'scripts/ci/create-registered-staging.sh': canonical,
  }));
  assert.deepEqual(scan.findings, [{
    path: 'scripts/ci/create-registered-staging.sh',
    resourceClass: 'temporary_artifact',
    operation: 'create',
    mechanism: 'registered_exact',
  }]);

  for (const altered of [
    canonical.replace('temporary_artifact obsolete exact_delete path',
      'temporary_artifact active exact_delete path'),
    canonical.replace('--execution-authority "$execution_authority"',
      '--execution-authority "$foreign_authority"'),
    canonical.replace('register_owned_resource temporary_artifact',
      'record_owned_resource temporary_artifact'),
    canonical.replace(creation, '').replace('  ownership_initialize\n', `${creation}  ownership_initialize\n`),
  ]) {
    const weakened = scanLifecycleCallsites(fixture({
      'scripts/ci/create-registered-staging.sh': altered,
    }));
    assert.equal(weakened.findings[0].mechanism, 'host_migration');
  }
});
test('registered collector helper requires immediate exact signed registration', () => {
  const canonical = readFileSync(
    path.join(CHECKOUT, 'scripts/ci/registered-collector-process.sh'), 'utf8',
  );
  const scan = scanLifecycleCallsites(fixture({
    'scripts/ci/registered-collector-process.sh': canonical,
  }));
  assert.deepEqual(scan.findings, [{
    path: 'scripts/ci/registered-collector-process.sh',
    resourceClass: 'collector_process',
    operation: 'register',
    mechanism: 'registered_exact',
  }]);

  for (const altered of [
    canonical.replace('collector_process obsolete exact_delete authority',
      'collector_process obsolete exact_delete pid'),
    canonical.replace('--execution-authority "$execution_authority"',
      '--execution-authority "$foreign_authority"'),
    canonical.replace('register_owned_resource collector_process',
      'record_owned_resource collector_process'),
    canonical.replace('  ownership_initialize\n', '  printf \'%s\\n\' "$pid"\n  ownership_initialize\n'),
  ]) {
    const weakened = scanLifecycleCallsites(fixture({
      'scripts/ci/registered-collector-process.sh': altered,
    }));
    assert.equal(weakened.findings[0].mechanism, 'host_migration');
  }
});

test('isolated workspace registers the empty exact workdir before cloning into it', () => {
  const canonical = readFileSync(
    path.join(CHECKOUT, 'scripts/ci/create-isolated-workspace.sh'), 'utf8',
  );
  const scan = scanLifecycleCallsites(fixture({
    'scripts/ci/create-isolated-workspace.sh': canonical,
  }));
  assert.deepEqual(scan.findings, [{
    path: 'scripts/ci/create-isolated-workspace.sh',
    resourceClass: 'temporary_artifact',
    operation: 'create',
    mechanism: 'registered_exact',
  }]);

  const clone = '  git clone --quiet --no-hardlinks "$source_workspace" "$repo"\n';
  const initialize = '  SANCTUARY_PROJECT_DIR="$source_workspace" ownership_initialize\n';
  for (const altered of [
    canonical.replace(clone, '').replace(initialize, `${clone}${initialize}`),
    canonical.replace('temporary "$workdir" "$SANCTUARY_OPERATION_RUN_ID"',
      'temporary "$parent" "$SANCTUARY_OPERATION_RUN_ID"'),
    canonical.replace('register_owned_resource temporary_artifact',
      'record_owned_resource temporary_artifact'),
    canonical.replace(initialize, `  touch "$workdir/premature"\n${initialize}`),
  ]) {
    const weakened = scanLifecycleCallsites(fixture({
      'scripts/ci/create-isolated-workspace.sh': altered,
    }));
    assert.equal(weakened.findings[0].mechanism, 'host_migration');
  }
});

test('upgrade worktree requires exact registration before the checkout is exposed', () => {
  const pathname = 'tests/install/e2e/upgrade-install.test.sh';
  const canonical = readFileSync(path.join(CHECKOUT, pathname), 'utf8');
  const worktreeFinding = (source) => scanLifecycleCallsites(fixture({ [pathname]: source })).findings
    .find((entry) => entry.resourceClass === 'git_worktree' && entry.operation === 'create');
  assert.equal(worktreeFinding(canonical).mechanism, 'registered_exact');

  const exposure = '    PROJECT_ROOT="$UPGRADE_SOURCE_CHECKOUT"\n';
  const authority = '    authority_bundle="$(node "$SANCTUARY_OWNERSHIP_TOOL_DIR/describe-host-authority.mjs" \\\n';
  const reordered = canonical.replace(exposure, '').replace(authority, `${exposure}${authority}`);
  assert.equal(worktreeFinding(reordered).mechanism, 'host_migration');
  assert.equal(worktreeFinding(canonical.replace(
    'register_owned_resource git_worktree', 'record_owned_resource git_worktree',
  )).mechanism, 'host_migration');

  const generic = `git worktree add --detach "$checkout" "$ref"
node describe-host-authority.mjs worktree "$checkout" "$base" "$deployment" "$run"
register_owned_resource git_worktree obsolete exact_delete path "$checkout" "$identity" \\
  --execution-authority "$execution_authority" "$run"
`;
  assert.equal(scanLifecycleCallsites(fixture({
    'scripts/untrusted-worktree.sh': generic,
  })).findings[0].mechanism, 'host_migration');
});

test('only explicitly identified Phase 6 host artifacts may be deferred', () => {
  const deferred = (resourceClass, safetyContract) => ({
    path: 'host.sh', resourceClass, operation: 'cleanup', disposition: 'deferred', safetyContract,
  });
  assert.doesNotThrow(() => validateLifecycleCallsites({
    inventory: {
      schemaVersion: '1.0.0',
      callsites: [deferred('temporary_artifact', 'Phase 6 performs descriptor-relative host cleanup.')],
    },
    scan: {
      findings: [{
        path: 'host.sh', resourceClass: 'temporary_artifact', operation: 'cleanup',
        mechanism: 'host_migration',
      }],
      broadPrunes: [],
    },
  }));
  assert.throws(() => validateLifecycleCallsites({
    inventory: {
      schemaVersion: '1.0.0',
      callsites: [deferred('compose_container', 'Phase 6 would remove this Docker container.')],
    },
    scan: { findings: [], broadPrunes: [] },
  }), /only an explicit Phase 6 host artifact may be deferred/);
});

test('scanner discovers recursive host deletion, process signals, and worktree mutations', () => {
  const source = fixture({
    'scripts/host-cleanup.sh': `rm -rf "$artifact"
kill "$collector_pid"
git -C "$root" worktree add --detach "$checkout" "$ref"
git -C "$root" worktree remove --force "$checkout"
`,
    'scripts/host-cleanup.mjs': `rmSync(
  root,
  { recursive: true, force: true },
);
child.kill('SIGTERM');
`,
    'scripts/worktree-argv.mjs': "run(['git', '-C', root, 'worktree', 'remove', checkout]);\n",
  });
  assert.deepEqual(scanLifecycleCallsites(source).findings, [
    { path: 'scripts/host-cleanup.mjs', resourceClass: 'temporary_artifact', operation: 'cleanup', mechanism: 'host_migration' },
    { path: 'scripts/host-cleanup.mjs', resourceClass: 'collector_process', operation: 'cleanup', mechanism: 'host_migration' },
    { path: 'scripts/host-cleanup.sh', resourceClass: 'temporary_artifact', operation: 'cleanup', mechanism: 'host_migration' },
    { path: 'scripts/host-cleanup.sh', resourceClass: 'collector_process', operation: 'cleanup', mechanism: 'host_migration' },
    { path: 'scripts/host-cleanup.sh', resourceClass: 'git_worktree', operation: 'cleanup', mechanism: 'host_migration' },
    { path: 'scripts/host-cleanup.sh', resourceClass: 'git_worktree', operation: 'create', mechanism: 'host_migration' },
    { path: 'scripts/worktree-argv.mjs', resourceClass: 'git_worktree', operation: 'cleanup', mechanism: 'host_migration' },
  ]);
});

test('host exemptions require a mechanically narrow lifecycle shape', () => {
  const source = fixture({
    'scripts/ci/browser-e2e-groups.sh': `temp_dir="$(mktemp -d)"
rm -rf "$temp_dir"
`,
    'scripts/ci/backend-integration-groups.sh': `temp_dir="$(mktemp -d)"
rm -rf "$temp_dir"
rm -rf "$foreign"
`,
    'scripts/ci/report-timing-notices.sh': 'rm -rf "$temp_dir"\n',
    'scripts/ownership/registration.mjs': `const staging = \`.keys-${'${process.pid}'}-${'${Date.now()}'}\`;
renameSync(staging, keys);
rmSync(staging, { recursive: true, force: true });
`,
    'scripts/ci/docker-exec-tcp-forwarder.mjs': `const child = spawn('docker', args);
child.kill('SIGTERM');
`,
    'tests/ci/example.test.sh': 'rm -rf "$TEST_TEMP_DIR"\n',
    'tests/ci/danger.test.sh': 'TEST_ROOT="$(mktemp -d)"\nrm -rf "$HOME"\n',
  });
  const findings = new Map(scanLifecycleCallsites(source).findings.map((entry) => [entry.path, entry]));
  assert.equal(findings.get('scripts/ci/browser-e2e-groups.sh').mechanism, 'host_migration');
  assert.equal(findings.get('scripts/ci/backend-integration-groups.sh').mechanism, 'host_migration');
  assert.equal(findings.get('scripts/ci/report-timing-notices.sh').mechanism, 'host_migration');
  assert.equal(findings.get('scripts/ownership/registration.mjs').mechanism, 'canonical_host_internal');
  assert.equal(findings.get('scripts/ci/docker-exec-tcp-forwarder.mjs').mechanism, 'host_migration');
  assert.equal(findings.get('tests/ci/example.test.sh').mechanism, 'test_fixture');
  assert.equal(findings.get('tests/ci/danger.test.sh').mechanism, 'host_migration');
});

test('scanner fixture command strings are explicitly treated as non-executable test data', () => {
  const source = fixture({
    'tests/ownership/lifecycle-callsite-scanner.test.mjs': 'rm -rf "$HOME"\nkill "$pid"\n',
  });
  assert.deepEqual(scanLifecycleCallsites(source).findings, []);
});

test('container-internal recursive deletion is not a host-artifact mutation', () => {
  const source = fixture({
    'tests/install/utils/helpers.sh': `docker run --rm image sh -c 'find /dst/monitoring -exec rm -rf {} +'
docker exec exact sh -c 'find /dst/monitoring -exec rm -rf {} +'
`,
  });
  assert.ok(scanLifecycleCallsites(source).findings
    .every((entry) => entry.resourceClass !== 'temporary_artifact'));
});

test('read-only host observations cannot authorize mutation', () => {
  const source = fixture({
    'scripts/ownership/deployment-lock.mjs': 'process.kill(owner.pid, 0);\n',
    'scripts/release/promote-release.sh': 'git worktree list --porcelain\n',
  });
  const scan = scanLifecycleCallsites(source);
  assert.deepEqual(scan.findings, [
    { path: 'scripts/ownership/deployment-lock.mjs', resourceClass: 'collector_process', operation: 'register', mechanism: 'reference_observation' },
    { path: 'scripts/release/promote-release.sh', resourceClass: 'git_worktree', operation: 'register', mechanism: 'reference_observation' },
  ]);
  const inventory = {
    schemaVersion: '1.0.0',
    callsites: scan.findings.map((entry) => ({
      path: entry.path, resourceClass: entry.resourceClass, operation: entry.operation,
      disposition: 'reference_only', safetyContract: 'This is a mechanically read-only identity observation.',
    })),
  };
  assert.doesNotThrow(() => validateLifecycleCallsites({ inventory, scan }));
  inventory.callsites[0].disposition = 'exempt';
  assert.throws(() => validateLifecycleCallsites({ inventory, scan }), /host lifecycle cannot be exempt/);
});

test('host migrations stay deferred until their callers use the exact adapter', () => {
  const source = fixture({ 'scripts/raw.sh': 'rm -rf "$artifact"\n' });
  const scan = scanLifecycleCallsites(source);
  const deferred = {
    path: 'scripts/raw.sh', resourceClass: 'temporary_artifact', operation: 'cleanup',
    disposition: 'deferred', safetyContract: 'Phase 6 will route this deletion through exact signed authority.',
  };
  assert.doesNotThrow(() => validateLifecycleCallsites({
    inventory: { schemaVersion: '1.0.0', callsites: [deferred] }, scan,
  }));
  assert.throws(() => validateLifecycleCallsites({
    inventory: { schemaVersion: '1.0.0', callsites: [{ ...deferred, disposition: 'exempt' }] }, scan,
  }), /host lifecycle cannot be exempt/);
  assert.throws(() => validateLifecycleCallsites({
    inventory: { schemaVersion: '1.0.0', callsites: [deferred] }, scan, phase: 6,
  }), /unresolved Phase 6 host lifecycle migration/);
  assert.deepEqual(phase6MigrationBlockers({ callsites: [deferred] }), [
    'scripts/raw.sh:temporary_artifact:cleanup',
  ]);
});
