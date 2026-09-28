import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...options });
function write(root, name, contents) {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), contents, { mode: 0o755 });
}
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'backend-subject-proof-'));
  assert.equal(run('git', ['init', '-q', dir]).status, 0);
  assert.equal(run('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']).status, 0);
  for (const file of ['scripts/ci/run-docker-test-subject.sh', 'scripts/ci/run-ci-compose-subject.sh', 'scripts/ci/backend-docker-inputs.sh']) write(dir, file, readFileSync(file));
  write(dir, 'scripts/ownership/producer-hooks.sh', `ownership_initialize_build_identity() { :; }
export_lane_image_tag() { :; }
register_ci_compose_resources() { printf 'register:%s\\n' "$*" >> "$PROOF_LOG"; return "\${PROOF_REGISTER_STATUS:-0}"; }
`);
  write(dir, 'scripts/ownership/run-compose.sh', '#!/bin/bash\nprintf "compose:%s\\n" "$*" >> "$PROOF_LOG"\nexit "${PROOF_STATUS:-0}"\n');
  write(dir, 'scripts/ci/create-registered-staging.sh', '#!/bin/bash\necho "$PROOF_OUTPUT"\n');
  mkdirSync(path.join(dir, 'output')); write(dir, 'output/test.log', 'public test result\n');
  mkdirSync(path.join(dir, 'runtime'));
  return { dir, env: { ...process.env, SANCTUARY_CLEANUP_COORDINATED: '1', SANCTUARY_RUNTIME_DIR: path.join(dir, 'runtime'), PROOF_LOG: path.join(dir, 'commands.log'), PROOF_OUTPUT: path.join(dir, 'output') } };
}
for (const service of ['backend-test', 'backend-coverage', 'test-all']) {
  test(`${service} registers its image on partial failure and retains receipts without replacing failure`, () => {
    const f = fixture();
    const result = run('bash', [path.join(f.dir, 'scripts/ci/run-docker-test-subject.sh'), service], { env: { ...f.env, PROOF_STATUS: '27', PROOF_REGISTER_STATUS: '13' } });
    assert.equal(result.status, 27, result.stderr);
    assert.match(readFileSync(f.env.PROOF_LOG, 'utf8'), /register:--expected-image sanctuary-backend-test/);
    assert.equal(readFileSync(path.join(f.dir, 'runtime/backend-test-receipts/test.log'), 'utf8'), 'public test result\n');
  });
}
test('successful backend command propagates registration failure', () => {
  const f = fixture(); const result = run('bash', [path.join(f.dir, 'scripts/ci/run-docker-test-subject.sh'), 'backend-test'], { env: { ...f.env, PROOF_REGISTER_STATUS: '13' } });
  assert.equal(result.status, 13);
});
test('frontend preserves no-owned-image admission', () => {
  const f = fixture(); const result = run('bash', [path.join(f.dir, 'scripts/ci/run-docker-test-subject.sh'), 'frontend-test'], { env: f.env });
  assert.equal(result.status, 0, result.stderr); assert.match(readFileSync(f.env.PROOF_LOG, 'utf8'), /register:--allow-no-owned-images/);
});
test('actual integration caller dispatches prepared integration mode and propagates status', () => {
  const f = fixture(); write(f.dir, 'scripts/run-tests.sh', readFileSync('scripts/run-tests.sh'));
  write(f.dir, 'scripts/ci/run-docker-test-subject.sh', '#!/bin/bash\nprintf "%s\\n" "$*" > "$PROOF_LOG"\nexit 31\n');
  const result = run('bash', [path.join(f.dir, 'scripts/run-tests.sh'), '--docker', '--backend', '--integration'], { env: f.env });
  assert.equal(result.status, 31, result.stderr);
  assert.equal(readFileSync(f.env.PROOF_LOG, 'utf8').trim(), 'backend-test bash /repo/scripts/ci/backend-docker-test.sh integration');
});
test('successful backend producer registers its expected image and returns success', () => {
  const f = fixture();
  const result = run('bash', [path.join(f.dir, 'scripts/ci/run-docker-test-subject.sh'), 'backend-test'], { env: f.env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(f.env.PROOF_LOG, 'utf8'), /register:--expected-image sanctuary-backend-test/);
});
