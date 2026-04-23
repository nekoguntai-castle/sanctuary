#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
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
const wsFanoutClients = readPositiveInt(process.env.SANCTUARY_WS_FANOUT_CLIENTS, wsClients);
const timeoutMs = readPositiveInt(process.env.SANCTUARY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
let token = process.env.SANCTUARY_TOKEN || '';
let adminToken = process.env.SANCTUARY_ADMIN_TOKEN || token;
let walletId = process.env.SANCTUARY_WALLET_ID || '';
const backupFile = process.env.SANCTUARY_BACKUP_FILE || '';
const allowRestore = process.env.SANCTUARY_ALLOW_RESTORE === 'true';
const strictMode = process.env.SANCTUARY_BENCHMARK_STRICT === 'true';
const provisionLocalFixture = process.env.SANCTUARY_BENCHMARK_PROVISION === 'true';
const allowPrivateProvisionTarget = process.env.SANCTUARY_BENCHMARK_ALLOW_PRIVATE_PROVISION === 'true';
const allowExternalBackupUpload = process.env.SANCTUARY_BENCHMARK_ALLOW_EXTERNAL_BACKUP_UPLOAD === 'true';
const createBenchmarkBackup = process.env.SANCTUARY_BENCHMARK_CREATE_BACKUP === 'true';
const benchmarkUsername = process.env.SANCTUARY_BENCHMARK_USERNAME || 'admin';
const benchmarkPassword = process.env.SANCTUARY_BENCHMARK_PASSWORD || 'sanctuary';
const benchmarkWalletName = process.env.SANCTUARY_BENCHMARK_WALLET_NAME || 'Phase 3 Benchmark Wallet';
const benchmarkWalletNetwork = process.env.SANCTUARY_BENCHMARK_WALLET_NETWORK || 'testnet';
const benchmarkWalletDescriptor = process.env.SANCTUARY_BENCHMARK_WALLET_DESCRIPTOR
  || "wpkh([aabbccdd/84'/1'/0']tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M/0/*)";

const timestamp = new Date().toISOString();
const runId = timestamp.replace(/[:.]/g, '-');
const commit = readCommit();

const notes = [];
const scenarios = [];
const skipped = [];
const fixture = {
  provisionRequested: provisionLocalFixture,
  privateProvisionAllowed: allowPrivateProvisionTarget,
  tokenSource: token ? 'environment' : null,
  walletSource: walletId ? 'environment' : null,
  backupSource: backupFile ? 'file' : null,
};
let generatedBackup = null;

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

  await measureHttpScenario({
    name: 'api health',
    method: 'GET',
    url: `${apiBaseUrl}/api/v1/health`,
    requests: requestCount,
    expectedStatuses: [200, 503],
    allowDegradedStatus: true,
  });

  if (provisionLocalFixture) {
    await provisionBenchmarkFixture();
  }

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
    await measureWebSocketSubscriptionFanout();

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
    skipScenario('websocket subscription fanout', 'SANCTUARY_TOKEN and SANCTUARY_WALLET_ID are required');
    skipScenario('wallet sync queue', 'SANCTUARY_TOKEN and SANCTUARY_WALLET_ID are required');
  }

  if (adminToken && (backupFile || generatedBackup)) {
    if (backupFile) {
      assertBackupUploadTarget();
    }
    const backup = generatedBackup || await readBackup(backupFile);
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
      wsFanoutClients,
      timeoutMs,
      trustedExtraCa: Boolean(process.env.NODE_EXTRA_CA_CERTS),
      authenticatedHttp: Boolean(token),
      adminBackupInput: Boolean(adminToken && (backupFile || generatedBackup)),
      allowRestore,
      fixture,
      datasetLabel: getDatasetLabel(),
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

async function provisionBenchmarkFixture() {
  try {
    assertLocalProvisionTarget();

    if (!token) {
      const login = await apiJson(`${apiBaseUrl}/api/v1/auth/login`, {
        method: 'POST',
        body: {
          username: benchmarkUsername,
          password: benchmarkPassword,
        },
      });

      if (login && typeof login === 'object' && login.requires2FA) {
        skipScenario('local fixture login', 'benchmark user requires 2FA; provide SANCTUARY_TOKEN instead');
        return;
      }

      // Phase 6: the login response body no longer carries a `token`
      // field. The access JWT is in the sanctuary_access Set-Cookie
      // header, which apiJson attaches as a non-enumerable property.
      const extractedToken = extractAccessTokenFromSetCookie(login && login.__setCookie);
      if (!extractedToken) {
        throw new Error('login response did not include an access token in Set-Cookie');
      }

      token = extractedToken;
      fixture.tokenSource = 'local-login';
      notes.push({
        type: 'fixture',
        action: 'login',
        username: benchmarkUsername,
      });
    }

    if (!adminToken) {
      adminToken = token;
      fixture.adminTokenSource = fixture.tokenSource;
    }

    if (!walletId && token) {
      walletId = await ensureBenchmarkWallet(token);
    }

    if (createBenchmarkBackup && !backupFile && !generatedBackup && adminToken) {
      try {
        generatedBackup = await apiJson(`${apiBaseUrl}/api/v1/admin/backup`, {
          method: 'POST',
          token: adminToken,
          body: {
            includeCache: false,
            description: `Phase 3 benchmark fixture ${runId}`,
          },
        });
        fixture.backupSource = 'local-admin-api';
        notes.push({
          type: 'fixture',
          action: 'backup-create',
        });
      } catch (error) {
        const reason = getErrorMessage(error);
        fixture.backupError = reason;
        skipScenario('local fixture backup', reason);
      }
    }
  } catch (error) {
    const reason = getErrorMessage(error);
    fixture.error = reason;
    skipScenario('local fixture provisioning', reason);
  }
}

async function ensureBenchmarkWallet(bearerToken) {
  const wallets = await apiJson(`${apiBaseUrl}/api/v1/wallets`, {
    method: 'GET',
    token: bearerToken,
  });
  if (Array.isArray(wallets)) {
    const existing = wallets.find((wallet) => wallet?.name === benchmarkWalletName);
    if (existing?.id) {
      fixture.walletSource = 'local-existing';
      notes.push({
        type: 'fixture',
        action: 'wallet-reuse',
        walletName: benchmarkWalletName,
      });
      return existing.id;
    }
  }

  const wallet = await apiJson(`${apiBaseUrl}/api/v1/wallets`, {
    method: 'POST',
    token: bearerToken,
    body: {
      name: benchmarkWalletName,
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: benchmarkWalletNetwork,
      descriptor: benchmarkWalletDescriptor,
    },
  }, [201]);

  if (!wallet.id) {
    throw new Error('wallet creation response did not include an id');
  }

  fixture.walletSource = 'local-created';
  notes.push({
    type: 'fixture',
    action: 'wallet-create',
    walletName: benchmarkWalletName,
    network: benchmarkWalletNetwork,
  });
  return wallet.id;
}

// ADR 0001 / 0002 Phase 6: browser auth is cookie-only. The /auth/login
// response no longer carries a `token` field in the JSON body — the
// access and refresh JWTs are delivered via Set-Cookie. This helper
// parses the sanctuary_access cookie out of the response so the
// benchmark script can continue to pass the JWT as `Authorization:
// Bearer` on subsequent calls (which the backend accepts — the bearer
// path is preserved for mobile/gateway/tooling, it's just no longer
// reachable via the response body).
function extractAccessTokenFromSetCookie(setCookieHeaders) {
  if (!setCookieHeaders) return null;
  const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const cookie of cookies) {
    if (typeof cookie !== 'string') continue;
    if (!cookie.startsWith('sanctuary_access=')) continue;
    const firstAttr = cookie.split(';')[0];
    const value = firstAttr.slice('sanctuary_access='.length);
    if (value) return value;
  }
  return null;
}

async function apiJson(url, options = {}, expectedStatuses = [200]) {
  const headers = { Accept: 'application/json' };
  let encodedBody;
  if (options.body !== undefined) {
    encodedBody = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: encodedBody,
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = parseJson(text);

    // Phase 6: callers that need auth tokens read them from the
    // sanctuary_access Set-Cookie header. getSetCookie() returns an
    // array; we expose it as a non-enumerable property on the parsed
    // body so existing `const body = await apiJson(...)` callers keep
    // working unchanged and only login-like callers reach for it.
    if (parsed && typeof parsed === 'object') {
      const setCookie = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : response.headers.get('set-cookie');
      Object.defineProperty(parsed, '__setCookie', {
        value: setCookie,
        enumerable: false,
        configurable: true,
      });
    }

    if (!expectedStatuses.includes(response.status)) {
      throw new Error(`${options.method || 'GET'} ${sanitizeUrl(url)} returned ${response.status}`);
    }

    return parsed;
  } finally {
    clearTimeout(timer);
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
      }); // lgtm[js/file-access-to-http] Backup uploads are restricted to loopback/private targets unless explicitly overridden.
      records.push({
        ok: expectedStatuses.includes(response.status),
        status: response.status,
        durationMs: performance.now() - startedAt,
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

  const summary = summarizeHttp(name, method, url, records, expectedStatuses, optional, allowDegradedStatus);
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

async function measureWebSocketSubscriptionFanout() {
  if (typeof WebSocket !== 'function') {
    skipScenario('websocket subscription fanout', 'global WebSocket is not available in this Node runtime');
    return;
  }

  const channels = [`wallet:${walletId}`, `wallet:${walletId}:sync`, 'sync:all'];
  const triggerUrl = `${apiBaseUrl}/api/v1/sync/queue/${encodeURIComponent(walletId)}`;
  const clients = await Promise.all(
    Array.from({ length: wsFanoutClients }, (_value, index) => connectSubscribedWebSocket(index, channels))
  );
  const setupRecords = clients.map((client) => client.setup);
  const setupFailures = setupRecords.filter((record) => !record.ok);

  if (setupFailures.length > 0) {
    clients.forEach((client) => client.close('subscription setup failed'));
    const summary = {
      name: 'websocket subscription fanout',
      kind: 'websocket',
      url: sanitizeUrl(wsUrl),
      status: 'failed',
      requests: clients.length,
      successes: 0,
      errors: setupFailures.length,
      latency: summarizeDurations(setupRecords.map((record) => record.durationMs)),
      setupLatency: summarizeDurations(setupRecords.map((record) => record.durationMs)),
      channels,
      failures: setupFailures
        .map((record) => record.error)
        .filter(Boolean)
        .slice(0, 5),
    };

    scenarios.push(summary);
    console.log(`${summary.status.toUpperCase()} websocket subscription fanout: p95=${summary.latency.p95Ms ?? 'n/a'}ms errors=${summary.errors}`);
    return;
  }

  const eventWaits = clients.map((client) => client.waitForSyncEvent());
  let triggerStatus = null;
  let triggerError = null;

  try {
    const response = await fetch(triggerUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ priority: 'high' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    triggerStatus = response.status;

    if (!response.ok) {
      triggerError = `POST ${sanitizeUrl(triggerUrl)} returned ${response.status}`;
    }
  } catch (error) {
    triggerError = getErrorMessage(error);
  }

  if (triggerError) {
    clients.forEach((client) => client.close(`trigger failed: ${triggerError}`));
  }

  const fanoutRecords = await Promise.all(eventWaits);
  clients.forEach((client) => client.close());

  const successful = triggerError ? [] : fanoutRecords.filter((record) => record.ok);
  const failures = [
    triggerError,
    ...fanoutRecords.filter((record) => !record.ok).map((record) => record.error),
  ].filter(Boolean);
  const summary = {
    name: 'websocket subscription fanout',
    kind: 'websocket',
    url: sanitizeUrl(wsUrl),
    status: successful.length === fanoutRecords.length ? 'passed' : successful.length > 0 ? 'partial' : 'failed',
    requests: fanoutRecords.length,
    successes: successful.length,
    errors: fanoutRecords.length - successful.length,
    latency: summarizeDurations(fanoutRecords.map((record) => record.durationMs)),
    setupLatency: summarizeDurations(setupRecords.map((record) => record.durationMs)),
    channels,
    trigger: {
      method: 'POST',
      url: sanitizeUrl(triggerUrl),
      status: triggerStatus,
      error: triggerError,
    },
    messages: [...new Set(successful.map((record) => `${record.event}:${record.channel}`))],
    failures: failures.slice(0, 5),
  };

  scenarios.push(summary);
  console.log(`${summary.status.toUpperCase()} websocket subscription fanout: p95=${summary.latency.p95Ms ?? 'n/a'}ms errors=${summary.errors}`);
}

function connectSubscribedWebSocket(index, channels) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const socket = new WebSocket(wsUrl);
    let setupSettled = false;
    let closed = false;
    let fanoutWait = null;
    const timer = setTimeout(() => {
      finishSetup({
        ok: false,
        error: 'websocket subscription setup timeout',
      });
    }, timeoutMs);

    function finishSetup(record) {
      if (setupSettled) return;
      setupSettled = true;
      clearTimeout(timer);

      const setup = {
        client: index,
        durationMs: performance.now() - startedAt,
        ...record,
      };

      if (!setup.ok) {
        closeSocket();
      }

      resolve({
        setup,
        waitForSyncEvent,
        close: (reason) => {
          resolveFanoutWait({
            ok: false,
            error: reason || 'socket closed before sync event',
          });
          closeSocket();
        },
      });
    }

    function waitForSyncEvent() {
      if (closed) {
        return Promise.resolve({
          client: index,
          durationMs: 0,
          ok: false,
          error: 'websocket already closed before sync event wait',
        });
      }

      if (fanoutWait) {
        return Promise.resolve({
          client: index,
          durationMs: 0,
          ok: false,
          error: 'websocket sync event wait already registered',
        });
      }

      return new Promise((waitResolve) => {
        const fanoutStartedAt = performance.now();
        const fanoutTimer = setTimeout(() => {
          fanoutWait = null;
          waitResolve({
            client: index,
            durationMs: performance.now() - fanoutStartedAt,
            ok: false,
            error: 'websocket sync event timeout',
          });
        }, timeoutMs);

        fanoutWait = {
          startedAt: fanoutStartedAt,
          timer: fanoutTimer,
          resolve: waitResolve,
        };
      });
    }

    function resolveFanoutWait(record) {
      if (!fanoutWait) return;
      const current = fanoutWait;
      fanoutWait = null;
      clearTimeout(current.timer);
      current.resolve({
        client: index,
        durationMs: performance.now() - current.startedAt,
        ...record,
      });
    }

    function closeSocket() {
      if (closed) return;
      closed = true;
      try {
        socket.close();
      } catch {
        // Socket may already be closed.
      }
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'auth', data: { token } }));
    });

    socket.addEventListener('message', (event) => {
      const parsed = parseJson(String(event.data));

      if (setupSettled && isSyncFanoutEvent(parsed)) {
        resolveFanoutWait({
          ok: true,
          event: parsed.event,
          channel: parsed.channel,
        });
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      if (parsed.type === 'authenticated') {
        if (parsed.data && parsed.data.success === false) {
          finishSetup({
            ok: false,
            error: 'websocket authentication failed',
          });
          return;
        }

        socket.send(JSON.stringify({ type: 'subscribe_batch', data: { channels } }));
        return;
      }

      if (parsed.type === 'subscribed_batch') {
        const subscribed = Array.isArray(parsed.data?.subscribed) ? parsed.data.subscribed : [];
        const errors = Array.isArray(parsed.data?.errors) ? parsed.data.errors : [];
        const missing = channels.filter((channel) => !subscribed.includes(channel));

        if (missing.length > 0 || errors.length > 0) {
          finishSetup({
            ok: false,
            error: `subscription failed; missing=${missing.join(',') || 'none'} errors=${JSON.stringify(errors)}`,
          });
          return;
        }

        finishSetup({ ok: true });
        return;
      }

      if (parsed.type === 'error') {
        finishSetup({
          ok: false,
          error: parsed.data?.message || 'websocket error message received during setup',
        });
      }
    });

    socket.addEventListener('error', () => {
      if (!setupSettled) {
        finishSetup({ ok: false, error: 'websocket setup error' });
      } else {
        resolveFanoutWait({ ok: false, error: 'websocket error before sync event' });
      }
    });

    socket.addEventListener('close', () => {
      closed = true;
      if (!setupSettled) {
        finishSetup({ ok: false, error: 'websocket closed during subscription setup' });
      } else {
        resolveFanoutWait({ ok: false, error: 'websocket closed before sync event' });
      }
    });
  });
}

function isSyncFanoutEvent(value) {
  return value
    && typeof value === 'object'
    && value.type === 'event'
    && value.event === 'sync'
    && (value.channel === `wallet:${walletId}` || value.channel === `wallet:${walletId}:sync`);
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

function summarizeHttp(name, method, url, records, expectedStatuses, optional, allowDegradedStatus) {
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
    sampleBodies: [],
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
    `Dataset: ${result.environment.datasetLabel}`,
    `Traffic shape: ${result.environment.requestCount} HTTP requests per default scenario at concurrency ${result.environment.concurrency}; ${result.environment.wsClients} WebSocket handshake clients; ${result.environment.wsFanoutClients} WebSocket fanout clients`,
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
    '## Fixture',
    '',
    `Provision requested: ${result.environment.fixture.provisionRequested ? 'yes' : 'no'}`,
    `Private target allowed: ${result.environment.fixture.privateProvisionAllowed ? 'yes' : 'no'}`,
    `Token source: ${result.environment.fixture.tokenSource || 'none'}`,
    `Wallet source: ${result.environment.fixture.walletSource || 'none'}`,
    `Backup source: ${result.environment.fixture.backupSource || 'none'}`
  );
  if (result.environment.fixture.error) {
    lines.push(`Provision error: ${result.environment.fixture.error}`);
  }
  if (result.environment.fixture.backupError) {
    lines.push(`Backup error: ${result.environment.fixture.backupError}`);
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
      ? 'Smoke evidence captured for the configured inputs. A-grade scale claims require privacy-safe calibrated inputs for wallet sync, transaction history, WebSocket fanout, backup/restore, queue processing, and scale-out scenarios.'
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

function assertLocalProvisionTarget() {
  if (isLocalUrl(apiBaseUrl)) {
    return;
  }
  if (allowPrivateProvisionTarget && isPrivateNetworkUrl(apiBaseUrl)) {
    return;
  }

  const privateHint = isPrivateNetworkUrl(apiBaseUrl)
    ? '; set SANCTUARY_BENCHMARK_ALLOW_PRIVATE_PROVISION=true only for private non-production targets'
    : '';
  throw new Error(`SANCTUARY_BENCHMARK_PROVISION=true is only allowed for localhost, 127.0.0.1, or ::1 API targets by default${privateHint}`);
}

function assertBackupUploadTarget() {
  if (isLocalUrl(apiBaseUrl) || isPrivateNetworkUrl(apiBaseUrl) || allowExternalBackupUpload) {
    return;
  }

  throw new Error('SANCTUARY_BACKUP_FILE uploads are only allowed to loopback/private API targets by default; set SANCTUARY_BENCHMARK_ALLOW_EXTERNAL_BACKUP_UPLOAD=true only for an operator-owned non-production target');
}

function getDatasetLabel() {
  if (!token) {
    return 'unauthenticated smoke only';
  }

  if (fixture.walletSource === 'local-created' || fixture.walletSource === 'local-existing') {
    return 'local auto-provisioned benchmark fixture; not a large-wallet performance dataset';
  }

  if (provisionLocalFixture && !walletId) {
    return 'authenticated local provisioning incomplete; wallet-dependent scenarios skipped';
  }

  return 'operator-provided privacy-safe authenticated dataset';
}

function isLocalUrl(value) {
  const hostname = new URL(value).hostname;
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
}

function isPrivateNetworkUrl(value) {
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, '');
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const [first, second] = hostname.split('.').map((part) => Number.parseInt(part, 10));
    return first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 169 && second === 254);
  }
  if (ipVersion === 6) {
    const normalized = hostname.toLowerCase();
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return false;
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
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
}

function round(value) {
  return Math.round(value * 100) / 100;
}
