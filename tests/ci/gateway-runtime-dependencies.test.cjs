const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// R5-B phase 3 (tasks/ci-install-lane-speedup-design-2026-09-29.md): the
// gateway image installs its runtime dependencies from the reviewed lockfile,
// projected to production edges, for the gateway and shared workspaces only.
// The former workspace-root `npm prune --production` took about 196 s of an
// uncached build and shipped every workspace's production dependencies
// (657 packages, including frontend and backend-only ones) instead of 194.

const dockerfile = fs.readFileSync(path.join(__dirname, '../../gateway/Dockerfile'), 'utf8');

function stage(name) {
  const match = dockerfile.match(new RegExp(`^FROM [^\\n]+ AS ${name}\\n([\\s\\S]*?)(?=^FROM |(?![\\s\\S]))`, 'm'));
  assert.ok(match, `stage ${name} must exist`);
  return match[1];
}

test('the gateway image never prunes a workspace-root install', () => {
  assert.doesNotMatch(dockerfile, /npm prune/);
});

test('gateway runtime dependencies come from the reviewed-lockfile projection', () => {
  const deps = stage('gateway-runtime-deps');
  for (const manifest of ['package*.json', 'shared/package.json', 'server/package.json', 'gateway/package.json']) {
    assert.ok(deps.includes(`COPY ${manifest} `), `copies ${manifest}`);
  }
  assert.match(deps, /COPY server\/scripts\/project-runtime-dependencies\.cjs \.\/server\/scripts\//);
  assert.match(deps, /RUN node server\/scripts\/project-runtime-dependencies\.cjs \/runtime application\n/);
  assert.match(deps, /RUN npm ci --workspace gateway --workspace shared --omit=dev --omit=optional --ignore-scripts\b/);
});

test('the runner takes node_modules only from the projected runtime stage', () => {
  const runner = stage('runner');
  assert.match(runner, /COPY --chown=gateway:nodejs --from=gateway-runtime-deps \/runtime\/node_modules \.\/node_modules/);
  assert.doesNotMatch(runner, /--from=builder \/repo\/node_modules/);
  assert.doesNotMatch(runner, /--from=deps /);
});
