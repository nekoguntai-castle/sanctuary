import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertFirstManifestDockerResources } from '../../scripts/ownership/legacy-docker-inspection.mjs';

const definition = { composeProjectName: 'sanctuary' };
const composeArgs = ['--project-directory', '/fixture', '-p', 'sanctuary', '-f', '/fixture/docker-compose.yml'];
const identity = {
  definition, composeArgs, deploymentId: 'deploy-sanctuary', ownerId: 'owner-1000', projectLabel: 'sanctuary',
};

function installFakeDocker() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-legacy-docker-'));
  const executable = path.join(root, 'docker');
  const log = path.join(root, 'calls.log');
  writeFileSync(executable, `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
labels='{"io.sanctuary.project":"sanctuary","io.sanctuary.deployment-id":"deploy-sanctuary","io.sanctuary.owner-id":"owner-1000","io.sanctuary.resource-class":"RESOURCE_CLASS","io.sanctuary.lifecycle":"active","io.sanctuary.cleanup-policy":"CLEANUP_POLICY","io.sanctuary.created-at":"2026-08-30T00:00:00.000Z","io.sanctuary.created-by-release":"v0.8.69","io.sanctuary.created-by-commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","io.sanctuary.creation-run-id":"run-prior"}'
case " $* " in
  *" compose "*" config --format json "*)
    printf '%s\\n' '{"services":{"backend":{},"grafana":{"container_name":"sanctuary-grafana"}},"networks":{"default":{"name":"sanctuary_default"}},"volumes":{"postgres_data":{"name":"sanctuary_postgres_data"}}}' ;;
  " volume ls "*) [ "$FAKE_DOCKER_CASE" = empty ] || printf '%s\\n' sanctuary_postgres_data ;;
  " network ls "*) [ "$FAKE_DOCKER_CASE" = empty ] || printf 'network-id\\tsanctuary_default\\n' ;;
  " container ls "*) [ "$FAKE_DOCKER_CASE" = empty ] || printf 'container-id\\tsanctuary-backend-1\\tsanctuary\\n' ;;
  " volume inspect sanctuary_postgres_data ")
    if [ "$FAKE_DOCKER_CASE" = legacy ]; then printf '%s\\n' '[{"Labels":{"com.docker.compose.project":"sanctuary"}}]'
    else printf '%s\\n' "[{\\"Labels\\":\${labels/RESOURCE_CLASS/compose_volume}}]" | sed 's/CLEANUP_POLICY/preserve_ambiguous/' ; fi ;;
  " network inspect network-id ")
    if [ "$FAKE_DOCKER_CASE" = legacy ]; then printf '%s\\n' '[{"Labels":{}}]'
    elif [ "$FAKE_DOCKER_CASE" = mismatch ]; then printf '%s\\n' "[{\\"Labels\\":\${labels/RESOURCE_CLASS/compose_network}}]" | sed -e 's/CLEANUP_POLICY/exact_delete/' -e 's/owner-1000/owner-other/'
    else printf '%s\\n' "[{\\"Labels\\":\${labels/RESOURCE_CLASS/compose_network}}]" | sed 's/CLEANUP_POLICY/exact_delete/' ; fi ;;
  " container inspect container-id ")
    if [ "$FAKE_DOCKER_CASE" = legacy ]; then printf '%s\\n' '[{"Config":{"Labels":null}}]'
    else printf '%s\\n' "[{\\"Config\\":{\\"Labels\\":\${labels/RESOURCE_CLASS/compose_container}}}]" | sed 's/CLEANUP_POLICY/exact_delete/' ; fi ;;
  *) printf 'unexpected command: %s\\n' "$*" >&2; exit 65 ;;
esac
`);
  chmodSync(executable, 0o755);
  return { root, log };
}

test('first-manifest inspection is read-only and refuses legacy or mismatched exact resources', () => {
  const fixture = installFakeDocker();
  const originalPath = process.env.PATH;
  const originalCase = process.env.FAKE_DOCKER_CASE;
  const originalLog = process.env.FAKE_DOCKER_LOG;
  process.env.PATH = `${fixture.root}:${originalPath}`;
  process.env.FAKE_DOCKER_LOG = fixture.log;
  try {
    process.env.FAKE_DOCKER_CASE = 'empty';
    assert.deepEqual(assertFirstManifestDockerResources(identity), { inspected: true });

    process.env.FAKE_DOCKER_CASE = 'legacy';
    assert.throws(() => assertFirstManifestDockerResources(identity), (error) => {
      assert.match(error.message, /volume sanctuary_postgres_data: missing io\.sanctuary\.project/);
      assert.match(error.message, /network sanctuary_default: missing io\.sanctuary\.deployment-id/);
      assert.match(error.message, /container sanctuary-backend-1: missing io\.sanctuary\.owner-id/);
      assert.match(error.message, /No resources were relabeled, recreated, or adopted/);
      return true;
    });

    process.env.FAKE_DOCKER_CASE = 'mismatch';
    assert.throws(() => assertFirstManifestDockerResources(identity), /network sanctuary_default: io\.sanctuary\.owner-id does not match owner-1000/);

    process.env.FAKE_DOCKER_CASE = 'matching';
    assert.deepEqual(assertFirstManifestDockerResources(identity), { inspected: true });

    const calls = readFileSync(fixture.log, 'utf8');
    assert.doesNotMatch(calls, /\b(create|rm|remove|update|up|down|run)\b/);
    assert.match(calls, /compose .* config --format json/);
    assert.match(calls, /volume inspect sanctuary_postgres_data/);
    assert.match(calls, /network inspect network-id/);
    assert.match(calls, /container inspect container-id/);
  } finally {
    process.env.PATH = originalPath;
    if (originalCase === undefined) delete process.env.FAKE_DOCKER_CASE; else process.env.FAKE_DOCKER_CASE = originalCase;
    if (originalLog === undefined) delete process.env.FAKE_DOCKER_LOG; else process.env.FAKE_DOCKER_LOG = originalLog;
  }
});
