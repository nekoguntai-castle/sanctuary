import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../..');
const subject = join(repoRoot, 'scripts/ci/run-psbt-core-subject.sh');
const containerId = 'a'.repeat(64);
const commit = 'b'.repeat(40);

function fixtureEnv(root, extra = {}) {
  return {
    ...process.env,
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    DOCKER_LOG: join(root, 'docker.log'),
    RUNNER_TEMP: root,
    DIAGNOSTIC_DIR: join(root, 'diagnostics'),
    VERIFY_PSBT_CORE_IMAGE: 'bitcoin/bitcoin:29.0@sha256:' + 'c'.repeat(64),
    SANCTUARY_CLEANUP_COORDINATED: '1',
    SANCTUARY_OWNERSHIP_ROOT: join(root, 'ownership'),
    SANCTUARY_PROJECT: 'psbt-test',
    COMPOSE_PROJECT_NAME: 'psbt-test',
    SANCTUARY_DEPLOYMENT_ID: 'deploy-psbt-test',
    SANCTUARY_OWNER_ID: 'owner-psbt-test',
    SANCTUARY_OPERATION_RUN_ID: 'run-psbt-test',
    SANCTUARY_RELEASE: 'unreleased',
    SANCTUARY_COMMIT: commit,
    SANCTUARY_CLEANUP_CREATED_AT: '2026-09-01T00:00:00.000Z',
    SANCTUARY_RESOURCE_LIFECYCLE: 'obsolete',
    ...extra,
  };
}

function installFakeDocker(root, options = {}) {
  const {
    secondId = containerId,
    createStatus = 23,
    createId = containerId,
    inspectProject = '$SANCTUARY_PROJECT',
    expectedImageId = `sha256:${'e'.repeat(64)}`,
    actualImageId = expectedImageId,
    repoDigest = `sha256:${'c'.repeat(64)}`,
  } = options;
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const docker = join(binDir, 'docker');
  writeFileSync(docker, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "\${1:-}" in
  pull) exit 0 ;;
  create)
    cidfile=''
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --cidfile ]; then cidfile="$2"; break; fi
      shift
    done
    if [ '${createStatus}' -eq 0 ]; then
      printf '%s\\n' '${createId}' > "$cidfile"
      printf '%s\\n' '${createId}'
    fi
    exit '${createStatus}'
    ;;
esac
if [ "\${1:-}" = image ] && [ "\${2:-}" = inspect ]; then
  case "$*" in
    *'{{.Id}}'*) printf '%s\n' '${expectedImageId}' ;;
    *RepoDigests*) printf '%s\n' 'bitcoin/bitcoin:29.0@${repoDigest}' ;;
    *) exit 98 ;;
  esac
  exit 0
fi
if [ "\${1:-}" = inspect ] && [ "\${2:-}" = '${containerId}' ]; then
  case "$*" in
    *NetworkSettings.Ports*) printf '%s\n' '18443' ;;
    *) printf '%s\n' '${actualImageId}' ;;
  esac
  exit 0
fi
if [ "\${1:-}" = start ] && [ "\${2:-}" = '${containerId}' ]; then
  exit 0
fi
if [ "\${1:-}" = container ] && [ "\${2:-}" = inspect ]; then
  id='${containerId}'
  [ "\${3:-}" = '${containerId}' ] && id='${secondId}'
  jq -n --arg id "$id" --arg name "/$COMPOSE_PROJECT_NAME-bitcoin-core" \\
    --arg project "${inspectProject}" --arg deployment "$SANCTUARY_DEPLOYMENT_ID" \\
    --arg owner "$SANCTUARY_OWNER_ID" --arg run "$SANCTUARY_OPERATION_RUN_ID" \\
    --arg created "$SANCTUARY_CLEANUP_CREATED_AT" --arg release "$SANCTUARY_RELEASE" \\
    --arg commit "$SANCTUARY_COMMIT" '[{Id: $id, Name: $name, State: {Status: "created", Running: false}, Config: {Labels: {
      "io.sanctuary.project": $project,
      "io.sanctuary.deployment-id": $deployment,
      "io.sanctuary.owner-id": $owner,
      "io.sanctuary.resource-class": "compose_container",
      "io.sanctuary.lifecycle": "obsolete",
      "io.sanctuary.cleanup-policy": "exact_delete",
      "io.sanctuary.created-at": $created,
      "io.sanctuary.created-by-release": $release,
      "io.sanctuary.created-by-commit": $commit,
      "io.sanctuary.creation-run-id": $run
    }}}]'
  exit 0
fi
exit 99
`);
  chmodSync(docker, 0o755);
}

function installSuccessfulProofCommands(root) {
  for (const command of ['curl', 'npm']) {
    const executable = join(root, 'bin', command);
    writeFileSync(executable, `#!/usr/bin/env bash
set -euo pipefail
printf '%s %s\\n' '${command}' "$*" >> "$DOCKER_LOG"
exit 0
`);
    chmodSync(executable, 0o755);
  }
}

test('PSBT subject refuses direct invocation before Docker mutation', () => {
  const root = mkdtempSync(join(tmpdir(), 'psbt-subject-guard-'));
  try {
    installFakeDocker(root);
    const env = fixtureEnv(root);
    delete env.SANCTUARY_CLEANUP_COORDINATED;
    const result = spawnSync(subject, ['live'], { env, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /requires the signed cleanup coordinator/);
    assert.equal(existsSync(env.DOCKER_LOG), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const mode of ['live', 'regenerate']) {
  test(`${mode} PSBT create response loss recovers the exact ID and preserves status`, () => {
    const root = mkdtempSync(join(tmpdir(), `psbt-subject-${mode}-`));
    try {
      installFakeDocker(root);
      const env = fixtureEnv(root);
      const result = spawnSync(subject, [mode], { env, encoding: 'utf8' });
      assert.equal(result.status, 23, result.stderr);
      assert.equal(readFileSync(join(root, 'psbt-test-bitcoin-core.cid'), 'utf8').trim(), containerId);
      const calls = readFileSync(env.DOCKER_LOG, 'utf8').trim().split('\n');
      assert.equal(calls.filter(call => call.startsWith('container inspect ')).length, 2);
      assert.equal(calls.some(call => call.startsWith('start ')), false);
      const create = calls.find(call => call.startsWith('create '));
      assert.match(create, /--cidfile .* --name psbt-test-bitcoin-core/);
      assert.doesNotMatch(create, /(?:^| )--rm(?: |$)/);
      assert.match(create, /io\.sanctuary\.cleanup-policy=exact_delete/);
      assert.match(create, /io\.sanctuary\.creation-run-id=run-psbt-test/);
      assert.equal(existsSync(join(root, 'ownership', 'registrations')), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('PSBT create recovery refuses a replaced immutable identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'psbt-subject-replaced-'));
  try {
    installFakeDocker(root, { secondId: 'd'.repeat(64) });
    const env = fixtureEnv(root);
    const result = spawnSync(subject, ['live'], { env, encoding: 'utf8' });
    assert.equal(result.status, 23, result.stderr);
    assert.equal(existsSync(join(root, 'psbt-test-bitcoin-core.cid')), false);
    const calls = readFileSync(env.DOCKER_LOG, 'utf8').trim().split('\n');
    assert.equal(calls.filter(call => call.startsWith('container inspect ')).length, 2);
    assert.equal(calls.some(call => call.startsWith('start ')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PSBT successful create rejects a valid foreign ID after exact tuple reinspection', () => {
  const root = mkdtempSync(join(tmpdir(), 'psbt-subject-foreign-success-'));
  const foreignId = 'd'.repeat(64);
  try {
    installFakeDocker(root, { createStatus: 0, createId: foreignId });
    const env = fixtureEnv(root);
    const result = spawnSync(subject, ['live'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /cidfile did not bind the verified created ID/);
    assert.equal(readFileSync(join(root, 'psbt-test-bitcoin-core.cid'), 'utf8').trim(), containerId);
    const calls = readFileSync(env.DOCKER_LOG, 'utf8').trim().split('\n');
    assert.equal(calls.filter(call => call.startsWith('container inspect ')).length, 2);
    assert.equal(calls.some(call => call.startsWith('start ')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PSBT successful create refuses an ownership-tuple mismatch before start', () => {
  const root = mkdtempSync(join(tmpdir(), 'psbt-subject-tuple-mismatch-'));
  try {
    installFakeDocker(root, { createStatus: 0, inspectProject: 'foreign-project' });
    const env = fixtureEnv(root);
    const result = spawnSync(subject, ['live'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(readFileSync(join(root, 'psbt-test-bitcoin-core.cid'), 'utf8').trim(), containerId);
    const calls = readFileSync(env.DOCKER_LOG, 'utf8').trim().split('\n');
    assert.equal(calls.filter(call => call.startsWith('container inspect ')).length, 1);
    assert.equal(calls.some(call => call.startsWith('start ')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PSBT live proof attests exact image ID and repository digest before start', () => {
  const root = mkdtempSync(join(tmpdir(), 'psbt-subject-attested-success-'));
  try {
    installFakeDocker(root, { createStatus: 0 });
    installSuccessfulProofCommands(root);
    const env = fixtureEnv(root);
    const result = spawnSync(subject, ['live'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(env.DOCKER_LOG, 'utf8').trim().split('\n');
    const positions = [
      calls.findIndex(call => call.startsWith('image inspect ') && call.includes('{{.Id}}')),
      calls.findIndex(call => call.startsWith(`inspect ${containerId} `)),
      calls.findIndex(call => call.startsWith('image inspect ') && call.includes('RepoDigests')),
      calls.findIndex(call => call === `start ${containerId}`),
      calls.findIndex(call => call.startsWith('curl ')),
      calls.findIndex(call => call.startsWith('npm ')),
    ];
    assert.deepEqual([...positions].sort((left, right) => left - right), positions);
    assert.equal(positions.every(position => position >= 0), true);
    const create = calls.find(call => call.startsWith('create '));
    assert.match(create, new RegExp(env.VERIFY_PSBT_CORE_IMAGE.replaceAll('.', '\\.')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, dockerOptions] of [
  ['image ID', { actualImageId: `sha256:${'f'.repeat(64)}` }],
  ['repository digest', { repoDigest: `sha256:${'d'.repeat(64)}` }],
]) {
  test(`PSBT live proof refuses ${label} drift before start`, () => {
    const root = mkdtempSync(join(tmpdir(), 'psbt-subject-attestation-drift-'));
    try {
      installFakeDocker(root, { createStatus: 0, ...dockerOptions });
      installSuccessfulProofCommands(root);
      const env = fixtureEnv(root);
      const result = spawnSync(subject, ['live'], { env, encoding: 'utf8' });
      assert.equal(result.status, 1, result.stderr);
      const calls = readFileSync(env.DOCKER_LOG, 'utf8').trim().split('\n');
      assert.equal(calls.some(call => call === `start ${containerId}`), false);
      assert.equal(calls.some(call => call.startsWith('npm ')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
