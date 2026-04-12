#!/usr/bin/env node

import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const outputDir = process.env.PHASE2_GATEWAY_AUDIT_OUTPUT_DIR || path.join(repoRoot, 'docs/plans');
const startedAt = new Date();
const timestamp = startedAt.toISOString().replace(/[:.]/g, '-');
const projectName = process.env.PHASE2_GATEWAY_AUDIT_PROJECT || `sanctuary-phase2-audit-${timestamp.toLowerCase()}`;
const keepStack = process.env.PHASE2_GATEWAY_AUDIT_KEEP_STACK === 'true';
const timeoutMs = Number(process.env.PHASE2_GATEWAY_AUDIT_TIMEOUT_MS || '240000');
const retryMs = Number(process.env.PHASE2_GATEWAY_AUDIT_RETRY_MS || '2000');

const postgresUser = 'sanctuary';
const postgresDb = 'sanctuary_phase2_audit';
const jwtSecret = 'phase2-gateway-audit-jwt-secret-32-characters';
const gatewaySecret = 'phase2-gateway-audit-gateway-secret-32-characters';
const proofUserAgent = `Phase2GatewayAuditComposeSmoke/${timestamp}`;
const unsignedUsername = `phase2-compose-unsigned-${timestamp.toLowerCase()}`;

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

const gatewayPort = process.env.PHASE2_GATEWAY_AUDIT_GATEWAY_PORT
  || process.env.GATEWAY_PORT
  || String(await findAvailablePort(14000));

const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
const gatewayInternalUrl = 'http://127.0.0.1:4000';
const composeArgs = ['compose', '-p', projectName, '-f', 'docker-compose.yml'];
const composeEnv = {
  ...process.env,
  NODE_ENV: 'production',
  LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
  POSTGRES_USER: postgresUser,
  POSTGRES_PASSWORD: 'phase2GatewayAuditPostgresPassword',
  POSTGRES_DB: postgresDb,
  REDIS_PASSWORD: 'phase2GatewayAuditRedisPassword',
  JWT_SECRET: jwtSecret,
  ENCRYPTION_KEY: 'phase2-gateway-audit-encryption-key-32-chars',
  ENCRYPTION_SALT: 'phase2-gateway-audit-encryption-salt',
  GATEWAY_SECRET: gatewaySecret,
  AI_CONFIG_SECRET: 'phase2-gateway-audit-ai-config-secret-32-characters',
  GATEWAY_TLS_ENABLED: 'false',
  TLS_ENABLED: 'false',
  GATEWAY_PORT: gatewayPort,
  HTTP_PORT: process.env.HTTP_PORT || '18080',
  HTTPS_PORT: process.env.HTTPS_PORT || '18443',
  WORKER_HEALTH_URL: 'http://worker:3002/ready',
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
    maxBuffer: 1024 * 1024 * 20,
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

function runGatewayNode(script) {
  return runCompose(['exec', '-T', 'gateway', 'node', '--input-type=module', '-e', script]).trim();
}

function parseLastJsonLine(output) {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep looking in case node or the service wrote another line first.
    }
  }

  throw new Error(`Expected JSON output, got: ${output}`);
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function queryPostgres(sql) {
  return runCompose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    postgresUser,
    '-d',
    postgresDb,
    '-Atc',
    sql,
  ]).trim();
}

async function waitForGatewayHttpJson(pathname) {
  const deadline = Date.now() + timeoutMs;
  let latestError;

  while (Date.now() < deadline) {
    try {
      const output = runGatewayNode(`
        const response = await fetch(${JSON.stringify(`${gatewayInternalUrl}${pathname}`)}, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        const body = await response.text();
        console.log(JSON.stringify({
          status: response.status,
          ok: response.ok,
          body: body ? JSON.parse(body) : null,
        }));
      `);
      const result = parseLastJsonLine(output);

      if (result.ok) {
        return result;
      }

      latestError = new Error(`HTTP ${result.status}: ${JSON.stringify(result.body).slice(0, 200)}`);
    } catch (error) {
      latestError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  throw latestError || new Error(`Timed out waiting for gateway ${pathname}`);
}

async function waitForAuditRow(userAgent) {
  const deadline = Date.now() + timeoutMs;
  const sql = `
    SELECT json_build_object(
      'action', "action",
      'username', "username",
      'category', "category",
      'success', "success",
      'errorMsg', "errorMsg",
      'source', "details"->>'source',
      'path', "details"->>'path',
      'severity', "details"->>'severity',
      'userAgent', "userAgent"
    )::text
    FROM "audit_logs"
    WHERE "action" = 'gateway.auth_missing_token'
      AND "userAgent" = ${sqlLiteral(userAgent)}
    ORDER BY "createdAt" DESC
    LIMIT 1;
  `;

  while (Date.now() < deadline) {
    const output = queryPostgres(sql);
    if (output) {
      return JSON.parse(output);
    }
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  throw new Error(`Timed out waiting for gateway audit row for user agent ${userAgent}`);
}

function assertNoUnsignedAuditRow(username) {
  const output = queryPostgres(`
    SELECT count(*)
    FROM "audit_logs"
    WHERE "action" = 'gateway.auth_failed'
      AND "username" = ${sqlLiteral(username)};
  `);
  const count = Number(output || '0');
  if (count !== 0) {
    throw new Error(`Expected zero unsigned audit rows, found ${count}`);
  }
}

function requestUnsignedGatewayAudit() {
  const script = `
    const response = await fetch('http://backend:3001/api/v1/push/gateway-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'AUTH_FAILED', username: ${JSON.stringify(unsignedUsername)} })
    });
    console.log(response.status);
  `;

  const output = runGatewayNode(script);
  const status = Number(output.split(/\s+/).pop());

  if (status !== 403) {
    throw new Error(`Expected unsigned gateway audit request to return 403, got ${output}`);
  }

  return status;
}

function requestProtectedGatewayRoute(userAgent) {
  const script = `
    const response = await fetch(${JSON.stringify(`${gatewayInternalUrl}/api/v1/wallets`)}, {
      headers: {
        Accept: 'application/json',
        'User-Agent': ${JSON.stringify(userAgent)}
      },
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.text();
    console.log(JSON.stringify({
      status: response.status,
      body: body.slice(0, 1000)
    }));
  `;

  return parseLastJsonLine(runGatewayNode(script));
}

function collectComposePs() {
  return runCompose(['ps', '--format', 'json'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((container) => ({
      service: container.Service,
      state: container.State,
      health: container.Health || '',
      publishers: container.Publishers || [],
    }));
}

async function waitForComposeHealthy() {
  const deadline = Date.now() + timeoutMs;
  let latestComposePs = [];

  while (Date.now() < deadline) {
    latestComposePs = collectComposePs();
    const unhealthy = latestComposePs.filter((container) => (
      container.state !== 'running' || (container.health && container.health !== 'healthy')
    ));

    if (unhealthy.length === 0) {
      return latestComposePs;
    }

    await new Promise((resolve) => setTimeout(resolve, retryMs));
  }

  const unhealthy = latestComposePs.filter((container) => (
    container.state !== 'running' || (container.health && container.health !== 'healthy')
  ));
  throw new Error(`Unhealthy containers: ${JSON.stringify(unhealthy)}`);
}

function assertNoGatewayAuditDeliveryErrors() {
  const logs = runCompose(['logs', '--no-color', '--tail', '200', 'gateway']);
  const deliveryErrorPattern = /Failed to send audit event to backend|Error sending audit event to backend/i;
  if (deliveryErrorPattern.test(logs)) {
    throw new Error('Gateway logs contain audit delivery errors');
  }
}

function buildMarkdown(report) {
  const lines = [
    '# Phase 2 Gateway Audit Compose Smoke',
    '',
    `Date: ${report.startedAt}`,
    `Status: ${report.passed ? 'Passed' : 'Failed'}`,
    `Compose project: ${report.projectName}`,
    `Gateway URL (published): ${report.gatewayUrl}`,
    `Gateway URL (in-container proof): ${report.gatewayInternalUrl}`,
    '',
    '## Results',
    '',
    ...report.steps.map((step) => `- ${step.passed ? 'PASS' : 'FAIL'} ${step.name}: ${step.summary}`),
    '',
    '## Audit Row',
    '',
    report.auditRow
      ? `- Action: ${report.auditRow.action}`
      : '- Action: not recorded',
    report.auditRow
      ? `- Username: ${report.auditRow.username}`
      : '- Username: not recorded',
    report.auditRow
      ? `- Category: ${report.auditRow.category}`
      : '- Category: not recorded',
    report.auditRow
      ? `- Success: ${report.auditRow.success}`
      : '- Success: not recorded',
    report.auditRow
      ? `- Error: ${report.auditRow.errorMsg || 'none'}`
      : '- Error: not recorded',
    report.auditRow
      ? `- Source: ${report.auditRow.source}`
      : '- Source: not recorded',
    report.auditRow
      ? `- Path: ${report.auditRow.path}`
      : '- Path: not recorded',
    report.auditRow
      ? `- Severity: ${report.auditRow.severity}`
      : '- Severity: not recorded',
    report.auditRow
      ? `- User-Agent: ${report.auditRow.userAgent}`
      : '- User-Agent: not recorded',
    '',
    '## Containers',
    '',
    ...report.composePs.map((container) => `- ${container.service}: state=${container.state}${container.health ? ` health=${container.health}` : ''}`),
    '',
    '## Notes',
    '',
    '- This proof starts the backend and gateway as separate Docker Compose services with the production-style shared `GATEWAY_SECRET` HMAC path.',
    '- The local proof pins `GATEWAY_TLS_ENABLED=false`; TLS-specific gateway listener behavior should be exercised separately when TLS changes.',
    '- The gateway receives a protected-route request without a bearer token, emits a gateway security event, signs the backend audit request, and the backend persists the row in PostgreSQL.',
    '- The smoke also verifies that an unsigned in-network request to the backend gateway-audit endpoint returns 403 without creating a row.',
    '- Alertmanager notification delivery remains pending until production receiver channels are chosen.'
  ];

  return `${lines.join('\n')}\n`;
}

let auditRow = null;
let composePs = [];
let passed = false;
let failureError = null;

try {
  runCompose(['up', '-d', '--build', 'gateway']);
  recordStep('compose stack started', true, `project=${projectName} gatewayPort=${gatewayPort}`);

  const health = await waitForGatewayHttpJson('/health');
  recordStep('gateway health', true, `status=${health.status} bodyStatus=${health.body?.status || 'unknown'}`);

  const protectedResponse = requestProtectedGatewayRoute(proofUserAgent);
  if (protectedResponse.status !== 401) {
    throw new Error(`Expected protected gateway route to return 401, got ${protectedResponse.status}: ${protectedResponse.body.slice(0, 200)}`);
  }
  recordStep('gateway protected route event', true, 'missing token request returned 401 and should emit AUTH_MISSING_TOKEN');

  auditRow = await waitForAuditRow(proofUserAgent);
  if (auditRow.action !== 'gateway.auth_missing_token' || auditRow.source !== 'gateway' || auditRow.success !== false) {
    throw new Error(`Unexpected audit row: ${JSON.stringify(auditRow)}`);
  }
  recordStep('backend audit persistence', true, `persisted ${auditRow.action} for ${auditRow.userAgent}`);

  const unsignedStatus = requestUnsignedGatewayAudit();
  assertNoUnsignedAuditRow(unsignedUsername);
  recordStep('unsigned backend audit rejection', true, `status=${unsignedStatus} and no audit row persisted`);

  assertNoGatewayAuditDeliveryErrors();
  recordStep('gateway delivery logs', true, 'no audit delivery errors in recent gateway logs');

  composePs = await waitForComposeHealthy();
  recordStep('compose container health', true, `${composePs.length} service containers running and healthy`);

  passed = steps.every((step) => step.passed);
} catch (error) {
  failureError = error;
  recordStep('phase2 gateway audit compose smoke', false, error instanceof Error ? error.message : String(error));
  try {
    composePs = collectComposePs();
  } catch {
    composePs = [];
  }
} finally {
  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    passed,
    projectName,
    gatewayUrl,
    gatewayInternalUrl,
    gatewayPort,
    proofUserAgent,
    steps,
    auditRow,
    composePs,
    keptStack: keepStack,
  };

  mkdirSync(outputDir, { recursive: true });
  const mdPath = path.join(outputDir, `phase2-gateway-audit-compose-smoke-${timestamp}.md`);
  const jsonPath = path.join(outputDir, `phase2-gateway-audit-compose-smoke-${timestamp}.json`);
  writeFileSync(mdPath, buildMarkdown(report));
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Wrote ${path.relative(repoRoot, mdPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, jsonPath)}`);

  if (!keepStack) {
    try {
      execFileSync('docker', [...composeArgs, 'down', '-v', '--remove-orphans'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: composeEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log(`Stopped and removed compose project ${projectName}`);
    } catch (error) {
      console.warn(`Failed to clean up compose project ${projectName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log(`Leaving compose project ${projectName} running because PHASE2_GATEWAY_AUDIT_KEEP_STACK=true`);
  }
}

if (!passed) {
  if (failureError) {
    console.error(failureError instanceof Error ? failureError.message : String(failureError));
  }
  process.exitCode = 1;
}
