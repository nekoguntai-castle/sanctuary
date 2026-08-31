#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, parseStrictJson } from './canonical-json.mjs';
import { composeArguments, diagnoseLegacyDeployment, resolveDeploymentDefinition } from './deployment-definition.mjs';
import {
  acquireDeploymentLock, heartbeatDeploymentLock, inspectDeploymentLock, recoverStaleDeploymentLock, releaseDeploymentLock,
} from './deployment-lock.mjs';
import { DeploymentStore } from './deployment-store.mjs';
import { assertLegacyUpgradePostconditions } from './legacy-docker-inspection.mjs';

const EXIT = Object.freeze({ invalid: 2, conflict: 3, ambiguous: 4, runtime: 5 });

function usage() {
  throw new Error('usage: deployment-cli.mjs COMMAND REQUEST.json');
}

function requestFile(args) {
  if (args.length !== 1) usage();
  const bytes = readFileSync(path.resolve(args[0]));
  return parseStrictJson(bytes);
}

function exact(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`request must contain exactly: ${expected.join(', ')}`);
  }
}

function exactWithOptional(value, required, optional) {
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !(key in value));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(`request requires ${required.join(', ')}; optional: ${optional.join(', ')}`);
  }
}

function output(value) { process.stdout.write(canonicalJson(value)); }

function storeFrom(request) {
  return new DeploymentStore({ runtimeDirectory: request.runtimeDirectory, deploymentId: request.deploymentId });
}

function resolveCommand(request) {
  exact(request, ['definitionOptions']);
  const { definition } = resolveDeploymentDefinition(request.definitionOptions);
  output(definition);
}

function diagnoseCommand(request) {
  exact(request, ['projectDirectory', 'definitionOptions']);
  output(diagnoseLegacyDeployment(request.projectDirectory, request.definitionOptions));
}

function lockAcquireCommand(request) {
  const required = ['runtimeDirectory', 'deploymentId', 'operationRunId', 'journalPath', 'generation'];
  exactWithOptional(request, required, ['controllerPid']);
  const store = storeFrom(request);
  const fromEnvironment = process.env.SANCTUARY_LOCK_CONTROLLER_PID;
  const controllerPid = request.controllerPid ?? (fromEnvironment === undefined ? process.ppid : Number(fromEnvironment));
  const owner = acquireDeploymentLock(store.lockPath, { ...request, controllerPid });
  output(owner);
}

function lockInspectCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId']);
  output(inspectDeploymentLock(storeFrom(request).lockPath));
}

function lockReleaseCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'operationRunId', 'lockToken']);
  releaseDeploymentLock(storeFrom(request).lockPath, request.lockToken, request.operationRunId);
  output({ released: true });
}

function lockHeartbeatCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'operationRunId', 'lockToken', 'journalPath', 'generation']);
  output(heartbeatDeploymentLock(storeFrom(request).lockPath, request.lockToken, request.operationRunId, request));
}

function lockRecoverCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'expectedOwnerDigest']);
  recoverStaleDeploymentLock(storeFrom(request).lockPath, request.expectedOwnerDigest);
  output({ recovered: true });
}

function prepareCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'identity', 'operationRunId', 'lockToken', 'expectedActiveDigest', 'definitionOptions']);
  const store = storeFrom(request);
  store.initialize(request.identity);
  const bundle = resolveDeploymentDefinition(request.definitionOptions);
  output(store.prepareRevision({ bundle, operationRunId: request.operationRunId, lockToken: request.lockToken, expectedActiveDigest: request.expectedActiveDigest }));
}

function transitionCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'operationRunId', 'lockToken', 'expectedPendingDigest', 'nextStage']);
  output(storeFrom(request).transitionPending(request));
}

function activateCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'operationRunId', 'lockToken', 'expectedPendingDigest']);
  output(storeFrom(request).activateRevision(request));
}

function finalizePreparedCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'operationRunId', 'lockToken', 'expectedPendingDigest']);
  output(storeFrom(request).finalizePreparedRevision(request));
}

function beginRollbackCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'operationRunId', 'lockToken', 'expectedActiveDigest', 'targetGeneration']);
  output(storeFrom(request).beginRollback(request));
}

function completeRollbackCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'operationRunId', 'lockToken', 'expectedPendingDigest']);
  const store = storeFrom(request);
  const pending = store.inspect().pending;
  if (!pending || pending.digest !== request.expectedPendingDigest || pending.value.mode !== 'rollback') {
    throw new Error('pending rollback compare-and-swap failed');
  }
  const revision = store.readManifest(pending.value.generation, { verifySnapshots: true });
  assertLegacyUpgradePostconditions({
    definition: revision.manifest,
    composeArgs: composeArguments(revision.manifest, { snapshotRoot: revision.revisionRoot }),
    deploymentId: revision.manifest.deploymentId,
    ownerId: revision.manifest.ownerId,
    projectLabel: revision.manifest.composeProjectName,
    legacyResources: revision.manifest.legacyResources,
  });
  output(store.completeRollback(request));
}

function inspectCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId']);
  output(storeFrom(request).inspect());
}

function composeArgsCommand(request) {
  exact(request, ['runtimeDirectory', 'deploymentId', 'generation']);
  const store = storeFrom(request);
  const revision = store.readManifest(request.generation, { verifySnapshots: true });
  const args = composeArguments(revision.manifest, { snapshotRoot: revision.revisionRoot });
  process.stdout.write(Buffer.from(`${args.join('\0')}\0`));
}

const COMMANDS = new Map([
  ['resolve', resolveCommand], ['diagnose-legacy', diagnoseCommand],
  ['lock-acquire', lockAcquireCommand], ['lock-inspect', lockInspectCommand],
  ['lock-release', lockReleaseCommand], ['lock-heartbeat', lockHeartbeatCommand], ['lock-recover', lockRecoverCommand],
  ['prepare', prepareCommand], ['transition', transitionCommand], ['activate', activateCommand],
  ['finalize-prepared', finalizePreparedCommand],
  ['begin-rollback', beginRollbackCommand], ['complete-rollback', completeRollbackCommand],
  ['inspect', inspectCommand], ['compose-args', composeArgsCommand],
]);

export function runDeploymentCli(argv) {
  const [command, ...args] = argv;
  const handler = COMMANDS.get(command);
  if (!handler) usage();
  handler(requestFile(args));
}

function exitCode(error) {
  if (error.code === 'DEPLOYMENT_LOCK_CONFLICT' || /compare-and-swap|collision|already pending/.test(error.message)) return EXIT.conflict;
  if (/ambiguous|liveness/.test(error.message)) return EXIT.ambiguous;
  if (/invalid|must |usage:|not found|does not exist|unsafe|literal secret/.test(error.message)) return EXIT.invalid;
  return EXIT.runtime;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runDeploymentCli(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`deployment-cli: ${error.message}\n`);
    process.exitCode = exitCode(error);
  }
}
