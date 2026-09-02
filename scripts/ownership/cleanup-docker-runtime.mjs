import { createDockerActionReconciler, createDockerAuthorityReloader } from './cleanup-docker-reconciler.mjs';
import { executeDockerMutation } from './cleanup-docker-executor.mjs';
import { canonicalSha256 } from './canonical-json.mjs';
import { runCleanupCommand } from './cleanup-command.mjs';
import { resolveDockerDaemonContext } from './cleanup-execution-context.mjs';
import { observeDockerResources } from './docker-observation.mjs';
import { buildCleanupInventoryExecutionContext } from './cleanup-inventory.mjs';
import { acquireRegistrationFence, releaseRegistrationFence } from './registration.mjs';
import { runSupervisedCleanupCommand } from './cleanup-supervisor.mjs';

function exactInventoryBinding(inventory, plan) {
  for (const key of [
    'deploymentId', 'operationRunId', 'policyDigest', 'deploymentManifestDigest',
    'runManifestDigest', 'contextFingerprint',
  ]) if (inventory?.[key] !== plan[key]) throw new Error(`fresh inventory ${key} changed`);
  return inventory;
}

function registrationOwnership(registration, composeProjectName) {
  return {
    project: composeProjectName, deploymentId: registration.deploymentId,
    ownerId: registration.ownerId, resourceClass: registration.resourceClass,
    lifecycle: registration.lifecycle, cleanupPolicy: registration.cleanupPolicy,
    createdAt: registration.createdAt, createdByRelease: registration.createdByRelease,
    createdByCommit: registration.createdByCommit,
    creationRunId: registration.operationRunId,
    immutableIdentity: registration.immutableIdentity,
  };
}

function volumeRegistrationProof(action, registrations, composeProjectName) {
  const matches = registrations.filter((entry) => entry.resourceClass === 'compose_volume'
    && entry.locatorKind === 'name' && entry.locator === action.locator
    && entry.immutableIdentity === action.immutableIdentity);
  if (matches.length !== 1) throw new Error('volume registration authority is not unique');
  const registration = matches[0];
  if (registration.deploymentId !== action.deploymentId
      || registration.cleanupPolicy !== 'exact_delete'
      || registration.lifecycle !== 'obsolete'
      || registration.referenceIds?.length !== 1) {
    throw new Error('volume registration authority is retained or shared');
  }
  const ownership = registrationOwnership(registration, composeProjectName);
  return {
    resourceClass: 'compose_volume', locatorKind: 'name', locator: registration.locator,
    immutableIdentity: registration.immutableIdentity, ownershipDigest: action.ownershipDigest,
    ownership, registrationId: registration.registrationId,
    metadataDigest: registration.metadataDigest, signerKeyId: registration.signerKeyId,
    creationNonce: registration.operationRunId,
  };
}

function commandRunner(observationOptions) {
  return observationOptions.runCommand ?? ((executable, args, commandOptions) => runCleanupCommand(
    executable, args, { ...observationOptions.commandOptions, ...commandOptions },
  ));
}

function registrationFence(registrationRoot, injected) {
  if (typeof injected === 'function') return injected;
  if (typeof registrationRoot !== 'string' || registrationRoot.length === 0) {
    throw new TypeError('registrationRoot or withRegistrationFence is required');
  }
  return async (operationRunId, callback) => {
    const owner = acquireRegistrationFence(registrationRoot, operationRunId);
    try { return await callback(); } finally { releaseRegistrationFence(registrationRoot, owner); }
  };
}

function withDeploymentId(action, deploymentId) {
  return Object.freeze({ ...action, deploymentId });
}

function assertApprovedRuntimeContext(plan, deploymentManifest, registrations, authority, engine, options) {
  if (!deploymentManifest || canonicalSha256(deploymentManifest) !== plan.deploymentManifestDigest) {
    throw new Error('runtime deployment manifest does not match approved plan');
  }
  const context = buildCleanupInventoryExecutionContext({
    deploymentManifest, registrations, engine,
    daemonContextFingerprint: authority.fingerprint,
    protectedProjects: options.protectedProjects ?? [],
    dataVolumeNames: options.dataVolumeNames ?? [],
    sharedImmutableIdentities: options.sharedImmutableIdentities ?? [],
    legacyFixtureWitnessDigest: options.legacyFixtureWitnessDigest ?? null,
  });
  if (context.fingerprint !== plan.contextFingerprint) {
    throw new Error('runtime Docker authority does not match approved cleanup context');
  }
}

/** Join the read-only authority, exact executor, and postcondition reconciler. */
export function createCleanupDockerRuntime({
  plan, deploymentManifest, engine = 'docker', loadInventory, loadRegistrations,
  observationOptions = {}, supervisor = runSupervisedCleanupCommand,
  supervisorOptions = {}, registrationRoot, withRegistrationFence,
}) {
  if (typeof loadInventory !== 'function' || typeof loadRegistrations !== 'function') {
    throw new TypeError('loadInventory and loadRegistrations callbacks are required');
  }
  const authority = resolveDockerDaemonContext({ engine, runCommand: commandRunner(observationOptions) });
  const initialRegistrations = loadRegistrations();
  assertApprovedRuntimeContext(
    plan, deploymentManifest, initialRegistrations, authority, engine, observationOptions,
  );
  const fenced = registrationFence(registrationRoot, withRegistrationFence);
  const registrations = () => loadRegistrations();
  const loadVolumeRegistrationProof = async ({ action }) => volumeRegistrationProof(
    withDeploymentId(action, plan.deploymentId), registrations(), deploymentManifest.composeProjectName,
  );
  const authoritativeInventory = async (request) => {
    assertApprovedRuntimeContext(
      plan, deploymentManifest, registrations(), authority, engine, observationOptions,
    );
    return exactInventoryBinding(
      await loadInventory(Object.freeze({ ...request, daemonAuthority: authority })), plan,
    );
  };
  const observeAction = async ({ action, selectors }) => observeDockerResources({
    ...observationOptions, engine, selectors, registrations: registrations(),
    daemonAuthority: authority,
  });
  const reloadAuthority = createDockerAuthorityReloader({
    approvedActions: plan.actions, loadInventory: authoritativeInventory,
    loadVolumeRegistrationProof,
  });
  const reconcile = createDockerActionReconciler({
    observeAction, loadVolumeRegistrationProof,
    expectedDaemonContextFingerprint: authority.fingerprint,
  });
  const mutate = async ({ action, signal, predecessorResultDigest, authorityRowDigest }) => fenced(
    plan.operationRunId,
    async () => {
      const finalAuthority = await reloadAuthority({
        action, phase: 'pre_mutation_reinspection', predecessorResultDigest, signal,
      });
      if (finalAuthority.state !== 'eligible'
          || canonicalSha256(finalAuthority.row) !== authorityRowDigest) {
        return { outcome: 'not_started', refusalClass: finalAuthority.failureClass ?? 'identity_changed' };
      }
      let freshVolumeProof;
      if (action.resourceClass === 'compose_volume') {
        const observed = await observeAction({ action, selectors: {
          compose_container: [], compose_network: [], compose_volume: [{ locator: action.locator }],
          oci_image: [], buildkit_cache: [],
        } });
        const exact = observed.complete === true && observed.ambiguities.length === 0
          && observed.daemonContextFingerprint === authority.fingerprint
          && observed.resources.length === 1 && observed.resources[0].immutableIdentity === action.immutableIdentity
          && observed.resources[0].runtime?.attachmentCount === 0;
        if (!exact) return { outcome: 'not_started', refusalClass: 'identity_changed' };
        const proof = await loadVolumeRegistrationProof({ action });
        freshVolumeProof = {
          locator: action.locator, observedFingerprint: observed.resources[0].immutableIdentity,
          registeredCreationNonce: proof.creationNonce, observedCreationNonce: proof.creationNonce,
          observedOwnershipDigest: proof.ownershipDigest,
          attachmentCount: observed.resources[0].runtime.attachmentCount,
        };
      }
      return executeDockerMutation(action, {
        engine, engineGlobalArgs: authority.engineGlobalArgs, supervisor, freshVolumeProof,
        supervisorOptions: { ...supervisorOptions, signal },
      });
    },
  );
  return Object.freeze({ reloadAuthority, mutate, reconcile, observeAction });
}
