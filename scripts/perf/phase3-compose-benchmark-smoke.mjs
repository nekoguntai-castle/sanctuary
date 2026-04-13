#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const outputDir = process.env.PHASE3_COMPOSE_BENCHMARK_OUTPUT_DIR || path.join(repoRoot, 'docs/plans');
const startedAt = new Date();
const timestamp = startedAt.toISOString().replace(/[:.]/g, '-');
const projectName = process.env.PHASE3_COMPOSE_BENCHMARK_PROJECT || `sanctuary-phase3-benchmark-${timestamp.toLowerCase()}`;
const keepStack = process.env.PHASE3_COMPOSE_BENCHMARK_KEEP_STACK === 'true';
const timeoutMs = Number(process.env.PHASE3_COMPOSE_BENCHMARK_TIMEOUT_MS || '360000');
const retryMs = Number(process.env.PHASE3_COMPOSE_BENCHMARK_RETRY_MS || '2000');
const workerQueueProofTimeoutMs = Number(process.env.PHASE3_WORKER_QUEUE_PROOF_TIMEOUT_MS || '60000');
const workerScaleOutReplicas = Number(process.env.PHASE3_WORKER_SCALE_OUT_REPLICAS || '2');
const workerScaleOutProofTimeoutMs = Number(process.env.PHASE3_WORKER_SCALE_OUT_PROOF_TIMEOUT_MS || '60000');
const workerScaleOutJobCount = Number(process.env.PHASE3_WORKER_SCALE_OUT_JOB_COUNT || '8');
const workerScaleOutJobDelayMs = Number(process.env.PHASE3_WORKER_SCALE_OUT_JOB_DELAY_MS || '300');
const composeWorkerConcurrency = process.env.PHASE3_COMPOSE_WORKER_CONCURRENCY || process.env.WORKER_CONCURRENCY || '1';
const backendScaleOutReplicas = Number(process.env.PHASE3_BACKEND_SCALE_OUT_REPLICAS || '2');
const backendScaleOutProofTimeoutMs = Number(process.env.PHASE3_BACKEND_SCALE_OUT_PROOF_TIMEOUT_MS || '60000');

const postgresUser = 'sanctuary';
const postgresDb = 'sanctuary_phase3_benchmark';
const adminUsername = process.env.SANCTUARY_BENCHMARK_USERNAME || 'admin';
const adminPassword = process.env.SANCTUARY_BENCHMARK_PASSWORD || 'sanctuary';

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });

    if (available) {
      return port;
    }
  }

  throw new Error(`Could not find an available loopback port starting at ${startPort}`);
}

const httpPort = process.env.PHASE3_COMPOSE_BENCHMARK_HTTP_PORT
  || process.env.HTTP_PORT
  || String(await findAvailablePort(18080));
const httpsPort = process.env.PHASE3_COMPOSE_BENCHMARK_HTTPS_PORT
  || process.env.HTTPS_PORT
  || String(await findAvailablePort(18443));
const gatewayPort = process.env.PHASE3_COMPOSE_BENCHMARK_GATEWAY_PORT
  || process.env.GATEWAY_PORT
  || String(await findAvailablePort(14000));

const apiUrl = `https://127.0.0.1:${httpsPort}`;
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const wsUrl = `wss://127.0.0.1:${httpsPort}/ws`;
const composeArgs = ['compose', '-p', projectName, '-f', 'docker-compose.yml'];
const composeEnv = {
  ...process.env,
  NODE_ENV: 'production',
  LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
  POSTGRES_USER: postgresUser,
  POSTGRES_PASSWORD: 'phase3ComposeBenchmarkPostgresPassword',
  POSTGRES_DB: postgresDb,
  REDIS_PASSWORD: 'phase3ComposeBenchmarkRedisPassword',
  JWT_SECRET: 'phase3-compose-benchmark-jwt-secret-32-characters',
  ENCRYPTION_KEY: 'phase3-compose-benchmark-encryption-key-32-chars',
  ENCRYPTION_SALT: 'phase3-compose-benchmark-encryption-salt',
  GATEWAY_SECRET: 'phase3-compose-benchmark-gateway-secret-32-characters',
  AI_CONFIG_SECRET: 'phase3-compose-benchmark-ai-config-secret-32-characters',
  HTTP_PORT: httpPort,
  HTTPS_PORT: httpsPort,
  GATEWAY_PORT: gatewayPort,
  GATEWAY_TLS_ENABLED: 'false',
  TLS_ENABLED: 'false',
  WORKER_HEALTH_URL: 'http://worker:3002/ready',
  WORKER_CONCURRENCY: composeWorkerConcurrency,
  ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS: process.env.PHASE3_ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS || process.env.ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS || '15000',
  ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS: process.env.PHASE3_ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS || process.env.ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS || '5000',
  ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS: process.env.PHASE3_ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS || process.env.ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS || '5000',
};

const benchmarkEnv = {
  ...composeEnv,
  SANCTUARY_API_URL: apiUrl,
  SANCTUARY_GATEWAY_URL: gatewayUrl,
  SANCTUARY_WS_URL: wsUrl,
  SANCTUARY_INSECURE_TLS: 'true',
  SANCTUARY_BENCHMARK_PROVISION: 'true',
  SANCTUARY_BENCHMARK_CREATE_BACKUP: 'true',
  SANCTUARY_BENCHMARK_STRICT: 'true',
  SANCTUARY_BENCHMARK_USERNAME: adminUsername,
  SANCTUARY_BENCHMARK_PASSWORD: adminPassword,
  SANCTUARY_BENCHMARK_WALLET_NAME: process.env.SANCTUARY_BENCHMARK_WALLET_NAME || 'Phase 3 Compose Benchmark Wallet',
  SANCTUARY_OUTPUT_DIR: 'docs/plans',
  SANCTUARY_REQUESTS: process.env.SANCTUARY_REQUESTS || '5',
  SANCTUARY_CONCURRENCY: process.env.SANCTUARY_CONCURRENCY || '2',
  SANCTUARY_WS_CLIENTS: process.env.SANCTUARY_WS_CLIENTS || '2',
  SANCTUARY_WS_FANOUT_CLIENTS: process.env.SANCTUARY_WS_FANOUT_CLIENTS || process.env.SANCTUARY_WS_CLIENTS || '2',
  SANCTUARY_TIMEOUT_MS: process.env.SANCTUARY_TIMEOUT_MS || '20000',
};

const steps = [];

function recordStep(name, passed, summary, extra = {}) {
  const step = {
    name,
    passed,
    summary,
    ...extra,
  };
  steps.push(step);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}: ${summary}`);
  return step;
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: composeEnv,
    maxBuffer: 1024 * 1024 * 40,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error([
      `docker ${args.join(' ')} exited with ${result.status}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }

  return result.stdout || '';
}

function runCompose(args) {
  return runDocker([...composeArgs, ...args]);
}

function parseJsonLines(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function collectComposePs(all = false) {
  const args = ['ps'];
  if (all) {
    args.push('--all');
  }
  args.push('--format', 'json');

  return parseJsonLines(runCompose(args))
    .map((container) => ({
      service: container.Service,
      state: container.State,
      health: container.Health || '',
      exitCode: container.ExitCode ?? null,
      publishers: container.Publishers || [],
    }));
}

function getServiceContainerId(serviceName) {
  return runCompose(['ps', '-aq', serviceName]).trim().split('\n').filter(Boolean)[0] || '';
}

function getServiceContainerIds(serviceName) {
  return runCompose(['ps', '-q', serviceName]).trim().split('\n').filter(Boolean);
}

function inspectContainer(containerId) {
  const output = runDocker(['inspect', containerId]);
  const inspected = JSON.parse(output);
  if (!inspected?.[0]) {
    throw new Error(`Could not inspect container ${containerId}`);
  }
  return inspected[0];
}

function inspectContainerState(containerId) {
  return inspectContainer(containerId).State || {};
}

function getServiceContainers(serviceName) {
  return getServiceContainerIds(serviceName).map((containerId) => {
    const inspected = inspectContainer(containerId);
    return {
      id: containerId,
      shortId: containerId.slice(0, 12),
      name: String(inspected.Name || '').replace(/^\//, ''),
      ip: findComposeNetworkAddress(inspected),
    };
  });
}

function findComposeNetworkAddress(inspected) {
  const networks = inspected?.NetworkSettings?.Networks || {};
  const entries = Object.entries(networks);
  const entry = entries.find(([name]) => name.endsWith('_sanctuary-network')) || entries[0];
  const ipAddress = entry?.[1]?.IPAddress;
  if (!ipAddress) {
    throw new Error(`Could not find Compose network address for ${inspected?.Name || inspected?.Id || 'container'}`);
  }
  return ipAddress;
}

async function waitForMigrateExit() {
  const deadline = Date.now() + timeoutMs;
  let latestState = null;

  while (Date.now() < deadline) {
    const containerId = getServiceContainerId('migrate');
    if (containerId) {
      latestState = inspectContainerState(containerId);
      if (latestState.Status === 'exited') {
        if (latestState.ExitCode === 0) {
          return latestState;
        }

        const logs = runCompose(['logs', '--no-color', '--tail', '200', 'migrate']);
        throw new Error(`migrate exited with ${latestState.ExitCode}\n${logs}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  throw new Error(`Timed out waiting for migrate service to exit; last state=${JSON.stringify(latestState)}`);
}

async function waitForComposeHealthy() {
  const deadline = Date.now() + timeoutMs;
  let latestComposePs = [];
  const requiredServices = new Set(['redis', 'postgres', 'worker', 'backend', 'frontend', 'gateway']);

  while (Date.now() < deadline) {
    latestComposePs = collectComposePs();
    const seenServices = new Set(latestComposePs.map((container) => container.service));
    const missing = [...requiredServices].filter((service) => !seenServices.has(service));
    const unhealthy = latestComposePs.filter((container) => (
      requiredServices.has(container.service)
      && (container.state !== 'running' || (container.health && container.health !== 'healthy'))
    ));

    if (missing.length === 0 && unhealthy.length === 0) {
      return latestComposePs;
    }

    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  const seenServices = new Set(latestComposePs.map((container) => container.service));
  const missing = [...requiredServices].filter((service) => !seenServices.has(service));
  const unhealthy = latestComposePs.filter((container) => (
    requiredServices.has(container.service)
    && (container.state !== 'running' || (container.health && container.health !== 'healthy'))
  ));
  throw new Error(`Unhealthy containers: ${JSON.stringify({ missing, unhealthy })}`);
}

async function waitForServiceReplicaHealth(serviceName, expectedCount) {
  const deadline = Date.now() + timeoutMs;
  let latestContainers = [];

  while (Date.now() < deadline) {
    latestContainers = collectComposePs().filter((container) => container.service === serviceName);
    const unhealthy = latestContainers.filter((container) => (
      container.state !== 'running' || (container.health && container.health !== 'healthy')
    ));

    if (latestContainers.length === expectedCount && unhealthy.length === 0) {
      return latestContainers;
    }

    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  const unhealthy = latestContainers.filter((container) => (
    container.state !== 'running' || (container.health && container.health !== 'healthy')
  ));
  throw new Error(`Service ${serviceName} did not reach ${expectedCount} healthy replicas: ${JSON.stringify({ count: latestContainers.length, unhealthy })}`);
}

async function waitForHttpOk(name, url) {
  const deadline = Date.now() + timeoutMs;
  let latestError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      const body = await response.text();

      if (response.ok) {
        return {
          status: response.status,
          body: parseJson(body),
        };
      }

      latestError = new Error(`${name} returned HTTP ${response.status}: ${body.slice(0, 200)}`);
    } catch (error) {
      latestError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  throw latestError || new Error(`Timed out waiting for ${name}`);
}

function runBenchmarkHarness() {
  const result = spawnSync('npm', ['run', 'perf:phase3'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: benchmarkEnv,
    maxBuffer: 1024 * 1024 * 60,
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');

  if (result.status !== 0) {
    throw new Error([
      `npm run perf:phase3 exited with ${result.status}`,
      output.trim(),
    ].filter(Boolean).join('\n'));
  }

  return {
    status: result.status,
    output,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function readBenchmarkEvidence(output) {
  const jsonPath = findGeneratedPath(output, /Wrote (.+phase3-benchmark-.+\.json)/g);
  const mdPath = findGeneratedPath(output, /Wrote (.+phase3-benchmark-.+\.md)/g);

  if (!jsonPath || !existsSync(jsonPath)) {
    throw new Error(`Could not find generated Phase 3 benchmark JSON evidence in harness output:\n${output}`);
  }

  const benchmark = JSON.parse(readFileSync(jsonPath, 'utf8'));
  return {
    jsonPath,
    mdPath: mdPath && existsSync(mdPath) ? mdPath : null,
    benchmark,
  };
}

function findGeneratedPath(output, pattern) {
  let match;
  let lastPath = null;

  while ((match = pattern.exec(output)) !== null) {
    lastPath = match[1].trim();
  }

  if (!lastPath) {
    return null;
  }

  return path.isAbsolute(lastPath)
    ? lastPath
    : path.join(repoRoot, lastPath);
}

function assertBenchmarkProof(benchmark) {
  const requiredScenarios = new Map([
    ['wallet list', ['200']],
    ['large wallet transaction history', ['200']],
    ['websocket subscription fanout', []],
    ['wallet sync queue', ['200']],
    ['backup validate', ['200']],
  ]);
  const scenariosByName = new Map((benchmark.scenarios || []).map((scenario) => [scenario.name, scenario]));
  const skippedByName = new Map((benchmark.skipped || []).map((scenario) => [scenario.name, scenario]));

  for (const [scenarioName, requiredStatuses] of requiredScenarios) {
    const scenario = scenariosByName.get(scenarioName);
    if (!scenario) {
      const skipped = skippedByName.get(scenarioName);
      const reason = skipped ? `; skipped because ${skipped.reason}` : '';
      throw new Error(`Required scenario "${scenarioName}" was not recorded${reason}`);
    }

    if (scenario.status !== 'passed') {
      throw new Error(`Required scenario "${scenarioName}" did not pass: ${JSON.stringify(scenario)}`);
    }

    if (requiredStatuses.length > 0) {
      for (const status of requiredStatuses) {
        if (!scenario.statusCounts || !scenario.statusCounts[status]) {
          throw new Error(`Required scenario "${scenarioName}" did not record HTTP ${status}: ${JSON.stringify(scenario)}`);
        }
      }
    }
  }

  const failedScenarios = (benchmark.scenarios || []).filter((scenario) => scenario.status === 'failed');
  if (failedScenarios.length > 0) {
    throw new Error(`Benchmark recorded failed scenarios: ${failedScenarios.map((scenario) => scenario.name).join(', ')}`);
  }

  if (benchmark.environment?.fixture?.tokenSource !== 'local-login') {
    throw new Error(`Benchmark did not use local-login fixture token: ${benchmark.environment?.fixture?.tokenSource || 'none'}`);
  }

  if (!['local-created', 'local-existing'].includes(benchmark.environment?.fixture?.walletSource)) {
    throw new Error(`Benchmark did not create/reuse a local wallet fixture: ${benchmark.environment?.fixture?.walletSource || 'none'}`);
  }

  if (benchmark.environment?.fixture?.backupSource !== 'local-admin-api') {
    throw new Error(`Benchmark did not create a backup fixture through the admin API: ${benchmark.environment?.fixture?.backupSource || 'none'}`);
  }

  return {
    requiredScenarios: [...requiredScenarios.keys()],
    skipped: benchmark.skipped || [],
    datasetLabel: benchmark.environment?.datasetLabel || 'unknown',
  };
}

function runWorkerQueueProof() {
  const output = runCompose([
    'exec',
    '-T',
    '-e',
    `PHASE3_QUEUE_PROOF_ID=${timestamp}`,
    '-e',
    `PHASE3_WORKER_QUEUE_PROOF_TIMEOUT_MS=${workerQueueProofTimeoutMs}`,
    'worker',
    'node',
    '--input-type=module',
    '--eval',
    getWorkerQueueProofScript(),
  ]);

  const proof = parseLastJsonLine(output);
  const failedJobs = proof.jobs.filter((job) => job.state !== 'completed');
  if (failedJobs.length > 0) {
    throw new Error(`Worker queue proof recorded non-completed jobs: ${JSON.stringify(failedJobs)}`);
  }

  return proof;
}

function parseLastJsonLine(output) {
  const lines = output.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines.toReversed()) {
    if (!line.startsWith('{')) continue;
    return JSON.parse(line);
  }

  throw new Error(`Worker queue proof did not emit JSON output:\n${output}`);
}

function summarizeWorkerQueueProof(proof) {
  const categories = [...new Set(proof.jobs.map((job) => job.category))];
  const durations = summarizeDurations(proof.jobs.map((job) => job.durationMs));
  return `${proof.jobs.length} jobs completed across ${categories.join(', ')}; p95=${durations.p95Ms}ms`;
}

async function runWorkerScaleOutProof() {
  if (workerScaleOutReplicas < 2) {
    throw new Error(`PHASE3_WORKER_SCALE_OUT_REPLICAS must be at least 2, got ${workerScaleOutReplicas}`);
  }

  runCompose(['up', '-d', '--scale', `worker=${workerScaleOutReplicas}`, 'worker']);
  const workerPs = await waitForServiceReplicaHealth('worker', workerScaleOutReplicas);
  const workers = getServiceContainers('worker');
  if (workers.length < 2) {
    throw new Error(`Expected at least two worker containers after scale-out, found ${workers.length}`);
  }

  const output = runDocker([
    'exec',
    '-e',
    `PHASE3_WORKER_SCALE_OUT_TARGETS=${JSON.stringify(workers)}`,
    '-e',
    `PHASE3_WORKER_SCALE_OUT_PROOF_ID=${timestamp}`,
    '-e',
    `PHASE3_WORKER_SCALE_OUT_PROOF_TIMEOUT_MS=${workerScaleOutProofTimeoutMs}`,
    '-e',
    `PHASE3_WORKER_SCALE_OUT_JOB_COUNT=${workerScaleOutJobCount}`,
    '-e',
    `PHASE3_WORKER_SCALE_OUT_JOB_DELAY_MS=${workerScaleOutJobDelayMs}`,
    workers[0].id,
    'node',
    '--input-type=module',
    '--eval',
    getWorkerScaleOutProofScript(),
  ]);

  const proof = parseLastJsonLine(output);
  const failedJobs = proof.jobs.filter((job) => job.state !== 'completed');
  if (failedJobs.length > 0) {
    throw new Error(`Worker scale-out proof recorded non-completed jobs: ${JSON.stringify(failedJobs)}`);
  }

  const diagnosticJobs = proof.jobs.filter((job) => job.name === 'diagnostics:worker-ping');
  const processorIds = new Set(
    diagnosticJobs
      .map((job) => job.returnvalue?.worker?.hostname)
      .filter(Boolean)
  );
  if (processorIds.size < Math.min(2, workerScaleOutReplicas)) {
    throw new Error(`Worker scale-out proof did not observe multiple job processors: ${JSON.stringify([...processorIds])}`);
  }

  const seenSequences = new Set();
  for (const job of diagnosticJobs) {
    const sequence = job.returnvalue?.sequence;
    if (sequence === null || sequence === undefined) {
      throw new Error(`Worker diagnostic job did not return a sequence: ${JSON.stringify(job)}`);
    }
    if (seenSequences.has(sequence)) {
      throw new Error(`Worker diagnostic sequence processed more than once: ${sequence}`);
    }
    seenSequences.add(sequence);
  }

  const lockedExecuted = proof.lockProof.jobs.filter((job) => job.returnvalue?.success);
  const lockedSkipped = proof.lockProof.jobs.filter((job) => job.returnvalue?.skipped);
  if (lockedExecuted.length !== 1 || lockedSkipped.length !== 1) {
    throw new Error(`Worker locked diagnostic proof expected one executed job and one lock-held skip: ${JSON.stringify(proof.lockProof.jobs)}`);
  }

  const ownerMetrics = proof.metricsAfter.filter((entry) => (
    entry.metrics?.worker?.electrumSubscriptionOwner || entry.metrics?.electrum?.isRunning
  ));
  if (ownerMetrics.length !== 1) {
    throw new Error(`Expected exactly one worker to own Electrum subscriptions, found ${ownerMetrics.length}: ${JSON.stringify(ownerMetrics)}`);
  }

  const repeatableDuplicates = (proof.repeatableJobs || []).filter((job) => job.count > 1);
  if (repeatableDuplicates.length > 0) {
    throw new Error(`Worker scale-out proof found duplicate repeatable jobs: ${JSON.stringify(repeatableDuplicates)}`);
  }

  return {
    ...proof,
    workerPs,
  };
}

function summarizeWorkerScaleOutProof(proof) {
  const processorIds = [...new Set(
    proof.jobs
      .filter((job) => job.name === 'diagnostics:worker-ping')
      .map((job) => job.returnvalue?.worker?.hostname)
      .filter(Boolean)
  )];
  const owner = proof.metricsAfter.find((entry) => (
    entry.metrics?.worker?.electrumSubscriptionOwner || entry.metrics?.electrum?.isRunning
  ));
  const lockedSkipped = proof.lockProof.jobs.filter((job) => job.returnvalue?.skipped).length;
  return `${proof.workers.length} workers healthy; processors=${processorIds.join(', ')}; electrumOwner=${owner?.target?.name || 'unknown'}; lockedSkips=${lockedSkipped}`;
}

async function runBackendScaleOutProof() {
  if (backendScaleOutReplicas < 2) {
    throw new Error(`PHASE3_BACKEND_SCALE_OUT_REPLICAS must be at least 2, got ${backendScaleOutReplicas}`);
  }

  runCompose(['up', '-d', '--scale', `backend=${backendScaleOutReplicas}`, '--scale', `worker=${workerScaleOutReplicas}`, 'backend', 'worker']);
  const backendPs = await waitForServiceReplicaHealth('backend', backendScaleOutReplicas);
  const backends = getServiceContainers('backend');
  if (backends.length < 2) {
    throw new Error(`Expected at least two backend containers after scale-out, found ${backends.length}`);
  }

  const output = runDocker([
    'exec',
    '-e',
    `PHASE3_BACKEND_SCALE_OUT_TARGETS=${JSON.stringify(backends)}`,
    '-e',
    `PHASE3_BACKEND_SCALE_OUT_PROOF_ID=${timestamp}`,
    '-e',
    `PHASE3_BACKEND_SCALE_OUT_PROOF_TIMEOUT_MS=${backendScaleOutProofTimeoutMs}`,
    '-e',
    `SANCTUARY_BENCHMARK_USERNAME=${adminUsername}`,
    '-e',
    `SANCTUARY_BENCHMARK_PASSWORD=${adminPassword}`,
    backends[0].id,
    'node',
    '--input-type=module',
    '--eval',
    getBackendScaleOutProofScript(),
  ]);

  const proof = parseLastJsonLine(output);
  if (!proof.event?.ok) {
    throw new Error(`Backend scale-out proof did not receive a cross-instance sync event: ${JSON.stringify(proof.event || null)}`);
  }

  return {
    ...proof,
    backendPs,
  };
}

function summarizeBackendScaleOutProof(proof) {
  return `sync event from ${proof.triggerTarget.name} reached WebSocket on ${proof.websocketTarget.name} via Redis in ${proof.event.durationMs}ms`;
}

function buildMarkdown(report) {
  const lines = [
    '# Phase 3 Compose Benchmark Smoke',
    '',
    `Date: ${report.startedAt}`,
    `Status: ${report.passed ? 'Passed' : 'Failed'}`,
    `Compose project: ${report.projectName}`,
    `API URL: ${report.apiUrl}`,
    `Gateway URL: ${report.gatewayUrl}`,
    `WebSocket URL: ${report.wsUrl}`,
    '',
    '## Results',
    '',
    ...report.steps.map((step) => `- ${step.passed ? 'PASS' : 'FAIL'} ${step.name}: ${step.summary}`),
    '',
    '## Benchmark Evidence',
    '',
    report.benchmarkEvidence?.mdPath
      ? `- Markdown: ${displayPath(report.benchmarkEvidence.mdPath)}`
      : '- Markdown: not recorded',
    report.benchmarkEvidence?.jsonPath
      ? `- JSON: ${displayPath(report.benchmarkEvidence.jsonPath)}`
      : '- JSON: not recorded',
    report.benchmarkProof
      ? `- Dataset: ${report.benchmarkProof.datasetLabel}`
      : '- Dataset: not recorded',
    '',
    '## Scenario Summary',
    '',
  ];

  if (report.benchmarkEvidence?.benchmark?.scenarios?.length) {
    lines.push(
      '| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
      ...report.benchmarkEvidence.benchmark.scenarios.map((scenario) => [
        escapeCell(scenario.name),
        scenario.status,
        scenario.requests,
        scenario.successes,
        scenario.errors,
        scenario.latency?.p95Ms ?? '',
        scenario.latency?.p99Ms ?? '',
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
      ''
    );
  } else {
    lines.push('No benchmark scenarios recorded.', '');
  }

  lines.push('## Worker Queue Proof', '');

  if (report.workerQueueProof?.jobs?.length) {
    const durations = summarizeDurations(report.workerQueueProof.jobs.map((job) => job.durationMs));
    lines.push(
      `Total duration: ${report.workerQueueProof.totalDurationMs} ms`,
      `Job p95: ${durations.p95Ms} ms`,
      '',
      '| Category | Queue | Job | State | Duration ms |',
      '| --- | --- | --- | --- | ---: |',
      ...report.workerQueueProof.jobs.map((job) => [
        job.category,
        job.queue,
        escapeCell(job.name),
        job.state,
        job.durationMs,
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
      '',
      'Queue counts after proof:',
      ''
    );

    for (const [queueName, stats] of Object.entries(report.workerQueueProof.metricsAfter?.queues || {})) {
      lines.push(`- ${queueName}: waiting=${stats.waiting} active=${stats.active} delayed=${stats.delayed} failed=${stats.failed} completed=${stats.completed}`);
    }
    lines.push('');
  } else {
    lines.push('No worker queue proof recorded.', '');
  }

  lines.push('## Worker Scale-Out Proof', '');

  if (report.workerScaleOutProof?.jobs?.length) {
    const processorIds = [...new Set(
      report.workerScaleOutProof.jobs
        .filter((job) => job.name === 'diagnostics:worker-ping')
        .map((job) => job.returnvalue?.worker?.hostname)
        .filter(Boolean)
    )];
    const owner = report.workerScaleOutProof.metricsAfter.find((entry) => (
      entry.metrics?.worker?.electrumSubscriptionOwner || entry.metrics?.electrum?.isRunning
    ));
    lines.push(
      `Worker replicas: ${report.workerScaleOutProof.workers?.length || 0}`,
      `Diagnostic job processors: ${processorIds.join(', ')}`,
      `Electrum subscription owner: ${owner?.target?.name || 'unknown'}`,
      `Locked diagnostic result: ${report.workerScaleOutProof.lockProof.jobs.filter((job) => job.returnvalue?.success).length} executed, ${report.workerScaleOutProof.lockProof.jobs.filter((job) => job.returnvalue?.skipped).length} skipped by lock`,
      '',
      '| Category | Job | State | Processor | Duration ms |',
      '| --- | --- | --- | --- | ---: |',
      ...report.workerScaleOutProof.jobs.map((job) => [
        job.category,
        escapeCell(job.name),
        job.state,
        job.returnvalue?.worker?.hostname || '',
        job.durationMs,
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
      '',
      'Repeatable job ownership:',
      ''
    );

    for (const job of report.workerScaleOutProof.repeatableJobs || []) {
      lines.push(`- ${job.queue}:${job.name}: repeatable definitions=${job.count}`);
    }
    lines.push('');
  } else {
    lines.push('No worker scale-out proof recorded.', '');
  }

  lines.push('## Backend Scale-Out Proof', '');

  if (report.backendScaleOutProof?.event?.ok) {
    lines.push(
      `Backend replicas: ${report.backendScaleOutProof.backends?.length || 0}`,
      `WebSocket target: ${report.backendScaleOutProof.websocketTarget.name} (${report.backendScaleOutProof.websocketTarget.ip})`,
      `Trigger target: ${report.backendScaleOutProof.triggerTarget.name} (${report.backendScaleOutProof.triggerTarget.ip})`,
      `Wallet: ${report.backendScaleOutProof.wallet.name} (${report.backendScaleOutProof.wallet.id})`,
      `Trigger status: ${report.backendScaleOutProof.trigger.status}`,
      `Event: ${report.backendScaleOutProof.event.event} on ${report.backendScaleOutProof.event.channel} in ${report.backendScaleOutProof.event.durationMs} ms`,
      ''
    );
  } else {
    lines.push('No backend scale-out proof recorded.', '');
  }

  lines.push(
    '## Containers',
    '',
    ...report.composePs.map((container) => `- ${container.service}: state=${container.state}${container.health ? ` health=${container.health}` : ''}`),
    '',
    '## Notes',
    '',
    '- This proof starts a disposable full-stack Docker Compose project with frontend, backend, gateway, worker, Redis, and PostgreSQL services.',
    '- The smoke waits for database migration and seed completion, then runs the existing Phase 3 benchmark harness with local fixture provisioning.',
    '- The run proves authenticated wallet list, transaction-history, WebSocket subscription fanout, wallet-sync queue, and admin backup-validation paths execute end to end on a local seeded stack.',
    '- The worker queue proof enqueues and waits for BullMQ jobs across sync, confirmations, notifications, maintenance, autopilot, and intelligence handlers in the running worker container.',
    '- The worker scale-out proof runs two worker replicas, verifies diagnostic BullMQ jobs complete on both replicas, proves a shared diagnostic lock skips one concurrent duplicate, checks recurring jobs have one repeatable definition, and requires exactly one worker to own Electrum subscriptions.',
    '- The backend scale-out proof runs two backend replicas, opens a wallet subscription WebSocket on one replica, triggers wallet sync on the other replica, and requires the Redis bridge to deliver the sync event across instances.',
    '- The local generated wallet and two-replica topology are smoke evidence only; representative large-wallet, load-level fanout, and capacity evidence remain required before claiming Phase 3 complete.',
    '- Restore remains intentionally skipped because it is destructive unless `SANCTUARY_ALLOW_RESTORE=true` is set for a restore-safe environment.'
  );

  return `${lines.join('\n')}\n`;
}

function relativePath(targetPath) {
  return path.relative(repoRoot, targetPath);
}

function displayPath(targetPath) {
  return path.isAbsolute(targetPath) ? relativePath(targetPath) : targetPath;
}

function parseJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function summarizeDurations(values) {
  if (values.length === 0) {
    return { minMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null };
  }

  const sorted = values.slice().sort((a, b) => a - b);
  return {
    minMs: round(sorted[0]),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    maxMs: round(sorted[sorted.length - 1]),
  };
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let composePs = [];
let benchmarkRun = null;
let benchmarkEvidence = null;
let benchmarkProof = null;
let workerQueueProof = null;
let workerScaleOutProof = null;
let backendScaleOutProof = null;
let passed = false;
let failureError = null;

try {
  runCompose(['up', '-d', '--build', 'frontend', 'gateway', 'migrate']);
  recordStep('compose stack started', true, `project=${projectName} apiPort=${httpsPort} gatewayPort=${gatewayPort}`);

  const migrationState = await waitForMigrateExit();
  recordStep('database migration and seed', true, `migrate exited with ${migrationState.ExitCode}`);

  composePs = await waitForComposeHealthy();
  recordStep('compose container health', true, `${composePs.length} service containers running and healthy`);

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

  workerQueueProof = runWorkerQueueProof();
  recordStep('worker queue proof', true, summarizeWorkerQueueProof(workerQueueProof));

  workerScaleOutProof = await runWorkerScaleOutProof();
  composePs = collectComposePs();
  recordStep('worker scale-out proof', true, summarizeWorkerScaleOutProof(workerScaleOutProof));

  backendScaleOutProof = await runBackendScaleOutProof();
  composePs = collectComposePs();
  recordStep('backend scale-out websocket proof', true, summarizeBackendScaleOutProof(backendScaleOutProof));

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
    workerQueueProof,
    workerScaleOutProof,
    backendScaleOutProof,
    composePs,
    keptStack: keepStack,
  };

  mkdirSync(outputDir, { recursive: true });
  const mdPath = path.join(outputDir, `phase3-compose-benchmark-smoke-${timestamp}.md`);
  const jsonPath = path.join(outputDir, `phase3-compose-benchmark-smoke-${timestamp}.json`);
  writeFileSync(mdPath, buildMarkdown(report));
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
}

if (!passed) {
  if (failureError) {
    console.error(getErrorMessage(failureError));
  }
  process.exitCode = 1;
}

function getWorkerQueueProofScript() {
  return `
import { Queue, QueueEvents } from 'bullmq';

const proofId = process.env.PHASE3_QUEUE_PROOF_ID || String(Date.now());
const safeProofId = proofId.replace(/[^a-zA-Z0-9_-]/g, '-');
const jobTimeoutMs = Number(process.env.PHASE3_WORKER_QUEUE_PROOF_TIMEOUT_MS || '60000');
const prefix = 'sanctuary:worker';

function connectionFromEnv() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for worker queue proof');
  }

  const parsed = new URL(redisUrl);
  const db = parsed.pathname && parsed.pathname !== '/'
    ? Number.parseInt(parsed.pathname.slice(1), 10)
    : 0;

  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isFinite(db) ? db : 0,
  };
}

async function readWorkerMetrics() {
  const response = await fetch('http://127.0.0.1:3002/metrics', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error('worker metrics returned ' + response.status + ': ' + body.slice(0, 200));
  }
  return JSON.parse(body);
}

const connection = connectionFromEnv();
const queueNames = ['sync', 'confirmations', 'notifications', 'maintenance'];
const queues = new Map();
const events = new Map();

for (const queueName of queueNames) {
  const queue = new Queue(queueName, { connection, prefix });
  const queueEvents = new QueueEvents(queueName, { connection, prefix });
  await queueEvents.waitUntilReady();
  queues.set(queueName, queue);
  events.set(queueName, queueEvents);
}

const jobDefinitions = [
  {
    category: 'sync',
    queue: 'sync',
    name: 'check-stale-wallets',
    data: {
      staleThresholdMs: 0,
      maxWallets: 0,
      priority: 'low',
      staggerDelayMs: 0,
      reason: 'phase3-worker-queue-proof',
    },
  },
  {
    category: 'confirmations',
    queue: 'confirmations',
    name: 'update-all-confirmations',
    data: {},
  },
  {
    category: 'notifications',
    queue: 'notifications',
    name: 'confirmation-notify',
    data: {
      walletId: '00000000-0000-4000-8000-000000000000',
      txid: 'phase3-worker-queue-proof',
      confirmations: 2,
      previousConfirmations: 1,
    },
  },
  {
    category: 'maintenance',
    queue: 'maintenance',
    name: 'cleanup:expired-tokens',
    data: {},
  },
  {
    category: 'autopilot',
    queue: 'maintenance',
    name: 'autopilot:evaluate',
    data: {},
  },
  {
    category: 'intelligence',
    queue: 'maintenance',
    name: 'intelligence:cleanup',
    data: {},
  },
];

const proofStartedAt = Date.now();
const jobs = [];

try {
  const metricsBefore = await readWorkerMetrics();

  for (const definition of jobDefinitions) {
    const queue = queues.get(definition.queue);
    const queueEvents = events.get(definition.queue);
    const job = await queue.add(definition.name, definition.data, {
      attempts: 1,
      jobId: ['phase3', safeProofId, definition.category, definition.name.replace(/[^a-zA-Z0-9_-]/g, '-')].join('-'),
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    const startedAt = Date.now();
    const returnvalue = await job.waitUntilFinished(queueEvents, jobTimeoutMs);
    const state = await job.getState();

    jobs.push({
      category: definition.category,
      queue: definition.queue,
      name: definition.name,
      id: job.id,
      state,
      durationMs: Date.now() - startedAt,
      returnvalue,
    });
  }

  const metricsAfter = await readWorkerMetrics();
  console.log(JSON.stringify({
    proofId,
    totalDurationMs: Date.now() - proofStartedAt,
    metricsBefore,
    metricsAfter,
    jobs,
  }));
} finally {
  await Promise.all([...events.values()].map((queueEvents) => queueEvents.close()));
  await Promise.all([...queues.values()].map((queue) => queue.close()));
}
`;
}

function getWorkerScaleOutProofScript() {
  return `
import { Queue, QueueEvents } from 'bullmq';

const proofId = process.env.PHASE3_WORKER_SCALE_OUT_PROOF_ID || String(Date.now());
const safeProofId = proofId.replace(/[^a-zA-Z0-9_-]/g, '-');
const workers = JSON.parse(process.env.PHASE3_WORKER_SCALE_OUT_TARGETS || '[]');
const jobTimeoutMs = Number(process.env.PHASE3_WORKER_SCALE_OUT_PROOF_TIMEOUT_MS || '60000');
const requestedJobCount = Number(process.env.PHASE3_WORKER_SCALE_OUT_JOB_COUNT || '8');
const jobDelayMs = Number(process.env.PHASE3_WORKER_SCALE_OUT_JOB_DELAY_MS || '300');
const prefix = 'sanctuary:worker';
const proofStartedAt = Date.now();

if (workers.length < 2) {
  throw new Error('At least two worker targets are required for worker scale-out proof');
}

function connectionFromEnv() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for worker scale-out proof');
  }

  const parsed = new URL(redisUrl);
  const db = parsed.pathname && parsed.pathname !== '/'
    ? Number.parseInt(parsed.pathname.slice(1), 10)
    : 0;

  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isFinite(db) ? db : 0,
  };
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readWorkerMetrics(target) {
  const response = await fetch('http://' + target.ip + ':3002/metrics', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error('worker metrics for ' + target.name + ' returned ' + response.status + ': ' + body.slice(0, 200));
  }
  return {
    target,
    metrics: parseJson(body),
  };
}

async function readAllWorkerMetrics() {
  return Promise.all(workers.map((target) => readWorkerMetrics(target)));
}

async function waitForElectrumOwner() {
  const deadline = Date.now() + jobTimeoutMs;
  let latest = [];

  while (Date.now() < deadline) {
    latest = await readAllWorkerMetrics();
    const owners = latest.filter((entry) => (
      entry.metrics?.worker?.electrumSubscriptionOwner || entry.metrics?.electrum?.isRunning
    ));
    if (owners.length === 1) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return latest;
}

const connection = connectionFromEnv();
const queueNames = ['sync', 'confirmations', 'maintenance'];
const queues = new Map();
for (const queueName of queueNames) {
  queues.set(queueName, new Queue(queueName, { connection, prefix }));
}
const maintenanceQueue = queues.get('maintenance');
const maintenanceEvents = new QueueEvents('maintenance', { connection, prefix });
await maintenanceEvents.waitUntilReady();

async function readRepeatableJobs() {
  const expected = {
    sync: ['check-stale-wallets'],
    confirmations: ['update-all-confirmations'],
    maintenance: [
      'cleanup:expired-drafts',
      'cleanup:expired-transfers',
      'cleanup:audit-logs',
      'cleanup:price-data',
      'cleanup:fee-estimates',
      'cleanup:expired-tokens',
      'maintenance:weekly-vacuum',
      'maintenance:monthly-cleanup',
      'backup:scheduled',
    ],
  };
  const records = [];

  for (const [queueName, names] of Object.entries(expected)) {
    const queue = queues.get(queueName);
    const repeatableJobs = await queue.getRepeatableJobs();
    for (const name of names) {
      const matches = repeatableJobs.filter((job) => job.name === name);
      records.push({
        queue: queueName,
        name,
        count: matches.length,
        keys: matches.map((job) => job.key),
      });
    }
  }

  return records;
}

async function waitForJob(job, category) {
  const startedAt = Date.now();
  const returnvalue = await job.waitUntilFinished(maintenanceEvents, jobTimeoutMs);
  const state = await job.getState();
  return {
    category,
    queue: 'maintenance',
    name: job.name,
    id: job.id,
    state,
    durationMs: Date.now() - startedAt,
    returnvalue,
  };
}

const metricsBefore = await readAllWorkerMetrics();
const repeatableJobs = await readRepeatableJobs();
const jobCount = Math.max(workers.length * 2, requestedJobCount);

const diagnosticJobs = [];
for (let sequence = 0; sequence < jobCount; sequence += 1) {
  const job = await maintenanceQueue.add('diagnostics:worker-ping', {
    proofId,
    sequence,
    delayMs: jobDelayMs,
  }, {
    attempts: 1,
    jobId: ['phase3-worker-scaleout', safeProofId, 'ping', String(sequence)].join('-'),
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  diagnosticJobs.push(job);
}

const jobs = await Promise.all(diagnosticJobs.map((job) => waitForJob(job, 'worker-distribution')));

const lockKey = ['phase3-worker-scaleout', safeProofId, 'shared-lock'].join('-');
const lockedJobs = [];
for (let sequence = 0; sequence < 2; sequence += 1) {
  const job = await maintenanceQueue.add('diagnostics:locked-worker-ping', {
    proofId,
    sequence,
    lockKey,
    delayMs: Math.max(jobDelayMs, 500),
  }, {
    attempts: 1,
    jobId: ['phase3-worker-scaleout', safeProofId, 'locked', String(sequence)].join('-'),
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  lockedJobs.push(job);
}

const lockProof = {
  lockKey,
  jobs: await Promise.all(lockedJobs.map((job) => waitForJob(job, 'distributed-lock'))),
};
const metricsAfter = await waitForElectrumOwner();

console.log(JSON.stringify({
  proofId,
  totalDurationMs: Date.now() - proofStartedAt,
  workers,
  workerCount: workers.length,
  metricsBefore,
  metricsAfter,
  repeatableJobs,
  jobs,
  lockProof,
}));

await maintenanceEvents.close();
await Promise.all([...queues.values()].map((queue) => queue.close()));
`;
}

function getBackendScaleOutProofScript() {
  return `
const proofId = process.env.PHASE3_BACKEND_SCALE_OUT_PROOF_ID || String(Date.now());
const timeoutMs = Number(process.env.PHASE3_BACKEND_SCALE_OUT_PROOF_TIMEOUT_MS || '60000');
const username = process.env.SANCTUARY_BENCHMARK_USERNAME || 'admin';
const password = process.env.SANCTUARY_BENCHMARK_PASSWORD || 'sanctuary';
const backends = JSON.parse(process.env.PHASE3_BACKEND_SCALE_OUT_TARGETS || '[]');
const proofStartedAt = Date.now();
const walletDescriptor = "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)";

if (backends.length < 2) {
  throw new Error('At least two backend targets are required for backend scale-out proof');
}

const websocketTarget = backends[0];
const triggerTarget = backends.find((target) => target.ip !== websocketTarget.ip) || backends[1];

function backendHttpUrl(target, path) {
  return 'http://' + target.ip + ':3001' + path;
}

function backendWsUrl(target) {
  return 'ws://' + target.ip + ':3001/ws';
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatBody(value) {
  return typeof value === 'string' ? value.slice(0, 300) : JSON.stringify(value).slice(0, 300);
}

async function apiJson(target, path, options = {}, expectedStatuses = [200]) {
  const headers = { Accept: 'application/json' };
  let body;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = 'Bearer ' + options.token;
  }

  const response = await fetch(backendHttpUrl(target, path), {
    method: options.method || 'GET',
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error((options.method || 'GET') + ' ' + path + ' on ' + target.name + ' returned ' + response.status + ': ' + formatBody(parsed));
  }
  return { status: response.status, body: parsed };
}

async function login(target) {
  const response = await apiJson(target, '/api/v1/auth/login', {
    method: 'POST',
    body: {
      username,
      password,
    },
  });

  if (response.body && typeof response.body === 'object' && response.body.requires2FA) {
    throw new Error('benchmark user requires 2FA; provide a non-2FA local proof user');
  }

  if (!response.body || typeof response.body !== 'object' || typeof response.body.token !== 'string') {
    throw new Error('login response from ' + target.name + ' did not include an access token');
  }

  return response.body.token;
}

async function createProofWallet(target, token) {
  const walletName = 'Phase 3 Scale-Out Wallet ' + proofId;
  const response = await apiJson(target, '/api/v1/wallets', {
    method: 'POST',
    token,
    body: {
      name: walletName,
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet',
      descriptor: walletDescriptor,
    },
  }, [201]);

  if (!response.body || typeof response.body !== 'object' || typeof response.body.id !== 'string') {
    throw new Error('wallet creation response from ' + target.name + ' did not include an id');
  }

  return {
    id: response.body.id,
    name: response.body.name || walletName,
    addressCount: response.body.addressCount ?? null,
  };
}

function connectSubscribedWebSocket(target, token, walletId) {
  return new Promise((resolve, reject) => {
    const channels = ['wallet:' + walletId, 'wallet:' + walletId + ':sync', 'sync:all'];
    const startedAt = Date.now();
    const socket = new WebSocket(backendWsUrl(target));
    let setupDone = false;
    let eventWait = null;
    let settled = false;

    const setupTimer = setTimeout(() => {
      fail(new Error('websocket setup timeout on ' + target.name));
    }, timeoutMs);

    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(setupTimer);
      try {
        socket.close();
      } catch {
        // Socket may already be closed.
      }
      reject(error);
    }

    function finishSetup() {
      if (settled) return;
      settled = true;
      setupDone = true;
      clearTimeout(setupTimer);
      resolve({
        target,
        channels,
        setupDurationMs: Date.now() - startedAt,
        waitForSyncEvent,
        close: () => {
          try {
            socket.close();
          } catch {
            // Socket may already be closed.
          }
        },
      });
    }

    function waitForSyncEvent() {
      if (!setupDone) {
        return Promise.resolve({ ok: false, error: 'websocket setup did not finish' });
      }

      if (eventWait) {
        return Promise.resolve({ ok: false, error: 'event wait already registered' });
      }

      return new Promise((waitResolve) => {
        const eventStartedAt = Date.now();
        const eventTimer = setTimeout(() => {
          eventWait = null;
          waitResolve({
            ok: false,
            durationMs: Date.now() - eventStartedAt,
            error: 'cross-instance sync event timeout',
          });
        }, timeoutMs);

        eventWait = {
          resolve: (record) => {
            clearTimeout(eventTimer);
            eventWait = null;
            waitResolve({
              durationMs: Date.now() - eventStartedAt,
              ...record,
            });
          },
        };
      });
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'auth', data: { token } }));
    });

    socket.addEventListener('message', (event) => {
      const parsed = parseJson(String(event.data));

      if (
        setupDone
        && eventWait
        && parsed
        && typeof parsed === 'object'
        && parsed.type === 'event'
        && parsed.event === 'sync'
        && (parsed.channel === 'wallet:' + walletId || parsed.channel === 'wallet:' + walletId + ':sync')
      ) {
        eventWait.resolve({
          ok: true,
          event: parsed.event,
          channel: parsed.channel,
          data: parsed.data,
        });
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      if (parsed.type === 'authenticated') {
        if (parsed.data && parsed.data.success === false) {
          fail(new Error('websocket authentication failed on ' + target.name));
          return;
        }
        socket.send(JSON.stringify({ type: 'subscribe_batch', data: { channels } }));
        return;
      }

      if (parsed.type === 'subscribed_batch') {
        const subscribed = Array.isArray(parsed.data?.subscribed) ? parsed.data.subscribed : [];
        const errors = Array.isArray(parsed.data?.errors) ? parsed.data.errors : [];
        const required = ['wallet:' + walletId, 'wallet:' + walletId + ':sync'];
        const missing = required.filter((channel) => !subscribed.includes(channel));

        if (missing.length > 0 || errors.length > 0) {
          fail(new Error('subscription failed on ' + target.name + '; missing=' + (missing.join(',') || 'none') + ' errors=' + JSON.stringify(errors)));
          return;
        }

        finishSetup();
        return;
      }

      if (!setupDone && parsed.type === 'error') {
        fail(new Error(parsed.data?.message || 'websocket error message received during setup'));
      }
    });

    socket.addEventListener('error', () => {
      if (!setupDone) {
        fail(new Error('websocket setup error on ' + target.name));
      } else if (eventWait) {
        eventWait.resolve({ ok: false, error: 'websocket error before sync event' });
      }
    });

    socket.addEventListener('close', () => {
      if (!setupDone) {
        fail(new Error('websocket closed during setup on ' + target.name));
      } else if (eventWait) {
        eventWait.resolve({ ok: false, error: 'websocket closed before sync event' });
      }
    });
  });
}

const token = await login(triggerTarget);
const wallet = await createProofWallet(triggerTarget, token);
const socketProof = await connectSubscribedWebSocket(websocketTarget, token, wallet.id);
const eventPromise = socketProof.waitForSyncEvent();
const triggerStartedAt = Date.now();
const triggerResponse = await apiJson(triggerTarget, '/api/v1/sync/queue/' + encodeURIComponent(wallet.id), {
  method: 'POST',
  token,
  body: { priority: 'high' },
});
const event = await eventPromise;
socketProof.close();

console.log(JSON.stringify({
  proofId,
  totalDurationMs: Date.now() - proofStartedAt,
  backends,
  websocketTarget,
  triggerTarget,
  wallet,
  websocket: {
    url: backendWsUrl(websocketTarget),
    setupDurationMs: socketProof.setupDurationMs,
    channels: socketProof.channels,
  },
  trigger: {
    url: backendHttpUrl(triggerTarget, '/api/v1/sync/queue/' + encodeURIComponent(wallet.id)),
    status: triggerResponse.status,
    durationMs: Date.now() - triggerStartedAt,
    body: triggerResponse.body,
  },
  event,
}));
`;
}
