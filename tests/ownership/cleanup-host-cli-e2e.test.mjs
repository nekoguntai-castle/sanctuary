import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalJson, canonicalSha256, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { verifySignedArtifact } from '../../scripts/ownership/cleanup-evidence.mjs';
import { verifyCleanupJournal } from '../../scripts/ownership/cleanup-journal.mjs';
import { publicKeyFingerprint, sha256 } from '../../scripts/ownership/crypto.mjs';
import { describeHostAuthority } from '../../scripts/ownership/describe-host-authority.mjs';
import { registerResource } from '../../scripts/ownership/registration.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLI = path.join(ROOT, 'scripts/ownership/cleanup-cli.mjs');
const CONTRACT = path.join(ROOT, 'config/resource-ownership-contract.json');
const POLICY_DIGEST = sha256(readFileSync(CONTRACT));
const COMMIT = 'b'.repeat(40);

function writeCanonical(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, canonicalJson(value), { mode: 0o600 });
}

function keyPair(directory, name) {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = path.join(directory, `${name}-private.pem`);
  const publicKeyPath = path.join(directory, `${name}-public.pem`);
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(privateKeyPath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { mode: 0o600 });
  return { privateKeyPath, publicKeyPath, publicKey, fingerprint: publicKeyFingerprint(publicKey) };
}

function refusingContainerEngines(directory) {
  const source = `#!/usr/bin/env bash
printf '%s\\n' "$0 $*" >>"\${SANCTUARY_CONTAINER_ENGINE_POISON_MARKER:?}"
exit 97
`;
  for (const name of ['docker', 'podman']) {
    writeFileSync(path.join(directory, name), source, { mode: 0o700 });
  }
}

function invoke(command, requestPath, env) {
  return spawnSync(process.execPath, [CLI, command, requestPath], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 30_000,
  });
}

function git(repository, args) {
  return execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function registerHost(root, manifest, runManifest, authority) {
  return registerResource({
    deploymentId: manifest.deploymentId, operationRunId: runManifest.operationRunId,
    ownerId: manifest.ownerId, lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: manifest.createdAt, createdByRelease: manifest.release,
    createdByCommit: manifest.commit, referenceIds: [runManifest.operationRunId],
    ...authority,
  }, { root: path.join(root, 'ownership'), checkoutRoot: ROOT });
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cleanup-host-cli-e2e-'));
  chmodSync(root, 0o700);
  const runtimeDirectory = path.join(root, 'runtime');
  const evidenceDirectory = path.join(root, 'evidence');
  const binDirectory = path.join(root, 'bin');
  const projectLockRoot = path.join(root, 'project-locks');
  const artifactParent = path.join(root, 'artifacts');
  const worktreeParent = path.join(root, 'worktrees');
  const repository = path.join(root, 'repository');
  for (const directory of [runtimeDirectory, evidenceDirectory, binDirectory, projectLockRoot,
    artifactParent, worktreeParent, repository]) mkdirSync(directory, { mode: 0o700 });
  const poisonMarker = path.join(root, 'container-engine-invoked');
  refusingContainerEngines(binDirectory);

  const artifact = path.join(artifactParent, 'owned-temp');
  const artifactPeer = path.join(artifactParent, 'peer-temp');
  mkdirSync(artifact, { mode: 0o700 });
  mkdirSync(artifactPeer, { mode: 0o700 });
  writeFileSync(path.join(artifact, 'payload'), 'owned\n');
  writeFileSync(path.join(artifactPeer, 'sentinel'), 'peer\n');

  git(repository, ['init']);
  git(repository, ['config', 'user.email', 'cleanup-fixture@example.invalid']);
  git(repository, ['config', 'user.name', 'Cleanup Fixture']);
  writeFileSync(path.join(repository, 'tracked.txt'), 'owned\n');
  git(repository, ['add', 'tracked.txt']);
  git(repository, ['commit', '-m', 'fixture']);
  const baseOid = git(repository, ['rev-parse', 'HEAD']);
  const worktree = path.join(worktreeParent, 'owned-worktree');
  const worktreePeer = path.join(worktreeParent, 'peer-worktree');
  git(repository, ['worktree', 'add', '-b', 'cleanup-owned', worktree, baseOid]);
  git(repository, ['worktree', 'add', '-b', 'cleanup-peer', worktreePeer, baseOid]);
  chmodSync(path.join(repository, '.git'), 0o755);
  chmodSync(path.join(repository, '.git', 'worktrees'), 0o755);
  chmodSync(git(worktree, ['rev-parse', '--path-format=absolute', '--git-dir']), 0o755);
  chmodSync(git(worktreePeer, ['rev-parse', '--path-format=absolute', '--git-dir']), 0o755);
  const worktreeAdmin = path.basename(git(worktree, ['rev-parse', '--path-format=absolute', '--git-dir']));
  const peerAdmin = path.basename(git(worktreePeer, ['rev-parse', '--path-format=absolute', '--git-dir']));
  const commonDir = git(repository, ['rev-parse', '--path-format=absolute', '--git-common-dir']);

  const deploymentId = 'deploy-host-cli-e2e';
  const operationRunId = 'cleanup-host-cli-e2e';
  const snapshot = Buffer.from('services: {}\n');
  const definition = {
    definitionVersion: 1, ownerId: 'owner-1', release: 'unreleased', commit: COMMIT,
    projectDirectory: '/private/project', projectDirectoryIdentity: 'device:inode',
    composeProjectName: 'cleanup-host-cli-e2e', envFile: '/private/sanctuary.env',
    envFileIdentity: 'env:inode', installMode: 'online', profiles: [],
    overlays: [{ sourcePath: '/private/compose.yml', sourceIdentity: 'overlay:inode',
      snapshotPath: 'compose/00-compose.yml', sha256: sha256(snapshot), kind: 'tracked' }],
    policyDigest: POLICY_DIGEST, contextFingerprint: 'c'.repeat(64),
  };
  const manifest = {
    schemaVersion: '1.0.0', artifactType: 'deployment_manifest', deploymentId,
    generation: 1, createdAt: '2026-09-01T00:00:00.000Z', priorActiveDigest: null,
    ...definition, definitionDigest: canonicalSha256(definition), legacyResources: [],
  };
  const runManifest = {
    schemaVersion: '1.0.0', artifactType: 'run_manifest', deploymentId, operationRunId,
    ownerId: manifest.ownerId, generation: 1, startedAt: '2026-09-01T00:00:01.000Z',
    heartbeatAt: '2026-09-01T00:00:02.000Z', terminalAt: '2026-09-01T00:00:03.000Z',
    controllerIdentity: 'controller-1', deploymentDigest: canonicalSha256(manifest),
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

  const temporary = describeHostAuthority(['temporary', artifact, operationRunId]);
  const linkedWorktree = describeHostAuthority([
    'worktree', worktree, baseOid, deploymentId, operationRunId,
  ]);
  registerHost(runtimeDirectory, manifest, runManifest, temporary);
  registerHost(runtimeDirectory, manifest, runManifest, linkedWorktree);

  const evidence = keyPair(evidenceDirectory, 'evidence');
  const authorization = keyPair(evidenceDirectory, 'authorization');
  assert.notEqual(evidence.fingerprint, authorization.fingerprint);
  writeCanonical(path.join(runtimeDirectory, 'ownership/deployments', deploymentId, 'cleanup-trust.json'), {
    trustVersion: 1, deploymentId, validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    authorizationFingerprints: [authorization.fingerprint], evidenceFingerprints: [evidence.fingerprint],
  });
  const env = {
    ...process.env, PATH: `${binDirectory}:${process.env.PATH}`,
    SANCTUARY_CONTAINER_ENGINE_POISON_MARKER: poisonMarker,
    SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT: 'true', SANCTUARY_TEST_PROJECT_LOCK_ROOT: projectLockRoot,
  };
  return {
    root, env, runtimeDirectory, evidenceDirectory, deploymentId, operationRunId,
    deploymentPath, runPath, evidence, authorization, artifact, artifactPeer,
    repository, baseOid, worktree, worktreePeer, commonDir, worktreeAdmin, peerAdmin, poisonMarker,
    identities: [temporary.immutableIdentity, linkedWorktree.immutableIdentity].sort(),
  };
}

test('real v1.1 temp and linked worktree complete one signed canonical CLI transaction',
  { skip: process.platform !== 'linux', timeout: 60_000 }, () => {
    const f = fixture();
    try {
      const inventoryPath = path.join(f.evidenceDirectory, 'inventory.json');
      const inventoryRequest = path.join(f.evidenceDirectory, 'inventory-request.json');
      const inventoryRequestCore = {
        checkoutRoot: ROOT, ownershipContractPath: CONTRACT,
        deploymentManifestPath: f.deploymentPath, runManifestPath: f.runPath,
        outputPath: inventoryPath, deploymentId: f.deploymentId,
        runtimeDirectory: f.runtimeDirectory, engine: 'host', timeoutMs: 2_000,
        maxOutputBytes: 64 * 1024,
      };
      const rejectedRequest = path.join(f.evidenceDirectory, 'rejected-inventory-request.json');
      writeCanonical(rejectedRequest, {
        ...inventoryRequestCore,
        outputPath: path.join(f.evidenceDirectory, 'rejected-inventory.json'),
        protectedProjects: ['must-not-be-ignored'],
      });
      const rejected = invoke('inventory', rejectedRequest, f.env);
      assert.equal(rejected.status, 2);
      assert.match(rejected.stderr, /host-only cleanup rejects Docker option protectedProjects/);
      assert.equal(existsSync(f.poisonMarker), false);

      const unknownRequest = path.join(f.evidenceDirectory, 'unknown-engine-request.json');
      writeCanonical(unknownRequest, {
        ...inventoryRequestCore,
        outputPath: path.join(f.evidenceDirectory, 'unknown-engine-inventory.json'),
        engine: 'HOST',
      });
      const unknown = invoke('inventory', unknownRequest, f.env);
      assert.equal(unknown.status, 2);
      assert.match(unknown.stderr, /cleanup engine must be docker, podman, or host/);
      assert.equal(existsSync(f.poisonMarker), false);

      writeCanonical(inventoryRequest, inventoryRequestCore);
      const inventoried = invoke('inventory', inventoryRequest, f.env);
      assert.equal(inventoried.status, 0, inventoried.stderr);
      const inventory = parseStrictJson(readFileSync(inventoryPath));
      assert.equal(inventory.complete, true);
      assert.deepEqual(inventory.resources.map((row) => row.immutableIdentity).sort(), f.identities);
      assert.ok(inventory.resources.every((row) => row.disposition === 'eligible'));

      const planPath = path.join(f.evidenceDirectory, 'plan.json');
      const dryRunReceiptPath = path.join(f.evidenceDirectory, 'dry-run.json');
      const planRequest = path.join(f.evidenceDirectory, 'plan-request.json');
      writeCanonical(planRequest, {
        checkoutRoot: ROOT, ownershipContractPath: CONTRACT, inventoryPath,
        planOutputPath: planPath, receiptOutputPath: dryRunReceiptPath,
        evidencePrivateKeyPath: f.evidence.privateKeyPath,
        evidencePublicKeyPath: f.evidence.publicKeyPath,
        expectedEvidenceFingerprint: f.evidence.fingerprint,
      });
      const planned = invoke('plan', planRequest, f.env);
      assert.equal(planned.status, 0, planned.stderr);
      const plan = parseStrictJson(readFileSync(planPath));
      assert.deepEqual(plan.actions.map((action) => action.immutableIdentity).sort(), f.identities);
      const dryRun = verifySignedArtifact({
        inputPath: dryRunReceiptPath, publicKeyPath: f.evidence.publicKeyPath,
        expectedFingerprint: f.evidence.fingerprint, checkoutRoot: ROOT,
      }).artifact;
      assert.equal(dryRun.state, 'dry_run');
      assert.equal(dryRun.signerKeyId, f.evidence.fingerprint);

      const approvalPath = path.join(f.evidenceDirectory, 'approval.json');
      const authorizeRequest = path.join(f.evidenceDirectory, 'authorize-request.json');
      writeCanonical(authorizeRequest, {
        checkoutRoot: ROOT, planPath, dryRunReceiptPath,
        evidencePublicKeyPath: f.evidence.publicKeyPath,
        expectedEvidenceFingerprint: f.evidence.fingerprint, approvalOutputPath: approvalPath,
        authorizationPrivateKeyPath: f.authorization.privateKeyPath,
        authorizationPublicKeyPath: f.authorization.publicKeyPath,
        expectedAuthorizationFingerprint: f.authorization.fingerprint,
        nonce: 'host-cli-e2e-approval', expiresAt: new Date(Date.now() + 60_000).toISOString(),
        decommission: false,
      });
      const authorized = invoke('authorize', authorizeRequest, f.env);
      assert.equal(authorized.status, 0, authorized.stderr);
      const approval = verifySignedArtifact({
        inputPath: approvalPath, publicKeyPath: f.authorization.publicKeyPath,
        expectedFingerprint: f.authorization.fingerprint, checkoutRoot: ROOT,
      }).artifact;
      assert.equal(approval.signerKeyId, f.authorization.fingerprint);
      assert.notEqual(approval.signerKeyId, dryRun.signerKeyId);

      const approvalDigest = canonicalSha256(approval);
      const applyRequest = path.join(f.evidenceDirectory, 'apply-request.json');
      writeCanonical(applyRequest, {
        checkoutRoot: ROOT, runtimeDirectory: f.runtimeDirectory, deploymentId: f.deploymentId,
        ownershipContractPath: CONTRACT, deploymentManifestPath: f.deploymentPath,
        runManifestPath: f.runPath, inventoryPath, planPath, dryRunReceiptPath, approvalPath,
        evidencePrivateKeyPath: f.evidence.privateKeyPath,
        evidencePublicKeyPath: f.evidence.publicKeyPath,
        expectedEvidenceFingerprint: f.evidence.fingerprint,
        authorizationPublicKeyPath: f.authorization.publicKeyPath,
        expectedAuthorizationFingerprint: f.authorization.fingerprint,
        engine: 'host', timeoutMs: 2_000, maxOutputBytes: 64 * 1024,
        supervisorTimeoutMs: 10_000, supervisorGraceMs: 50, supervisorKillWaitMs: 500,
        subjectExitStatus: 0,
      });
      const applied = invoke('apply', applyRequest, f.env);
      assert.equal(applied.status, 0, applied.stderr);
      const recoverRequest = path.join(f.evidenceDirectory, 'recover-request.json');
      writeCanonical(recoverRequest, {
        ...parseStrictJson(readFileSync(applyRequest)),
        controllerRunId: 'recover-host-cli-e2e',
      });
      const recovered = invoke('recover', recoverRequest, f.env);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(existsSync(f.poisonMarker), false, 'host recovery invoked a container engine');
      const receiptPath = path.join(
        f.runtimeDirectory, 'ownership/cleanup-executions', approvalDigest, 'cleanup-receipt.json',
      );
      const receipt = verifySignedArtifact({
        inputPath: receiptPath, publicKeyPath: f.evidence.publicKeyPath,
        expectedFingerprint: f.evidence.fingerprint, checkoutRoot: ROOT,
      }).artifact;
      assert.equal(receipt.state, 'cleaned');
      assert.deepEqual(receipt.actions.map((action) => action.immutableIdentity).sort(), f.identities);
      assert.ok(receipt.results.every((result) => result.result === 'absent'));
      const journal = verifyCleanupJournal({
        runtimeDirectory: f.runtimeDirectory, approvalDigest, publicKey: f.evidence.publicKey,
        expectedSignerKeyId: f.evidence.fingerprint,
      });
      assert.equal(journal.headDigest, receipt.journalDigest);
      assert.equal(journal.protocol.terminal, true);
      assert.equal(journal.records.filter(({ checkpoint }) => checkpoint.checkpointType === 'intent').length, 2);
      assert.equal(journal.records.filter(({ checkpoint }) => checkpoint.checkpointType === 'result').length, 2);

      assert.equal(existsSync(f.artifact), false);
      assert.equal(readFileSync(path.join(f.artifactPeer, 'sentinel'), 'utf8'), 'peer\n');
      assert.equal(existsSync(f.worktree), false);
      assert.equal(existsSync(path.join(f.commonDir, 'worktrees', f.worktreeAdmin)), false);
      assert.equal(existsSync(f.worktreePeer), true);
      assert.equal(existsSync(path.join(f.commonDir, 'worktrees', f.peerAdmin)), true);
      assert.equal(git(f.worktreePeer, ['rev-parse', 'HEAD']), f.baseOid);
      assert.equal(git(f.repository, ['rev-parse', 'HEAD']), f.baseOid);
      assert.equal(existsSync(f.poisonMarker), false, 'host-only CLI invoked a container engine');
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
