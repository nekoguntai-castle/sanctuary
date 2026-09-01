import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson, canonicalSha256, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { publicKeyFingerprint, sha256 } from '../../scripts/ownership/crypto.mjs';
import { inspectDeploymentLock } from '../../scripts/ownership/deployment-lock.mjs';
import { DeploymentStore } from '../../scripts/ownership/deployment-store.mjs';
import { verifySignedArtifact } from '../../scripts/ownership/cleanup-evidence.mjs';
import { createCleanupJournal } from '../../scripts/ownership/cleanup-journal.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLI = path.join(ROOT, 'scripts/ownership/cleanup-cli.mjs');
const CONTRACT = path.join(ROOT, 'config/resource-ownership-contract.json');
const POLICY_DIGEST = sha256(readFileSync(CONTRACT));
const TARGET_ID = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);

function writeCanonical(file, value, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, canonicalJson(value), { mode });
}

function keyPair(directory, name) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = path.join(directory, `${name}-private.pem`);
  const publicKeyPath = path.join(directory, `${name}-public.pem`);
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(privateKeyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { mode: 0o600 });
  return { privateKeyPath, publicKeyPath, fingerprint: publicKeyFingerprint(publicKey) };
}

function fakeDocker(directory) {
  const executable = path.join(directory, 'docker');
  writeFileSync(executable, `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
if [ "\${1:-}" = "--host" ]; then shift 2; fi
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "\${1:-} \${2:-}" in
  "context show")
    if [ "$FAKE_DOCKER_MODE" = "hold_context" ]; then
      printf '%s\\n' "$$" > "$FAKE_DOCKER_PID"
      : > "$FAKE_DOCKER_MARKER"
      while [ -f "$FAKE_DOCKER_HOLD" ]; do sleep 0.05; done
    fi
    printf 'default\\n'
    ;;
  "context inspect") printf '%s\\n' '{"Name":"default","Endpoints":{"docker":{"Host":"unix:///run/cleanup-cli-fixture.sock","SkipTLSVerify":false}},"TLSMaterial":{}}' ;;
  "version --format"|"info --format") printf '%s\\n' '{"fixture":"stable"}' ;;
  "container ls"|"volume ls"|"image ls") printf '' ;;
  "network ls")
    if [ -f "$FAKE_DOCKER_STATE" ]; then
      printf '%s\\n' '${TARGET_ID}'
    fi
    ;;
  "network inspect")
    if [ ! -f "$FAKE_DOCKER_STATE" ]; then exit 1; fi
    printf '[{"Id":"${TARGET_ID}","Containers":{},"Labels":{"io.sanctuary.project":"cleanup-cli-fixture","io.sanctuary.deployment-id":"%s","io.sanctuary.owner-id":"owner-1","io.sanctuary.resource-class":"compose_network","io.sanctuary.lifecycle":"obsolete","io.sanctuary.cleanup-policy":"exact_delete","io.sanctuary.created-at":"2026-08-30T00:00:00.000Z","io.sanctuary.created-by-release":"unreleased","io.sanctuary.created-by-commit":"${COMMIT}","io.sanctuary.creation-run-id":"create-obsolete"}}]\\n' "$FAKE_DEPLOYMENT_ID"
    ;;
  "network rm")
    if [ "$FAKE_DOCKER_MODE" = "hold" ] || [ "$FAKE_DOCKER_MODE" = "hold_ignore_term" ]; then
      printf '%s\\n' "$$" > "$FAKE_DOCKER_PID"
      : > "$FAKE_DOCKER_MARKER"
      if [ "$FAKE_DOCKER_MODE" = "hold_ignore_term" ]; then trap '' TERM; fi
      while :; do sleep 1; done
    fi
    unlink_target="$FAKE_DOCKER_STATE"
    rm -f -- "$unlink_target"
    if [ "$FAKE_DOCKER_MODE" = "crash_after_remove" ]; then
      printf '%s\\n' "$$" > "$FAKE_DOCKER_PID"
      : > "$FAKE_DOCKER_MARKER"
      while :; do sleep 1; done
    fi
    printf '%s\\n' '${TARGET_ID}'
    ;;
  *) printf 'unexpected fake Docker command: %s\\n' "$*" >&2; exit 64 ;;
esac
`, { mode: 0o700 });
  return executable;
}

function invoke(command, requestPath, env) {
  return spawnSync(process.execPath, [CLI, command, requestPath], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 20_000,
  });
}

function waitForFile(file, child, timeoutMs = 10_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (existsSync(file)) { resolve(); return; }
      if (child.exitCode !== null || child.signalCode !== null) {
        reject(new Error(`cleanup CLI exited before ${path.basename(file)} appeared: ${child.stderrText}`));
        return;
      }
      if (Date.now() - started > timeoutMs) { reject(new Error(`timed out waiting for ${file}`)); return; }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function waitForExit(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => reject(new Error('cleanup CLI did not exit')), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function executionFixture(name, { expiresInMs = 60_000, subjectExitStatus = 17 } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), `cleanup-cli-execution-${name}-`));
  chmodSync(root, 0o700);
  const runtimeDirectory = path.join(root, 'runtime');
  const evidenceDirectory = path.join(root, 'evidence');
  const binDirectory = path.join(root, 'bin');
  const projectLockRoot = path.join(root, 'project-locks');
  for (const directory of [runtimeDirectory, evidenceDirectory, binDirectory, projectLockRoot]) {
    mkdirSync(directory, { mode: 0o700 });
  }
  fakeDocker(binDirectory);
  const statePath = path.join(root, 'network-present');
  const markerPath = path.join(root, 'docker-marker');
  const dockerPidPath = path.join(root, 'docker.pid');
  const dockerLogPath = path.join(root, 'docker.log');
  const holdPath = path.join(root, 'docker-hold');
  writeFileSync(statePath, 'present\n', { mode: 0o600 });
  writeFileSync(dockerLogPath, '', { mode: 0o600 });
  const evidence = keyPair(evidenceDirectory, 'evidence');
  const authorization = keyPair(evidenceDirectory, 'authorization');
  const deploymentId = `deploy-${name}`;
  const operationRunId = `cleanup-${name}`;
  const snapshot = Buffer.from('services: {}\n');
  const definition = {
    definitionVersion: 1, ownerId: 'owner-1', release: 'unreleased', commit: COMMIT,
    projectDirectory: '/private/project', projectDirectoryIdentity: 'device:inode',
    composeProjectName: 'cleanup-cli-fixture', envFile: '/private/sanctuary.env',
    envFileIdentity: 'env:inode', installMode: 'online', profiles: [],
    overlays: [{ sourcePath: '/private/compose.yml', sourceIdentity: 'overlay:inode',
      snapshotPath: 'compose/00-compose.yml', sha256: sha256(snapshot), kind: 'tracked' }],
    policyDigest: POLICY_DIGEST, contextFingerprint: 'c'.repeat(64),
  };
  const manifest = {
    schemaVersion: '1.0.0', artifactType: 'deployment_manifest', deploymentId,
    generation: 1, createdAt: '2026-08-30T00:00:00.000Z', priorActiveDigest: null,
    ...definition, definitionDigest: canonicalSha256(definition), legacyResources: [],
  };
  const runManifest = {
    schemaVersion: '1.0.0', artifactType: 'run_manifest', deploymentId,
    operationRunId, ownerId: manifest.ownerId, generation: manifest.generation,
    startedAt: '2026-08-30T00:00:01.000Z', heartbeatAt: '2026-08-30T00:00:02.000Z',
    terminalAt: '2026-08-30T00:00:03.000Z', controllerIdentity: 'controller-1',
    deploymentDigest: canonicalSha256(manifest),
  };
  const deploymentPath = path.join(evidenceDirectory, 'deployment.json');
  const runPath = path.join(evidenceDirectory, 'run.json');
  writeCanonical(deploymentPath, manifest);
  writeCanonical(runPath, runManifest);
  const revisionRoot = path.join(runtimeDirectory, 'ownership/deployments', deploymentId, 'revisions/1');
  writeCanonical(path.join(revisionRoot, 'deployment-manifest.json'), manifest);
  mkdirSync(path.join(revisionRoot, 'compose'), { mode: 0o700 });
  writeFileSync(path.join(revisionRoot, 'compose/00-compose.yml'), snapshot, { mode: 0o600 });
  writeCanonical(path.join(runtimeDirectory, 'ownership/deployments', deploymentId, 'active-revision.json'), {
    pointerVersion: 1, deploymentId, generation: 1, manifestDigest: canonicalSha256(manifest),
    activatedAt: new Date().toISOString(),
  });
  const keysRoot = path.join(runtimeDirectory, 'ownership/keys');
  mkdirSync(keysRoot, { recursive: true, mode: 0o700 });
  chmodSync(path.join(runtimeDirectory, 'ownership'), 0o700);
  writeFileSync(path.join(keysRoot, 'public.pem'), readFileSync(evidence.publicKeyPath), { mode: 0o600 });
  const trustPath = path.join(runtimeDirectory, 'ownership/deployments', deploymentId, 'cleanup-trust.json');
  chmodSync(path.dirname(trustPath), 0o700);
  writeCanonical(trustPath, {
    trustVersion: 1, deploymentId,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    authorizationFingerprints: [authorization.fingerprint],
    evidenceFingerprints: [evidence.fingerprint],
  });
  const env = {
    ...process.env, PATH: `${binDirectory}:${process.env.PATH}`,
    SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT: 'true',
    SANCTUARY_TEST_PROJECT_LOCK_ROOT: projectLockRoot,
    FAKE_DOCKER_STATE: statePath, FAKE_DOCKER_MARKER: markerPath,
    FAKE_DOCKER_PID: dockerPidPath, FAKE_DOCKER_LOG: dockerLogPath,
    FAKE_DOCKER_HOLD: holdPath, FAKE_DOCKER_MODE: 'normal',
    FAKE_DEPLOYMENT_ID: deploymentId,
  };
  const inventoryPath = path.join(evidenceDirectory, 'inventory.json');
  const inventoryRequest = path.join(evidenceDirectory, 'inventory-request.json');
  writeCanonical(inventoryRequest, {
    checkoutRoot: ROOT, ownershipContractPath: CONTRACT, deploymentManifestPath: deploymentPath,
    runManifestPath: runPath, outputPath: inventoryPath, deploymentId, runtimeDirectory,
    engine: 'docker', timeoutMs: 2_000, maxOutputBytes: 64 * 1024,
  });
  const inventoried = invoke('inventory', inventoryRequest, env);
  assert.equal(inventoried.status, 0, inventoried.stderr);
  const inventory = parseStrictJson(readFileSync(inventoryPath));
  assert.equal(inventory.complete, true);
  assert.equal(inventory.resources.length, 1);
  assert.equal(inventory.resources[0].disposition, 'eligible');
  const planPath = path.join(evidenceDirectory, 'plan.json');
  const dryRunReceiptPath = path.join(evidenceDirectory, 'dry-run.json');
  const planRequest = path.join(evidenceDirectory, 'plan-request.json');
  writeCanonical(planRequest, {
    checkoutRoot: ROOT, ownershipContractPath: CONTRACT, inventoryPath, planOutputPath: planPath,
    receiptOutputPath: dryRunReceiptPath, evidencePrivateKeyPath: evidence.privateKeyPath,
    evidencePublicKeyPath: evidence.publicKeyPath, expectedEvidenceFingerprint: evidence.fingerprint,
  });
  const planned = invoke('plan', planRequest, env);
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(parseStrictJson(Buffer.from(planned.stdout)).state, 'dry_run');
  const approvalPath = path.join(evidenceDirectory, 'approval.json');
  const authorizeRequest = path.join(evidenceDirectory, 'authorize-request.json');
  writeCanonical(authorizeRequest, {
    checkoutRoot: ROOT, planPath, dryRunReceiptPath, evidencePublicKeyPath: evidence.publicKeyPath,
    expectedEvidenceFingerprint: evidence.fingerprint, approvalOutputPath: approvalPath,
    authorizationPrivateKeyPath: authorization.privateKeyPath,
    authorizationPublicKeyPath: authorization.publicKeyPath,
    expectedAuthorizationFingerprint: authorization.fingerprint,
    nonce: `nonce-${name}`, expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    decommission: false,
  });
  const authorized = invoke('authorize', authorizeRequest, env);
  assert.equal(authorized.status, 0, authorized.stderr);
  const approvalDigest = canonicalSha256(parseStrictJson(readFileSync(approvalPath)));
  const receiptOutputPath = path.join(
    runtimeDirectory, 'ownership/cleanup-executions', approvalDigest, 'cleanup-receipt.json',
  );
  const applyRequest = path.join(evidenceDirectory, 'apply-request.json');
  const request = {
    checkoutRoot: ROOT, runtimeDirectory, deploymentId, ownershipContractPath: CONTRACT,
    deploymentManifestPath: deploymentPath, runManifestPath: runPath, inventoryPath, planPath,
    dryRunReceiptPath, approvalPath, evidencePrivateKeyPath: evidence.privateKeyPath,
    evidencePublicKeyPath: evidence.publicKeyPath, expectedEvidenceFingerprint: evidence.fingerprint,
    authorizationPublicKeyPath: authorization.publicKeyPath,
    expectedAuthorizationFingerprint: authorization.fingerprint,
    engine: 'docker',
    timeoutMs: 2_000, maxOutputBytes: 64 * 1024,
    supervisorTimeoutMs: 10_000, supervisorGraceMs: 50, supervisorKillWaitMs: 500,
    subjectExitStatus,
  };
  writeCanonical(applyRequest, request);
  return {
    root, env, request, applyRequest, runtimeDirectory, deploymentId, evidence,
    approvalDigest, receiptOutputPath,
    statePath, markerPath, dockerPidPath, dockerLogPath, holdPath, projectLockRoot,
  };
}

function spawnCli(command, requestPath, env) {
  const child = spawn(process.execPath, [CLI, command, requestPath], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdoutText = '';
  child.stderrText = '';
  child.stdout.on('data', (chunk) => { child.stdoutText += chunk; });
  child.stderr.on('data', (chunk) => { child.stderrText += chunk; });
  return child;
}

function exactKillFrom(file) {
  if (!existsSync(file)) return;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (Number.isSafeInteger(pid) && pid > 1) {
    try { process.kill(-pid, 'SIGKILL'); } catch (groupError) {
      if (groupError.code !== 'ESRCH') throw groupError;
      try { process.kill(pid, 'SIGKILL'); } catch (processError) {
        if (processError.code !== 'ESRCH') throw processError;
      }
    }
  }
  try { unlinkSync(file); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function inspectFixtureProjectLock(fixture) {
  const identity = canonicalSha256({ composeProjectName: 'cleanup-cli-fixture' });
  return inspectDeploymentLock(path.join(fixture.projectLockRoot, identity, 'mutation-lock'));
}

test('CLI SIGKILL recovery preserves subject status, rejects a concurrent apply, and resumes after expiry',
  { timeout: 30_000 }, async (t) => {
    const fixture = executionFixture('kill-recover', { expiresInMs: 1_000, subjectExitStatus: 23 });
    let apply;
    let recover;
    t.after(() => {
      exactKillFrom(fixture.dockerPidPath);
      for (const child of [apply, recover]) {
        if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      rmSync(fixture.root, { recursive: true, force: true });
    });
    apply = spawnCli('apply', fixture.applyRequest, {
      ...fixture.env, FAKE_DOCKER_MODE: 'crash_after_remove',
    });
    await waitForFile(fixture.markerPath, apply);
    apply.kill('SIGKILL');
    assert.deepEqual(await waitForExit(apply), { code: null, signal: 'SIGKILL' });
    exactKillFrom(fixture.dockerPidPath);
    assert.equal(existsSync(fixture.statePath), false);
    await new Promise((resolve) => setTimeout(resolve, 1_050));

    const recoveryRequestPath = path.join(fixture.root, 'evidence/recover-request.json');
    const { subjectExitStatus: _omitted, ...recoveryRequest } = fixture.request;
    writeCanonical(recoveryRequestPath, { ...recoveryRequest, controllerRunId: 'recover-kill-1' });
    const journalPath = path.join(
      fixture.runtimeDirectory, 'ownership/cleanup-executions', fixture.approvalDigest,
      'action-journal.jsonl',
    );
    const correctJournal = readFileSync(journalPath);
    const genesis = parseStrictJson(Buffer.from(correctJournal.toString('utf8').split('\n')[0]));
    const wrongRuntime = mkdtempSync(path.join(os.tmpdir(), 'cleanup-cli-wrong-journal-'));
    chmodSync(wrongRuntime, 0o700);
    t.after(() => rmSync(wrongRuntime, { recursive: true, force: true }));
    const wrong = createCleanupJournal({
      runtimeDirectory: wrongRuntime, approvalDigest: fixture.approvalDigest,
      deploymentId: fixture.deploymentId, operationRunId: 'wrong-operation',
      signerKeyId: fixture.evidence.fingerprint,
      privateKey: readFileSync(fixture.evidence.privateKeyPath),
      payload: genesis.checkpoint.payload,
    });
    writeFileSync(journalPath, readFileSync(wrong.journalPath), { mode: 0o600 });
    const wrongRecovery = invoke('recover', recoveryRequestPath, fixture.env);
    assert.equal(wrongRecovery.status, 2, wrongRecovery.stderr);
    assert.match(wrongRecovery.stderr, /genesis|journal|identity|operation/);
    writeFileSync(journalPath, correctJournal, { mode: 0o600 });
    unlinkSync(fixture.markerPath);
    if (existsSync(fixture.dockerPidPath)) unlinkSync(fixture.dockerPidPath);
    writeFileSync(fixture.holdPath, 'hold\n', { mode: 0o600 });
    recover = spawnCli('recover', recoveryRequestPath, {
      ...fixture.env, FAKE_DOCKER_MODE: 'hold_context',
    });
    await waitForFile(fixture.markerPath, recover);
    const competing = invoke('apply', fixture.applyRequest, fixture.env);
    assert.equal(competing.status, 3, competing.stderr);
    unlinkSync(fixture.holdPath);
    const recoveredStatus = await waitForExit(recover);
    assert.equal(recoveredStatus.code, 0);
    const receipt = verifySignedArtifact({
      inputPath: fixture.receiptOutputPath,
      publicKeyPath: fixture.evidence.publicKeyPath,
      expectedFingerprint: fixture.evidence.fingerprint, checkoutRoot: ROOT,
    }).artifact;
    assert.equal(receipt.state, 'recovered');
    assert.equal(receipt.subjectExitStatus, 23);
    const store = new DeploymentStore({
      runtimeDirectory: fixture.runtimeDirectory, deploymentId: fixture.deploymentId,
    });
    assert.equal(inspectDeploymentLock(store.lockPath).state, 'unlocked');
    assert.equal(inspectFixtureProjectLock(fixture).state, 'unlocked');
    assert.equal((readFileSync(fixture.dockerLogPath, 'utf8').match(/network rm/g) ?? []).length, 1);
  });

test('CLI SIGKILL before mutation response finalizes ambiguous without replaying the open intent',
  { timeout: 30_000 }, async (t) => {
    const fixture = executionFixture('kill-before-remove');
    let apply;
    t.after(() => {
      exactKillFrom(fixture.dockerPidPath);
      if (apply && apply.exitCode === null && apply.signalCode === null) apply.kill('SIGKILL');
      rmSync(fixture.root, { recursive: true, force: true });
    });
    apply = spawnCli('apply', fixture.applyRequest, {
      ...fixture.env, FAKE_DOCKER_MODE: 'hold',
    });
    await waitForFile(fixture.markerPath, apply);
    apply.kill('SIGKILL');
    assert.deepEqual(await waitForExit(apply), { code: null, signal: 'SIGKILL' });
    exactKillFrom(fixture.dockerPidPath);
    assert.equal(existsSync(fixture.statePath), true);

    const recoveryRequestPath = path.join(fixture.root, 'evidence/recover-request.json');
    const { subjectExitStatus: _omitted, ...recoveryRequest } = fixture.request;
    writeCanonical(recoveryRequestPath, {
      ...recoveryRequest, controllerRunId: 'recover-before-remove-1',
    });
    const recovered = invoke('recover', recoveryRequestPath, fixture.env);
    assert.equal(recovered.status, 4, recovered.stderr);
    const receipt = verifySignedArtifact({
      inputPath: fixture.receiptOutputPath,
      publicKeyPath: fixture.evidence.publicKeyPath,
      expectedFingerprint: fixture.evidence.fingerprint, checkoutRoot: ROOT,
    }).artifact;
    assert.equal(receipt.state, 'ambiguous');
    assert.equal(receipt.subjectExitStatus, 17);
    assert.equal(existsSync(fixture.statePath), true);
    assert.equal((readFileSync(fixture.dockerLogPath, 'utf8').match(/network rm/g) ?? []).length, 1);
  });

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  test(`CLI repeated ${signal} during mutation emits a signed cancelled receipt and releases both locks`,
    { timeout: 30_000 }, async (t) => {
      const fixture = executionFixture(`signal-${signal.toLowerCase()}`);
      let apply;
      t.after(() => {
        exactKillFrom(fixture.dockerPidPath);
        if (apply && apply.exitCode === null && apply.signalCode === null) apply.kill('SIGKILL');
        rmSync(fixture.root, { recursive: true, force: true });
      });
      apply = spawnCli('apply', fixture.applyRequest, {
        ...fixture.env, FAKE_DOCKER_MODE: 'hold_ignore_term',
      });
      await waitForFile(fixture.markerPath, apply);
      apply.kill(signal);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(apply.exitCode, null);
      apply.kill(signal);
      const status = await waitForExit(apply);
      assert.equal(status.code, 4);
      assert.equal(existsSync(fixture.statePath), true);
      const receipt = verifySignedArtifact({
        inputPath: fixture.receiptOutputPath,
        publicKeyPath: fixture.evidence.publicKeyPath,
        expectedFingerprint: fixture.evidence.fingerprint, checkoutRoot: ROOT,
      }).artifact;
      assert.equal(receipt.state, 'cancelled');
      assert.equal(receipt.subjectExitStatus, 17);
      const store = new DeploymentStore({
        runtimeDirectory: fixture.runtimeDirectory, deploymentId: fixture.deploymentId,
      });
      assert.equal(inspectDeploymentLock(store.lockPath).state, 'unlocked');
      assert.equal(inspectFixtureProjectLock(fixture).state, 'unlocked');
    });
}
