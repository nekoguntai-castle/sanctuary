#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_REQUESTS = 20;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_WS_CLIENTS = 5;
const DEFAULT_TIMEOUT_MS = 15000;

const apiBaseUrl = trimTrailingSlash(process.env.SANCTUARY_API_URL || 'https://127.0.0.1:8443');
const gatewayBaseUrl = process.env.SANCTUARY_GATEWAY_URL
  ? trimTrailingSlash(process.env.SANCTUARY_GATEWAY_URL)
  : 'https://127.0.0.1:4000';
const wsUrl = process.env.SANCTUARY_WS_URL || deriveWebSocketUrl(apiBaseUrl);
const outputDir = process.env.SANCTUARY_OUTPUT_DIR || 'docs/plans';
const requestCount = readPositiveInt(process.env.SANCTUARY_REQUESTS, DEFAULT_REQUESTS);
const concurrency = readPositiveInt(process.env.SANCTUARY_CONCURRENCY, DEFAULT_CONCURRENCY);
const wsClients = readPositiveInt(process.env.SANCTUARY_WS_CLIENTS, DEFAULT_WS_CLIENTS);
const timeoutMs = readPositiveInt(process.env.SANCTUARY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const token = process.env.SANCTUARY_TOKEN || '';
const adminToken = process.env.SANCTUARY_ADMIN_TOKEN || token;
const walletId = process.env.SANCTUARY_WALLET_ID || '';
const backupFile = process.env.SANCTUARY_BACKUP_FILE || '';
const allowRestore = process.env.SANCTUARY_ALLOW_RESTORE === 'true';
const strictMode = process.env.SANCTUARY_BENCHMARK_STRICT === 'true';

if (shouldAllowInsecureTls(apiBaseUrl, gatewayBaseUrl)) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const timestamp = new Date().toISOString();
const runId = timestamp.replace(/[:.]/g, '-');
const commit = readCommit();

const notes = [];
const scenarios = [];
const skipped = [];

console.log(`Phase 3 benchmark run ${runId}`);
console.log(`API: ${apiBaseUrl}`);
console.log(`WebSocket: ${wsUrl}`);

process.on('unhandledRejection', (error) => {
  const command = basename(process.argv[1] || 'phase3-benchmark');
  console.error(`${command} failed: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});

try {
  await run();
} catch (error) {
  const command = basename(process.argv[1] || 'phase3-benchmark');
  console.error(`${command} failed: ${getErrorMessage(error)}`);
  process.exitCode = 1;
}

async function run() {
  await mkdir(outputDir, { recursive: true });

  await measureHttpScenario({
    name: 'frontend health',
    method: 'GET',
    url: `${apiBaseUrl}/health`,
    requests: requestCount,
    expectedStatuses: [200],
  });

  const apiHealth = await measureHttpScenario({
    name: 'api health',
    method: 'GET',
    url: `${apiBaseUrl}/api/v1/health`,
    requests: requestCount,
    expectedStatuses: [200, 503],
    allowDegradedStatus: true,
    captureBody: true,
  });
  recordHealthSnapshot(apiHealth);

  await measureHttpScenario({
    name: 'gateway health',
    method: 'GET',
    url: `${gatewayBaseUrl}/health`,
    requests: Math.min(requestCount, 10),
    expectedStatuses: [200],
    optional: true,
  });

  await measureWebSocketHandshake();

  if (token) {
    await measureHttpScenario({
      name: 'wallet list',
      method: 'GET',
      url: `${apiBaseUrl}/api/v1/wallets`,
      token,
      requests: requestCount,
      expectedStatuses: [200],
    });
  } else {
    skipScenario('wallet list', 'SANCTUARY_TOKEN was not provided');
  }

  if (token && walletId) {
    await measureHttpScenario({
      name: 'large wallet transaction history',
      method: 'GET',
      url: `${apiBaseUrl}/api/v1/wallets/${encodeURIComponent(walletId)}/transactions?limit=50&offset=0`,
      token,
      requests: requestCount,
      expectedStatuses: [200],
    });

    await measureHttpScenario({
      name: 'wallet sync queue',
      method: 'POST',
      url: `${apiBaseUrl}/api/v1/sync/queue/${encodeURIComponent(walletId)}`,
      token,
      body: { priority: 'low' },
      requests: Math.min(requestCount, 5),
      expectedStatuses: [200],
    });
  } else {
    skipScenario('large wallet transaction history', 'SANCTUARY_TOKEN and SANCTUARY_WALLET_ID are required');
    skipScenario('wallet sync queue', 'SANCTUARY_TOKEN and SANCTUARY_WALLET_ID are required');
  }

  if (adminToken && backupFile) {
    const backup = await readBackup(backupFile);
    await measureHttpScenario({
      name: 'backup validate',
      method: 'POST',
      url: `${apiBaseUrl}/api/v1/admin/backup/validate`,
      token: adminToken,
      body: { backup },
      requests: 1,
      expectedStatuses: [200, 400],
      allowDegradedStatus: true,
    });

    if (allowRestore) {
      await measureHttpScenario({
        name: 'backup restore',
        method: 'POST',
        url: `${apiBaseUrl}/api/v1/admin/restore`,
        token: adminToken,
        body: { backup, confirmationCode: 'CONFIRM_RESTORE' },
        requests: 1,
        expectedStatuses: [200],
      });
    } else {
      skipScenario('backup restore', 'SANCTUARY_ALLOW_RESTORE=true is required because restore is destructive');
    }
  } else {
    skipScenario('backup validate', 'SANCTUARY_ADMIN_TOKEN and SANCTUARY_BACKUP_FILE are required');
    skipScenario('backup restore', 'SANCTUARY_ADMIN_TOKEN, SANCTUARY_BACKUP_FILE, and SANCTUARY_ALLOW_RESTORE=true are required');
  }

  const result = {
    runId,
    timestamp,
    commit,
    environment: {
      apiBaseUrl,
      gatewayBaseUrl,
      wsUrl,
      requestCount,
      concurrency,
      wsClients,
      timeoutMs,
      insecureTls: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
      authenticatedHttp: Boolean(token),
      adminBackupInput: Boolean(adminToken && backupFile),
      allowRestore,
    },
    notes,
    scenarios,
    skipped,
  };

  const jsonPath = join(outputDir, `phase3-benchmark-${runId}.json`);
  const mdPath = join(outputDir, `phase3-benchmark-${runId}.md`);
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(mdPath, renderMarkdown(result));

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);

  const failedScenarios = scenarios.filter((scenario) => scenario.status === 'failed');
  if (strictMode && failedScenarios.length > 0) {
    console.error(`Strict mode failed: ${failedScenarios.map((scenario) => scenario.name).join(', ')}`);
    process.exitCode = 1;
  }
}

async function measureHttpScenario(options) {
  const {
    name,
    method,
    url,
    body,
    token: bearerToken,
    requests,
    expectedStatuses,
    optional = false,
    allowDegradedStatus = false,
    captureBody = false,
  } = options;
  const records = [];

  await runPool(requests, concurrency, async () => {
    const headers = { Accept: 'application/json' };
    let encodedBody;
    if (body !== undefined) {
      encodedBody = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    const startedAt = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: encodedBody,
        signal: controller.signal,
      });
      const responseBody = await response.text();
      records.push({
        ok: expectedStatuses.includes(response.status),
        status: response.status,
        durationMs: performance.now() - startedAt,
        body: captureBody ? parseJson(responseBody) : undefined,
      });
    } catch (error) {
      records.push({
        ok: false,
        error: getErrorMessage(error),
        durationMs: performance.now() - startedAt,
      });
    } finally {
      clearTimeout(timer);
    }
  });

  const summary = summarizeHttp(name, method, url, records, expectedStatuses, optional, allowDegradedStatus, captureBody);
  const recordedSummary = { ...summary };
  delete recordedSummary.sampleBodies;
  scenarios.push(recordedSummary);
  console.log(`${summary.status.toUpperCase()} ${name}: p95=${summary.latency.p95Ms ?? 'n/a'}ms errors=${summary.errors}`);
  return summary;
}

async function measureWebSocketHandshake() {
  if (typeof WebSocket !== 'function') {
    skipScenario('websocket handshake', 'global WebSocket is not available in this Node runtime');
    return;
  }

  const records = await Promise.all(
    Array.from({ length: wsClients }, () => measureOneWebSocket(wsUrl))
  );

  const successful = records.filter((record) => record.ok);
  const summary = {
    name: 'websocket handshake',
    kind: 'websocket',
    url: wsUrl,
    status: successful.length === records.length ? 'passed' : successful.length > 0 ? 'partial' : 'failed',
    requests: records.length,
    successes: successful.length,
    errors: records.length - successful.length,
    latency: summarizeDurations(records.map((record) => record.durationMs)),
    messages: records.map((record) => record.firstMessageType).filter(Boolean),
    failures: records
      .filter((record) => !record.ok)
      .map((record) => record.error)
      .slice(0, 5),
  };

  scenarios.push(summary);
  console.log(`${summary.status.toUpperCase()} websocket handshake: p95=${summary.latency.p95Ms ?? 'n/a'}ms errors=${summary.errors}`);
}

function measureOneWebSocket(targetUrl) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let settled = false;
    let firstMessageType;
    let openGraceTimer;
    const socket = new WebSocket(targetUrl);
    const timer = setTimeout(() => {
      finish({ ok: false, error: 'websocket timeout' });
    }, timeoutMs);

    const finish = (record) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(openGraceTimer);
      try {
        socket.close();
      } catch {
        // Socket may already be closed.
      }
      resolve({
        durationMs: performance.now() - startedAt,
        firstMessageType,
        ...record,
      });
    };

    socket.addEventListener('open', () => {
      openGraceTimer = setTimeout(() => {
        finish({ ok: true, warning: 'opened without server message' });
      }, 1000);
    });
    socket.addEventListener('message', (event) => {
      const parsed = parseJson(String(event.data));
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        firstMessageType = parsed.type;
      }
      finish({ ok: true });
    });
    socket.addEventListener('error', () => {
      finish({ ok: false, error: 'websocket error' });
    });
    socket.addEventListener('close', () => {
      finish({ ok: false, error: 'websocket closed before open' });
    });
  });
}

async function readBackup(path) {
  const content = await readFile(path, 'utf8');
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${getErrorMessage(error)}`);
  }
}

function recordHealthSnapshot(apiHealth) {
  const firstResponse = apiHealth.sampleBodies.find(Boolean);
  if (!firstResponse || typeof firstResponse !== 'object') {
    return;
  }

  const components = firstResponse.components && typeof firstResponse.components === 'object'
    ? firstResponse.components
    : {};
  notes.push({
    type: 'health',
    status: firstResponse.status,
    components: Object.fromEntries(
      Object.entries(components).map(([name, value]) => [
        name,
        value && typeof value === 'object' && 'status' in value ? value.status : 'unknown',
      ])
    ),
  });
}

function summarizeHttp(name, method, url, records, expectedStatuses, optional, allowDegradedStatus, captureBody) {
  const successes = records.filter((record) => record.ok);
  const failed = records.filter((record) => !record.ok);
  const statusCounts = {};
  for (const record of records) {
    const key = record.status ? String(record.status) : 'error';
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  }

  let status = failed.length === 0 ? 'passed' : successes.length > 0 && optional ? 'partial' : 'failed';
  if (allowDegradedStatus && successes.length === records.length) {
    status = 'passed';
  }

  return {
    name,
    kind: 'http',
    method,
    url: sanitizeUrl(url),
    status,
    requests: records.length,
    successes: successes.length,
    errors: failed.length,
    expectedStatuses,
    statusCounts,
    latency: summarizeDurations(records.map((record) => record.durationMs)),
    sampleBodies: captureBody
      ? records
        .map((record) => record.body)
        .filter(Boolean)
        .slice(0, 2)
      : [],
    failures: failed
      .map((record) => record.error || `status ${record.status}`)
      .slice(0, 5),
  };
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

async function runPool(total, limit, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, total) }, async () => {
    while (next < total) {
      next += 1;
      await worker();
    }
  });
  await Promise.all(workers);
}

function skipScenario(name, reason) {
  skipped.push({ name, reason });
  console.log(`SKIP ${name}: ${reason}`);
}

function renderMarkdown(result) {
  const lines = [
    '# Phase 3 Benchmark Run',
    '',
    `Date: ${result.timestamp}`,
    `Commit: ${result.commit}`,
    `Environment: ${result.environment.apiBaseUrl}`,
    `Topology: single frontend/backend/gateway/worker stack unless noted externally`,
    `Dataset: ${result.environment.authenticatedHttp ? 'operator-provided authenticated dataset' : 'unauthenticated smoke only'}`,
    `Traffic shape: ${result.environment.requestCount} HTTP requests per default scenario at concurrency ${result.environment.concurrency}; ${result.environment.wsClients} WebSocket handshake clients`,
    '',
    '## Scenario Results',
    '',
    '| Scenario | Kind | Status | Requests | Successes | Errors | p50 ms | p95 ms | p99 ms |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...result.scenarios.map((scenario) => [
      escapeCell(scenario.name),
      scenario.kind,
      scenario.status,
      scenario.requests,
      scenario.successes,
      scenario.errors,
      scenario.latency.p50Ms ?? '',
      scenario.latency.p95Ms ?? '',
      scenario.latency.p99Ms ?? '',
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    '',
    '## Skipped Scenarios',
    '',
  ];

  if (result.skipped.length === 0) {
    lines.push('None.');
  } else {
    for (const item of result.skipped) {
      lines.push(`- ${item.name}: ${item.reason}`);
    }
  }

  lines.push(
    '',
    '## Health Snapshot',
    ''
  );

  const health = result.notes.find((note) => note.type === 'health');
  if (health) {
    lines.push(`Overall status: ${health.status || 'unknown'}`, '');
    for (const [component, status] of Object.entries(health.components || {})) {
      lines.push(`- ${component}: ${status}`);
    }
  } else {
    lines.push('No API health snapshot captured.');
  }

  lines.push(
    '',
    '## Decision',
    '',
    result.skipped.length > 0
      ? 'Smoke evidence captured. Phase 3 is not complete until authenticated wallet sync, transaction history, backup/restore, queue processing, and scale-out scenarios have run with production-like data.'
      : 'Benchmark evidence captured for the configured scenarios. Compare p95/p99 and failure rates against the Phase 3 gates before promoting this run.'
  );

  return `${lines.join('\n')}\n`;
}

function deriveWebSocketUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/ws';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function shouldAllowInsecureTls(...urls) {
  const setting = process.env.SANCTUARY_INSECURE_TLS;
  if (setting === 'true') return true;
  if (setting === 'false') return false;

  return urls
    .filter(Boolean)
    .map((value) => new URL(value))
    .some((url) => ['127.0.0.1', 'localhost', '::1'].includes(url.hostname));
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readCommit() {
  if (process.env.SANCTUARY_BENCHMARK_COMMIT) {
    return process.env.SANCTUARY_BENCHMARK_COMMIT;
  }

  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function sanitizeUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/token|secret|password|key/i.test(key)) {
      url.searchParams.set(key, '[redacted]');
    }
  }
  return url.toString();
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function round(value) {
  return Math.round(value * 100) / 100;
}
