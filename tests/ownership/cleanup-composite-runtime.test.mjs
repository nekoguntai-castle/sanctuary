import test from 'node:test';
import assert from 'node:assert/strict';
import { createCleanupCompositeRuntime } from '../../scripts/ownership/cleanup-composite-runtime.mjs';

test('composite runtime dispatches only typed host classes to host operations', async () => {
  const calls = [];
  const runtime = (label) => Object.fromEntries(['reloadAuthority', 'mutate', 'reconcile'].map((name) => [
    name, async ({ action }) => {
      calls.push(`${label}:${name}:${action.resourceClass}`);
      return label;
    },
  ]));
  const composite = createCleanupCompositeRuntime({
    dockerRuntime: runtime('docker'), hostRuntime: runtime('host'),
  });
  assert.equal(await composite.reloadAuthority({ action: { resourceClass: 'temporary_artifact' } }), 'host');
  assert.equal(await composite.mutate({ action: { resourceClass: 'collector_process' } }), 'host');
  assert.equal(await composite.reconcile({ action: { resourceClass: 'git_worktree' } }), 'host');
  assert.equal(await composite.mutate({ action: { resourceClass: 'compose_volume' } }), 'docker');
  assert.deepEqual(calls, [
    'host:reloadAuthority:temporary_artifact', 'host:mutate:collector_process',
    'host:reconcile:git_worktree', 'docker:mutate:compose_volume',
  ]);
});
