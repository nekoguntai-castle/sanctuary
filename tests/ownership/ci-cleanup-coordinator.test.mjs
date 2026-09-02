import assert from 'node:assert/strict';
import {
  chmodSync, constants as fsConstants, copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson } from '../../scripts/ownership/canonical-json.mjs';

const CHECKOUT = path.resolve('.');
const CLI = path.join(CHECKOUT, 'scripts/ownership/ci-cleanup-coordinator.mjs');
const FACADE = path.join(CHECKOUT, 'scripts/ci/cleanup-ci-callsite.sh');
const VERIFY_UPLOAD = path.join(CHECKOUT, 'scripts/ownership/verify-ci-cleanup-upload.mjs');
const REAL_GIT = spawnSync(
  'sh', ['-c', 'command -v git'], { encoding: 'utf8' },
).stdout.trim();

function fakeDocker(directory) {
  const engine = path.join(directory, 'docker');
writeFileSync(engine, `#!/usr/bin/env bash
set -euo pipefail
if [ -n "\${DOCKER_FINISH_TRIGGER_FILE:-}" ] && [ -e "$DOCKER_FINISH_TRIGGER_FILE" ] \
    && [ -n "\${DOCKER_FINISH_WINDOW_MARKER:-}" ] && [ ! -e "$DOCKER_FINISH_WINDOW_MARKER" ]; then
  : > "$DOCKER_FINISH_WINDOW_MARKER"
  sleep "\${DOCKER_WINDOW_DELAY_SECONDS:-0.25}"
fi
if [ -n "\${DOCKER_CALLS:-}" ]; then printf '%q ' "$@" >> "$DOCKER_CALLS"; printf '\\n' >> "$DOCKER_CALLS"; fi
if [ "\${1:-}" = --host ]; then shift 2; fi
case "\${1:-} \${2:-}" in
  "context show") printf 'default\\n' ;;
  "version --format"|"info --format") printf '{}\\n' ;;
  "context inspect") printf '%s\\n' '{"Name":"default","Endpoints":{"docker":{"Host":"unix:///run/docker-coordinator.sock","SkipTLSVerify":false}},"TLSMaterial":{}}' ;;
esac
`, { mode: 0o700 });
}

function fakeGit(directory) {
  const executable = path.join(directory, 'git');
  writeFileSync(executable, `#!/usr/bin/env bash
set -euo pipefail
if [ -n "\${GIT_PREPARE_WINDOW_MARKER:-}" ] && [ ! -e "$GIT_PREPARE_WINDOW_MARKER" ]; then
  : > "$GIT_PREPARE_WINDOW_MARKER"
  sleep "\${COORDINATOR_WINDOW_DELAY_SECONDS:-0.25}"
fi
exec ${JSON.stringify(REAL_GIT)} "$@"
`, { mode: 0o700 });
}

function ciEnvironment(runnerTemp, bin, runId, runAttempt = '1') {
  return {
    ...process.env, PATH: `${bin}:${process.env.PATH}`,
    GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt,
    RUNNER_TEMP: runnerTemp, FORGEJO_ACTIONS: 'false', FORGEJO_SERVER_URL: '',
  };
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

test('run coordinator preserves failing subject status after verified no-op evidence', () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-coordinator-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'cli',
  }), { mode: 0o600 });
  const result = spawnSync(process.execPath, [
    CLI, 'run', requestPath, '--', 'bash', '-c',
    'test "$SANCTUARY_RESOURCE_LIFECYCLE" = obsolete; exit 17',
  ], {
    cwd: CHECKOUT, encoding: 'utf8', env: ciEnvironment(runnerTemp, bin, '95003'),
  });
  assert.equal(result.status, 17, result.stderr);
  assert.equal(existsSync(path.join(artifactDirectory, 'planning-upload.json')), true);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json')), true);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json.sig')), true);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.sha256')), true);
});

test('run coordinator keeps a stable Node runtime when the subject replaces its launcher', {
  skip: process.platform !== 'linux',
}, () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-node-runtime-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  const transientNode = path.join(runnerTemp, 'subject-managed-node');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  copyFileSync(process.execPath, transientNode, fsConstants.COPYFILE_FICLONE);
  chmodSync(transientNode, 0o700);
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'stable-node-runtime',
  }), { mode: 0o600 });
  const result = spawnSync(transientNode, [
    CLI, 'run', requestPath, '--', 'bash', '-c', 'rm -f "$SUBJECT_MANAGED_NODE"',
  ], {
    cwd: CHECKOUT, encoding: 'utf8', env: {
      ...ciEnvironment(runnerTemp, bin, '95012'), SUBJECT_MANAGED_NODE: transientNode,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(transientNode), false);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json')), true);
});

test('ordinary leader exit with a live descendant suppresses cleanup and kills the group', {
  skip: process.platform === 'win32',
}, () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-ordinary-descendant-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  const dockerCalls = path.join(runnerTemp, 'docker.calls');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  writeFileSync(dockerCalls, '');
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'ordinary-descendant',
    subjectGraceMs: 25, subjectKillWaitMs: 1_000,
  }), { mode: 0o600 });
  const marker = path.join(runtimeDirectory, 'late-descendant-mutation');
  const descendant = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, 'mutated'), 250);
    setInterval(() => {}, 1_000);
  `;
  const subject = `
    const { spawn } = require('node:child_process');
    spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' }).unref();
  `;
  const result = spawnSync(process.execPath, [
    CLI, 'run', requestPath, '--', process.execPath, '-e', subject,
  ], {
    cwd: CHECKOUT, encoding: 'utf8',
    env: { ...ciEnvironment(runnerTemp, bin, '95011'), DOCKER_CALLS: dockerCalls },
  });
  assert.equal(result.status, 126, result.stderr);
  assert.match(result.stderr, /process group remained runnable/);
  assert.equal(existsSync(marker), false);
  const state = JSON.parse(readFileSync(path.join(runtimeDirectory, 'coordinator-state.json'), 'utf8'));
  assert.equal(state.cleanupSuppression, 'subject_quiescence_failed');
  const finalUpload = JSON.parse(readFileSync(path.join(artifactDirectory, 'final-upload.json'), 'utf8'));
  assert.equal(finalUpload.state, 'ambiguous');
  assert.doesNotMatch(readFileSync(dockerCalls, 'utf8'), /\b(?:rm|stop|kill)\b/);
});

test('run coordinator terminalizes and emits signed evidence when subject launch fails', () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-spawn-failure-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'spawn-failure',
  }), { mode: 0o600 });
  const result = spawnSync(process.execPath, [
    CLI, 'run', requestPath, '--', 'definitely-not-a-sanctuary-command',
  ], {
    cwd: CHECKOUT, encoding: 'utf8', env: ciEnvironment(runnerTemp, bin, '95008'),
  });
  assert.equal(result.status, 127, result.stderr);
  assert.match(result.stderr, /subject launch\/supervision failed/);
  assert.equal(existsSync(path.join(artifactDirectory, 'planning-upload.json')), true);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json')), true);
  assert.equal(JSON.parse(readFileSync(
    path.join(runtimeDirectory, 'coordinator-state.json'), 'utf8',
  )).phase, 'projected');
});

test('subject-managed failure before bind emits a signed zero-authority refusal', () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-prebind-failure-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  const dockerCalls = path.join(runnerTemp, 'docker.calls');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  writeFileSync(dockerCalls, '');
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'prebind-failure',
    authorityMode: 'deployment_managed_by_subject',
  }), { mode: 0o600 });
  const environment = {
    ...ciEnvironment(runnerTemp, bin, '95015'), DOCKER_CALLS: dockerCalls,
  };
  const result = spawnSync(process.execPath, [
    CLI, 'run', requestPath, '--', 'bash', '-c', 'exit 17',
  ], { cwd: CHECKOUT, encoding: 'utf8', env: environment });
  assert.equal(result.status, 17, result.stderr);
  const outcome = JSON.parse(result.stdout);
  assert.equal(outcome.cleanupState, 'refused');
  const state = JSON.parse(readFileSync(
    path.join(runtimeDirectory, 'coordinator-state.json'), 'utf8',
  ));
  assert.equal(state.phase, 'projected');
  assert.equal(state.deploymentManifestDigest, null);
  assert.equal(state.runManifestDigest, null);
  const privateReceipt = JSON.parse(readFileSync(state.planningReceiptPath, 'utf8'));
  assert.equal(privateReceipt.phase, 'coordination');
  assert.equal(privateReceipt.ownershipAuthorityEstablished, false);
  assert.equal(privateReceipt.deploymentManifestDigest, null);
  assert.deepEqual(privateReceipt.actions, []);
  const finalUpload = JSON.parse(readFileSync(
    path.join(artifactDirectory, 'final-upload.json'), 'utf8',
  ));
  assert.equal(finalUpload.state, 'refused');
  assert.deepEqual(finalUpload.failureClasses, ['unregistered']);
  assert.doesNotMatch(readFileSync(dockerCalls, 'utf8'), /\b(?:rm|stop|kill|prune)\b/);
  const verified = spawnSync(process.execPath, [
    VERIFY_UPLOAD, '--artifact-root', artifactDirectory,
    '--runtime-root', runtimeDirectory, '--checkout-root', CHECKOUT,
  ], { cwd: CHECKOUT, encoding: 'utf8', env: environment });
  assert.equal(verified.status, 0, verified.stderr);
  const privateReceiptPath = state.planningReceiptPath;
  unlinkSync(`${privateReceiptPath}.sig`);
  const recoverPath = path.join(runnerTemp, 'recover.json');
  writeFileSync(recoverPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory,
    lane: 'prebind-failure', authorityMode: 'deployment_managed_by_subject',
    statePath: path.join(runtimeDirectory, 'coordinator-state.json'),
    subjectExitStatus: 17,
  }), { mode: 0o600 });
  const recovered = spawnSync(process.execPath, [CLI, 'recover', recoverPath], {
    cwd: CHECKOUT, encoding: 'utf8', env: environment,
  });
  assert.equal(recovered.status, 17, recovered.stderr);
  assert.equal(existsSync(`${privateReceiptPath}.sig`), true);
  assert.equal(JSON.parse(recovered.stdout).cleanupState, 'refused');
});

test('witnessed failure before subject bind creates canonical fallback cleanup authority', () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-witness-fallback-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  const dockerCalls = path.join(runnerTemp, 'docker.calls');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  writeFileSync(dockerCalls, '');
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'witness-fallback',
    authorityMode: 'deployment_managed_by_subject', legacyFixtureCreationWitness: true,
  }), { mode: 0o600 });
  const environment = {
    ...ciEnvironment(runnerTemp, bin, '95016'), DOCKER_CALLS: dockerCalls,
  };
  const result = spawnSync(process.execPath, [
    CLI, 'run', requestPath, '--', 'bash', '-c', 'exit 17',
  ], { cwd: CHECKOUT, encoding: 'utf8', env: environment });
  assert.equal(result.status, 17, result.stderr);
  const outcome = JSON.parse(result.stdout);
  assert.equal(outcome.cleanupState, 'no_op');
  const state = JSON.parse(readFileSync(
    path.join(runtimeDirectory, 'coordinator-state.json'), 'utf8',
  ));
  assert.equal(state.phase, 'projected');
  assert.match(state.deploymentManifestDigest, /^[a-f0-9]{64}$/);
  assert.match(state.runManifestDigest, /^[a-f0-9]{64}$/);
  const finalUpload = JSON.parse(readFileSync(
    path.join(artifactDirectory, 'final-upload.json'), 'utf8',
  ));
  assert.equal(finalUpload.state, 'no_op');
  assert.doesNotMatch(readFileSync(dockerCalls, 'utf8'), /\b(?:rm|stop|kill|prune)\b/);
});

test('shell facade constructs a canonical request and preserves subject status', () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-facade-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  const result = spawnSync('bash', [
    FACADE, 'run', '--lane', 'facade', '--runtime', runtimeDirectory,
    '--artifact-dir', artifactDirectory, '--', 'bash', '-c', 'exit 19',
  ], {
    cwd: CHECKOUT, encoding: 'utf8', env: ciEnvironment(runnerTemp, bin, '95004', '2'),
  });
  assert.equal(result.status, 19, result.stderr);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json')), true);
  const recovered = spawnSync('bash', [
    FACADE, 'recover', '--lane', 'facade', '--runtime', runtimeDirectory,
    '--artifact-dir', artifactDirectory,
    '--state', path.join(runtimeDirectory, 'coordinator-state.json'),
    '--subject-exit-status', '19',
  ], {
    cwd: CHECKOUT, encoding: 'utf8', env: ciEnvironment(runnerTemp, bin, '95004', '2'),
  });
  assert.equal(recovered.status, 19, recovered.stderr);
});

test('run coordinator reports cleanup failure separately from a failing subject', () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-failure-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'failure',
  }), { mode: 0o600 });
  const result = spawnSync(process.execPath, [
    CLI, 'run', requestPath, '--', 'bash', '-c',
    'chmod 644 "$SANCTUARY_RUNTIME_DIR/coordinator/keys/evidence/private.pem"; exit 23',
  ], {
    cwd: CHECKOUT, encoding: 'utf8', env: ciEnvironment(runnerTemp, bin, '95005'),
  });
  assert.equal(result.status, 23, result.stderr);
  const outcome = JSON.parse(result.stdout);
  assert.equal(outcome.subjectExitStatus, 23);
  assert.equal(outcome.cleanupState, 'coordinator_failed');
  assert.equal(outcome.cleanupExitStatus, 2);
  assert.match(result.stderr, /cleanup failed after subject 23/);
});

test('finish refuses mismatched runtime, lane, and live provider before terminalization', () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-authority-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  const preparePath = path.join(runnerTemp, 'prepare.json');
  writeFileSync(preparePath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'authority',
  }), { mode: 0o600 });
  const prepared = spawnSync(process.execPath, [CLI, 'prepare', preparePath], {
    cwd: CHECKOUT, encoding: 'utf8', env: ciEnvironment(runnerTemp, bin, '95006'),
  });
  assert.equal(prepared.status, 0, prepared.stderr);
  const statePath = path.join(runtimeDirectory, 'coordinator-state.json');
  const finishPath = path.join(runnerTemp, 'finish.json');
  writeFileSync(finishPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory: path.join(runnerTemp, 'wrong-runtime'),
    artifactDirectory, lane: 'wrong-lane', statePath, subjectExitStatus: 0,
  }), { mode: 0o600 });
  const refused = spawnSync(process.execPath, [CLI, 'finish', finishPath], {
    cwd: CHECKOUT, encoding: 'utf8', env: ciEnvironment(runnerTemp, bin, 'different-run'),
  });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /does not match the current provider authority/);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).phase, 'trust_installed');
});

test('run coordinator finalizes signed evidence when TERM arrives during prepare', {
  skip: process.platform === 'win32',
}, async () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-prepare-signal-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  const prepareWindow = path.join(runnerTemp, 'prepare-window');
  const subjectRan = path.join(runnerTemp, 'subject-ran');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  fakeGit(bin);
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'prepare-signal',
  }), { mode: 0o600 });
  const subjectScript = `require('node:fs').writeFileSync(${JSON.stringify(subjectRan)}, 'yes')`;
  const child = spawn(process.execPath, [
    CLI, 'run', requestPath, '--', process.execPath, '-e', subjectScript,
  ], {
    cwd: CHECKOUT,
    env: {
      ...ciEnvironment(runnerTemp, bin, '95012'),
      GIT_PREPARE_WINDOW_MARKER: prepareWindow,
      COORDINATOR_WINDOW_DELAY_SECONDS: '0.5',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  await waitForFile(prepareWindow);
  process.kill(child.pid, 'SIGTERM');
  assert.equal(await closed, 143, stderr);
  assert.equal(existsSync(subjectRan), false);
  const outcome = JSON.parse(stdout);
  assert.equal(outcome.subjectExitStatus, 143);
  assert.equal(existsSync(path.join(artifactDirectory, 'planning-upload.json')), true);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json')), true);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json.sig')), true);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.sha256')), true);
  assert.equal(readFileSync(
    path.join(runtimeDirectory, 'coordinator', 'cancellation-signal'), 'utf8',
  ).trim(), 'SIGTERM');
});

test('run coordinator keeps INT handling through finish and preserves subject failure precedence', {
  skip: process.platform === 'win32',
}, async (context) => {
  for (const fixture of [
    { subjectStatus: 0, expectedStatus: 130, runId: '95013' },
    { subjectStatus: 23, expectedStatus: 23, runId: '95014' },
  ]) {
    await context.test(`subject status ${fixture.subjectStatus}`, async () => {
      const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-finish-signal-'));
      chmodSync(runnerTemp, 0o700);
      const runtimeDirectory = path.join(runnerTemp, 'runtime');
      const artifactDirectory = path.join(runnerTemp, 'artifacts');
      const bin = path.join(runnerTemp, 'bin');
      const finishTrigger = path.join(runnerTemp, 'finish-trigger');
      const finishWindow = path.join(runnerTemp, 'finish-window');
      mkdirSync(artifactDirectory, { mode: 0o700 });
      mkdirSync(bin, { mode: 0o700 });
      fakeDocker(bin);
      const requestPath = path.join(runnerTemp, 'request.json');
      writeFileSync(requestPath, canonicalJson({
        checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: `finish-${fixture.runId}`,
      }), { mode: 0o600 });
      const subjectScript = `
        require('node:fs').writeFileSync(${JSON.stringify(finishTrigger)}, 'yes');
        process.exit(${fixture.subjectStatus});
      `;
      const child = spawn(process.execPath, [
        CLI, 'run', requestPath, '--', process.execPath, '-e', subjectScript,
      ], {
        cwd: CHECKOUT,
        env: {
          ...ciEnvironment(runnerTemp, bin, fixture.runId),
          DOCKER_FINISH_TRIGGER_FILE: finishTrigger,
          DOCKER_FINISH_WINDOW_MARKER: finishWindow,
          DOCKER_WINDOW_DELAY_SECONDS: '0.5',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const closed = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      await waitForFile(finishWindow);
      process.kill(child.pid, 'SIGINT');
      assert.equal(await closed, fixture.expectedStatus, stderr);
      const outcome = JSON.parse(stdout);
      assert.equal(outcome.subjectExitStatus, fixture.subjectStatus);
      assert.equal(existsSync(path.join(artifactDirectory, 'planning-upload.json')), true);
      assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json')), true);
      assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json.sig')), true);
      assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.sha256')), true);
      assert.equal(readFileSync(
        path.join(runtimeDirectory, 'coordinator', 'cancellation-signal'), 'utf8',
      ).trim(), 'SIGINT');
    });
  }
});

test('run coordinator bounds signal shutdown with TERM then KILL and still emits evidence', {
  skip: process.platform === 'win32',
}, async () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-signal-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'signal',
    subjectGraceMs: 25, subjectKillWaitMs: 1_000,
  }), { mode: 0o600 });
  const subjectScript = `
    const fs = require('node:fs');
    const root = process.env.SANCTUARY_RUNTIME_DIR;
    process.on('SIGTERM', () => fs.writeFileSync(root + '/subject-saw-term', 'yes'));
    fs.writeFileSync(root + '/subject-ready', 'yes');
    setInterval(() => {}, 1_000);
  `;
  const child = spawn(process.execPath, [
    CLI, 'run', requestPath, '--', process.execPath, '-e', subjectScript,
  ], {
    cwd: CHECKOUT, env: ciEnvironment(runnerTemp, bin, '95007'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await waitForFile(path.join(runtimeDirectory, 'subject-ready'));
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  process.kill(child.pid, 'SIGHUP');
  const code = await closed;
  assert.equal(code, 129, stderr);
  assert.equal(existsSync(path.join(runtimeDirectory, 'subject-saw-term')), true);
  assert.equal(existsSync(path.join(artifactDirectory, 'planning-upload.json')), true);
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json')), true);
});

test('run coordinator waits for a signal-ignoring descendant after its leader exits', {
  skip: process.platform === 'win32',
}, async () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-descendant-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'descendant',
    subjectGraceMs: 25, subjectKillWaitMs: 1_000,
  }), { mode: 0o600 });
  const subjectScript = `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const root = process.env.SANCTUARY_RUNTIME_DIR;
    const descendant = spawn(process.execPath, ['-e', \`process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\`], { stdio: 'ignore' });
    fs.writeFileSync(root + '/descendant-pid', String(descendant.pid));
    process.on('SIGTERM', () => process.exit(0));
    fs.writeFileSync(root + '/subject-ready', 'yes');
    setInterval(() => {}, 1_000);
  `;
  const child = spawn(process.execPath, [
    CLI, 'run', requestPath, '--', process.execPath, '-e', subjectScript,
  ], {
    cwd: CHECKOUT, env: ciEnvironment(runnerTemp, bin, '95009'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await waitForFile(path.join(runtimeDirectory, 'subject-ready'));
  const descendantPid = Number(readFileSync(path.join(runtimeDirectory, 'descendant-pid'), 'utf8'));
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  process.kill(child.pid, 'SIGHUP');
  assert.equal(await closed, 129, stderr);
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${descendantPid}/stat`, 'utf8');
      assert.match(stat.slice(stat.lastIndexOf(')') + 2), /^[ZX] /);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  } else {
    assert.throws(() => process.kill(descendantPid, 0), { code: 'ESRCH' });
  }
  assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json')), true);
});

test('failed process-group quiescence emits ambiguity without cleanup mutation', {
  skip: process.platform === 'win32',
}, async () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-nonquiescent-'));
  chmodSync(runnerTemp, 0o700);
  const runtimeDirectory = path.join(runnerTemp, 'runtime');
  const artifactDirectory = path.join(runnerTemp, 'artifacts');
  const bin = path.join(runnerTemp, 'bin');
  const dockerCalls = path.join(runnerTemp, 'docker.calls');
  const preload = path.join(runnerTemp, 'nonquiescent.cjs');
  mkdirSync(artifactDirectory, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  fakeDocker(bin);
  writeFileSync(dockerCalls, '');
  writeFileSync(preload, `
const realKill = process.kill;
process.kill = (pid, signal) => {
  if (pid < 0) return true;
  return realKill(pid, signal);
};
`, { mode: 0o600 });
  const requestPath = path.join(runnerTemp, 'request.json');
  writeFileSync(requestPath, canonicalJson({
    checkoutRoot: CHECKOUT, runtimeDirectory, artifactDirectory, lane: 'nonquiescent',
    subjectGraceMs: 10, subjectKillWaitMs: 25,
  }), { mode: 0o600 });
  const subjectScript = `
    const fs = require('node:fs');
    fs.writeFileSync(process.env.SANCTUARY_RUNTIME_DIR + '/subject-pid', String(process.pid));
    fs.writeFileSync(process.env.SANCTUARY_RUNTIME_DIR + '/subject-ready', 'yes');
    setInterval(() => {}, 1_000);
  `;
  const child = spawn(process.execPath, [
    CLI, 'run', requestPath, '--', process.execPath, '-e', subjectScript,
  ], {
    cwd: CHECKOUT,
    env: {
      ...ciEnvironment(runnerTemp, bin, '95010'),
      DOCKER_CALLS: dockerCalls, NODE_OPTIONS: `--require=${preload}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await waitForFile(path.join(runtimeDirectory, 'subject-ready'));
  const subjectPid = Number(readFileSync(path.join(runtimeDirectory, 'subject-pid'), 'utf8'));
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  process.kill(child.pid, 'SIGHUP');
  assert.equal(await exited, 129, stderr);
  process.kill(subjectPid, 'SIGKILL');
  await new Promise((resolve) => child.once('close', resolve));
  assert.match(stderr, /did not quiesce/);
  const state = JSON.parse(readFileSync(path.join(runtimeDirectory, 'coordinator-state.json'), 'utf8'));
  assert.equal(state.phase, 'projected');
  assert.equal(state.cleanupSuppression, 'subject_quiescence_failed');
  const finalUpload = JSON.parse(readFileSync(path.join(artifactDirectory, 'final-upload.json'), 'utf8'));
  assert.equal(finalUpload.state, 'ambiguous');
  assert.doesNotMatch(readFileSync(dockerCalls, 'utf8'), /\b(?:rm|stop|kill)\b/);
});
