import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLegacyCleanupProjectNotCurrent } from '../../scripts/ownership/cleanup-legacy-guard.mjs';

function store(projects) {
  const pointers = projects.map((project, index) => (
    project === null ? null : { value: { generation: index + 1 } }
  ));
  return {
    inspect: () => ({ registered: true, active: pointers[0], pending: pointers[1], prepared: pointers[2] }),
    readManifest: (generation, options) => {
      assert.deepEqual(options, { verifySnapshots: true });
      return { manifest: { composeProjectName: projects[generation - 1] } };
    },
  };
}

test('legacy cleanup guard refuses every current deployment pointer under the lock', () => {
  for (const projects of [
    ['target', null, null], [null, 'target', null], [null, null, 'target'],
  ]) {
    assert.throws(() => assertLegacyCleanupProjectNotCurrent(store(projects), 'target'), /current manifest project/);
  }
  assert.equal(assertLegacyCleanupProjectNotCurrent(store(['active', 'pending', null]), 'obsolete'), 'obsolete');
  assert.throws(
    () => assertLegacyCleanupProjectNotCurrent(store([null, null, null]), 'obsolete'),
    /unresolved manifest state/,
  );
  assert.throws(() => assertLegacyCleanupProjectNotCurrent(store([null, null, null]), '../unsafe'), /invalid format/);
});
