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

function inspectContainerState(containerId) {
  const output = runDocker(['inspect', containerId]);
  const inspected = JSON.parse(output);
  return inspected?.[0]?.State || {};
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

    for (const status of requiredStatuses) {
      if (!scenario.statusCounts || !scenario.statusCounts[status]) {
        throw new Error(`Required scenario "${scenarioName}" did not record HTTP ${status}: ${JSON.stringify(scenario)}`);
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

  lines.push(
    '## Containers',
    '',
    ...report.composePs.map((container) => `- ${container.service}: state=${container.state}${container.health ? ` health=${container.health}` : ''}`),
    '',
    '## Notes',
    '',
    '- This proof starts a disposable full-stack Docker Compose project with frontend, backend, gateway, worker, Redis, and PostgreSQL services.',
    '- The smoke waits for database migration and seed completion, then runs the existing Phase 3 benchmark harness with local fixture provisioning.',
    '- The run proves authenticated wallet list, transaction-history, wallet-sync queue, and admin backup-validation paths execute end to end on a local seeded stack.',
    '- The local generated wallet is smoke evidence only; a representative large-wallet dataset and backend scale-out proof remain required before claiming Phase 3 complete.',
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
