import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const script = path.join(repoRoot, 'scripts/ci/write-runtime-image-evidence.mjs');
const commit = 'a'.repeat(40);

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'runtime-image-evidence-'));
  const bin = path.join(root, 'bin');
  const output = path.join(root, 'evidence');
  const lock = path.join(root, 'image-lock.json');
  writeFileSync(lock, '{"schemaVersion":1}\n');
  const lockSha = createHash('sha256').update(readFileSync(lock)).digest('hex');
  writeFileSync(path.join(root, 'docker'), `#!/bin/sh
set -eu
if [ "$1 $2" = "image inspect" ]; then
  printf '[{"Id":"sha256:%s","RepoDigests":["example/image@sha256:%s"],"Os":"linux","Architecture":"amd64","Config":{"User":"472","Labels":{"org.opencontainers.image.revision":"%s","dev.sanctuary.image-lock-sha256":"%s"}}}]\n' "$(printf '1%.0s' $(seq 1 64))" "$(printf '2%.0s' $(seq 1 64))" "$FAKE_COMMIT" "$FAKE_LOCK_SHA"
  exit 0
fi
case "$*" in
  *'apk info -v'*) printf 'busybox-1.36.1\nca-certificates-20250619\n' ;;
  *) exit 0 ;;
esac
`);
  chmodSync(path.join(root, 'docker'), 0o755);
  return { root, bin, output, lock, lockSha };
}

function run(fx, overrides = {}) {
  return spawnSync(process.execPath, [
    script,
    '--role', 'grafana-migration',
    '--image', 'example/image:test',
    '--commit', commit,
    '--image-lock', fx.lock,
    '--output-dir', fx.output,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fx.root}:${process.env.PATH}`,
      FAKE_COMMIT: overrides.commit ?? commit,
      FAKE_LOCK_SHA: overrides.lockSha ?? fx.lockSha,
    },
  });
}

test('writes subject-bound provenance and a non-empty SPDX component inventory', () => {
  const fx = fixture();
  const result = run(fx);
  assert.equal(result.status, 0, result.stderr);
  const provenance = JSON.parse(readFileSync(path.join(fx.output, 'grafana-migration.provenance.json')));
  const sbom = JSON.parse(readFileSync(path.join(fx.output, 'grafana-migration.spdx.json')));
  assert.equal(provenance.subject[0].digest.sha256, '1'.repeat(64));
  assert.equal(provenance.predicate.buildDefinition.externalParameters.sourceCommit, commit);
  assert.equal(provenance.predicate.buildDefinition.externalParameters.imageLockSha256, fx.lockSha);
  assert.equal(sbom.spdxVersion, 'SPDX-2.3');
  assert.deepEqual(sbom.packages.map(entry => entry.name), ['busybox', 'ca-certificates']);
});

test('fails closed when the image revision label is not the tested commit', () => {
  const fx = fixture();
  const result = run(fx, { commit: 'b'.repeat(40) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /revision label does not match/);
});

test('fails closed when the image-lock label is not the checked-in lock', () => {
  const fx = fixture();
  const result = run(fx, { lockSha: '3'.repeat(64) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /image-lock label does not match/);
});

test('smokes the backend at its emitted TypeScript entry path', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /backend: \['package-lock[.]json'\]/);
  assert.match(source, /test -f dist\/server\/src\/index[.]js/);
});

test('smokes the frontend through its non-root generated nginx configuration', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /'--env', 'ENABLE_SSL=false'/);
  assert.match(source, /'--env', 'BACKEND_HOST=127[.]0[.]0[.]1'/);
  assert.match(source, /options[.]image, 'nginx', '-t'/);
});
