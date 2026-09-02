import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalSha256, parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { buildCleanupApproval } from '../../scripts/ownership/cleanup-approval.mjs';
import { createCleanupDockerRuntime } from '../../scripts/ownership/cleanup-docker-runtime.mjs';
import { buildCleanupInventoryExecutionContext } from '../../scripts/ownership/cleanup-inventory.mjs';
import { verifySignedArtifact, writeSignedArtifact } from '../../scripts/ownership/cleanup-evidence.mjs';
import { applyCleanupExecution } from '../../scripts/ownership/cleanup-execution.mjs';
import { buildCleanupPlan, buildPlanningReceipt } from '../../scripts/ownership/cleanup-planner.mjs';
import { buildCleanupUploadReceipt } from '../../scripts/ownership/cleanup-upload-receipt.mjs';
import { recoverCleanupExecution } from '../../scripts/ownership/cleanup-recovery.mjs';
import { publicKeyFingerprint } from '../../scripts/ownership/crypto.mjs';
import { observeDockerResources } from '../../scripts/ownership/docker-observation.mjs';
import {
  cleanupProcessGroupHasRunnableMember, runSupervisedCleanupCommand,
} from '../../scripts/ownership/cleanup-supervisor.mjs';
import {
  ensureRegistrationKeys, readRegistrations, registerResource,
} from '../../scripts/ownership/registration.mjs';

const enabled = process.env.SANCTUARY_RUN_DOCKER_ACCEPTANCE === 'true';
const checkoutRoot = path.resolve(import.meta.dirname, '../..');
const HASH = 'a'.repeat(64);
const contract = { resourceClasses: [
  { classId: 'compose_container', dependsOn: [], cleanupPolicies: ['exact_delete'] },
  { classId: 'compose_network', dependsOn: ['compose_container'], cleanupPolicies: ['exact_delete'] },
  { classId: 'compose_volume', dependsOn: ['compose_container'], cleanupPolicies: ['exact_delete'] },
  { classId: 'oci_image', dependsOn: ['compose_container'], cleanupPolicies: ['exact_delete'] },
] };

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, ...options,
  }).trim();
}

function dockerExists(inContext, noun, identity) {
  return spawnSync('docker', inContext([noun, 'inspect', identity]), { stdio: 'ignore' }).status === 0;
}

function signer(directory, name = 'receipt') {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPath = path.join(directory, `${name}-private.pem`);
  const publicKeyPath = path.join(directory, `${name}-public.pem`);
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  writeFileSync(publicKeyPath, publicKey, { mode: 0o600 });
  return { privateKey, publicKey, privateKeyPath, publicKeyPath,
    signerKeyId: publicKeyFingerprint(publicKey) };
}

function signAndVerifyArtifact(artifact, signerValue, outputPath) {
  const written = writeSignedArtifact(artifact, {
    outputPath, privateKeyPath: signerValue.privateKeyPath,
    publicKeyPath: signerValue.publicKeyPath,
    expectedFingerprint: signerValue.signerKeyId, checkoutRoot,
  });
  const verified = verifySignedArtifact({
    inputPath: written.outputPath, signaturePath: written.signaturePath,
    checksumPath: written.checksumPath, publicKeyPath: signerValue.publicKeyPath,
    expectedFingerprint: signerValue.signerKeyId, checkoutRoot,
  });
  assert.equal(verified.digest, written.digest);
  return verified.artifact;
}

function publishAcceptanceEvidence(receipt, signerValue, name) {
  const root = process.env.SANCTUARY_CLEANUP_ACCEPTANCE_ARTIFACT_DIR;
  if (!root) return;
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const projection = buildCleanupUploadReceipt(receipt);
  signAndVerifyArtifact(projection, signerValue, path.join(root, `${name}.json`));
  const publicPath = path.join(root, 'evidence-public.pem');
  const publicBytes = readFileSync(signerValue.publicKeyPath);
  if (existsSync(publicPath)) {
    assert.deepEqual(readFileSync(publicPath), publicBytes);
  } else writeFileSync(publicPath, publicBytes, { mode: 0o600 });
}

function ownershipLabels({ project, deploymentId, ownerId, resourceClass, lifecycle, createdAt,
  creationRunId, cleanupPolicy = 'exact_delete' }) {
  return {
    'io.sanctuary.project': project,
    'io.sanctuary.deployment-id': deploymentId,
    'io.sanctuary.owner-id': ownerId,
    'io.sanctuary.resource-class': resourceClass,
    'io.sanctuary.lifecycle': lifecycle,
    'io.sanctuary.cleanup-policy': cleanupPolicy,
    'io.sanctuary.created-at': createdAt,
    'io.sanctuary.created-by-release': 'unreleased',
    'io.sanctuary.created-by-commit': 'c'.repeat(40),
    'io.sanctuary.creation-run-id': creationRunId,
  };
}

function labelArgs(labels) {
  return Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
}

function ownershipFromObservation(resource) {
  const labels = resource.labels;
  return {
    project: labels['io.sanctuary.project'],
    deploymentId: labels['io.sanctuary.deployment-id'],
    ownerId: labels['io.sanctuary.owner-id'],
    resourceClass: resource.resourceClass,
    lifecycle: labels['io.sanctuary.lifecycle'],
    cleanupPolicy: labels['io.sanctuary.cleanup-policy'],
    createdAt: labels['io.sanctuary.created-at'],
    createdByRelease: labels['io.sanctuary.created-by-release'],
    createdByCommit: labels['io.sanctuary.created-by-commit'],
    creationRunId: labels['io.sanctuary.creation-run-id'],
    immutableIdentity: resource.immutableIdentity,
  };
}

function eligibleRow(resource, project) {
  const ownership = resource.classifications.includes('externally_registered') ? {
    project,
    deploymentId: resource.registration.deploymentId,
    ownerId: resource.registration.ownerId,
    resourceClass: resource.registration.resourceClass,
    lifecycle: resource.registration.lifecycle,
    cleanupPolicy: resource.registration.cleanupPolicy,
    createdAt: resource.registration.createdAt,
    createdByRelease: resource.registration.createdByRelease,
    createdByCommit: resource.registration.createdByCommit,
    creationRunId: resource.registration.operationRunId,
    immutableIdentity: resource.registration.immutableIdentity,
  } : ownershipFromObservation(resource);
  const references = [...(resource.runtime?.references ?? [])].sort();
  const contentDigests = [...new Set([
    ...(resource.runtime?.contentDigests ?? []),
    ...[resource.registration?.registrationId, resource.registration?.metadataDigest]
      .filter((value) => /^[a-f0-9]{64}$/.test(value ?? '')),
  ])].sort();
  const dependencyIdentities = [...new Set(
    resource.runtime?.dependencyIdentities ?? [],
  )].sort();
  const locatorKind = resource.resourceClass === 'compose_volume' ? 'name' : 'engine_id';
  return {
    resourceClass: resource.resourceClass, locatorKind, locator: resource.locator,
    immutableIdentity: resource.immutableIdentity, ownership,
    ownershipDigest: canonicalSha256(ownership),
    observationDigest: canonicalSha256({
      resourceClass: resource.resourceClass, locator: resource.locator,
      immutableIdentity: resource.immutableIdentity, ownershipState: resource.ownershipState,
      classifications: resource.classifications, runtime: resource.runtime,
      registration: resource.registration ?? null, references, contentDigests,
      dependencyIdentities,
    }),
    disposition: 'eligible', failureClasses: [], references, contentDigests,
    dependencyIdentities,
    active: false, protected: false, data: false,
    running: resource.resourceClass === 'compose_container' ? resource.runtime.running : null,
  };
}

function inventory(binding, resources, observedAt = new Date().toISOString()) {
  return {
    schemaVersion: '1.2.0', artifactType: 'inventory',
    deploymentId: binding.deploymentId, operationRunId: binding.operationRunId,
    generation: 1, observedAt, complete: true, policyDigest: HASH,
    deploymentManifestDigest: binding.deploymentManifestDigest ?? HASH,
    runManifestDigest: HASH, contextFingerprint: binding.contextFingerprint ?? HASH,
    resources, ambiguities: [],
  };
}

function approvedBinding({ deploymentId, operationRunId, ownerId, project,
  daemonContextFingerprint, registrations = [] }) {
  const deploymentManifest = {
    deploymentId, ownerId, composeProjectName: project, legacyResources: [],
  };
  const context = buildCleanupInventoryExecutionContext({
    deploymentManifest, registrations, daemonContextFingerprint,
  });
  return {
    deploymentId, operationRunId, deploymentManifest,
    deploymentManifestDigest: canonicalSha256(deploymentManifest),
    contextFingerprint: context.fingerprint,
  };
}

function registerVolume({ root, deploymentId, ownerId, operationRunId, locator,
  immutableIdentity, lifecycle, referenceIds, createdAt }) {
  return registerResource({
    deploymentId, operationRunId, ownerId, resourceClass: 'compose_volume', lifecycle,
    cleanupPolicy: lifecycle === 'shared' ? 'retain' : 'exact_delete',
    createdAt, createdByRelease: 'unreleased',
    createdByCommit: 'c'.repeat(40), locatorKind: 'name', locator, immutableIdentity,
    metadataDigest: canonicalSha256({ locator, immutableIdentity }), referenceIds,
  }, { root, checkoutRoot });
}

function registerImage({ root, deploymentId, ownerId, operationRunId, locator, immutableIdentity,
  createdAt, locatorKind = 'reference' }) {
  return registerResource({
    deploymentId, operationRunId, ownerId, resourceClass: 'oci_image',
    lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt, createdByRelease: 'unreleased',
    createdByCommit: 'c'.repeat(40), locatorKind,
    locator, immutableIdentity,
    metadataDigest: canonicalSha256({ immutableIdentity }), referenceIds: [operationRunId],
  }, { root, checkoutRoot });
}

function exactSelectors({ targetContainerId, targetId, currentId, unlabeledId,
  targetVolume, sharedVolume, dataVolume, targetImageId }) {
  return {
    compose_container: [targetContainerId].filter(Boolean).map((locator) => ({ locator })),
    compose_network: [targetId, currentId, unlabeledId].filter(Boolean).map((locator) => ({ locator })),
    compose_volume: [targetVolume, sharedVolume, dataVolume]
      .filter(Boolean).map((locator) => ({ locator })),
    oci_image: [targetImageId].filter(Boolean).map((locator) => ({ locator })),
    buildkit_cache: [],
  };
}

function actionSelectors(action) {
  const selectors = exactSelectors({});
  selectors[action.resourceClass] = [{ locator: action.locator }];
  return selectors;
}

function observe(options) {
  const result = observeDockerResources(options);
  assert.equal(result.complete, true, JSON.stringify(result.ambiguities));
  assert.deepEqual(result.ambiguities, []);
  return result;
}

function classed(resources, locator, classification) {
  const resource = resources.find((entry) => entry.locator === locator);
  assert.ok(resource, `missing observation for ${locator}`);
  assert.ok(resource.classifications.includes(classification), `${locator} is not ${classification}`);
  return resource;
}

function removeCreated(inContext, created) {
  const failures = [];
  for (const identity of created.containers) {
    const removed = spawnSync('docker', inContext(['rm', '-f', identity]), {
      encoding: 'utf8', timeout: 30_000,
    });
    if (removed.status !== 0 && dockerExists(inContext, 'container', identity)) {
      failures.push(`container ${identity}: ${removed.stderr.trim() || removed.error?.code || 'unknown failure'}`);
    }
  }
  for (const identity of created.networks) {
    const removed = spawnSync('docker', inContext(['network', 'rm', identity]), {
      encoding: 'utf8', timeout: 30_000,
    });
    if (removed.status !== 0 && dockerExists(inContext, 'network', identity)) {
      failures.push(`network ${identity}: ${removed.stderr.trim() || removed.error?.code || 'unknown failure'}`);
    }
  }
  for (const name of created.volumes) {
    const removed = spawnSync('docker', inContext(['volume', 'rm', name]), {
      encoding: 'utf8', timeout: 30_000,
    });
    if (removed.status !== 0 && dockerExists(inContext, 'volume', name)) {
      failures.push(`volume ${name}: ${removed.stderr.trim() || removed.error?.code || 'unknown failure'}`);
    }
  }
  for (const identity of created.images) {
    const removed = spawnSync('docker', inContext(['image', 'rm', '-f', identity]), {
      encoding: 'utf8', timeout: 30_000,
    });
    if (removed.status !== 0 && dockerExists(inContext, 'image', identity)) {
      failures.push(`image ${identity}: ${removed.stderr.trim() || removed.error?.code || 'unknown failure'}`);
    }
  }
  if (failures.length > 0) throw new Error(`real Docker fixture cleanup failed: ${failures.join('; ')}`);
}

test('real Docker coordinator deletes one exact ID, recovers durably, and preserves protected resources',
  { skip: !enabled, timeout: 900_000 }, async () => {
    const contextName = docker(['context', 'show']);
    const inContext = (args) => ['--context', contextName, ...args];
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const project = `cleanup-fixture-${suffix}`;
    const deploymentId = `deploy-${suffix}`;
    const currentDeploymentId = `current-${suffix}`;
    const ownerId = `owner-${suffix}`;
    const operationRunId = `cleanup-${suffix}`;
    const createdAt = new Date().toISOString();
    const targetName = `sanctuary-cleanup-target-${suffix}`;
    const targetContainerName = `sanctuary-cleanup-container-${suffix}`;
    const targetVolume = `sanctuary-cleanup-volume-${suffix}`;
    const currentName = `sanctuary-cleanup-current-${suffix}`;
    const unlabeledName = `sanctuary-cleanup-unlabeled-${suffix}`;
    const sharedVolume = `sanctuary-cleanup-shared-${suffix}`;
    const dataVolume = `sanctuary-cleanup-data-${suffix}`;
    const targetImageTag = `localhost/sanctuary-cleanup-image-${suffix}:replay`;
    const sharedImageTag = `localhost/sanctuary-cleanup-image-${suffix}:shared`;
    const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-cleanup-runtime-'));
    const registrationRoot = path.join(runtimeDirectory, 'ownership');
    const signingRoot = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-cleanup-signing-'));
    chmodSync(runtimeDirectory, 0o700);
    chmodSync(signingRoot, 0o700);
    const receiptSigner = signer(signingRoot);
    const authorizationSigner = signer(signingRoot, 'authorization');
    assert.notEqual(receiptSigner.signerKeyId, authorizationSigner.signerKeyId);
    const created = { containers: [], networks: [], volumes: [], images: [] };
    try {
      const targetId = docker(inContext(['network', 'create', ...labelArgs(ownershipLabels({
        project, deploymentId, ownerId, resourceClass: 'compose_network', lifecycle: 'obsolete',
        createdAt, creationRunId: `create-target-${suffix}`,
      })), targetName]));
      created.networks.push(targetId);
      const currentId = docker(inContext(['network', 'create', ...labelArgs(ownershipLabels({
        project, deploymentId: currentDeploymentId, ownerId, resourceClass: 'compose_network',
        lifecycle: 'active', createdAt, creationRunId: `create-current-${suffix}`,
      })), currentName]));
      created.networks.push(currentId);
      const unlabeledId = docker(inContext(['network', 'create', unlabeledName]));
      created.networks.push(unlabeledId);
      docker(inContext(['volume', 'create', ...labelArgs(ownershipLabels({
        project, deploymentId, ownerId, resourceClass: 'compose_volume', lifecycle: 'obsolete',
        createdAt, creationRunId: `create-volume-${suffix}`,
      })), targetVolume]));
      created.volumes.push(targetVolume);
      docker(inContext(['volume', 'create', ...labelArgs(ownershipLabels({
        project, deploymentId, ownerId, resourceClass: 'compose_volume', lifecycle: 'shared',
        createdAt, creationRunId: `shared-a-${suffix}`, cleanupPolicy: 'retain',
      })), sharedVolume]));
      created.volumes.push(sharedVolume);
      docker(inContext(['volume', 'create', ...labelArgs(ownershipLabels({
        project, deploymentId, ownerId, resourceClass: 'compose_volume', lifecycle: 'active',
        createdAt, creationRunId: `data-${suffix}`,
      })), dataVolume]));
      created.volumes.push(dataVolume);

      const imageLabels = labelArgs({
        'org.opencontainers.image.source': 'https://github.com/nekoguntai-castle/sanctuary',
        'org.opencontainers.image.version': '0.8.69',
        'org.opencontainers.image.revision': 'c'.repeat(40),
        'io.sanctuary.build-id': `distinct-build-lane-${suffix}`,
        'dev.sanctuary.image-lock-sha256': 'd'.repeat(64),
      });
      const imageContext = path.join(signingRoot, 'image-context');
      mkdirSync(imageContext, { mode: 0o700 });
      writeFileSync(path.join(imageContext, 'Dockerfile'), [
        'FROM alpine:latest',
        'ARG SANCTUARY_ACCEPTANCE_REVISION=target',
        'LABEL io.sanctuary.acceptance-revision=$SANCTUARY_ACCEPTANCE_REVISION',
        `CMD ["sh", "-c", "trap 'exit 0' TERM; while :; do sleep 1; done"]`,
        '',
      ].join('\n'));
      docker(inContext([
        'buildx', 'build', '--quiet', '--load', '--tag', targetImageTag, ...imageLabels, imageContext,
      ]));
      const observedImageId = docker(inContext([
        'image', 'inspect', '--format', '{{.Id}}', targetImageTag,
      ]));
      const targetImageId = observedImageId.startsWith('sha256:')
        ? observedImageId : `sha256:${observedImageId}`;
      assert.match(targetImageId, /^sha256:[a-f0-9]{64}$/);
      created.images.push(targetImageId);
      registerImage({
        root: registrationRoot, deploymentId, ownerId,
        operationRunId: `create-image-${suffix}`, locator: targetImageId,
        locatorKind: 'engine_id',
        immutableIdentity: targetImageId, createdAt,
      });
      docker(inContext(['image', 'tag', targetImageId, sharedImageTag]));
      const sharedImageObservation = observe({
        selectors: exactSelectors({ targetImageId }), registrations: readRegistrations(registrationRoot),
      });
      classed(sharedImageObservation.resources, targetImageId, 'protected');
      docker(inContext(['image', 'rm', sharedImageTag]));
      docker(inContext([
        'buildx', 'build', '--quiet', '--load', '--tag', targetImageTag,
        '--build-arg', 'SANCTUARY_ACCEPTANCE_REVISION=replacement',
        ...imageLabels, imageContext,
      ]));
      const replacementImageId = docker(inContext([
        'image', 'inspect', '--format', '{{.Id}}', targetImageTag,
      ]));
      assert.notEqual(replacementImageId, targetImageId);
      created.images.push(replacementImageId);
      assert.equal(docker(inContext([
        'image', 'inspect', '--format', '{{len .RepoTags}}', targetImageId,
      ])), '0');
      const targetContainerId = docker(inContext(['run', '--detach',
        ...labelArgs(ownershipLabels({
          project, deploymentId, ownerId, resourceClass: 'compose_container',
          lifecycle: 'obsolete', createdAt, creationRunId: `create-container-${suffix}`,
        })), '--name', targetContainerName, '--network', targetName,
        '--mount', `type=volume,source=${targetVolume},target=/data`, targetImageId,
      ]));
      created.containers.push(targetContainerId);

      const volumeBootstrap = observe({
        selectors: exactSelectors({ targetVolume, sharedVolume, dataVolume }),
      });
      const targetVolumeIdentity = classed(
        volumeBootstrap.resources, targetVolume, 'unregistered',
      ).immutableIdentity;
      const sharedIdentity = classed(volumeBootstrap.resources, sharedVolume, 'unregistered').immutableIdentity;
      const dataIdentity = classed(volumeBootstrap.resources, dataVolume, 'unregistered').immutableIdentity;
      registerVolume({ root: registrationRoot, deploymentId, ownerId,
        operationRunId: `create-volume-${suffix}`, locator: targetVolume,
        immutableIdentity: targetVolumeIdentity, lifecycle: 'obsolete',
        referenceIds: [`create-volume-${suffix}`], createdAt });
      registerVolume({ root: registrationRoot, deploymentId, ownerId,
        operationRunId: `shared-a-${suffix}`, locator: sharedVolume,
        immutableIdentity: sharedIdentity, lifecycle: 'shared',
        referenceIds: [`shared-a-${suffix}`, `shared-b-${suffix}`], createdAt });
      registerVolume({ root: registrationRoot, deploymentId, ownerId,
        operationRunId: `shared-b-${suffix}`, locator: sharedVolume,
        immutableIdentity: sharedIdentity, lifecycle: 'shared',
        referenceIds: [`shared-a-${suffix}`, `shared-b-${suffix}`], createdAt });
      registerVolume({ root: registrationRoot, deploymentId, ownerId,
        operationRunId: `data-${suffix}`, locator: dataVolume,
        immutableIdentity: dataIdentity, lifecycle: 'active', referenceIds: [`data-${suffix}`], createdAt });
      const registrations = () => readRegistrations(registrationRoot);
      const selectors = exactSelectors({
        targetContainerId, targetId, currentId, unlabeledId,
        targetVolume, sharedVolume, dataVolume, targetImageId,
      });
      const beforeObservation = observe({ selectors, registrations: registrations(),
        currentDeploymentIds: [currentDeploymentId], dataVolumeNames: [dataVolume] });
      const target = classed(beforeObservation.resources, targetId, 'owned');
      assert.deepEqual(target.classifications, ['owned']);
      const targetContainer = classed(beforeObservation.resources, targetContainerId, 'owned');
      const targetVolumeResource = classed(beforeObservation.resources, targetVolume, 'owned');
      const targetImage = classed(beforeObservation.resources, targetImageId, 'externally_registered');
      classed(beforeObservation.resources, currentId, 'current');
      classed(beforeObservation.resources, sharedVolume, 'shared');
      classed(beforeObservation.resources, unlabeledId, 'unlabeled');
      classed(beforeObservation.resources, dataVolume, 'data');

      const binding = approvedBinding({
        deploymentId, operationRunId, ownerId, project,
        daemonContextFingerprint: beforeObservation.daemonContextFingerprint,
        registrations: registrations(),
      });
      const inventoryBefore = inventory(binding, [
        targetContainer, target, targetVolumeResource, targetImage,
      ].map((resource) => eligibleRow(resource, project)), createdAt);
      const plan = buildCleanupPlan(inventoryBefore, contract, { policyDigest: HASH });
      const dryRunReceipt = buildPlanningReceipt(inventoryBefore, plan, {
        signerKeyId: receiptSigner.signerKeyId,
      });
      assert.equal(dryRunReceipt.state, 'dry_run');
      signAndVerifyArtifact(dryRunReceipt, receiptSigner, path.join(signingRoot, 'dry-run.json'));
      const approval = buildCleanupApproval(plan, dryRunReceipt, {
        signerKeyId: authorizationSigner.signerKeyId, nonce: `approval-${suffix}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      signAndVerifyArtifact(approval, authorizationSigner, path.join(signingRoot, 'approval.json'));
      const realDocker = execFileSync('which', ['docker'], { encoding: 'utf8' }).trim();
      assert.ok(realDocker);
      const wrapperDirectory = path.join(signingRoot, 'bin');
      const wrapperPath = path.join(wrapperDirectory, 'docker');
      const wrapperPidPath = path.join(signingRoot, 'docker-wrapper.pid');
      mkdirSync(wrapperDirectory, { mode: 0o700 });
      writeFileSync(wrapperPath, `#!/usr/bin/env bash
set -euo pipefail
printf '%s' "$$" > ${JSON.stringify(wrapperPidPath)}
${JSON.stringify(realDocker)} "$@"
sleep 10 &
wait "$!"
`, { mode: 0o700 });
      const runtime = createCleanupDockerRuntime({
        plan, deploymentManifest: binding.deploymentManifest,
        loadInventory: async ({ action }) => {
          const fresh = observe({
            selectors: actionSelectors(action),
            registrations: registrations(),
          });
          return inventory(binding, fresh.resources.map(
            (resource) => eligibleRow(resource, project),
          ), new Date().toISOString());
        },
        loadRegistrations: registrations, registrationRoot,
        observationOptions: {
          runCommand: (_engine, args) => execFileSync(realDocker, args, {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
          }),
        },
        supervisor: (_engine, args, options) => runSupervisedCleanupCommand(
          wrapperPath, args, options,
        ),
        supervisorOptions: { timeoutMs: 2_000, graceMs: 200, killWaitMs: 2_000 },
      });
      const buildInventoryAfter = async () => {
        const after = observe({
          selectors: exactSelectors({
            targetContainerId, targetId, targetVolume, targetImageId,
          }),
          registrations: registrations(),
        });
        assert.equal(after.resources.length, 0, JSON.stringify(after.resources));
        return inventory(binding, after.resources.map(
          (resource) => eligibleRow(resource, project),
        ), new Date().toISOString());
      };
      await assert.rejects(() => applyCleanupExecution({
        runtimeDirectory, checkoutRoot, inventoryBefore, plan, approval, dryRunReceipt,
        ...receiptSigner, reloadAuthority: runtime.reloadAuthority, mutate: runtime.mutate,
        reconcile: runtime.reconcile, buildInventoryAfter,
        afterBoundary: async (boundary) => {
          if (boundary === 'approval_finalized') throw new Error('simulated finalized crash');
        },
      }), /simulated finalized crash/);
      assert.equal(dockerExists(inContext, 'network', targetId), false);
      assert.equal(dockerExists(inContext, 'container', targetContainerId), false);
      assert.equal(dockerExists(inContext, 'volume', targetVolume), false);
      assert.equal(dockerExists(inContext, 'image', targetImageId), false);
      const wrapperPid = Number.parseInt(readFileSync(wrapperPidPath, 'ascii'), 10);
      assert.equal(cleanupProcessGroupHasRunnableMember(wrapperPid), false);
      created.networks = created.networks.filter((identity) => identity !== targetId);
      created.containers = created.containers.filter((identity) => identity !== targetContainerId);
      created.volumes = created.volumes.filter((identity) => identity !== targetVolume);
      created.images = created.images.filter((identity) => identity !== targetImageId);

      const recovered = await recoverCleanupExecution({
        runtimeDirectory, checkoutRoot, inventoryBefore, plan, approval, dryRunReceipt,
        ...receiptSigner, controllerRunId: `recover-${suffix}`,
        projectLockObservationDigest: HASH, deploymentLockObservationDigest: HASH,
        reloadAuthority: async () => { throw new Error('terminal recovery must not reload'); },
        mutate: async () => { throw new Error('terminal recovery must not mutate'); },
        reconcile: async () => { throw new Error('terminal recovery must not reconcile'); },
        buildInventoryAfter: async () => { throw new Error('terminal recovery must reuse inventory'); },
      });
      assert.equal(recovered.state, 'cleaned');
      const verified = verifySignedArtifact({
        inputPath: recovered.receiptOutputPath,
        signaturePath: `${recovered.receiptOutputPath}.sig`,
        checksumPath: `${recovered.receiptOutputPath.slice(0, -5)}.sha256`,
        publicKeyPath: receiptSigner.publicKeyPath,
        expectedFingerprint: receiptSigner.signerKeyId, checkoutRoot,
      });
      assert.equal(verified.digest, recovered.receiptDigest);
      assert.equal(verified.artifact.state, 'cleaned');
      publishAcceptanceEvidence(verified.artifact, receiptSigner, 'recovered-upload');
      assert.equal(verified.artifact.results.length, 5);
      assert.deepEqual(
        verified.artifact.results.map((entry) => entry.result),
        ['cleaned', 'absent', 'absent', 'absent', 'absent'],
      );
      assert.equal(readFileSync(`${recovered.receiptOutputPath.slice(0, -5)}.sha256`, 'ascii'), recovered.receiptDigest);
      const replayObservation = observe({
        selectors: exactSelectors({
          targetContainerId, targetId, targetVolume, targetImageId,
        }), registrations: registrations(),
      });
      const replayInventory = inventory({
        deploymentId, operationRunId: `replay-${suffix}`,
      }, [], new Date().toISOString());
      assert.equal(replayObservation.resources.length, 0);
      const replayPlan = buildCleanupPlan(replayInventory, contract, { policyDigest: HASH });
      const replayReceipt = buildPlanningReceipt(replayInventory, replayPlan, {
        signerKeyId: receiptSigner.signerKeyId,
      });
      assert.equal(replayReceipt.state, 'no_op');
      signAndVerifyArtifact(replayReceipt, receiptSigner, path.join(signingRoot, 'no-op-replay.json'));
      publishAcceptanceEvidence(replayReceipt, receiptSigner, 'second-run-upload');
      assert.equal(existsSync(path.join(registrationRoot, '.registration-lock')), false);
      for (const [noun, identity] of [['network', currentId], ['network', unlabeledId],
        ['volume', sharedVolume], ['volume', dataVolume]]) {
        assert.equal(dockerExists(inContext, noun, identity), true, `${noun} ${identity} was removed`);
      }
    } finally {
      removeCreated(inContext, created);
      rmSync(runtimeDirectory, { recursive: true, force: true });
      rmSync(signingRoot, { recursive: true, force: true });
    }
  });

test('real Docker pre-abort records a signed cancellation without touching the exact resource',
  { skip: !enabled, timeout: 120_000 }, async () => {
    const contextName = docker(['context', 'show']);
    const inContext = (args) => ['--context', contextName, ...args];
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-cancel-runtime-'));
    const registrationRoot = path.join(runtimeDirectory, 'ownership');
    const signingRoot = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-cancel-signing-'));
    chmodSync(runtimeDirectory, 0o700);
    chmodSync(signingRoot, 0o700);
    const receiptSigner = signer(signingRoot);
    const created = { containers: [], networks: [], volumes: [], images: [] };
    try {
      const createdAt = new Date().toISOString();
      const deploymentId = `cancel-deploy-${suffix}`;
      const operationRunId = `cancel-operation-${suffix}`;
      const project = `cancel-project-${suffix}`;
      const targetId = docker(inContext(['network', 'create', ...labelArgs(ownershipLabels({
        project, deploymentId, ownerId: `cancel-owner-${suffix}`,
        resourceClass: 'compose_network', lifecycle: 'obsolete', createdAt,
        creationRunId: `cancel-create-${suffix}`,
      })), `sanctuary-cancel-target-${suffix}`]));
      created.networks.push(targetId);
      const observed = observe({ selectors: exactSelectors({ targetId }) });
      const ownerId = `cancel-owner-${suffix}`;
      const binding = approvedBinding({
        deploymentId, operationRunId, ownerId, project,
        daemonContextFingerprint: observed.daemonContextFingerprint,
      });
      const inventoryBefore = inventory(binding, [eligibleRow(observed.resources[0])], createdAt);
      const plan = buildCleanupPlan(inventoryBefore, contract, { policyDigest: HASH });
      const dryRunReceipt = buildPlanningReceipt(inventoryBefore, plan, {
        signerKeyId: receiptSigner.signerKeyId,
      });
      const approval = buildCleanupApproval(plan, dryRunReceipt, {
        signerKeyId: receiptSigner.signerKeyId, nonce: `cancel-approval-${suffix}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      ensureRegistrationKeys(registrationRoot);
      const runtime = createCleanupDockerRuntime({
        plan, deploymentManifest: binding.deploymentManifest,
        loadInventory: async () => inventoryBefore,
        loadRegistrations: () => readRegistrations(registrationRoot), registrationRoot,
      });
      const controller = new AbortController();
      controller.abort();
      const result = await applyCleanupExecution({
        runtimeDirectory, checkoutRoot, inventoryBefore, plan, approval, dryRunReceipt,
        ...receiptSigner, reloadAuthority: runtime.reloadAuthority, mutate: runtime.mutate,
        reconcile: runtime.reconcile,
        buildInventoryAfter: async () => inventory(binding, [eligibleRow(observed.resources[0])]),
        signal: controller.signal,
      });
      assert.equal(result.state, 'cancelled');
      assert.equal(dockerExists(inContext, 'network', targetId), true);
      const receipt = parseStrictJson(readFileSync(result.receiptOutputPath));
      assert.equal(receipt.results[0].failureClass, 'cancelled');
      assert.equal(verifySignedArtifact({
        inputPath: result.receiptOutputPath, publicKeyPath: receiptSigner.publicKeyPath,
        expectedFingerprint: receiptSigner.signerKeyId, checkoutRoot,
      }).artifact.state, 'cancelled');
    } finally {
      removeCreated(inContext, created);
      rmSync(runtimeDirectory, { recursive: true, force: true });
      rmSync(signingRoot, { recursive: true, force: true });
    }
  });

test('real Docker cancellation after one action preserves the second exact resource',
  { skip: !enabled, timeout: 120_000 }, async () => {
    const contextName = docker(['context', 'show']);
    const inContext = (args) => ['--context', contextName, ...args];
    const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
    const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-mid-cancel-runtime-'));
    const registrationRoot = path.join(runtimeDirectory, 'ownership');
    const signingRoot = mkdtempSync(path.join(os.tmpdir(), 'sanctuary-mid-cancel-signing-'));
    chmodSync(runtimeDirectory, 0o700);
    chmodSync(signingRoot, 0o700);
    const receiptSigner = signer(signingRoot);
    const created = { containers: [], networks: [], volumes: [], images: [] };
    try {
      const createdAt = new Date().toISOString();
      const deploymentId = `mid-cancel-deploy-${suffix}`;
      const operationRunId = `mid-cancel-operation-${suffix}`;
      const ownerId = `mid-cancel-owner-${suffix}`;
      const project = `mid-cancel-project-${suffix}`;
      for (const index of [1, 2]) {
        const identity = docker(inContext(['network', 'create', ...labelArgs(ownershipLabels({
          project, deploymentId, ownerId, resourceClass: 'compose_network',
          lifecycle: 'obsolete', createdAt, creationRunId: `mid-cancel-create-${suffix}-${index}`,
        })), `sanctuary-mid-cancel-${index}-${suffix}`]));
        created.networks.push(identity);
      }
      const selectors = {
        ...exactSelectors({}),
        compose_network: created.networks.map((locator) => ({ locator })),
      };
      const observed = observe({ selectors });
      const binding = approvedBinding({
        deploymentId, operationRunId, ownerId, project,
        daemonContextFingerprint: observed.daemonContextFingerprint,
      });
      const inventoryBefore = inventory(
        binding, observed.resources.map((resource) => eligibleRow(resource)), createdAt,
      );
      const plan = buildCleanupPlan(inventoryBefore, contract, { policyDigest: HASH });
      assert.equal(plan.actions.length, 2);
      const dryRunReceipt = buildPlanningReceipt(inventoryBefore, plan, {
        signerKeyId: receiptSigner.signerKeyId,
      });
      const approval = buildCleanupApproval(plan, dryRunReceipt, {
        signerKeyId: receiptSigner.signerKeyId, nonce: `mid-cancel-approval-${suffix}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      ensureRegistrationKeys(registrationRoot);
      const registrations = () => readRegistrations(registrationRoot);
      const runtime = createCleanupDockerRuntime({
        plan, deploymentManifest: binding.deploymentManifest,
        loadInventory: async ({ action }) => {
          const fresh = observe({ selectors: actionSelectors(action), registrations: registrations() });
          return inventory(binding, fresh.resources.map(
            (resource) => eligibleRow(resource, project),
          ), new Date().toISOString());
        },
        loadRegistrations: registrations, registrationRoot,
      });
      const controller = new AbortController();
      let firstResultRecorded = false;
      const result = await applyCleanupExecution({
        runtimeDirectory, checkoutRoot, inventoryBefore, plan, approval, dryRunReceipt,
        ...receiptSigner, reloadAuthority: runtime.reloadAuthority, mutate: runtime.mutate,
        reconcile: runtime.reconcile, signal: controller.signal,
        afterBoundary: async (boundary) => {
          if (boundary === 'checkpoint_result' && !firstResultRecorded) {
            firstResultRecorded = true;
            controller.abort('SIGTERM');
          }
        },
        buildInventoryAfter: async () => {
          const after = observe({ selectors, registrations: registrations() });
          return inventory(binding, after.resources.map(
            (resource) => eligibleRow(resource, project),
          ), new Date().toISOString());
        },
      });
      const firstIdentity = plan.actions[0].immutableIdentity;
      const secondIdentity = plan.actions[1].immutableIdentity;
      assert.equal(result.state, 'cancelled');
      assert.equal(dockerExists(inContext, 'network', firstIdentity), false);
      assert.equal(dockerExists(inContext, 'network', secondIdentity), true);
      assert.deepEqual(
        result.receipt.results.map((entry) => entry.failureClass), ['none', 'cancelled'],
      );
      created.networks = created.networks.filter((identity) => identity !== firstIdentity);
    } finally {
      removeCreated(inContext, created);
      rmSync(runtimeDirectory, { recursive: true, force: true });
      rmSync(signingRoot, { recursive: true, force: true });
    }
  });
