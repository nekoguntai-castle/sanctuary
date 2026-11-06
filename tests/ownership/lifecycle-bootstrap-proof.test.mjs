import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { provesBootstrapStagingLifecycle } from '../../scripts/ownership/lifecycle-bootstrap-proof.mjs';

const SOURCE = readFileSync(path.resolve('scripts/ci/bootstrap-node.sh'), 'utf8');

test('bootstrap proof accepts only the two locked exact mktemp staging lifecycles', () => {
  assert.equal(provesBootstrapStagingLifecycle(SOURCE), true);
});

test('bootstrap proof rejects missing EXIT or signal cleanup traps', () => {
  for (const trap of [
    'trap cleanup_on_exit EXIT', "trap 'exit 129' HUP", "trap 'exit 130' INT", "trap 'exit 143' TERM",
  ]) {
    assert.equal(provesBootstrapStagingLifecycle(SOURCE.replace(`${trap}\n`, '')), false, trap);
  }
  assert.equal(provesBootstrapStagingLifecycle(SOURCE.replace(
    'trap cleanup_on_exit EXIT', 'trap cleanup_on_exit EXIT\ntrap : EXIT',
  )), false);
});

test('bootstrap proof rejects widened cleanup targets and unowned staging creation', () => {
  const widened = SOURCE.replace('rm -rf -- "$staging"', 'rm -rf -- "$active_staging_parent"');
  const shortRecursive = SOURCE.replace('  rm -rf -- "$staging" || return', '  rm -r "$HOME"\n  rm -rf -- "$staging" || return');
  const longRecursive = SOURCE.replace('  rm -rf -- "$staging" || return', '  rm --recursive "$HOME"\n  rm -rf -- "$staging" || return');
  const unowned = SOURCE.replace(
    'active_staging="$(mktemp -d "${cache_parent}/.node-${expected_version}.XXXXXX")"',
    'active_staging="$(mktemp -d "${cache_parent}/.node-${expected_version}.XXXXXX")"\n  active_staging="$cache_parent/other"',
  );
  const exportedOwner = SOURCE.replace(
    'active_staging_kind=node', 'export active_staging="$active_staging_parent"\nactive_staging_kind=node',
  );
  const mismatchedPrefix = SOURCE.replace('expected_prefix="$active_staging_parent/.npm-${expected_npm_version}."', 'expected_prefix="$active_staging_parent/.npm-"');
  const widenedOwner = SOURCE.replace('local staging="$active_staging"', 'local staging="$active_staging_parent"');
  const missingPrefixGuard = SOURCE.replace('[[ "$staging" == "$expected_prefix"* ]]', '[[ -n "$staging" ]]');
  const missingSymlinkGuard = SOURCE.replace('[[ -d "$staging" && ! -L "$staging" ]]', '[[ -d "$staging" ]]');
  const maskedCleanupFailure = SOURCE.replace('if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then status=$cleanup_status; fi', 'status=0');
  const missingPerInstallCleanup = SOURCE.replace('  cleanup_active_staging\n', ' ');
  const looseVersion = SOURCE.replace('[[ "$expected_version" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]]', '[[ -n "$expected_version" ]]');
  assert.equal(provesBootstrapStagingLifecycle(widened), false);
  assert.equal(provesBootstrapStagingLifecycle(shortRecursive), false);
  assert.equal(provesBootstrapStagingLifecycle(longRecursive), false);
  assert.equal(provesBootstrapStagingLifecycle(unowned), false);
  assert.equal(provesBootstrapStagingLifecycle(exportedOwner), false);
  assert.equal(provesBootstrapStagingLifecycle(mismatchedPrefix), false);
  assert.equal(provesBootstrapStagingLifecycle(widenedOwner), false);
  assert.equal(provesBootstrapStagingLifecycle(missingPrefixGuard), false);
  assert.equal(provesBootstrapStagingLifecycle(missingSymlinkGuard), false);
  assert.equal(provesBootstrapStagingLifecycle(maskedCleanupFailure), false);
  assert.equal(provesBootstrapStagingLifecycle(missingPerInstallCleanup), false);
  assert.equal(provesBootstrapStagingLifecycle(looseVersion), false);
});
