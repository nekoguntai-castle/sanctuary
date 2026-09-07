// Non-regression coverage for sanctuary#1036 / runner-infra#37: every CI
// Compose stack must carry io.runner-infra.owner-container so the
// runner-infra host reaper can reclaim it minutes after its job container
// disappears, instead of waiting out the multi-hour age floor -- but never on
// an operator's real install. See docs on ci_owner_container() in
// scripts/ci/provider-context.sh for the detection contract.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LABEL = 'io.runner-infra.owner-container';

// Every value the base Compose file's `:?`-required interpolations need,
// independent of the owner-container contract under test. Values are
// arbitrary well-formed placeholders -- `docker compose config` only checks
// that a required variable is non-empty, never its semantic shape.
const BASE_ENV = {
  SANCTUARY_PROJECT: 'sanctuary-test',
  SANCTUARY_DEPLOYMENT_ID: 'deploy-test',
  SANCTUARY_OWNER_ID: 'owner-test',
  SANCTUARY_CLEANUP_CREATED_AT: '2026-09-06T00:00:00.000Z',
  SANCTUARY_RELEASE: 'unreleased',
  SANCTUARY_COMMIT: 'a'.repeat(40),
  SANCTUARY_OPERATION_RUN_ID: 'run-test',
  SANCTUARY_SOURCE_COMMIT: 'a'.repeat(40),
  SANCTUARY_VERSION: '0.0.0',
  SANCTUARY_BUILD_ID: 'build-test',
  SANCTUARY_IMAGE_LOCK_SHA256: 'b'.repeat(64),
  JWT_SECRET: 'x', ENCRYPTION_KEY: 'x', ENCRYPTION_SALT: 'x',
  LLM_EGRESS_PROXY_SECRET: 'x', POSTGRES_PASSWORD: 'x', REDIS_PASSWORD: 'x',
  WORKER_DIAGNOSTICS_SECRET: 'x', GRAFANA_PASSWORD: 'x',
};

function composeConfigInterpolated(files, extraEnv = {}) {
  const env = { ...process.env, ...BASE_ENV, ...extraEnv };
  // Never let an owner-container value already sitting in the ambient
  // environment (e.g. this very test running inside a CI job container)
  // leak into a case that expects the default: an explicit key in extraEnv
  // is the only source of truth for this variable.
  if (!Object.hasOwn(extraEnv, 'SANCTUARY_CI_OWNER_CONTAINER')) {
    delete env.SANCTUARY_CI_OWNER_CONTAINER;
  }
  const args = ['compose', '--project-directory', root];
  for (const file of [].concat(files)) args.push('-f', resolve(root, file));
  args.push('config', '--format', 'json');
  const result = spawnSync('docker', args, { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('base Compose leaves the owner-container label empty outside CI', () => {
  const config = composeConfigInterpolated('docker-compose.yml');
  assert.equal(config.services.redis.labels[LABEL], '');
  const network = Object.values(config.networks)[0];
  assert.equal(network.labels[LABEL], '');
  const volume = Object.values(config.volumes)[0];
  assert.equal(volume.labels[LABEL], '');
});

test('base Compose stamps the resolved job container id under CI', () => {
  const config = composeConfigInterpolated('docker-compose.yml', {
    SANCTUARY_CI_OWNER_CONTAINER: 'deadbeefcafe',
  });
  for (const service of Object.values(config.services)) {
    assert.equal(service.labels[LABEL], 'deadbeefcafe');
  }
  for (const network of Object.values(config.networks)) {
    assert.equal(network.labels[LABEL], 'deadbeefcafe');
  }
  for (const volume of Object.values(config.volumes)) {
    assert.equal(volume.labels[LABEL], 'deadbeefcafe');
  }
});

test('test Compose (docker/compose/test.yml) follows the same contract', () => {
  const outsideCi = composeConfigInterpolated('docker/compose/test.yml');
  assert.equal(outsideCi.services['test-db'].labels[LABEL], '');

  const underCi = composeConfigInterpolated('docker/compose/test.yml', {
    SANCTUARY_CI_OWNER_CONTAINER: 'deadbeefcafe',
  });
  assert.equal(underCi.services['test-db'].labels[LABEL], 'deadbeefcafe');
});

test('the monitoring and Tor overlays (own ownership anchors) follow the same contract', () => {
  for (const overlay of ['docker/compose/monitoring.yml', 'docker/compose/tor.yml']) {
    const files = ['docker-compose.yml', overlay];
    const outsideCi = composeConfigInterpolated(files);
    for (const service of Object.values(outsideCi.services)) assert.equal(service.labels[LABEL], '');

    const underCi = composeConfigInterpolated(files, { SANCTUARY_CI_OWNER_CONTAINER: 'deadbeefcafe' });
    for (const service of Object.values(underCi.services)) assert.equal(service.labels[LABEL], 'deadbeefcafe');
  }
});
