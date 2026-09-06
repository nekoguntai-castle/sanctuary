#!/usr/bin/env node
import { constants as osConstants } from 'node:os';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isMainThread, parentPort, Worker, workerData,
} from 'node:worker_threads';
import { ciEnvFile } from '../ci/provider-context.mjs';
import { canonicalJson, parseStrictJson } from './canonical-json.mjs';
import {
  resumeCiCleanupEvidence,
} from './ci-cleanup-evidence.mjs';
import { projectUnboundCiCleanupEvidence } from './ci-cleanup-prebind-evidence.mjs';
import {
  bindSubjectManagedCiCleanupLifecycle, bindWitnessFallbackCiCleanupLifecycle, finishCiCleanupLifecycle,
  completeLegacyFixtureWitness, prepareCiCleanupLifecycle, resumeCiCleanupLifecycle,
} from './ci-cleanup-lifecycle.mjs';
import { coordinatorStatePath, readCoordinatorState } from './ci-cleanup-state.mjs';
import { ciCleanupProviderContext } from './ci-cleanup-trust.mjs';
import { cleanupProcessGroupHasRunnableMember } from './cleanup-supervisor.mjs';
import { registerLegacyFixtureResources } from './ci-legacy-fixture-witness.mjs';

const DEFAULT_SUBJECT_GRACE_MS = 5_000;
const DEFAULT_SUBJECT_KILL_WAIT_MS = 5_000;
const MAX_SUBJECT_WAIT_MS = 60_000;

function exactWithOptional(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request must be an object');
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !(key in value));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(`request requires ${required.join(', ')}; optional: ${optional.join(', ')}`);
  }
}

function requestFile(filePath) {
  return parseStrictJson(readFileSync(path.resolve(filePath)));
}

function cleanupStatus(receipt) {
  if (['no_op', 'cleaned', 'recovered'].includes(receipt.state)) return 0;
  if (['ambiguous', 'cancelled'].includes(receipt.state)) return 4;
  return 5;
}

function prepare(request) {
  exactWithOptional(request, ['checkoutRoot', 'runtimeDirectory', 'lane', 'artifactDirectory'], [
    'engine', 'subjectGraceMs', 'subjectKillWaitMs', 'authorityMode',
    'legacyFixtureCreationWitness', 'upgradeTargetCommit',
  ]);
  return prepareCiCleanupLifecycle(request);
}

function emitPreparedEnvironment(prepared) {
  const target = ciEnvFile();
  if (!target) return;
  const values = {
    ...prepared.environment, SANCTUARY_CLEANUP_STATE: prepared.path,
  };
  const lines = Object.entries(values).map(([key, value]) => {
    if (/\r|\n/.test(value)) throw new Error(`cleanup environment ${key} contains a newline`);
    return `${key}=${value}\n`;
  });
  appendFileSync(target, lines.join(''));
}

function assertFinishAuthority(statePath, request, state) {
  const live = ciCleanupProviderContext();
  const expectedStatePath = coordinatorStatePath(request.runtimeDirectory);
  const sameProvider = ['provider', 'runId', 'runAttempt', 'identityDigest']
    .every((key) => live[key] === state.authority[key]);
  if (path.resolve(statePath) !== path.resolve(expectedStatePath)
      || path.resolve(request.runtimeDirectory) !== state.authority.runtimeDirectory
      || path.resolve(request.checkoutRoot) !== state.authority.checkoutRoot
      || request.lane !== state.authority.lane
      || !sameProvider) {
    throw new Error('cleanup finish request does not match the current provider authority');
  }
}

function finishPrepared(prepared, request, subjectExitStatus, cleanupSuppression = null) {
  let state = readCoordinatorState(prepared.path, { checkoutRoot: request.checkoutRoot });
  assertFinishAuthority(prepared.path, request, state.state);
  state = completeLegacyFixtureWitness(state, prepared.path, request.checkoutRoot);
  if (cleanupSuppression === null && state.state.legacyFixtureWitnessDigest !== null) {
    try {
      if (state.state.phase === 'subject_ready') {
        state = bindWitnessFallbackCiCleanupLifecycle({
          statePath: prepared.path, checkoutRoot: request.checkoutRoot,
        });
      }
      registerLegacyFixtureResources({ state: state.state });
    } catch (error) {
      process.stderr.write(`ci-cleanup-coordinator: legacy fixture registration refused: ${error.message}\n`);
      cleanupSuppression = 'legacy_fixture_registration_failed';
    }
  }
  const prebind = state.state.authority.authorityMode === 'deployment_managed_by_subject'
    && state.state.deploymentManifestDigest === null
    && ['subject_ready', 'projected'].includes(state.state.phase);
  if (prebind) {
    const completed = projectUnboundCiCleanupEvidence({
      statePath: prepared.path, checkoutRoot: request.checkoutRoot,
      artifactDirectory: request.artifactDirectory, subjectExitStatus, cleanupSuppression,
    });
    return {
      statePath: prepared.path, subjectExitStatus,
      cleanupState: completed.privateReceipt.state,
      cleanupExitStatus: cleanupStatus(completed.privateReceipt),
      artifactDirectory: request.artifactDirectory,
      ...refusedResourceField(completed),
    };
  }
  if (['initialized', 'revision_prepared', 'deployment_active', 'deployment_bound', 'run_active']
    .includes(state.state.phase)) {
    resumeCiCleanupLifecycle({ statePath: prepared.path, checkoutRoot: request.checkoutRoot });
    state = readCoordinatorState(prepared.path, { checkoutRoot: request.checkoutRoot });
  }
  if (['trust_installed', 'subject_terminal', 'deployment_retired'].includes(state.state.phase)) {
    finishCiCleanupLifecycle({
      statePath: prepared.path, checkoutRoot: request.checkoutRoot,
      subjectExitStatus, cleanupSuppression,
    });
  }
  const completed = resumeCiCleanupEvidence({
    statePath: prepared.path, checkoutRoot: request.checkoutRoot,
    artifactDirectory: request.artifactDirectory, engine: request.engine,
    cancellationPath: request.cancellationPath,
  });
  return {
    statePath: prepared.path, subjectExitStatus,
    cleanupState: completed.privateReceipt.state,
    cleanupExitStatus: cleanupStatus(completed.privateReceipt),
    artifactDirectory: request.artifactDirectory,
    ...refusedResourceField(completed),
  };
}

// A refused cleanup uploads only counts and failure classes; the private
// receipt and inventory that name the resource stay on the runner. Name the
// refused resources in the job-log summary so a refusal on a host the operator
// cannot reach is diagnosable from the run alone (#1032). Locators here are CI
// resource names and engine identities, not secrets.
const REFUSED_RESOURCE_SUMMARY_LIMIT = 20;

export function refusedResourceField(completed) {
  const refusals = completed.privateReceipt?.refusals ?? [];
  if (refusals.length === 0) return {};
  return {
    refusedResources: refusedResourceSummary(refusals, completed.state.planningReceiptPath),
  };
}

export function refusedResourceSummary(refusals, planningReceiptPath) {
  let resources = [];
  try {
    const inventory = parseStrictJson(readFileSync(
      path.join(path.dirname(planningReceiptPath), 'inventory.json'),
    ));
    if (Array.isArray(inventory?.resources)) resources = inventory.resources;
  } catch {
    resources = [];
  }
  return refusals.slice(0, REFUSED_RESOURCE_SUMMARY_LIMIT).map((refusal) => {
    const resource = resources.find((entry) => (
      entry.resourceClass === refusal.resourceClass
      && entry.immutableIdentity === refusal.immutableIdentity
    ));
    return {
      resourceClass: refusal.resourceClass,
      immutableIdentity: refusal.immutableIdentity,
      failureClass: refusal.failureClass,
      locator: resource?.locator ?? null,
      ownershipState: resource?.ownershipState ?? null,
      classifications: resource?.classifications ?? [],
      references: (resource?.references ?? resource?.runtime?.references ?? []).slice(0, 8),
    };
  });
}

function signalExitStatus(signal) {
  const number = osConstants.signals[signal];
  return Number.isInteger(number) ? Math.min(255, 128 + number) : 1;
}

function publishCancellation(filePath, signal) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(filePath, `${signal}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function captureLifecycleSignals(cancellationPath) {
  let requestedSignal = null;
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => [
    signal, () => {
      requestedSignal ??= signal;
      publishCancellation(cancellationPath, requestedSignal);
    },
  ]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  return Object.freeze({
    requested: () => requestedSignal,
    close: () => {
      for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    },
  });
}

function yieldForPendingSignals() {
  return new Promise((resolve) => setImmediate(resolve));
}

function boundedWait(value, fallback, label) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > MAX_SUBJECT_WAIT_MS) {
    throw new Error(`${label} must be an integer from 1 through ${MAX_SUBJECT_WAIT_MS}`);
  }
  return selected;
}

function subjectSupervision(request) {
  return Object.freeze({
    graceMs: boundedWait(request.subjectGraceMs, DEFAULT_SUBJECT_GRACE_MS, 'subjectGraceMs'),
    killWaitMs: boundedWait(
      request.subjectKillWaitMs, DEFAULT_SUBJECT_KILL_WAIT_MS, 'subjectKillWaitMs',
    ),
  });
}

function subjectQuiescenceError(exitStatus, message) {
  return Object.assign(new Error(message), {
    exitCode: exitStatus === 0 ? 126 : exitStatus,
    cleanupSuppression: 'subject_quiescence_failed',
  });
}

function runSubject(command, args, environment, supervision) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...environment }, stdio: 'inherit', detached: process.platform !== 'win32',
    });
    let requestedSignal = null;
    let graceTimer = null;
    let killWaitTimer = null;
    let quiescenceTimer = null;
    let settled = false;
    const signalChild = (signal) => {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const clear = () => {
      if (graceTimer) clearTimeout(graceTimer);
      if (killWaitTimer) clearTimeout(killWaitTimer);
      if (quiescenceTimer) clearTimeout(quiescenceTimer);
      for (const [name, handler] of handlers) process.removeListener(name, handler);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clear();
      callback(value);
    };
    const processGroupAlive = () => {
      if (process.platform === 'win32' || !Number.isInteger(child.pid)) return false;
      if (process.platform === 'linux') return cleanupProcessGroupHasRunnableMember(child.pid);
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') return false;
        if (error.code === 'EPERM') return true;
        throw error;
      }
    };
    const settleWhenQuiescent = (deadline = null, failure = null) => {
      if (settled) return;
      try {
        if (!processGroupAlive()) {
          if (failure) settle(reject, failure);
          else settle(resolve, signalExitStatus(requestedSignal));
          return;
        }
        if (deadline !== null && Date.now() >= deadline) {
          child.unref();
          settle(reject, Object.assign(
            new Error('subject process group did not quiesce after bounded SIGKILL wait'),
            {
              exitCode: signalExitStatus(requestedSignal),
              cleanupSuppression: 'subject_quiescence_failed',
            },
          ));
          return;
        }
        quiescenceTimer = setTimeout(() => settleWhenQuiescent(deadline, failure), 10);
      } catch (error) { settle(reject, error); }
    };
    const suppressCleanupAfterOrdinaryExit = (exitStatus) => {
      const failure = subjectQuiescenceError(
        exitStatus,
        'subject leader exited while its process group remained runnable',
      );
      try {
        signalChild('SIGTERM');
        graceTimer = setTimeout(() => {
          try {
            signalChild('SIGKILL');
            settleWhenQuiescent(Date.now() + supervision.killWaitMs, failure);
          } catch (error) { settle(reject, error); }
        }, supervision.graceMs);
      } catch (error) { settle(reject, error); }
    };
    const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => [
      signal, () => {
        if (requestedSignal !== null || settled) return;
        requestedSignal = signal;
        try {
          signalChild('SIGTERM');
          graceTimer = setTimeout(() => {
            try {
              signalChild('SIGKILL');
              const deadline = Date.now() + supervision.killWaitMs;
              killWaitTimer = setTimeout(() => settleWhenQuiescent(deadline), 0);
            } catch (error) { settle(reject, error); }
          }, supervision.graceMs);
        } catch (error) { settle(reject, error); }
      },
    ]));
    for (const [signal, handler] of handlers) process.on(signal, handler);
    child.once('error', (error) => settle(reject, error));
    child.once('exit', (code, signal) => {
      if (requestedSignal !== null) {
        settleWhenQuiescent();
        return;
      }
      const exitStatus = code ?? signalExitStatus(signal);
      try {
        if (processGroupAlive()) suppressCleanupAfterOrdinaryExit(exitStatus);
        else settle(resolve, exitStatus);
      } catch (error) { settle(reject, error); }
    });
  });
}

function subjectFailureStatus(error) {
  if (Number.isInteger(error.exitCode) && error.exitCode > 0 && error.exitCode <= 255) {
    return error.exitCode;
  }
  return error.code === 'ENOENT' ? 127 : 126;
}

function cleanupFailureResult(prepared, request, subjectExitStatus, error) {
  const cleanupExitStatus = Number.isInteger(error.exitCode)
    && error.exitCode > 0 && error.exitCode <= 255 ? error.exitCode : 2;
  return {
    statePath: prepared.path, subjectExitStatus,
    cleanupState: 'coordinator_failed', cleanupExitStatus,
    cleanupErrorClass: typeof error.code === 'string' ? error.code : error.name,
    artifactDirectory: request.artifactDirectory,
  };
}

function finishOutcome(prepared, request, subjectExitStatus, cleanupSuppression = null) {
  try {
    return finishPrepared(prepared, request, subjectExitStatus, cleanupSuppression);
  } catch (error) {
    process.stderr.write(
      `ci-cleanup-coordinator: cleanup failed after subject ${subjectExitStatus}: ${error.message}\n`,
    );
    return cleanupFailureResult(prepared, request, subjectExitStatus, error);
  }
}

function finishOutcomeAsync(prepared, request, subjectExitStatus, cleanupSuppression = null) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: {
        task: 'finish-outcome', prepared: { path: prepared.path }, request,
        subjectExitStatus, cleanupSuppression,
      },
    });
    let completed = false;
    worker.once('message', (message) => {
      completed = true;
      resolve(message);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (!completed) reject(new Error(`cleanup finalizer worker exited before reporting (${code})`));
    });
  });
}

async function runCommand(request, command) {
  const cancellationPath = path.join(
    path.resolve(request.runtimeDirectory), 'coordinator', 'cancellation-signal',
  );
  const lifecycleSignals = captureLifecycleSignals(cancellationPath);
  try {
    const prepared = prepare(request);
    let subjectExitStatus;
    let cleanupSuppression = null;
    await yieldForPendingSignals();
    const prepareSignal = lifecycleSignals.requested();
    if (prepareSignal !== null) publishCancellation(cancellationPath, prepareSignal);
    if (prepareSignal !== null) {
      subjectExitStatus = signalExitStatus(prepareSignal);
    } else {
      try {
        subjectExitStatus = await runSubject(
          command[0], command.slice(1), prepared.environment, subjectSupervision(request),
        );
      } catch (error) {
        subjectExitStatus = subjectFailureStatus(error);
        cleanupSuppression = error.cleanupSuppression ?? null;
        process.stderr.write(`ci-cleanup-coordinator: subject launch/supervision failed: ${error.message}\n`);
      }
    }
    const result = await finishOutcomeAsync(
      prepared, { ...request, cancellationPath }, subjectExitStatus, cleanupSuppression,
    );
    await yieldForPendingSignals();
    const finalSignal = lifecycleSignals.requested();
    return {
      exitStatus: subjectExitStatus !== 0
        ? subjectExitStatus
        : (finalSignal === null ? result.cleanupExitStatus : signalExitStatus(finalSignal)),
      result,
    };
  } finally {
    lifecycleSignals.close();
  }
}

export async function run(argv) {
  const [command, requestPath, separator, ...subject] = argv;
  if (!requestPath) throw new Error('usage: ci-cleanup-coordinator.mjs prepare|finish|recover|run REQUEST.json');
  if (command === 'bind') {
    const bound = bindSubjectManagedCiCleanupLifecycle({
      statePath: requestPath,
      checkoutRoot: process.env.SANCTUARY_PROJECT_DIR,
      lockToken: process.env.SANCTUARY_DEPLOYMENT_LOCK_TOKEN,
    });
    process.stdout.write(canonicalJson({
      statePath: bound.path, generation: bound.state.generation,
      deploymentManifestDigest: bound.state.deploymentManifestDigest,
    }));
    return;
  }
  const request = requestFile(requestPath);
  if (command === 'prepare') {
    const prepared = prepare(request);
    emitPreparedEnvironment(prepared);
    process.stdout.write(canonicalJson({
      statePath: prepared.path, environment: prepared.environment,
    }));
    return;
  }
  if (command === 'finish' || command === 'recover') {
    exactWithOptional(request, [
      'checkoutRoot', 'runtimeDirectory', 'lane', 'artifactDirectory',
      'statePath', 'subjectExitStatus',
    ], ['engine', 'authorityMode']);
    const result = finishOutcome({ path: request.statePath }, request, request.subjectExitStatus);
    process.stdout.write(canonicalJson(result));
    process.exitCode = request.subjectExitStatus === 0
      ? result.cleanupExitStatus : request.subjectExitStatus;
    return;
  }
  if (command !== 'run' || separator !== '--' || subject.length === 0) {
    throw new Error('usage: ci-cleanup-coordinator.mjs run REQUEST.json -- COMMAND [ARG...]');
  }
  const outcome = await runCommand(request, subject);
  if (outcome.result) process.stdout.write(canonicalJson(outcome.result));
  process.exitCode = outcome.exitStatus;
}

if (!isMainThread && workerData?.task === 'finish-outcome') {
  const result = finishOutcome(
    workerData.prepared, workerData.request,
    workerData.subjectExitStatus, workerData.cleanupSuppression,
  );
  parentPort.postMessage(result);
} else if (isMainThread && process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`ci-cleanup-coordinator: ${error.message}\n`);
    process.exitCode = Number.isInteger(error.exitCode) ? error.exitCode : 2;
  });
}
