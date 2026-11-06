import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { canonicalSha256 } from '../../ownership/canonical-json.mjs';
import { coordinatorStatePath, readCoordinatorState } from '../../ownership/ci-cleanup-state.mjs';
import { registerResource } from '../../ownership/registration.mjs';
import { runCleanupCommand } from '../../ownership/cleanup-command.mjs';
import { resolveDockerDaemonContext } from '../../ownership/cleanup-execution-context.mjs';
import { formatBrowserError } from '../../lib/browser-sandbox-contract.mjs';

export const RUNNER_OWNED_LABEL = 'com.example.sanctuary.sandboxed-playwright';

const OWNERSHIP_LABELS = Object.freeze({
  project: 'io.sanctuary.project',
  deploymentId: 'io.sanctuary.deployment-id',
  ownerId: 'io.sanctuary.owner-id',
  resourceClass: 'io.sanctuary.resource-class',
  lifecycle: 'io.sanctuary.lifecycle',
  cleanupPolicy: 'io.sanctuary.cleanup-policy',
  createdAt: 'io.sanctuary.created-at',
  createdByRelease: 'io.sanctuary.created-by-release',
  createdByCommit: 'io.sanctuary.created-by-commit',
  operationRunId: 'io.sanctuary.creation-run-id',
});

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function loadBrowserContainerOwnership(
  env, readState = readCoordinatorState, resolveEngineContext = resolveDockerDaemonContext,
) {
  if (env.SANCTUARY_CLEANUP_COORDINATED !== '1') {
    throw new Error('browser container creation requires a coordinated cleanup context');
  }
  if (env.SANCTUARY_CLEANUP_ENGINE !== 'docker') {
    throw new Error('browser container recovery requires coordinator-selected Docker inventory');
  }
  const checkoutRoot = requiredAbsolute(env.SANCTUARY_PROJECT_DIR, 'checkout root');
  const statePath = requiredAbsolute(env.SANCTUARY_CLEANUP_STATE, 'cleanup state');
  const state = readState(statePath, { checkoutRoot });
  const dockerAuthority = resolveEngineContext({
    engine: 'docker',
    runCommand: (engine, args, { operation }) => runCleanupCommand(engine, args, { operation, env }),
  });
  const engineEndpoint = dockerAuthority?.engineGlobalArgs?.[1];
  return browserContainerOwnershipFromState(env, state.state, { checkoutRoot, statePath, engineEndpoint });
}

export function browserContainerOwnershipFromState(env, state, { checkoutRoot, statePath, engineEndpoint } = {}) {
  const authority = coordinatorAuthority(state);
  const runtimeDirectory = authority.runtimeDirectory;
  const expected = expectedBrowserOwnership(state, authority);
  assertLocalDockerEndpoint(engineEndpoint);
  assertCoordinatorOwnershipPaths(env, authority, runtimeDirectory, checkoutRoot, statePath);
  assertOwnershipEnvironment(env, expected);
  return Object.freeze({
    ...expected,
    checkoutRoot: authority.checkoutRoot,
    runtimeDirectory,
    ownershipRoot: path.join(runtimeDirectory, 'ownership'),
    statePath,
    engineEndpoint,
    lifecycle: 'obsolete',
    cleanupPolicy: 'exact_delete',
  });
}

function coordinatorAuthority(state) {
  const authority = state?.authority;
  if (state?.phase !== 'trust_installed' || authority?.authorityMode !== 'coordinator_managed') {
    throw new Error('browser container creation requires an active coordinator-managed cleanup run');
  }
  return authority;
}

function expectedBrowserOwnership(state, authority) {
  const expected = {
    project: authority.composeProjectName,
    deploymentId: authority.deploymentId,
    ownerId: authority.ownerId,
    operationRunId: authority.operationRunId,
    createdAt: state.resourceCreatedAt,
    createdByRelease: 'unreleased',
    createdByCommit: authority.checkoutCommit,
  };
  validateExpectedOwnership(expected);
  return expected;
}

function assertLocalDockerEndpoint(engineEndpoint) {
  if (typeof engineEndpoint !== 'string' || !/^unix:\/\/\/.+/.test(engineEndpoint)) {
    throw new Error('coordinator-resolved Docker endpoint must be a canonical local Unix socket');
  }
}

function assertCoordinatorOwnershipPaths(env, authority, runtimeDirectory, checkoutRoot, statePath) {
  const pathsMatch = path.isAbsolute(runtimeDirectory ?? '')
    && path.resolve(runtimeDirectory) === runtimeDirectory
    && path.resolve(checkoutRoot ?? '') === authority.checkoutRoot
    && statePath === coordinatorStatePath(runtimeDirectory)
    && path.resolve(env.SANCTUARY_OWNERSHIP_ROOT ?? '') === path.join(runtimeDirectory, 'ownership')
    && env.SANCTUARY_CLEANUP_STATE === statePath;
  if (!pathsMatch) throw new Error('browser ownership context paths do not match the cleanup coordinator state');
}

function assertOwnershipEnvironment(env, expected) {
  const envValues = {
    project: env.SANCTUARY_PROJECT,
    deploymentId: env.SANCTUARY_DEPLOYMENT_ID,
    ownerId: env.SANCTUARY_OWNER_ID,
    operationRunId: env.SANCTUARY_OPERATION_RUN_ID,
    createdAt: env.SANCTUARY_CLEANUP_CREATED_AT,
    createdByRelease: env.SANCTUARY_RELEASE,
    createdByCommit: env.SANCTUARY_COMMIT,
  };
  const valuesMatch = Object.keys(expected).every(key => envValues[key] === expected[key]);
  if (!valuesMatch || env.SANCTUARY_RESOURCE_LIFECYCLE !== 'obsolete') {
    throw new Error('browser ownership environment does not match the cleanup coordinator authority');
  }
}

export function browserContainerOwnershipLabels(ownership) {
  return Object.freeze({
    [OWNERSHIP_LABELS.project]: ownership.project,
    [OWNERSHIP_LABELS.deploymentId]: ownership.deploymentId,
    [OWNERSHIP_LABELS.ownerId]: ownership.ownerId,
    [OWNERSHIP_LABELS.resourceClass]: 'compose_container',
    [OWNERSHIP_LABELS.lifecycle]: ownership.lifecycle,
    [OWNERSHIP_LABELS.cleanupPolicy]: ownership.cleanupPolicy,
    [OWNERSHIP_LABELS.createdAt]: ownership.createdAt,
    [OWNERSHIP_LABELS.createdByRelease]: ownership.createdByRelease,
    [OWNERSHIP_LABELS.createdByCommit]: ownership.createdByCommit,
    [OWNERSHIP_LABELS.operationRunId]: ownership.operationRunId,
  });
}

export function assertBrowserContainerOwnership(inspect, ownership, { id, name } = {}) {
  if (!/^[a-f0-9]{64}$/.test(inspect?.Id ?? '')
      || (id !== undefined && inspect.Id !== id)
      || (name !== undefined && inspect.Name !== `/${name}`)) {
    throw new Error('browser container immutable ID or exact name does not match its registered owner');
  }
  const labels = inspect?.Config?.Labels;
  const expected = browserContainerOwnershipLabels(ownership);
  if (!labels || Object.entries(expected).some(([key, value]) => labels[key] !== value)) {
    throw new Error('browser container ownership labels do not match the cleanup coordinator');
  }
  return inspect.Id;
}

export function assertOwnedBrowserContainer(context, inspect) {
  assertBrowserContainerOwnership(inspect, context.ownership, { id: context.containerId, name: context.name });
  const labels = inspect?.Config?.Labels;
  if (labels?.[RUNNER_OWNED_LABEL] !== 'v1' || labels?.['com.example.sanctuary.run-id'] !== context.runId) {
    throw new Error('browser container wrapper ownership labels do not match this run');
  }
  return inspect.Id;
}

export async function recoverBrowserContainerId(context, api, cause) {
  try {
    const recovered = await api(context.socket, 'GET', `/v1.41/containers/${context.name}/json`);
    const recoveredId = assertBrowserContainerOwnership(recovered, context.ownership, { name: context.name });
    const labels = recovered?.Config?.Labels;
    if (labels?.[RUNNER_OWNED_LABEL] !== 'v1'
        || labels?.['com.example.sanctuary.run-id'] !== context.runId) {
      throw new Error('exact-name browser sibling recovery found mismatched run labels');
    }
    return recoveredId;
  } catch (error) {
    if (/returned 404/.test(formatBrowserError(error))) throw cause;
    throw new AggregateError([cause, error], 'container create failed and exact-name recovery lookup failed');
  }
}

export function registerBrowserContainer(ownership, id, register = registerResource) {
  if (!/^[a-f0-9]{64}$/.test(id ?? '')) throw new Error('browser container registration requires a full immutable engine ID');
  const locator = id;
  return register({
    deploymentId: ownership.deploymentId,
    operationRunId: ownership.operationRunId,
    ownerId: ownership.ownerId,
    resourceClass: 'compose_container',
    lifecycle: ownership.lifecycle,
    cleanupPolicy: ownership.cleanupPolicy,
    createdAt: ownership.createdAt,
    createdByRelease: ownership.createdByRelease,
    createdByCommit: ownership.createdByCommit,
    locatorKind: 'engine_id',
    locator,
    immutableIdentity: id,
    metadataDigest: canonicalSha256({ kind: 'engine_id', locator }),
  }, { root: ownership.ownershipRoot, checkoutRoot: ownership.checkoutRoot });
}

export async function registerAndReinspectBrowserContainer(context, api, register, assertBrowserChild) {
  register(context.ownership, context.containerId);
  const reinspection = await api(context.socket, 'GET', `/v1.41/containers/${context.containerId}/json`);
  assertOwnedBrowserContainer(context, reinspection);
  assertBrowserChild(reinspection, {
    profile: context.profilePath, outerId: context.outerId, imageId: context.image.id,
  });
}

export async function retireBrowserContainer(context, { api, command, assertBrowserChild }) {
  if (!context.containerId) return null;
  const verification = await verifyRetirementOwnership(context, api, assertBrowserChild);
  let failure = verification.failure;
  if (!verification.alreadyAbsent && verification.ownershipVerified) {
    failure = await retireVerifiedContainer(context, { api, command }, failure);
  }
  return finishAttachedServer(context, command, failure, verification.ownershipVerified);
}

async function verifyRetirementOwnership(context, api, assertBrowserChild) {
  try {
    const inspected = await api(context.socket, 'GET', `/v1.41/containers/${context.containerId}/json`);
    assertOwnedBrowserContainer(context, inspected);
    return { ownershipVerified: true, failure: childPolicyFailure(inspected, context, assertBrowserChild) };
  } catch (error) {
    if (/returned 404/.test(formatBrowserError(error))) return { alreadyAbsent: true, ownershipVerified: false };
    return {
      alreadyAbsent: false,
      ownershipVerified: false,
      failure: new Error(`browser container ownership could not be reverified before retirement: ${formatBrowserError(error)}`, { cause: error }),
    };
  }
}

function childPolicyFailure(inspected, context, assertBrowserChild) {
  try {
    assertBrowserChild(inspected, {
      profile: context.profilePath, outerId: context.outerId, imageId: context.image.id,
    });
    return undefined;
  } catch (error) {
    return new Error(`browser container policy changed before retirement: ${formatBrowserError(error)}`, { cause: error });
  }
}

async function retireVerifiedContainer(context, { api, command }, initialFailure) {
  let failure = await retrieveBrowserArtifacts(context, command, initialFailure);
  failure = await stopBrowserContainer(context, command, failure);
  failure = await removeBrowserContainer(context, command, failure);
  return confirmBrowserContainerAbsent(context, api, failure);
}

async function retrieveBrowserArtifacts(context, command, failure) {
  try {
    const artifactPath = path.join(context.reportDirectory, 'browser-server-artifacts');
    await mkdir(artifactPath, { recursive: true });
    await command(context.socket, ['cp', `${context.containerId}:/home/pwuser/browser-server-artifacts/.`, artifactPath]);
  } catch (error) {
    return combineErrors(failure, new Error(`could not retrieve browser diagnostics/artifacts: ${formatBrowserError(error)}`, { cause: error }), 'browser artifact retrieval failed');
  }
  return failure;
}

async function stopBrowserContainer(context, command, failure) {
  try { await command(context.socket, ['stop', '--time', '5', context.containerId], { timeoutMs: 15_000 }); }
  catch (error) {
    if (!/is not running|No such container/i.test(formatBrowserError(error))) {
      return combineErrors(failure, error, 'browser container stop failed');
    }
  }
  return failure;
}

async function removeBrowserContainer(context, command, failure) {
  try { await command(context.socket, ['rm', '--force', context.containerId], { timeoutMs: 15_000 }); }
  catch (error) { return combineErrors(failure, error, 'browser container force removal failed'); }
  return failure;
}

async function confirmBrowserContainerAbsent(context, api, failure) {
  try {
    const inspect = await api(context.socket, 'GET', `/v1.41/containers/${context.containerId}/json`);
    assertOwnedBrowserContainer(context, inspect);
    const detail = failure ? `; previous cleanup error: ${formatBrowserError(failure)}` : '';
    return new Error(`browser container remained present after exact-ID removal${detail}`);
  } catch (error) {
    if (/returned 404/.test(formatBrowserError(error))) return failure;
    return combineErrors(failure, error, 'browser container absence could not be confirmed');
  }
}

async function finishAttachedServer(context, command, failure, ownershipVerified) {
  if (context.attachPromise) {
    try { await waitBounded(context.attachPromise, 5_000, 'attached browser server'); }
    catch (error) {
      context.attachPromise.cancel?.();
      failure = combineErrors(failure, error, 'attached browser server did not exit after removal');
      if (ownershipVerified) {
        try { await command(context.socket, ['rm', '--force', context.containerId], { timeoutMs: 10_000 }); }
        catch (removeError) { failure = combineErrors(failure, removeError, 'browser container retry removal failed'); }
      }
    }
  }
  return failure;
}

function combineErrors(previous, next, message) {
  return previous ? new AggregateError([previous, next], message) : next;
}

async function waitBounded(promise, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${label} did not exit within ${timeoutMs}ms`)), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function validateExpectedOwnership(value) {
  for (const key of ['project', 'deploymentId', 'ownerId', 'operationRunId']) {
    if (!IDENTIFIER.test(value[key] ?? '')) throw new Error(`cleanup authority ${key} is missing or invalid`);
  }
  if (value.createdByRelease !== 'unreleased' || !COMMIT.test(value.createdByCommit ?? '')
      || !TIMESTAMP.test(value.createdAt ?? '') || Number.isNaN(Date.parse(value.createdAt))) {
    throw new Error('cleanup authority release, commit, or creation timestamp is invalid');
  }
}

function requiredAbsolute(value, label) {
  if (!path.isAbsolute(value ?? '') || path.resolve(value) !== value) {
    throw new Error(`coordinated browser cleanup ${label} must be an absolute canonical path`);
  }
  return value;
}
