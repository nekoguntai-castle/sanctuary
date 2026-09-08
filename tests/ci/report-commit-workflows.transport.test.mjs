import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('fake curl uses private config authentication, bounded response, and cleans staging', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'commit-report-fixture-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const bin = path.join(root, 'bin');
  const provider = path.join(root, 'provider');
  const runtime = path.join(provider, 'runtime');
  mkdirSync(bin); mkdirSync(provider, { mode: 0o700 });
  const manifest = path.join(root, 'manifest.json');
  writeFileSync(manifest, JSON.stringify({ event: 'push', workflows: [{ workflow_id: 'quality.yml', required_jobs: ['Quality'] }] }));
  writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
set -eu
config=$(cat)
[[ "$config" == *'Authorization: token fixture-secret'* ]]
[[ "$*" != *fixture-secret* ]]
[[ -z \${FORGEJO_TOKEN+x} && -z \${FORGEJO_REPORT_TOKEN+x} ]]
[[ "$*" == *'--max-time 60'* && "$*" == *'--connect-timeout 10'* ]]
url=\${!#}
while (( $# )); do
  if [[ "$1" == --dump-header ]]; then printf 'HTTP/1.1 200 OK\\r\\n\\r\\n' > "$2"; shift; fi
  shift
done
case "$url" in
  */actions/runs/1/jobs) printf '%s' '[{"id":2,"run_id":1,"attempt":1,"name":"Quality","status":"success"}]' ;;
  */actions/runs/1) printf '%s' '{"id":1,"workflow_id":"quality.yml","commit_sha":"${'a'.repeat(40)}","event":"push","status":"success"}' ;;
  *) printf '%s' '{"total_count":1,"workflow_runs":[{"id":1,"workflow_id":"quality.yml","commit_sha":"${'a'.repeat(40)}","event":"push","status":"success"}]}' ;;
esac
`, { mode: 0o700 });
  const result = spawnSync('bash', [
    'scripts/ci/cleanup-ci-callsite.sh', 'run', '--engine', 'host', '--lane', 'commit-report',
    '--runtime', runtime, '--artifact-dir', path.join(root, 'artifacts'), '--checkout-root', process.cwd(),
    '--', 'bash', 'scripts/ci/report-commit-workflows.sh', 'a'.repeat(40), manifest,
  ], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      FORGEJO_TOKEN: 'fixture-secret', SANCTUARY_FORGE_TOKEN: '', FORGEJO_REPOSITORY: 'owner/repo',
      SANCTUARY_FORGE_API_URL: 'https://forgejo.invalid/api/v1',
      SANCTUARY_LOCAL_CLEANUP_AUTHORITY: '1', SANCTUARY_LOCAL_CLEANUP_RUN_ID: 'commit-report-test',
      SANCTUARY_CI_TEMP_DIR_OVERRIDE: provider }, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  const report = result.stdout.trim().split('\n').map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).find((value) => value?.sha === 'a'.repeat(40));
  assert.equal(report?.state, 'success');
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret/);
  assert.equal(existsSync(path.join(runtime, 'subject-staging')), false);
});

test('shell entry point rejects an oversized manifest before staging', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'commit-report-input-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const manifest = path.join(root, 'manifest.json');
  writeFileSync(manifest, 'x'.repeat(65_537));
  const result = spawnSync('bash', [
    'scripts/ci/report-commit-workflows.sh', 'a'.repeat(40), manifest,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest exceeds 65536-byte limit/);
  assert.doesNotMatch(result.stderr, /could not create registered report staging/);
});
