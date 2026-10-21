import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesGlob, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const workflowPath = resolve(root, '.github/workflows/install-test.yml');
const workflow = readFileSync(workflowPath, 'utf8');
const { default: YAML } = await import('../../ci/lib/yaml.mjs');
const triggers = YAML.parse(workflow).on;

function matchesPathFilter(path, patterns) {
  let included = false;
  for (const pattern of patterns) {
    const excluded = pattern.startsWith('!');
    const glob = excluded ? pattern.slice(1) : pattern;
    if (!matchesGlob(path, glob)) continue;
    included = !excluded;
  }
  return included;
}

function assertEventPathsCover(paths, event) {
  const missing = paths.filter((path) => !matchesPathFilter(path, event.paths ?? []));
  assert.deepEqual(missing, [], `install-test ${event.name} path filter misses release-surface paths`);
}

const releaseSurfacePaths = [
  'scripts/ci/future-install-driver.sh',
  'scripts/ci/run-install-e2e-isolated-subject.sh',
  'scripts/ci/run-upgrade-baseline-isolated-subject.sh',
  'scripts/ownership/future-owner-driver.mjs',
  'tests/install/e2e/future-install-flow.test.sh',
  '.github/workflows/future-install-lane.yml',
  '.github/actions/future-install-action/action.yml',
  'Dockerfile',
  'server/Dockerfile',
  'gateway/Dockerfile',
  'docker/nested/Dockerfile',
  'future-component/nested/Dockerfile',
  'docker-compose.production.yml',
  'docker/compose/future-overlay.yml',
  'start.sh',
  'install.sh',
  'scripts/setup.sh',
  'server/scripts/migrate.sh',
];

assertEventPathsCover(releaseSurfacePaths, { name: 'push', ...triggers.push });
assertEventPathsCover(releaseSurfacePaths, { name: 'pull_request', ...triggers.pull_request });
assert.deepEqual(triggers.pull_request.paths, triggers.push.paths,
  'push and pull_request release-surface path filters must stay aligned');

for (const path of [
  'tests/install/README.md',
  'tests/install/unit/notes.md',
  'tests/install/e2e/guide.mdx',
  'tests/install/unit/guide.md',
]) {
  assert.equal(matchesPathFilter(path, triggers.pull_request.paths), false,
    `install documentation should remain excluded: ${path}`);
}
assert.equal(matchesPathFilter('src/App.tsx', triggers.pull_request.paths), false,
  'unrelated application files must not trigger install tests');
assert.equal(matchesPathFilter('gateway/Service.Dockerfile', triggers.pull_request.paths), false,
  'Dockerfile glob must match the exact basename, not a basename suffix');

assert.deepEqual(triggers.push.tags, [
  'v*.*.*-rc*',
  'v*.*.*-alpha*',
  'v*.*.*-beta*',
  'v*.*.*-dev*',
], 'prerelease tag trigger list must remain unchanged');
assert.equal(triggers.push.branches, undefined, 'install-test must remain tag-only on push');

console.log('Install workflow trigger contract passed');
