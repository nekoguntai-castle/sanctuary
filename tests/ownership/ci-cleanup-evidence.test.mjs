import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { writeSignedArtifact } from '../../scripts/ownership/cleanup-evidence.mjs';
import { publicKeyFingerprint } from '../../scripts/ownership/crypto.mjs';
import {
  assertCleanupInvocationResult, planCiCleanupEvidence, resumeCiCleanupEvidence,
} from '../../scripts/ownership/ci-cleanup-evidence.mjs';
import {
  finishCiCleanupLifecycle, prepareCiCleanupLifecycle,
} from '../../scripts/ownership/ci-cleanup-lifecycle.mjs';
import { readCoordinatorState } from '../../scripts/ownership/ci-cleanup-state.mjs';
import { verifyCiCleanupUpload } from '../../scripts/ownership/verify-ci-cleanup-upload.mjs';

const CHECKOUT = path.resolve('.');

test('cleanup invocation result preserves subprocess failures and accepted statuses', () => {
  const spawnError = Object.assign(new Error('stdout maxBuffer length exceeded'), {
    code: 'ENOBUFS',
  });
  assert.throws(
    () => assertCleanupInvocationResult({ error: spawnError, status: null }, 'inventory'),
    (error) => error.message === 'cleanup inventory could not execute: stdout maxBuffer length exceeded'
      && error.cause === spawnError && error.exitCode === 2,
  );
  assert.throws(
    () => assertCleanupInvocationResult({ status: 64, stderr: 'invalid request\n' }, 'plan'),
    (error) => error.message === 'cleanup plan failed (64): invalid request'
      && error.exitCode === 64,
  );
  assert.throws(
    () => assertCleanupInvocationResult({ status: 65, stderr: Buffer.from('binary') }, 'execute'),
    /cleanup execute failed \(65\): $/,
  );
  const accepted = { status: 4, stdout: '{}\n', stderr: '' };
  assert.equal(assertCleanupInvocationResult(accepted, 'inventory', [0, 4]), accepted);
});

function fakeDocker(directory) {
  const engine = path.join(directory, 'docker');
  writeFileSync(engine, `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = --host ]; then shift 2; fi
case "\${1:-} \${2:-}" in
  "context show") printf 'default\\n' ;;
  "version --format"|"info --format") printf '{}\\n' ;;
  "context inspect") printf '%s\\n' '{"Name":"default","Endpoints":{"docker":{"Host":"unix:///run/docker-ci-evidence.sock","SkipTLSVerify":false}},"TLSMaterial":{}}' ;;
  "container ls"|"volume ls"|"image ls") printf '' ;;
  "network ls")
    if [ -f "\${FAKE_DOCKER_RESOURCE:-/nonexistent}" ]; then printf '%s\\n' "$FAKE_DOCKER_ID"; fi
    ;;
  "network inspect")
    [ -f "$FAKE_DOCKER_RESOURCE" ] || exit 1
    printf '[{"Id":"%s","Containers":{},"Labels":{"io.sanctuary.project":"%s","io.sanctuary.deployment-id":"%s","io.sanctuary.owner-id":"%s","io.sanctuary.resource-class":"compose_network","io.sanctuary.lifecycle":"obsolete","io.sanctuary.cleanup-policy":"exact_delete","io.sanctuary.created-at":"%s","io.sanctuary.created-by-release":"unreleased","io.sanctuary.created-by-commit":"%s","io.sanctuary.creation-run-id":"%s"}}]\\n' "$FAKE_DOCKER_ID" "$FAKE_DOCKER_PROJECT" "$FAKE_DOCKER_DEPLOYMENT" "$FAKE_DOCKER_OWNER" "$FAKE_DOCKER_CREATED_AT" "$FAKE_DOCKER_COMMIT" "$FAKE_DOCKER_RUN"
    ;;
  "network rm")
    printf '%s\n' "$$" > "$FAKE_DOCKER_CLIENT_PID"
    rm -f -- "$FAKE_DOCKER_RESOURCE"
    if [ "\${FAKE_DOCKER_MODE:-normal}" = crash_after_remove ]; then
      : > "$FAKE_DOCKER_MARKER"
      while :; do sleep 1; done
    fi
    printf '%s\\n' "$FAKE_DOCKER_ID"
    ;;
  *) printf 'unexpected fake Docker command: %s\\n' "$*" >&2; exit 64 ;;
esac
`, { mode: 0o700 });
  return engine;
}

function waitForFile(filePath, child, timeoutMs = 10_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (existsSync(filePath)) return resolve();
      if (child.exitCode !== null || child.signalCode !== null) {
        return reject(new Error(
          `coordinator exited before ${path.basename(filePath)}: ${child.stderrText ?? ''}`,
        ));
      }
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for cleanup mutation'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}

function processCanRun(pid) {
  try {
    process.kill(pid, 0);
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const commandEnd = stat.lastIndexOf(')');
    return !['Z', 'X'].includes(stat.slice(commandEnd + 2).split(/\s+/, 1)[0]);
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
    throw error;
  }
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('condition did not become true before timeout');
}

function withCiEnvironment(callback) {
  const keys = [
    'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'RUNNER_TEMP',
    'FORGEJO_ACTIONS', 'FORGEJO_SERVER_URL',
  ];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-evidence-'));
  chmodSync(runnerTemp, 0o700);
  Object.assign(process.env, {
    GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '84002',
    GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: runnerTemp,
    FORGEJO_ACTIONS: 'false', FORGEJO_SERVER_URL: '',
  });
  try { return callback(runnerTemp); } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test('CI cleanup evidence emits verified planning and final upload projections for no-op', () => {
  withCiEnvironment((runnerTemp) => {
    const runtimeDirectory = path.join(runnerTemp, 'runtime');
    const startedAt = new Date();
    const prepared = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'evidence',
      now: startedAt,
    });
    finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 0,
      now: new Date(startedAt.getTime() + 1_000),
    });
    const bin = path.join(runnerTemp, 'bin');
    const artifactDirectory = path.join(runnerTemp, 'artifacts');
    mkdirSync(bin, { mode: 0o700 });
    mkdirSync(artifactDirectory, { mode: 0o700 });
    fakeDocker(bin);
    const priorPath = process.env.PATH;
    process.env.PATH = `${bin}:${priorPath}`;
    let planned;
    try {
      planned = planCiCleanupEvidence({
        statePath: prepared.path, checkoutRoot: CHECKOUT, artifactDirectory,
      });
    } finally { process.env.PATH = priorPath; }
    assert.equal(planned.privateReceipt.state, 'no_op');
    assert.equal(planned.state.phase, 'projected');
    for (const name of [
      'planning-upload.json', 'planning-upload.json.sig', 'planning-upload.sha256',
      'final-upload.json', 'final-upload.json.sig', 'final-upload.sha256',
      'evidence-public.pem', 'authorization-public.pem',
    ]) assert.equal(existsSync(path.join(artifactDirectory, name)), true, name);
    assert.doesNotThrow(() => verifyCiCleanupUpload({
      artifactRoot: artifactDirectory, runtimeRoot: runnerTemp, checkoutRoot: CHECKOUT,
    }));

    const forgedDirectory = path.join(runnerTemp, 'forged-artifacts');
    const forgedKeys = path.join(runnerTemp, 'forged-keys');
    mkdirSync(forgedDirectory, { mode: 0o700 });
    mkdirSync(forgedKeys, { mode: 0o700 });
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPath = path.join(forgedKeys, 'private.pem');
    const publicKeyPath = path.join(forgedKeys, 'public.pem');
    writeFileSync(privateKeyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(publicKeyPath, pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
    const fingerprint = publicKeyFingerprint(readFileSync(publicKeyPath));
    for (const name of ['planning-upload', 'final-upload']) {
      const original = parseStrictJson(readFileSync(path.join(artifactDirectory, `${name}.json`)));
      const forged = { ...original, signerKeyId: fingerprint };
      writeSignedArtifact(forged, {
        outputPath: path.join(forgedDirectory, `${name}.json`),
        privateKeyPath, publicKeyPath, expectedFingerprint: fingerprint, checkoutRoot: CHECKOUT,
      });
    }
    writeFileSync(path.join(forgedDirectory, 'evidence-public.pem'), readFileSync(publicKeyPath), { mode: 0o600 });
    assert.throws(() => verifyCiCleanupUpload({
      artifactRoot: forgedDirectory, runtimeRoot: runnerTemp, checkoutRoot: CHECKOUT,
    }), /exactly one provider-bound coordinator state \(found 0\)/);
  });
});

test('actionable coordinator resumes through canonical recovery after mutation response loss',
  { timeout: 30_000 }, async (t) => {
    const keys = [
      'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'RUNNER_TEMP', 'PATH',
      'FORGEJO_ACTIONS', 'FORGEJO_SERVER_URL',
      'FAKE_DOCKER_RESOURCE', 'FAKE_DOCKER_ID', 'FAKE_DOCKER_PROJECT',
      'FAKE_DOCKER_DEPLOYMENT', 'FAKE_DOCKER_OWNER', 'FAKE_DOCKER_CREATED_AT',
      'FAKE_DOCKER_COMMIT', 'FAKE_DOCKER_RUN', 'FAKE_DOCKER_MODE', 'FAKE_DOCKER_MARKER',
      'FAKE_DOCKER_CLIENT_PID',
    ];
    const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'ci-cleanup-actionable-'));
    chmodSync(runnerTemp, 0o700);
    t.after(() => {
      for (const key of keys) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
      rmSync(runnerTemp, { recursive: true, force: true });
    });
    Object.assign(process.env, {
      GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '84003',
      GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: runnerTemp,
      FORGEJO_ACTIONS: 'false', FORGEJO_SERVER_URL: '',
    });
    const bin = path.join(runnerTemp, 'bin');
    const runtimeDirectory = path.join(runnerTemp, 'runtime');
    const artifactDirectory = path.join(runnerTemp, 'artifacts');
    mkdirSync(bin, { mode: 0o700 });
    mkdirSync(artifactDirectory, { mode: 0o700 });
    fakeDocker(bin);
    process.env.PATH = `${bin}:${before.PATH}`;
    const startedAt = new Date();
    const prepared = prepareCiCleanupLifecycle({
      checkoutRoot: CHECKOUT, runtimeDirectory, lane: 'actionable', now: startedAt,
    });
    finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: CHECKOUT, subjectExitStatus: 19,
      now: new Date(startedAt.getTime() + 1_000),
    });
    const authority = prepared.state.authority;
    const resourcePath = path.join(runnerTemp, 'network-present');
    const markerPath = path.join(runnerTemp, 'mutation-marker');
    const clientPidPath = path.join(runnerTemp, 'mutation-client.pid');
    writeFileSync(resourcePath, 'present\n', { mode: 0o600 });
    Object.assign(process.env, {
      FAKE_DOCKER_RESOURCE: resourcePath, FAKE_DOCKER_ID: 'a'.repeat(64),
      FAKE_DOCKER_PROJECT: authority.composeProjectName,
      FAKE_DOCKER_DEPLOYMENT: authority.deploymentId,
      FAKE_DOCKER_OWNER: authority.ownerId,
      FAKE_DOCKER_CREATED_AT: prepared.state.resourceCreatedAt,
      FAKE_DOCKER_COMMIT: authority.checkoutCommit,
      FAKE_DOCKER_RUN: authority.operationRunId,
      FAKE_DOCKER_MODE: 'crash_after_remove', FAKE_DOCKER_MARKER: markerPath,
      FAKE_DOCKER_CLIENT_PID: clientPidPath,
    });
    const planned = planCiCleanupEvidence({
      statePath: prepared.path, checkoutRoot: CHECKOUT, artifactDirectory,
    });
    assert.equal(planned.privateReceipt.state, 'dry_run');
    const privateDirectory = path.join(runtimeDirectory, 'coordinator', 'private-evidence');
    const expiredAttemptDirectory = path.join(
      privateDirectory, 'requests', 'execution-01',
    );
    mkdirSync(expiredAttemptDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(expiredAttemptDirectory, 'authorize.json'), canonicalJson({
      checkoutRoot: CHECKOUT,
      planPath: path.join(privateDirectory, 'plan.json'),
      dryRunReceiptPath: planned.state.planningReceiptPath,
      evidencePublicKeyPath: path.join(runtimeDirectory, 'coordinator', 'keys', 'evidence', 'public.pem'),
      expectedEvidenceFingerprint: planned.state.evidenceFingerprint,
      approvalOutputPath: path.join(expiredAttemptDirectory, 'approval.json'),
      authorizationPrivateKeyPath: path.join(runtimeDirectory, 'coordinator', 'keys', 'authorization', 'private.pem'),
      authorizationPublicKeyPath: path.join(runtimeDirectory, 'coordinator', 'keys', 'authorization', 'public.pem'),
      expectedAuthorizationFingerprint: planned.state.authorizationFingerprint,
      issuedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:15:00.000Z',
      nonce: 'expired-unreserved-attempt', decommission: true,
    }), { mode: 0o600 });
    const modulePath = path.join(CHECKOUT, 'scripts/ownership/ci-cleanup-evidence.mjs');
    const source = `import { resumeCiCleanupEvidence } from ${JSON.stringify(modulePath)}; resumeCiCleanupEvidence(${JSON.stringify({
      statePath: prepared.path, checkoutRoot: CHECKOUT, artifactDirectory,
    })});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      cwd: CHECKOUT, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderrText = '';
    child.stderr.on('data', (chunk) => { child.stderrText += chunk; });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
    });
    await waitForFile(markerPath, child);
    const mutationClientPid = Number(readFileSync(clientPidPath, 'utf8'));
    assert.equal(processCanRun(mutationClientPid), true);
    process.kill(-child.pid, 'SIGKILL');
    assert.deepEqual(await waitForExit(child), { code: null, signal: 'SIGKILL' });
    await waitFor(() => !processCanRun(mutationClientPid));
    assert.equal(existsSync(resourcePath), false);
    assert.equal(
      readCoordinatorState(prepared.path, { checkoutRoot: CHECKOUT }).state.phase,
      'executing',
    );
    assert.equal(
      readCoordinatorState(prepared.path, { checkoutRoot: CHECKOUT }).state.executionAttempt,
      2,
    );
    assert.equal(existsSync(path.join(
      privateDirectory, 'requests', 'execution-02', 'authorize.json',
    )), true);
    process.env.FAKE_DOCKER_MODE = 'normal';
    if (existsSync(markerPath)) unlinkSync(markerPath);
    const recovered = resumeCiCleanupEvidence({
      statePath: prepared.path, checkoutRoot: CHECKOUT, artifactDirectory,
    });
    assert.equal(recovered.state.phase, 'projected');
    assert.equal(recovered.privateReceipt.state, 'recovered');
    assert.equal(recovered.privateReceipt.subjectExitStatus, 19);
    assert.equal(existsSync(path.join(artifactDirectory, 'final-upload.json')), true);
    assert.doesNotMatch(
      readFileSync(path.join(artifactDirectory, 'final-upload.json'), 'utf8'),
      /BEGIN (?:RSA )?PRIVATE KEY/,
    );
  });
