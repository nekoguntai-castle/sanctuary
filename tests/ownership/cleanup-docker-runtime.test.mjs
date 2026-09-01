import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSha256 } from '../../scripts/ownership/canonical-json.mjs';
import { runCleanupActions } from '../../scripts/ownership/cleanup-action-runner.mjs';
import { createCleanupDockerRuntime } from '../../scripts/ownership/cleanup-docker-runtime.mjs';
import { resolveDockerDaemonContext } from '../../scripts/ownership/cleanup-execution-context.mjs';
import { buildCleanupInventoryExecutionContext } from '../../scripts/ownership/cleanup-inventory.mjs';

const ID = 'a'.repeat(64);
const OBSERVATION = 'b'.repeat(64);
const CONTEXT = 'c'.repeat(64);

function owner() {
  return {
    project: 'fixture', deploymentId: 'deploy-1', ownerId: 'owner-1',
    resourceClass: 'compose_network', lifecycle: 'obsolete', cleanupPolicy: 'exact_delete',
    createdAt: '2026-08-31T00:00:00.000Z', createdByRelease: 'unreleased',
    createdByCommit: 'd'.repeat(40), creationRunId: 'create-1', immutableIdentity: ID,
  };
}

const action = {
  sequence: 1, resourceClass: 'compose_network', immutableIdentity: ID,
  action: 'remove', locatorKind: 'engine_id', locator: ID,
  ownershipDigest: canonicalSha256(owner()), observationDigest: OBSERVATION,
};
const deploymentManifest = {
  deploymentId: 'deploy-1', ownerId: 'owner-1', composeProjectName: 'fixture', legacyResources: [],
};
const basePlan = {
  deploymentId: 'deploy-1', operationRunId: 'cleanup-1', policyDigest: CONTEXT,
  deploymentManifestDigest: canonicalSha256(deploymentManifest), runManifestDigest: CONTEXT,
  actions: [action],
};

function approvedPlan(runCommand) {
  const authority = resolveDockerDaemonContext({ engine: 'docker', runCommand });
  const context = buildCleanupInventoryExecutionContext({
    deploymentManifest, daemonContextFingerprint: authority.fingerprint,
  });
  return { ...basePlan, contextFingerprint: context.fingerprint };
}

function inventory(plan) {
  return {
    schemaVersion: '1.2.0', artifactType: 'inventory', deploymentId: 'deploy-1',
    operationRunId: 'cleanup-1', generation: 1, observedAt: '2026-08-31T00:00:01.000Z',
    complete: true, policyDigest: CONTEXT,
    deploymentManifestDigest: plan.deploymentManifestDigest,
    runManifestDigest: CONTEXT, contextFingerprint: plan.contextFingerprint, ambiguities: [],
    resources: [{
      resourceClass: 'compose_network', locatorKind: 'engine_id', locator: ID,
      immutableIdentity: ID, ownership: owner(), ownershipDigest: action.ownershipDigest,
      observationDigest: OBSERVATION, disposition: 'eligible', failureClasses: [],
      references: [], contentDigests: [], running: null,
      active: false, protected: false, data: false,
    }],
  };
}

test('Docker runtime joins full authority reload, exact mutation, and exact absence reconciliation', async () => {
  let removed = false;
  const commands = [];
  const runCommand = (_engine, args) => {
    commands.push(args.join(' '));
    if (args[0] === 'context' && args[1] === 'show') return 'default\n';
    const effectiveArgs = args[0] === '--host' ? args.slice(2) : args;
    if (effectiveArgs[0] === 'version' || effectiveArgs[0] === 'info'
        ) return '{}\n';
    if (effectiveArgs[0] === 'context') return JSON.stringify({
      Name: 'default', Endpoints: { docker: { Host: 'unix:///run/docker-fixture.sock', SkipTLSVerify: false } },
      TLSMaterial: {},
    });
    if (effectiveArgs[0] === 'network' && effectiveArgs[1] === 'ls') return removed ? '' : `${ID}\n`;
    if (effectiveArgs[0] === 'network' && effectiveArgs[1] === 'inspect') throw new Error('post-delete inspect is not expected');
    if (effectiveArgs[0] === 'container' && effectiveArgs[1] === 'ls') return '';
    throw new Error(`unexpected query: ${args.join(' ')}`);
  };
  const plan = approvedPlan(runCommand);
  const runtime = createCleanupDockerRuntime({
    plan, deploymentManifest, loadInventory: async () => inventory(plan),
    loadRegistrations: () => [], observationOptions: { runCommand },
    withRegistrationFence: async (_operationRunId, callback) => callback(),
    supervisor: async (engine, args) => {
      assert.equal(engine, 'docker');
      assert.deepEqual(args, ['--host', 'unix:///run/docker-fixture.sock', 'network', 'rm', ID]);
      removed = true;
      return { outcome: 'success', exitCode: 0, terminationSignal: null };
    },
  });
  let checkpoint = 0;
  const result = await runCleanupActions({
    actions: [action], reloadAuthority: runtime.reloadAuthority,
    mutate: runtime.mutate, reconcile: runtime.reconcile,
    appendCheckpoint: async () => ({
      checkpointDigest: canonicalSha256({ checkpoint: checkpoint++ }), signed: true, synced: true,
    }),
  });
  assert.equal(result.results[0].result, 'absent');
  assert.equal(removed, true);
  assert.ok(commands.some((entry) => entry.startsWith('--host unix:///run/docker-fixture.sock network ls')));
});

test('the registration fence rechecks authority and refuses drift before mutation', async () => {
  let inventoryLoads = 0;
  let supervisorCalls = 0;
  let fenceCalls = 0;
  const runCommand = (_engine, args) => {
    if (args.join(' ') === 'context show') return 'default\n';
    const effectiveArgs = args[0] === '--host' ? args.slice(2) : args;
    if (['version', 'info'].includes(effectiveArgs[0])) return '{}\n';
    if (effectiveArgs[0] === 'context') return JSON.stringify({
      Name: 'default', Endpoints: { docker: { Host: 'unix:///run/docker-fixture.sock', SkipTLSVerify: false } },
      TLSMaterial: {},
    });
    throw new Error(`unexpected query: ${args.join(' ')}`);
  };
  const plan = approvedPlan(runCommand);
  const runtime = createCleanupDockerRuntime({
    plan, deploymentManifest,
    loadInventory: async () => {
      inventoryLoads += 1;
      const result = inventory(plan);
      if (inventoryLoads >= 3) {
        result.resources[0].observationDigest = 'e'.repeat(64);
      }
      return result;
    },
    loadRegistrations: () => [], observationOptions: { runCommand },
    withRegistrationFence: async (operationRunId, callback) => {
      assert.equal(operationRunId, plan.operationRunId);
      fenceCalls += 1;
      return callback();
    },
    supervisor: async () => {
      supervisorCalls += 1;
      return { outcome: 'success', exitCode: 0, terminationSignal: null };
    },
  });
  let checkpoint = 0;
  const result = await runCleanupActions({
    actions: [action], reloadAuthority: runtime.reloadAuthority,
    mutate: runtime.mutate, reconcile: runtime.reconcile,
    appendCheckpoint: async () => ({
      checkpointDigest: canonicalSha256({ checkpoint: checkpoint++ }), signed: true, synced: true,
    }),
  });
  assert.equal(result.results[0].result, 'refused');
  assert.equal(result.results[0].failureClass, 'identity_changed');
  assert.equal(result.results[0].mutationOutcome, 'not_started');
  assert.equal(inventoryLoads, 3);
  assert.equal(fenceCalls, 1);
  assert.equal(supervisorCalls, 0);
});

test('a named context endpoint change before supervision cannot redirect mutation', async () => {
  let namedEndpoint = 'unix:///run/original-docker.sock';
  let removed = false;
  const runCommand = (_engine, args) => {
    if (args.join(' ') === 'context show') return 'default\n';
    if (args[0] === 'context' && args[1] === 'inspect') return JSON.stringify({
      Name: 'default', Endpoints: { docker: { Host: namedEndpoint, SkipTLSVerify: false } },
      TLSMaterial: {},
    });
    const effectiveArgs = args[0] === '--host' ? args.slice(2) : args;
    assert.deepEqual(args.slice(0, 2), ['--host', 'unix:///run/original-docker.sock']);
    if (['version', 'info'].includes(effectiveArgs[0])) return '{}\n';
    if (effectiveArgs[0] === 'network' && effectiveArgs[1] === 'ls') return removed ? '' : `${ID}\n`;
    if (effectiveArgs[0] === 'container' && effectiveArgs[1] === 'ls') return '';
    throw new Error(`unexpected query: ${args.join(' ')}`);
  };
  const plan = approvedPlan(runCommand);
  const runtime = createCleanupDockerRuntime({
    plan, deploymentManifest, loadInventory: async () => inventory(plan),
    loadRegistrations: () => [], observationOptions: { runCommand },
    withRegistrationFence: async (_operationRunId, callback) => {
      namedEndpoint = 'unix:///run/attacker-controlled.sock';
      return callback();
    },
    supervisor: async (_engine, args) => {
      assert.deepEqual(args, ['--host', 'unix:///run/original-docker.sock', 'network', 'rm', ID]);
      removed = true;
      return { outcome: 'success', exitCode: 0, terminationSignal: null };
    },
  });
  let checkpoint = 0;
  const result = await runCleanupActions({
    actions: [action], reloadAuthority: runtime.reloadAuthority,
    mutate: runtime.mutate, reconcile: runtime.reconcile,
    appendCheckpoint: async () => ({
      checkpointDigest: canonicalSha256({ checkpoint: checkpoint++ }), signed: true, synced: true,
    }),
  });
  assert.equal(result.results[0].result, 'absent');
  assert.equal(removed, true);
});

test('an A-to-B-to-A context race cannot authorize mutation on the briefly pinned daemon', async () => {
  const approvedEndpoint = 'unix:///run/approved-docker.sock';
  const redirectedEndpoint = 'unix:///run/redirected-docker.sock';
  let namedEndpoint = approvedEndpoint;
  let inventoryLoads = 0;
  let supervisorCalls = 0;
  const runCommand = (_engine, args) => {
    if (args.join(' ') === 'context show') return 'default\n';
    if (args[0] === 'context' && args[1] === 'inspect') return JSON.stringify({
      Name: 'default', Endpoints: { docker: { Host: namedEndpoint, SkipTLSVerify: false } },
      TLSMaterial: {},
    });
    const effectiveArgs = args[0] === '--host' ? args.slice(2) : args;
    if (['version', 'info'].includes(effectiveArgs[0])) return '{}\n';
    throw new Error(`unexpected query: ${args.join(' ')}`);
  };
  const plan = approvedPlan(runCommand);
  namedEndpoint = redirectedEndpoint;
  assert.throws(() => createCleanupDockerRuntime({
    plan, deploymentManifest,
    loadInventory: async () => {
      inventoryLoads += 1;
      return inventory(plan);
    },
    loadRegistrations: () => [], observationOptions: { runCommand },
    withRegistrationFence: async (_operationRunId, callback) => callback(),
    supervisor: async () => {
      supervisorCalls += 1;
      return { outcome: 'success', exitCode: 0, terminationSignal: null };
    },
  }), /runtime Docker authority does not match approved cleanup context/);
  namedEndpoint = approvedEndpoint;
  assert.equal(inventoryLoads, 0);
  assert.equal(supervisorCalls, 0);
});
