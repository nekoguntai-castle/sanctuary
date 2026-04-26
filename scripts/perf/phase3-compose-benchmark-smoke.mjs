#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBenchmarkHarness } from './phase3-compose/benchmark-harness.mjs';
import { createComposeRuntime } from './phase3-compose/compose-runtime.mjs';
import { getErrorMessage } from './phase3-compose/common.mjs';
import { readPhase3ComposeBenchmarkConfig } from './phase3-compose/config.mjs';
import { createProofRunners } from './phase3-compose/proofs.mjs';
import { buildMarkdown } from './phase3-compose/report.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

async function findAvailablePort(startPort) {
  let lastProbeError = null;
  for (let port = startPort; port < startPort + 100; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const probe = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (error) => resolve({ available: false, error }));
      server.once('listening', () => {
        server.close(() => resolve({ available: true, error: null }));
      });
      server.listen(port, '127.0.0.1');
    });

    if (probe.available) {
      return port;
    }

    lastProbeError = probe.error;
    if (probe.error?.code === 'EPERM' || probe.error?.code === 'EACCES') {
      throw new Error(
        `Could not probe loopback port ${port}: ${probe.error.code}. ` +
          'Set PHASE3_COMPOSE_BENCHMARK_HTTP_PORT, PHASE3_COMPOSE_BENCHMARK_HTTPS_PORT, ' +
          'and PHASE3_COMPOSE_BENCHMARK_GATEWAY_PORT explicitly in restricted environments.'
      );
    }
  }

  const reason = lastProbeError?.code ? `; last probe error=${lastProbeError.code}` : '';
  throw new Error(`Could not find an available loopback port starting at ${startPort}${reason}`);
}

const config = await readPhase3ComposeBenchmarkConfig({
  repoRoot,
  startedAt: new Date(),
  findAvailablePort,
});

const {
  outputDir,
  startedAt,
  timestamp,
  projectName,
  keepStack,
  timeoutMs,
  retryMs,
  workerQueueProofTimeoutMs,
  workerQueueProofRepeats,
  workerScaleOutReplicas,
  workerScaleOutProofTimeoutMs,
  workerScaleOutJobCount,
  workerScaleOutJobDelayMs,
  backendScaleOutReplicas,
  backendScaleOutProofTimeoutMs,
  backendScaleOutWsClients,
  largeWalletTransactionCount,
  largeWalletHistoryRequests,
  largeWalletHistoryConcurrency,
  largeWalletHistoryPageSize,
  largeWalletHistoryP95BudgetMs,
  sizedBackupRestoreProofEnabled,
  capacitySnapshotsEnabled,
  postgresUser,
  postgresDb,
  adminUsername,
  adminPassword,
  httpPort,
  httpsPort,
  gatewayPort,
  apiUrl,
  gatewayUrl,
  wsUrl,
  composeArgs,
  sslDir,
  ownsSslDir,
  composeEnv,
  benchmarkEnv,
} = config;

const steps = [];

function redactSensitiveText(value) {
  const text = String(value ?? '');
  if (!adminPassword) {
    return text;
  }

  return text.split(adminPassword).join('[redacted:benchmark-password]');
}

function recordStep(name, passed, summary, extra = {}) {
  const safeSummary = redactSensitiveText(summary);
  const step = {
    name,
    passed,
    summary: safeSummary,
    ...extra,
  };
  steps.push(step);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${safeSummary}`); // lgtm[js/clear-text-logging]
  return step;
}

const runtime = createComposeRuntime({
  repoRoot,
  composeArgs,
  composeEnv,
  sslDir,
  timeoutMs,
  retryMs,
  redactSensitiveText,
});

const {
  runDocker,
  ensureComposeSslCertificates,
  runCompose,
  collectComposePs,
  getServiceContainers,
  waitForMigrateExit,
  waitForComposeHealthy,
  waitForServiceReplicaHealth,
  waitForHttpOk,
} = runtime;

const benchmarkHarness = createBenchmarkHarness({
  repoRoot,
  benchmarkEnv,
  redactSensitiveText,
});

const {
  runBenchmarkHarness,
  readBenchmarkEvidence,
} = benchmarkHarness;

function relativePath(targetPath) {
  return path.relative(repoRoot, targetPath);
}

function readCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

const proofRunners = createProofRunners({
  timestamp,
  apiUrl,
  timeoutMs,
  adminUsername,
  adminPassword,
  largeWalletTransactionCount,
  largeWalletHistoryRequests,
  largeWalletHistoryConcurrency,
  largeWalletHistoryPageSize,
  largeWalletHistoryP95BudgetMs,
  workerQueueProofTimeoutMs,
  workerQueueProofRepeats,
  workerScaleOutReplicas,
  workerScaleOutProofTimeoutMs,
  workerScaleOutJobCount,
  workerScaleOutJobDelayMs,
  backendScaleOutReplicas,
  backendScaleOutProofTimeoutMs,
  backendScaleOutWsClients,
  sslDir,
  postgresUser,
  postgresDb,
  runCompose,
  runDocker,
  waitForServiceReplicaHealth,
  getServiceContainers,
});

const {
  assertBenchmarkProof,
  collectCapacitySnapshot,
  runBackendScaleOutProof,
  runLargeWalletTransactionHistoryProof,
  runSizedBackupRestoreProof,
  runWorkerQueueProof,
  runWorkerScaleOutProof,
  summarizeBackendScaleOutProof,
  summarizeCapacitySnapshot,
  summarizeLargeWalletTransactionHistoryProof,
  summarizeSizedBackupRestoreProof,
  summarizeWorkerQueueProof,
  summarizeWorkerScaleOutProof,
} = proofRunners;

let composePs = [];
let benchmarkRun = null;
let benchmarkEvidence = null;
let benchmarkProof = null;
let largeWalletHistoryProof = null;
let workerQueueProof = null;
let workerScaleOutProof = null;
let backendScaleOutProof = null;
let sizedBackupRestoreProof = null;
const capacitySnapshots = [];
let passed = false;
let failureError = null;

try {
  ensureComposeSslCertificates();
  recordStep('compose ssl certificates', true, `SANCTUARY_SSL_DIR=${sslDir}`);

  runCompose(['up', '-d', '--build', 'frontend', 'gateway', 'migrate']);
  recordStep('compose stack started', true, `project=${projectName} apiPort=${httpsPort} gatewayPort=${gatewayPort}`);

  const migrationState = await waitForMigrateExit();
  recordStep('database migration and seed', true, `migrate exited with ${migrationState.ExitCode}`);

  composePs = await waitForComposeHealthy();
  recordStep('compose container health', true, `${composePs.length} service containers running and healthy`);

  if (capacitySnapshotsEnabled) {
    const baselineCapacity = collectCapacitySnapshot('baseline-after-health');
    capacitySnapshots.push(baselineCapacity);
    recordStep('capacity baseline snapshot', true, summarizeCapacitySnapshot(baselineCapacity));
  }

  const frontendHealth = await waitForHttpOk('frontend health', `${apiUrl}/health`);
  recordStep('frontend health', true, `status=${frontendHealth.status}`);

  const gatewayHealth = await waitForHttpOk('gateway health', `${gatewayUrl}/health`);
  recordStep('gateway health', true, `status=${gatewayHealth.status}`);

  benchmarkRun = runBenchmarkHarness();
  recordStep('phase3 benchmark harness', true, 'npm run perf:phase3 completed in strict mode');

  benchmarkEvidence = readBenchmarkEvidence(benchmarkRun.output);
  recordStep('benchmark evidence written', true, `${relativePath(benchmarkEvidence.mdPath)} and ${relativePath(benchmarkEvidence.jsonPath)}`);

  benchmarkProof = assertBenchmarkProof(benchmarkEvidence.benchmark);
  recordStep('authenticated scenario proof', true, `${benchmarkProof.requiredScenarios.join(', ')} passed`);

  largeWalletHistoryProof = await runLargeWalletTransactionHistoryProof();
  recordStep('large-wallet transaction-history proof', true, summarizeLargeWalletTransactionHistoryProof(largeWalletHistoryProof));

  if (sizedBackupRestoreProofEnabled) {
    sizedBackupRestoreProof = await runSizedBackupRestoreProof();
    recordStep('sized backup restore proof', true, summarizeSizedBackupRestoreProof(sizedBackupRestoreProof));
  }

  workerQueueProof = runWorkerQueueProof();
  recordStep('worker queue proof', true, summarizeWorkerQueueProof(workerQueueProof));

  workerScaleOutProof = await runWorkerScaleOutProof();
  composePs = collectComposePs();
  recordStep('worker scale-out proof', true, summarizeWorkerScaleOutProof(workerScaleOutProof));

  backendScaleOutProof = await runBackendScaleOutProof();
  composePs = collectComposePs();
  recordStep('backend scale-out websocket proof', true, summarizeBackendScaleOutProof(backendScaleOutProof));

  if (capacitySnapshotsEnabled) {
    const finalCapacity = collectCapacitySnapshot('after-local-load-profile');
    capacitySnapshots.push(finalCapacity);
    recordStep('capacity load snapshot', true, summarizeCapacitySnapshot(finalCapacity));
  }

  passed = steps.every((step) => step.passed);
} catch (error) {
  failureError = error;
  recordStep('phase3 compose benchmark smoke', false, getErrorMessage(error));
  try {
    composePs = collectComposePs(true);
  } catch {
    composePs = [];
  }
} finally {
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    commit: readCommit(),
    passed,
    projectName,
    apiUrl,
    gatewayUrl,
    wsUrl,
    ports: {
      http: httpPort,
      https: httpsPort,
      gateway: gatewayPort,
    },
    steps,
    benchmarkRun: benchmarkRun
      ? {
          status: benchmarkRun.status,
          stdoutTail: benchmarkRun.stdout.split('\n').slice(-80).join('\n'),
          stderrTail: benchmarkRun.stderr.split('\n').slice(-80).join('\n'),
        }
      : null,
    benchmarkEvidence: benchmarkEvidence
      ? {
          ...benchmarkEvidence,
          jsonPath: relativePath(benchmarkEvidence.jsonPath),
          mdPath: benchmarkEvidence.mdPath ? relativePath(benchmarkEvidence.mdPath) : null,
        }
      : null,
    benchmarkProof,
    largeWalletHistoryProof,
    workerQueueProof,
    workerScaleOutProof,
    backendScaleOutProof,
    sizedBackupRestoreProof,
    capacitySnapshots,
    composePs,
    keptStack: keepStack,
    sslDir,
  };

  mkdirSync(outputDir, { recursive: true });
  const mdPath = path.join(outputDir, `phase3-compose-benchmark-smoke-${timestamp}.md`);
  const jsonPath = path.join(outputDir, `phase3-compose-benchmark-smoke-${timestamp}.json`);
  writeFileSync(mdPath, buildMarkdown(report, { repoRoot }));
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Wrote ${relativePath(mdPath)}`);
  console.log(`Wrote ${relativePath(jsonPath)}`);

  if (!keepStack) {
    try {
      runCompose(['down', '-v', '--remove-orphans']);
      console.log(`Stopped and removed compose project ${projectName}`);
    } catch (error) {
      console.warn(`Failed to clean up compose project ${projectName}: ${getErrorMessage(error)}`);
    }
  } else {
    console.log(`Leaving compose project ${projectName} running because PHASE3_COMPOSE_BENCHMARK_KEEP_STACK=true`);
  }

  if (!keepStack && ownsSslDir) {
    try {
      rmSync(sslDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to clean up temporary SSL directory ${sslDir}: ${getErrorMessage(error)}`);
    }
  }
}

if (!passed) {
  if (failureError) {
    console.error(redactSensitiveText(getErrorMessage(failureError))); // lgtm[js/clear-text-logging]
  }
  process.exitCode = 1;
}
