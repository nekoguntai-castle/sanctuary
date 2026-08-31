#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from './canonical-json.mjs';
import { sha256 } from './crypto.mjs';
import { composeArguments, resolveDeploymentDefinition } from './deployment-definition.mjs';
import { acquireDeploymentLock, assertDeploymentLock, releaseDeploymentLock } from './deployment-lock.mjs';
import { DeploymentStore } from './deployment-store.mjs';
import {
  assertFirstManifestDockerResources,
  assertLegacyDurablePreconditions,
  assertLegacyUpgradePostconditions,
  resolveLegacyDurableComposeOverlay,
} from './legacy-docker-inspection.mjs';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function flag(name) { return ['1', 'true', 'yes'].includes((process.env[name] ?? '').toLowerCase()); }

function state() {
  const runtimeDirectory = required('SANCTUARY_RUNTIME_DIR');
  const deploymentId = required('SANCTUARY_DEPLOYMENT_ID');
  return { runtimeDirectory, deploymentId, store: new DeploymentStore({ runtimeDirectory, deploymentId }) };
}

function definitionOptions() {
  const projectDirectory = path.resolve(required('SANCTUARY_PROJECT_DIR'));
  const policyPath = path.join(projectDirectory, 'config/resource-ownership-contract.json');
  const contextFingerprint = canonicalSha256({
    dockerContext: process.env.DOCKER_CONTEXT ?? 'default',
    dockerHost: process.env.DOCKER_HOST ?? 'default',
    projectDirectory,
  });
  return {
    projectDirectory,
    envFile: required('SANCTUARY_ENV_FILE'),
    runtimeDirectory: required('SANCTUARY_RUNTIME_DIR'),
    composeProjectName: process.env.COMPOSE_PROJECT_NAME || required('SANCTUARY_PROJECT'),
    installMode: flag('SANCTUARY_OFFLINE_MODE') || process.env.SANCTUARY_INSTALL_MODE === 'offline' ? 'offline' : 'online',
    monitoring: flag('SANCTUARY_INCLUDE_MONITORING'),
    tor: flag('SANCTUARY_INCLUDE_TOR'),
    mcp: flag('SANCTUARY_INCLUDE_MCP'),
    customOverlays: JSON.parse(process.env.SANCTUARY_CUSTOM_COMPOSE_OVERLAYS_JSON ?? '[]'),
    ownerId: required('SANCTUARY_OWNER_ID'),
    release: required('SANCTUARY_RELEASE'),
    commit: required('SANCTUARY_COMMIT'),
    policyDigest: sha256(readFileSync(policyPath)),
    contextFingerprint,
  };
}

function resolveDefinition(options, baseBundle, legacyResources = []) {
  assertLegacyDurablePreconditions({ legacyResources, definition: baseBundle.definition });
  const compatibility = resolveLegacyDurableComposeOverlay({
    composeArgs: composeArguments(baseBundle.definition), legacyResources,
  });
  return resolveDeploymentDefinition({
    ...options,
    generatedOverlays: compatibility ? [{ name: 'legacy-durable-resources', bytes: compatibility }] : [],
  });
}

function existingRevisionLegacyResources(store, inspection) {
  for (const pointer of [inspection.pending, inspection.prepared, inspection.active]) {
    if (pointer) return store.readManifest(pointer.value.generation, { verifySnapshots: true }).manifest.legacyResources;
  }
  return [];
}

function lock(store, operationRunId) {
  const inherited = process.env.SANCTUARY_DEPLOYMENT_LOCK_TOKEN;
  if (inherited) {
    assertDeploymentLock(store.lockPath, inherited, operationRunId);
    return { token: inherited, owned: false };
  }
  const controllerPid = Number(required('SANCTUARY_LOCK_CONTROLLER_PID'));
  const owner = acquireDeploymentLock(store.lockPath, { operationRunId, controllerPid });
  return { token: owner.token, owned: true };
}

function output(fields) { process.stdout.write(`${fields.join('\t')}\n`); }

function begin() {
  const { store } = state();
  const operationRunId = required('SANCTUARY_OPERATION_RUN_ID');
  const held = lock(store, operationRunId);
  try {
    const options = definitionOptions();
    const baseBundle = resolveDeploymentDefinition(options);
    store.initialize({ projectDirectory: baseBundle.definition.projectDirectory, composeProjectName: baseBundle.definition.composeProjectName });
    const inspection = store.reconcilePointers({ operationRunId, lockToken: held.token });
    const existingLegacyResources = existingRevisionLegacyResources(store, inspection);
    let bundle = resolveDefinition(options, baseBundle, existingLegacyResources);
    if (inspection.pending) {
      const resumed = store.resumePending({
        operationRunId, lockToken: held.token, expectedPendingDigest: inspection.pending.digest,
        expectedDefinitionDigest: bundle.definition.definitionDigest,
      });
      output(['pending', resumed.pending.generation, resumed.pendingDigest, held.token,
        held.owned ? 'owned' : 'inherited', resumed.pending.stage]);
      return;
    }
    if (inspection.prepared) {
      const resumed = store.resumePreparedRevision({
        operationRunId, lockToken: held.token, expectedPreparedDigest: inspection.prepared.digest,
        expectedDefinitionDigest: bundle.definition.definitionDigest,
      });
      output(['pending', resumed.pending.generation, resumed.pendingDigest, held.token,
        held.owned ? 'owned' : 'inherited', resumed.pending.stage]);
      return;
    }
    let legacyResources = existingLegacyResources.filter((entry) => entry.resourceClass !== 'compose_container');
    if (inspection.active) {
      const active = store.readManifest(inspection.active.value.generation, { verifySnapshots: true });
      if (active.manifest.definitionDigest === bundle.definition.definitionDigest) {
        output(['active', inspection.active.value.generation, '-', held.token, held.owned ? 'owned' : 'inherited', 'active']);
        return;
      }
      legacyResources = active.manifest.legacyResources.filter((entry) => entry.resourceClass !== 'compose_container');
    }
    if (!inspection.active) {
      const legacyInspection = assertFirstManifestDockerResources({
        definition: bundle.definition,
        composeArgs: composeArguments(baseBundle.definition),
        deploymentId: required('SANCTUARY_DEPLOYMENT_ID'),
        ownerId: required('SANCTUARY_OWNER_ID'),
        projectLabel: required('SANCTUARY_PROJECT'),
        allowUnlabeledUpgrade: flag('SANCTUARY_UPGRADE_MODE'),
      });
      legacyResources = legacyInspection.legacyResources;
      bundle = resolveDefinition(options, baseBundle, legacyResources);
    }
    const prepared = store.prepareRevision({
      bundle,
      expectedActiveDigest: inspection.active?.value.manifestDigest ?? null,
      operationRunId,
      lockToken: held.token,
      legacyResources,
    });
    output(['pending', prepared.manifest.generation, prepared.pendingDigest, held.token,
      held.owned ? 'owned' : 'inherited', prepared.pending.stage]);
  } catch (error) {
    if (held.owned) releaseDeploymentLock(store.lockPath, held.token, operationRunId);
    throw error;
  }
}

function verifyLegacyUpgrade() {
  const { store } = state();
  assertDeploymentLock(
    store.lockPath,
    required('SANCTUARY_DEPLOYMENT_LOCK_TOKEN'),
    required('SANCTUARY_OPERATION_RUN_ID'),
  );
  const inspection = store.inspect();
  const pointer = inspection.pending ?? inspection.active;
  if (!pointer) throw new Error('deployment has no revision to verify');
  const revision = store.readManifest(pointer.value.generation, { verifySnapshots: true });
  assertLegacyUpgradePostconditions({
    definition: revision.manifest,
    composeArgs: composeArguments(revision.manifest, { snapshotRoot: revision.revisionRoot }),
    deploymentId: required('SANCTUARY_DEPLOYMENT_ID'),
    ownerId: required('SANCTUARY_OWNER_ID'),
    projectLabel: required('SANCTUARY_PROJECT'),
    legacyResources: revision.manifest.legacyResources,
  });
  output(['verified']);
}

function verifyLegacyPreconditions() {
  const { store } = state();
  assertDeploymentLock(
    store.lockPath,
    required('SANCTUARY_DEPLOYMENT_LOCK_TOKEN'),
    required('SANCTUARY_OPERATION_RUN_ID'),
  );
  const inspection = store.inspect();
  const pointer = inspection.pending ?? inspection.active;
  if (!pointer) throw new Error('deployment has no revision to verify');
  const revision = store.readManifest(pointer.value.generation, { verifySnapshots: true });
  assertLegacyDurablePreconditions({ legacyResources: revision.manifest.legacyResources, definition: revision.manifest });
  output(['verified']);
}

function useActive() {
  const { store } = state();
  const operationRunId = required('SANCTUARY_OPERATION_RUN_ID');
  const held = lock(store, operationRunId);
  try {
    const inspection = store.inspect();
    if (inspection.pending) throw new Error('deployment has an unresolved pending revision');
    if (!inspection.active) throw new Error('deployment is unregistered; mutation is refused');
    store.readManifest(inspection.active.value.generation, { verifySnapshots: true });
    output(['active', inspection.active.value.generation, '-', held.token, held.owned ? 'owned' : 'inherited', 'active']);
  } catch (error) {
    if (held.owned) releaseDeploymentLock(store.lockPath, held.token, operationRunId);
    throw error;
  }
}

function lockOnly() {
  const { store } = state();
  const operationRunId = required('SANCTUARY_OPERATION_RUN_ID');
  const held = lock(store, operationRunId);
  output([held.token, held.owned ? 'owned' : 'inherited']);
}

function assertLock() {
  const { store } = state();
  assertDeploymentLock(
    store.lockPath,
    required('SANCTUARY_DEPLOYMENT_LOCK_TOKEN'),
    required('SANCTUARY_OPERATION_RUN_ID'),
  );
  output(['locked']);
}

function transition(nextStage) {
  const { store } = state();
  const result = store.transitionPending({
    operationRunId: required('SANCTUARY_OPERATION_RUN_ID'),
    lockToken: required('SANCTUARY_DEPLOYMENT_LOCK_TOKEN'),
    expectedPendingDigest: required('SANCTUARY_PENDING_DIGEST'),
    nextStage,
  });
  output([result.pendingDigest]);
}

function activate() {
  const { store } = state();
  store.activateRevision({
    operationRunId: required('SANCTUARY_OPERATION_RUN_ID'),
    lockToken: required('SANCTUARY_DEPLOYMENT_LOCK_TOKEN'),
    expectedPendingDigest: required('SANCTUARY_PENDING_DIGEST'),
  });
  output(['active']);
}

function finalizePrepared() {
  const { store } = state();
  store.finalizePreparedRevision({
    operationRunId: required('SANCTUARY_OPERATION_RUN_ID'),
    lockToken: required('SANCTUARY_DEPLOYMENT_LOCK_TOKEN'),
    expectedPendingDigest: required('SANCTUARY_PENDING_DIGEST'),
  });
  output(['prepared']);
}

function composeArgs(generation) {
  const { store } = state();
  const revision = store.readManifest(Number(generation), { verifySnapshots: true });
  const args = composeArguments(revision.manifest, { snapshotRoot: revision.revisionRoot });
  process.stdout.write(Buffer.from(`${args.join('\0')}\0`));
}

function release() {
  const { store } = state();
  releaseDeploymentLock(store.lockPath, required('SANCTUARY_DEPLOYMENT_LOCK_TOKEN'), required('SANCTUARY_OPERATION_RUN_ID'));
}

async function main([command, argument]) {
  if (command === 'begin') begin();
  else if (command === 'lock-only') lockOnly();
  else if (command === 'assert-lock') assertLock();
  else if (command === 'use-active') useActive();
  else if (command === 'transition' && argument) transition(argument);
  else if (command === 'activate') activate();
  else if (command === 'finalize-prepared') finalizePrepared();
  else if (command === 'verify-legacy-preconditions') verifyLegacyPreconditions();
  else if (command === 'verify-legacy-upgrade') verifyLegacyUpgrade();
  else if (command === 'compose-args' && argument) composeArgs(argument);
  else if (command === 'release') release();
  else throw new Error('usage: deployment-session.mjs begin|lock-only|assert-lock|use-active|transition STAGE|activate|finalize-prepared|verify-legacy-preconditions|verify-legacy-upgrade|compose-args GENERATION|release');
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`deployment-session: ${error.message}\n`);
  process.exitCode = 1;
});
