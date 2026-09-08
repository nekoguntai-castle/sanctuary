import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runSubject } from '../../scripts/ownership/ci-subject-supervisor.mjs';

const checkout = path.resolve('.');

function fixture(mode) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ci-supervision-error-'));
  chmodSync(root, 0o700);
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const calls = path.join(root, 'docker.calls');
  writeFileSync(calls, '');
  writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
case "$1 $2" in
  'context show') echo default ;;
  'version --format'|'info --format') echo '{}' ;;
  'context inspect') echo '{"Name":"default","Endpoints":{"docker":{"Host":"unix:///run/docker-coordinator.sock","SkipTLSVerify":false}},"TLSMaterial":{}}' ;;
esac
`, { mode: 0o700 });
  const preload = path.join(root, 'failure.cjs');
  writeFileSync(preload, `
const realKill = process.kill;
process.kill = (pid, signal) => {
  if (pid < 0 && ${mode === 'observation' ? 'signal === 0' : "signal === 'SIGTERM'"}) {
    throw Object.assign(new Error('injected ${mode} failure'), { code: 'EIO' });
  }
  return realKill(pid, signal);
};
`);
  const environment = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: `--require=${preload}`,
    GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '95131', GITHUB_RUN_ATTEMPT: '1',
    RUNNER_TEMP: root, FORGEJO_ACTIONS: 'false', FORGEJO_SERVER_URL: '',
  };
  return { root, calls, environment };
}

for (const mode of ['observation', 'signal']) {
  test(`unknown subject ${mode} suppresses cleanup with signed ambiguity`, {
    skip: process.platform !== 'linux',
  }, () => {
    const { root, calls, environment } = fixture(mode);
    const runtime = path.join(root, 'runtime');
    const artifacts = path.join(root, 'artifacts');
    const request = path.join(root, 'request.json');
    writeFileSync(request, JSON.stringify({
      checkoutRoot: checkout, runtimeDirectory: runtime, artifactDirectory: artifacts,
      lane: `unknown-${mode}`, subjectGraceMs: 10, subjectKillWaitMs: 25,
      ...(mode === 'signal' ? { subjectDeadlineEpochMs: Date.now() + 10_000 } : {}),
    }));
    // The signal fixture self-exits, so even an injected TERM failure cannot
    // leave a test-owned process running. No real Docker resources are created.
    const subject = mode === 'signal'
      ? 'setTimeout(() => process.exit(0), 12000)' : 'process.exit(23)';
    const result = spawnSync(process.execPath, [
      'scripts/ownership/ci-cleanup-coordinator.mjs', 'run', request, '--', process.execPath, '-e', subject,
    ], { cwd: checkout, env: environment, encoding: 'utf8', timeout: 25_000 });
    assert.equal(result.status, mode === 'signal' ? 124 : 23, result.stderr);
    const state = JSON.parse(readFileSync(path.join(runtime, 'coordinator-state.json')));
    assert.equal(state.cleanupSuppression, 'subject_quiescence_failed');
    const upload = JSON.parse(readFileSync(path.join(artifacts, 'final-upload.json')));
    assert.equal(upload.state, 'ambiguous');
    assert.doesNotMatch(readFileSync(calls, 'utf8'), /\b(?:rm|stop|kill|prune)\b/);
    const verified = spawnSync(process.execPath, [
      'scripts/ownership/verify-ci-cleanup-upload.mjs', '--artifact-root', artifacts,
      '--runtime-root', runtime, '--checkout-root', checkout,
    ], { cwd: checkout, env: environment, encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
  });
}

test('a known no-child spawn failure retains its original ENOENT error', async () => {
  await assert.rejects(runSubject('no-such-supervision-subject', [], {}, {
    graceMs: 10, killWaitMs: 25, remainingMs: null,
  }), (error) => error.code === 'ENOENT' && error.cleanupSuppression === undefined);
});

test('post-exit observation failure preserves the original cause and subject status', {
  skip: process.platform !== 'linux',
}, async (context) => {
  const cause = Object.assign(new Error('process group query unavailable'), { code: 'EIO' });
  const originalKill = process.kill;
  context.mock.method(process, 'kill', (pid, signal) => {
    if (pid < 0 && signal === 0) throw cause;
    return originalKill(pid, signal);
  });
  await assert.rejects(runSubject(process.execPath, ['-e', 'process.exit(23)'], {}, {
    graceMs: 10, killWaitMs: 25, remainingMs: null,
  }), (error) => error.exitCode === 23
    && error.cleanupSuppression === 'subject_quiescence_failed' && error.cause === cause);
});
