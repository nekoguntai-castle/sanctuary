import assert from 'node:assert/strict';
import test from 'node:test';
import { createDockerCleanupAdapter, inventoryDockerResources } from '../../scripts/ownership/cleanup-docker-adapter.mjs';

const ID = 'f'.repeat(64);

function dockerFixture(args) {
  if (args[0] === 'container' && args[1] === 'ls') return `${ID}\n`;
  if (args[0] === 'container' && args[1] === 'inspect') return JSON.stringify([{
    Id: ID, State: { Running: false }, Config: { Labels: { 'com.docker.compose.project': 'legacy' } },
  }]);
  return undefined;
}

function podmanFixture(args) {
  if (args[0] === 'network' && args[1] === 'ls') return `${ID}\n`;
  if (args[0] === 'network' && args[1] === 'inspect') return JSON.stringify([{
    id: ID, labels: { 'com.docker.compose.project': 'legacy' }, name: 'legacy_default', driver: 'bridge',
  }]);
  if (args[0] === 'container' && args[1] === 'ls') return '';
  return undefined;
}

for (const engine of ['docker', 'podman']) {
  test(`${engine} adapter fixture performs observation commands only`, () => {
    const calls = [];
    const runCommand = (actualEngine, args) => {
      calls.push([actualEngine, ...args]);
      assert.equal(actualEngine, engine);
      const response = engine === 'docker' ? dockerFixture(args) : podmanFixture(args);
      if (response !== undefined) return response;
      throw new Error(`unexpected ${args.join(' ')}`);
    };
    const adapter = createDockerCleanupAdapter({ engine, runCommand });
    assert.ok(Object.isFrozen(adapter));
    assert.ok(adapter.resourceClasses.includes('oci_image'));
    const selectedClass = engine === 'docker' ? 'compose_container' : 'compose_network';
    const result = adapter.inventory({ selectors: { [selectedClass]: [{ locator: ID }] } });
    assert.equal(result.complete, true);
    assert.equal(result.resources[0].ownershipState, 'legacy_unlabeled');
    assert.equal(calls.length, engine === 'docker' ? 4 : 6);
    for (const call of calls) {
      assert.match(call.join(' '), /\b(ls|inspect)\b/);
      assert.doesNotMatch(call.join(' '), /\b(rm|remove|prune|stop|kill|down)\b/);
    }
  });
}

test('functional adapter API preserves injected engine and ambiguity', () => {
  const result = inventoryDockerResources({
    engine: 'podman', selectors: { compose_volume: [{ locator: 'data' }] },
    runCommand() { throw Object.assign(new Error('stalled'), { category: 'timeout', operation: 'volume list' }); },
  });
  assert.equal(result.engine, 'podman');
  assert.equal(result.complete, false);
  assert.equal(result.ambiguities[0].category, 'timeout');
});
