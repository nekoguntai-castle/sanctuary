import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertFirstManifestDockerResources,
  assertLegacyUpgradePostconditions,
  legacyDurableComposeOverlay,
  resolveLegacyDurableComposeOverlay,
} from '../../scripts/ownership/legacy-docker-inspection.mjs';

const definition = { composeProjectName: 'sanctuary' };
const composeArgs = ['--project-directory', '/fixture', '-p', 'sanctuary', '-f', '/fixture/docker-compose.yml'];
const identity = {
  definition, composeArgs, deploymentId: 'deploy-sanctuary', ownerId: 'owner-1000', projectLabel: 'sanctuary',
};

test('legacy durable compatibility overlay externalizes only exact observed resources', () => {
  const resources = [
    { resourceClass: 'compose_container', locator: 'app-1', composeResource: 'app', cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled' },
    { resourceClass: 'compose_volume', locator: 'project_data', composeResource: 'data', cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled' },
    { resourceClass: 'compose_network', locator: 'project_default', composeResource: 'default', cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled' },
  ];
  assert.equal(legacyDurableComposeOverlay(resources).toString(), [
    '# Generated from immutable legacy resource observations.',
    'networks:',
    '  "default": !override',
    '    name: "project_default"',
    '    external: true',
    'volumes:',
    '  "data": !override',
    '    name: "project_data"',
    '    external: true',
    '',
  ].join('\n'));
  assert.equal(legacyDurableComposeOverlay(resources.slice(0, 1)), null);
});

function installFakeDocker() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-legacy-docker-'));
  const executable = path.join(root, 'docker');
  const log = path.join(root, 'calls.log');
  writeFileSync(executable, `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
labels='"io.sanctuary.project":"sanctuary","io.sanctuary.deployment-id":"deploy-sanctuary","io.sanctuary.owner-id":"owner-1000","io.sanctuary.resource-class":"RESOURCE_CLASS","io.sanctuary.lifecycle":"active","io.sanctuary.cleanup-policy":"CLEANUP_POLICY","io.sanctuary.created-at":"2026-08-30T00:00:00.000Z","io.sanctuary.created-by-release":"v0.8.69","io.sanctuary.created-by-commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","io.sanctuary.creation-run-id":"run-prior"'
case " $* " in
  *" compose "*" config --format json "*)
    if [ "$FAKE_DOCKER_CASE" = unsupported ] && [[ " $* " == *" -f - "* ]]; then exit 15
    elif [[ " $* " == *" -f - "* ]]; then printf '%s\\n' '{"services":{},"networks":{"default":{"name":"sanctuary_default","external":true}},"volumes":{"postgres_data":{"name":"sanctuary_postgres_data","external":true}}}'
    elif [ "$FAKE_DOCKER_CASE" = removed ]; then printf '%s\\n' '{"services":{},"networks":{},"volumes":{}}'
    elif [ "$FAKE_DOCKER_CASE" = renamed ]; then printf '%s\\n' '{"services":{},"networks":{"default":{"name":"sanctuary_replacement"}},"volumes":{"postgres_data":{"name":"sanctuary_postgres_data"}}}'
    elif [ "$FAKE_DOCKER_CASE" = alias ]; then printf '%s\\n' '{"services":{},"networks":{"default":{"name":"sanctuary_default"},"other":{"name":"sanctuary_default"}},"volumes":{"postgres_data":{"name":"sanctuary_postgres_data"}}}'
    else printf '%s\\n' '{"services":{"backend":{},"grafana":{"container_name":"sanctuary-grafana"}},"networks":{"default":{"name":"sanctuary_default"}},"volumes":{"postgres_data":{"name":"sanctuary_postgres_data"}}}'; fi ;;
  " volume ls "*)
    [ "$FAKE_DOCKER_CASE" = empty ] || printf '%s\\n' sanctuary_postgres_data
    case "$FAKE_DOCKER_CASE" in leftover*) printf 'sanctuary_tor_hidden_service\\tsanctuary\\n' ;; esac ;;
  " network ls "*)
    [ "$FAKE_DOCKER_CASE" = empty ] || printf 'network-id\\tsanctuary_default\\n'
    case "$FAKE_DOCKER_CASE" in leftover*) printf 'leftover-network-id\\tsanctuary_ai-internal\\tsanctuary\\n' ;; esac ;;
  " container ls "*)
    [ "$FAKE_DOCKER_CASE" = empty ] || printf 'container-id\\tsanctuary-backend-1\\tsanctuary\\n'
    case "$FAKE_DOCKER_CASE" in leftover*) printf 'leftover-container-id\\tsanctuary-ai-proxy-1\\tsanctuary\\n' ;; esac ;;
  " volume inspect sanctuary_tor_hidden_service ")
    if [ "$FAKE_DOCKER_CASE" = leftover-claimed ]; then
      printf '%s\\n' '[{"Name":"sanctuary_tor_hidden_service","Driver":"local","Scope":"local","Mountpoint":"/var/lib/containers/storage/volumes/tor/_data","CreatedAt":"2026-04-01T00:00:00Z","Options":{},"Labels":{"com.docker.compose.project":"sanctuary","com.docker.compose.volume":"tor_hidden_service","io.sanctuary.project":"sanctuary"}}]'
    else
      printf '%s\\n' '[{"Name":"sanctuary_tor_hidden_service","Driver":"local","Scope":"local","Mountpoint":"/var/lib/containers/storage/volumes/tor/_data","CreatedAt":"2026-04-01T00:00:00Z","Options":{},"Labels":{"com.docker.compose.project":"sanctuary","com.docker.compose.volume":"tor_hidden_service"}}]'
    fi ;;
  " network inspect leftover-network-id ")
    printf '%s\\n' '[{"Id":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","Labels":{"com.docker.compose.project":"sanctuary","com.docker.compose.network":"ai-internal"}}]' ;;
  " container inspect leftover-container-id ")
    printf '%s\\n' '[{"Id":"abababababababababababababababababababababababababababababababab","Config":{"Labels":{"com.docker.compose.project":"sanctuary","com.docker.compose.service":"ai-proxy"}}}]' ;;
  " volume inspect sanctuary_postgres_data ")
    if [ "$FAKE_DOCKER_CASE" = legacy ] || [ "$FAKE_DOCKER_CASE" = post ] || [ "$FAKE_DOCKER_CASE" = identity-changed ] || [ "$FAKE_DOCKER_CASE" = removed ] || [ "$FAKE_DOCKER_CASE" = leftover ] || [ "$FAKE_DOCKER_CASE" = leftover-claimed ]; then
      printf '%s\\n' '[{"Name":"sanctuary_postgres_data","Driver":"local","Scope":"local","Mountpoint":"/var/lib/containers/storage/volumes/postgres/_data","CreatedAt":"2026-08-30T00:00:00Z","Options":{},"Labels":{"com.docker.compose.project":"sanctuary","com.docker.compose.volume":"postgres_data"}}]'
    elif [ "$FAKE_DOCKER_CASE" = partial ]; then
      printf '%s\\n' '[{"Name":"sanctuary_postgres_data","Driver":"local","Scope":"local","Mountpoint":"/var/lib/containers/storage/volumes/postgres/_data","CreatedAt":"2026-08-30T00:00:00Z","Options":{},"Labels":{"com.docker.compose.project":"sanctuary","com.docker.compose.volume":"postgres_data","io.sanctuary.project":"sanctuary"}}]'
    elif [ "$FAKE_DOCKER_CASE" = foreign ]; then
      printf '%s\\n' '[{"Name":"sanctuary_postgres_data","Driver":"local","Scope":"local","Mountpoint":"/var/lib/containers/storage/volumes/postgres/_data","CreatedAt":"2026-08-30T00:00:00Z","Options":{},"Labels":{"com.docker.compose.project":"other","com.docker.compose.volume":"postgres_data"}}]'
    else
      owned="\${labels/RESOURCE_CLASS/compose_volume}"; owned="\${owned/CLEANUP_POLICY/preserve_ambiguous}"
      printf '[{"Name":"sanctuary_postgres_data","Driver":"local","Scope":"local","Mountpoint":"/var/lib/containers/storage/volumes/postgres/_data","CreatedAt":"2026-08-30T00:00:00Z","Options":{},"Labels":{%s,"com.docker.compose.project":"sanctuary","com.docker.compose.volume":"postgres_data"}}]\\n' "$owned"
    fi ;;
  " network inspect network-id "|" network inspect sanctuary_default ")
    compose_labels='{"com.docker.compose.project":"sanctuary","com.docker.compose.network":"default"}'
    if [ "$FAKE_DOCKER_CASE" = identity-changed ]; then printf '%s\\n' "[{\\"Id\\":\\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\\",\\"Labels\\":$compose_labels}]"
    elif [ "$FAKE_DOCKER_CASE" = legacy ] || [ "$FAKE_DOCKER_CASE" = post ] || [ "$FAKE_DOCKER_CASE" = claimed ] || [ "$FAKE_DOCKER_CASE" = removed ] || [ "$FAKE_DOCKER_CASE" = leftover ] || [ "$FAKE_DOCKER_CASE" = leftover-claimed ]; then printf '%s\\n' "[{\\"Id\\":\\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\",\\"Labels\\":$compose_labels}]"
    elif [ "$FAKE_DOCKER_CASE" = mismatch ]; then owned="\${labels/RESOURCE_CLASS/compose_network}"; owned="\${owned/CLEANUP_POLICY/exact_delete}"; printf '[{"Id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Labels":{%s,"com.docker.compose.project":"sanctuary","com.docker.compose.network":"default"}}]\\n' "$owned" | sed 's/owner-1000/owner-other/'
    elif [ "$FAKE_DOCKER_CASE" = foreign ]; then printf '%s\\n' '[{"Id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Labels":{"com.docker.compose.project":"other","com.docker.compose.network":"default"}}]'
    else owned="\${labels/RESOURCE_CLASS/compose_network}"; owned="\${owned/CLEANUP_POLICY/exact_delete}"; printf '[{"Id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Labels":{%s,"com.docker.compose.project":"sanctuary","com.docker.compose.network":"default"}}]\\n' "$owned" ; fi ;;
  " container inspect container-id ")
    compose_labels='{"com.docker.compose.project":"sanctuary","com.docker.compose.service":"backend"}'
    if [ "$FAKE_DOCKER_CASE" = legacy ] || [ "$FAKE_DOCKER_CASE" = leftover ] || [ "$FAKE_DOCKER_CASE" = leftover-claimed ]; then printf '%s\\n' "[{\\"Id\\":\\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\\",\\"Config\\":{\\"Labels\\":$compose_labels}}]"
    elif [ "$FAKE_DOCKER_CASE" = foreign ]; then printf '%s\\n' '[{"Id":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","Config":{"Labels":{"com.docker.compose.project":"other","com.docker.compose.service":"backend"}}}]'
    else owned="\${labels/RESOURCE_CLASS/compose_container}"; owned="\${owned/CLEANUP_POLICY/exact_delete}"; printf '[{"Id":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","Config":{"Labels":{%s,"com.docker.compose.project":"sanctuary","com.docker.compose.service":"backend"}}}]\\n' "$owned" ; fi ;;
  *) printf 'unexpected command: %s\\n' "$*" >&2; exit 65 ;;
esac
`);
  chmodSync(executable, 0o755);
  return { root, log };
}

test('legacy compatibility resolves exact external mappings and refuses unsupported or ambiguous Compose', () => {
  const fixture = installFakeDocker();
  const originalPath = process.env.PATH;
  const originalCase = process.env.FAKE_DOCKER_CASE;
  const originalLog = process.env.FAKE_DOCKER_LOG;
  const legacyResources = [
    { resourceClass: 'compose_network', locator: 'sanctuary_default', composeResource: 'default', cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled' },
    { resourceClass: 'compose_volume', locator: 'sanctuary_postgres_data', composeResource: 'postgres_data', cleanupPolicy: 'preserve_ambiguous', ownershipState: 'unlabeled' },
  ];
  process.env.PATH = `${fixture.root}:${originalPath}`;
  process.env.FAKE_DOCKER_LOG = fixture.log;
  try {
    process.env.FAKE_DOCKER_CASE = 'post';
    assert.match(resolveLegacyDurableComposeOverlay({ composeArgs, legacyResources }).toString(), /!override/);
    process.env.FAKE_DOCKER_CASE = 'unsupported';
    assert.throws(
      () => resolveLegacyDurableComposeOverlay({ composeArgs, legacyResources }),
      /Docker Compose 2\.24\.4 or newer/,
    );
    process.env.FAKE_DOCKER_CASE = 'renamed';
    assert.throws(
      () => resolveLegacyDurableComposeOverlay({ composeArgs, legacyResources }),
      /changed legacy locator/,
    );
    process.env.FAKE_DOCKER_CASE = 'alias';
    assert.throws(
      () => resolveLegacyDurableComposeOverlay({ composeArgs, legacyResources }),
      /alias legacy locator/,
    );
    process.env.FAKE_DOCKER_CASE = 'removed';
    assert.equal(resolveLegacyDurableComposeOverlay({ composeArgs, legacyResources }), null);
  } finally {
    process.env.PATH = originalPath;
    if (originalCase === undefined) delete process.env.FAKE_DOCKER_CASE; else process.env.FAKE_DOCKER_CASE = originalCase;
    if (originalLog === undefined) delete process.env.FAKE_DOCKER_LOG; else process.env.FAKE_DOCKER_LOG = originalLog;
  }
});

test('first-manifest inspection is read-only and refuses legacy or mismatched exact resources', () => {
  const fixture = installFakeDocker();
  const originalPath = process.env.PATH;
  const originalCase = process.env.FAKE_DOCKER_CASE;
  const originalLog = process.env.FAKE_DOCKER_LOG;
  process.env.PATH = `${fixture.root}:${originalPath}`;
  process.env.FAKE_DOCKER_LOG = fixture.log;
  try {
    process.env.FAKE_DOCKER_CASE = 'empty';
    assert.deepEqual(assertFirstManifestDockerResources(identity), { inspected: true, legacyResources: [], retainedResources: [] });

    process.env.FAKE_DOCKER_CASE = 'legacy';
    assert.throws(() => assertFirstManifestDockerResources(identity), (error) => {
      assert.match(error.message, /volume sanctuary_postgres_data: missing io\.sanctuary\.project/);
      assert.match(error.message, /network sanctuary_default: missing io\.sanctuary\.deployment-id/);
      assert.match(error.message, /container sanctuary-backend-1: missing io\.sanctuary\.owner-id/);
      assert.match(error.message, /No resources were relabeled, recreated, or adopted/);
      return true;
    });

    const upgrade = assertFirstManifestDockerResources({ ...identity, allowUnlabeledUpgrade: true });
    assert.equal(upgrade.legacyResources.length, 3);
    assert.deepEqual(upgrade.legacyResources.map((entry) => entry.resourceClass).sort(), [
      'compose_container', 'compose_network', 'compose_volume',
    ]);
    assert.ok(upgrade.legacyResources.every((entry) => entry.cleanupPolicy === 'preserve_ambiguous'));
    assert.ok(upgrade.legacyResources.every((entry) => entry.ownershipState === 'unlabeled'));

    process.env.FAKE_DOCKER_CASE = 'partial';
    assert.throws(
      () => assertFirstManifestDockerResources({ ...identity, allowUnlabeledUpgrade: true }),
      /missing io\.sanctuary\.deployment-id/,
    );

    process.env.FAKE_DOCKER_CASE = 'foreign';
    assert.throws(
      () => assertFirstManifestDockerResources({ ...identity, allowUnlabeledUpgrade: true }),
      /com\.docker\.compose\.project does not match sanctuary/,
    );

    process.env.FAKE_DOCKER_CASE = 'mismatch';
    assert.throws(() => assertFirstManifestDockerResources(identity), /network sanctuary_default: io\.sanctuary\.owner-id does not match owner-1000/);

    process.env.FAKE_DOCKER_CASE = 'matching';
    assert.throws(
      () => assertFirstManifestDockerResources(identity),
      /labels alone cannot establish ownership without a deployment manifest/,
    );

    process.env.FAKE_DOCKER_CASE = 'legacy';
    const observations = assertFirstManifestDockerResources({ ...identity, allowUnlabeledUpgrade: true }).legacyResources;
    process.env.FAKE_DOCKER_CASE = 'post';
    assert.deepEqual(assertLegacyUpgradePostconditions({
      ...identity, legacyResources: observations,
    }), { verified: true });

    process.env.FAKE_DOCKER_CASE = 'claimed';
    assert.throws(
      () => assertLegacyUpgradePostconditions({ ...identity, legacyResources: observations }),
      /legacy resource was retroactively claimed/,
    );

    process.env.FAKE_DOCKER_CASE = 'identity-changed';
    assert.throws(
      () => assertLegacyUpgradePostconditions({ ...identity, legacyResources: observations }),
      /network sanctuary_default: immutable identity changed/,
    );

    process.env.FAKE_DOCKER_CASE = 'removed';
    assert.deepEqual(assertLegacyUpgradePostconditions({
      ...identity, legacyResources: observations,
    }), { verified: true });

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

test('upgrade inspection retains unowned same-project leftovers outside the definition without adopting them', () => {
  const fixture = installFakeDocker();
  const originalPath = process.env.PATH;
  const originalCase = process.env.FAKE_DOCKER_CASE;
  const originalLog = process.env.FAKE_DOCKER_LOG;
  process.env.PATH = `${fixture.root}:${originalPath}`;
  process.env.FAKE_DOCKER_LOG = fixture.log;
  const stderrWrites = [];
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { stderrWrites.push(String(chunk)); return typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1]() : true; };
  try {
    // A long-lived install keeps a Tor volume from a disabled profile, a network
    // renamed by an earlier release, and a stopped container of a removed service.
    process.env.FAKE_DOCKER_CASE = 'leftover';
    const upgrade = assertFirstManifestDockerResources({ ...identity, allowUnlabeledUpgrade: true });
    assert.equal(upgrade.legacyResources.length, 3);
    assert.deepEqual(upgrade.legacyResources.map((entry) => entry.locator).sort(), [
      'sanctuary-backend-1', 'sanctuary_default', 'sanctuary_postgres_data',
    ]);
    assert.deepEqual(upgrade.retainedResources, [
      { resourceClass: 'compose_volume', locator: 'sanctuary_tor_hidden_service', composeResource: 'tor_hidden_service' },
      { resourceClass: 'compose_network', locator: 'sanctuary_ai-internal', composeResource: 'ai-internal' },
      { resourceClass: 'compose_container', locator: 'sanctuary-ai-proxy-1', composeResource: 'ai-proxy' },
    ]);
    const reported = stderrWrites.join('');
    assert.match(reported, /retained unowned legacy volume sanctuary_tor_hidden_service \(tor_hidden_service\) outside the current definition/);
    assert.match(reported, /retained unowned legacy network sanctuary_ai-internal \(ai-internal\)/);
    assert.match(reported, /retained unowned legacy container sanctuary-ai-proxy-1 \(ai-proxy\)/);
    assert.equal(legacyDurableComposeOverlay(upgrade.legacyResources).toString().includes('tor_hidden_service'), false);

    // A first manifest that is not an upgrade still refuses them.
    assert.throws(() => assertFirstManifestDockerResources(identity), (error) => {
      assert.match(error.message, /volume sanctuary_tor_hidden_service: com\.docker\.compose\.volume does not match <unknown>/);
      assert.match(error.message, /network sanctuary_ai-internal: com\.docker\.compose\.network does not match <unknown>/);
      return true;
    });

    // A leftover carrying any io.sanctuary label is partially claimed, never silently retained.
    process.env.FAKE_DOCKER_CASE = 'leftover-claimed';
    assert.throws(
      () => assertFirstManifestDockerResources({ ...identity, allowUnlabeledUpgrade: true }),
      /volume sanctuary_tor_hidden_service: com\.docker\.compose\.volume does not match <unknown>/,
    );

    const calls = readFileSync(fixture.log, 'utf8');
    assert.doesNotMatch(calls, /\b(create|rm|remove|update|up|down|run)\b/);
  } finally {
    process.stderr.write = originalStderrWrite;
    process.env.PATH = originalPath;
    if (originalCase === undefined) delete process.env.FAKE_DOCKER_CASE; else process.env.FAKE_DOCKER_CASE = originalCase;
    if (originalLog === undefined) delete process.env.FAKE_DOCKER_LOG; else process.env.FAKE_DOCKER_LOG = originalLog;
  }
});
