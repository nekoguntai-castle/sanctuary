#!/usr/bin/env node

import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const outputDir = process.env.PHASE2_MONITORING_OUTPUT_DIR || path.join(repoRoot, 'docs/plans');
const startedAt = new Date();
const timestamp = startedAt.toISOString().replace(/[:.]/g, '-');
const timeoutMs = Number(process.env.PHASE2_MONITORING_TIMEOUT_MS || '90000');
const retryMs = Number(process.env.PHASE2_MONITORING_RETRY_MS || '2000');

function envPort(name, fallback) {
  return process.env[name] || fallback;
}

function endpoint(envName, fallbackPort) {
  const explicit = process.env[envName];
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }
  return `http://127.0.0.1:${fallbackPort}`;
}

const endpoints = {
  grafana: endpoint('GRAFANA_URL', envPort('GRAFANA_PORT', '3000')),
  prometheus: endpoint('PROMETHEUS_URL', envPort('PROMETHEUS_PORT', '9090')),
  alertmanager: endpoint('ALERTMANAGER_URL', envPort('ALERTMANAGER_PORT', '9093')),
  jaeger: endpoint('JAEGER_URL', envPort('JAEGER_UI_PORT', '16686')),
  loki: endpoint('LOKI_URL', envPort('LOKI_PORT', '3100')),
};

const monitoringContainers = [
  { service: 'grafana', container: 'sanctuary-grafana' },
  { service: 'prometheus', container: 'sanctuary-prometheus' },
  { service: 'alertmanager', container: 'sanctuary-alertmanager' },
  { service: 'jaeger', container: 'sanctuary-jaeger' },
  { service: 'loki', container: 'sanctuary-loki' },
  { service: 'promtail', container: 'sanctuary-promtail' },
];

const runtimeLogChecks = [
  {
    service: 'promtail',
    container: 'sanctuary-promtail',
    name: 'Docker discovery compatibility',
    summary: 'no Promtail Docker discovery compatibility errors in recent logs',
    rejectPatterns: [
      { name: 'old Docker API client', pattern: /client version .*too old/i },
      { name: 'target-group refresh failure', pattern: /Unable to refresh target groups/i },
    ],
  },
  {
    service: 'promtail',
    container: 'sanctuary-promtail',
    name: 'Loki push path',
    summary: 'no Promtail-to-Loki push errors in recent logs',
    rejectPatterns: [
      { name: 'batch send failure', pattern: /error sending batch/i },
      { name: 'Loki client failure', pattern: /final error sending batch/i },
      { name: 'Loki HTTP failure', pattern: /server returned HTTP status/i },
    ],
  },
];

const checks = [
  {
    service: 'grafana',
    name: 'health',
    url: `${endpoints.grafana}/api/health`,
    validate: (body) => {
      const parsed = JSON.parse(body);
      if (parsed.database && parsed.database !== 'ok') {
        throw new Error(`database=${parsed.database}`);
      }
      return `version=${parsed.version || 'unknown'} database=${parsed.database || 'unknown'}`;
    },
  },
  {
    service: 'prometheus',
    name: 'health',
    url: `${endpoints.prometheus}/-/healthy`,
    validate: (body) => body.trim() || 'healthy',
  },
  {
    service: 'prometheus',
    name: 'alert rules loaded',
    url: `${endpoints.prometheus}/api/v1/rules`,
    validate: (body) => {
      const parsed = JSON.parse(body);
      const groups = parsed?.data?.groups;
      if (parsed.status !== 'success' || !Array.isArray(groups) || groups.length === 0) {
        throw new Error('no Prometheus rule groups loaded');
      }
      const names = groups.map((group) => group.name).filter(Boolean).join(', ');
      return `${groups.length} rule groups: ${names}`;
    },
  },
  {
    service: 'alertmanager',
    name: 'health',
    url: `${endpoints.alertmanager}/-/healthy`,
    validate: (body) => body.trim() || 'healthy',
  },
  {
    service: 'alertmanager',
    name: 'status',
    url: `${endpoints.alertmanager}/api/v2/status`,
    validate: (body) => {
      const parsed = JSON.parse(body);
      const version = parsed?.versionInfo?.version || 'unknown';
      return `version=${version}`;
    },
  },
  {
    service: 'jaeger',
    name: 'services api',
    url: `${endpoints.jaeger}/api/services`,
    validate: (body) => {
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.data)) {
        throw new Error('Jaeger services response did not include data array');
      }
      return `${parsed.data.length} traced services visible`;
    },
  },
  {
    service: 'loki',
    name: 'ready',
    url: `${endpoints.loki}/ready`,
    validate: (body) => body.trim() || 'ready',
  },
];

async function probe(check) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(check.url, { signal: controller.signal });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 120)}`);
    }

    return {
      ...check,
      passed: true,
      status: response.status,
      summary: check.validate(body),
    };
  } catch (error) {
    return {
      ...check,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForCheck(check) {
  const deadline = Date.now() + timeoutMs;
  let latest;

  do {
    latest = await probe(check);
    if (latest.passed) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, retryMs));
  } while (Date.now() < deadline);

  return latest;
}

function collectPortBindings() {
  try {
    const raw = execFileSync(
      'docker',
      ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.monitoring.yml', 'config', '--format', 'json'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const config = JSON.parse(raw);
    const services = ['grafana', 'prometheus', 'alertmanager', 'jaeger', 'loki'];
    const bindings = services.flatMap((service) => {
      const ports = config?.services?.[service]?.ports || [];
      return ports.map((port) => ({
        service,
        hostIp: port.host_ip || '',
        published: String(port.published || ''),
        target: String(port.target || ''),
        protocol: port.protocol || 'tcp',
      }));
    });
    const unsafeBindings = bindings.filter((binding) => binding.hostIp !== '127.0.0.1');
    const nonLoopbackAllowed = process.env.PHASE2_MONITORING_ALLOW_NON_LOOPBACK === 'true';

    return {
      passed: unsafeBindings.length === 0 || nonLoopbackAllowed,
      skipped: false,
      bindings,
      unsafeBindings,
      summary: unsafeBindings.length === 0
        ? 'all published monitoring ports bind to 127.0.0.1'
        : `${unsafeBindings.length} published monitoring ports are not loopback-bound`,
    };
  } catch (error) {
    return {
      passed: false,
      skipped: false,
      bindings: [],
      unsafeBindings: [],
      summary: 'could not inspect docker compose monitoring port bindings',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectContainerHealth() {
  try {
    const raw = execFileSync('docker', ['inspect', ...monitoringContainers.map((item) => item.container)], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const inspected = JSON.parse(raw);

    return monitoringContainers.map(({ service, container }) => {
      const details = inspected.find((candidate) => candidate?.Name === `/${container}`);
      if (!details) {
        return {
          service,
          container,
          passed: false,
          running: false,
          healthStatus: 'missing',
          summary: 'container not found',
        };
      }

      const state = details.State || {};
      const healthStatus = state.Health?.Status || 'none';
      const running = Boolean(state.Running);
      const passed = running && (healthStatus === 'healthy' || healthStatus === 'none');
      return {
        service,
        container,
        passed,
        running,
        healthStatus,
        startedAt: state.StartedAt || null,
        summary: `running=${running} health=${healthStatus}`,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return monitoringContainers.map(({ service, container }) => ({
      service,
      container,
      passed: false,
      running: false,
      healthStatus: 'unknown',
      summary: 'could not inspect container health',
      error: message,
    }));
  }
}

function collectRuntimeLogChecks() {
  const since = process.env.PHASE2_MONITORING_LOG_SINCE || '10m';

  return runtimeLogChecks.map((check) => {
    const result = spawnSync('docker', ['logs', '--since', since, '--tail', '250', check.container], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    if (result.status !== 0) {
      return {
        service: check.service,
        container: check.container,
        name: check.name,
        passed: false,
        window: since,
        summary: 'could not read container logs',
        error: output.trim() || result.error?.message || `docker logs exited with ${result.status}`,
      };
    }

    const matchedPatterns = check.rejectPatterns
      .filter((rule) => rule.pattern.test(output))
      .map((rule) => rule.name);

    return {
      service: check.service,
      container: check.container,
      name: check.name,
      passed: matchedPatterns.length === 0,
      window: since,
      summary: matchedPatterns.length === 0
        ? `${check.summary} (window=${since})`
        : `matched ${matchedPatterns.join(', ')} (window=${since})`,
      matchedPatterns,
      bytesRead: Buffer.byteLength(output),
    };
  });
}

function formatCheck(result) {
  if (result.passed) {
    return `- PASS ${result.service} ${result.name}: ${result.summary}`;
  }
  return `- FAIL ${result.service} ${result.name}: ${result.error}`;
}

function formatContainerHealth(result) {
  if (result.passed) {
    return `- PASS ${result.container}: ${result.summary}`;
  }
  return `- FAIL ${result.container}: ${result.summary}${result.error ? ` (${result.error})` : ''}`;
}

function formatRuntimeLogCheck(result) {
  if (result.passed) {
    return `- PASS ${result.service} ${result.name}: ${result.summary}`;
  }
  return `- FAIL ${result.service} ${result.name}: ${result.summary}${result.error ? ` (${result.error})` : ''}`;
}

function buildMarkdown(report) {
  const lines = [
    '# Phase 2 Monitoring Stack Smoke',
    '',
    `Date: ${report.startedAt}`,
    `Status: ${report.passed ? 'Passed' : 'Failed'}`,
    '',
    '## Endpoints',
    '',
    `- Grafana: ${report.endpoints.grafana}`,
    `- Prometheus: ${report.endpoints.prometheus}`,
    `- Alertmanager: ${report.endpoints.alertmanager}`,
    `- Jaeger: ${report.endpoints.jaeger}`,
    `- Loki: ${report.endpoints.loki}`,
    '',
    '## Probe Results',
    '',
    ...report.checks.map(formatCheck),
    '',
    '## Container Health',
    '',
    ...report.containerHealth.map(formatContainerHealth),
    '',
    '## Runtime Log Checks',
    '',
    ...report.runtimeLogChecks.map(formatRuntimeLogCheck),
    '',
    '## Port Binding Check',
    '',
    `- ${report.portBindings.passed ? 'PASS' : 'FAIL'} ${report.portBindings.summary}`,
  ];

  for (const binding of report.portBindings.bindings) {
    lines.push(`- ${binding.service}: ${binding.hostIp || '<all interfaces>'}:${binding.published}->${binding.target}/${binding.protocol}`);
  }

  lines.push(
    '',
    '## Notes',
    '',
    '- This smoke verifies the local monitoring stack endpoints, Prometheus rule loading, Alertmanager status, Jaeger API reachability, Loki readiness, and Compose loopback host bindings.',
    '- Container health and recent Promtail logs are checked to catch image-level healthcheck drift and Docker API compatibility errors.',
    '- Prometheus target health for backend and worker is intentionally not a pass/fail criterion here because this proof can run against the monitoring stack without requiring the full application stack.',
    '- Alertmanager notification delivery remains pending until production receiver channels are chosen.'
  );

  return `${lines.join('\n')}\n`;
}

const checkResults = [];
for (const check of checks) {
  // eslint-disable-next-line no-await-in-loop
  const result = await waitForCheck(check);
  checkResults.push(result);
  console.log(formatCheck(result));
}

const portBindings = collectPortBindings();
console.log(`${portBindings.passed ? 'PASS' : 'FAIL'} ${portBindings.summary}`);

const containerHealth = collectContainerHealth();
for (const result of containerHealth) {
  console.log(formatContainerHealth(result));
}

const runtimeLogCheckResults = collectRuntimeLogChecks();
for (const result of runtimeLogCheckResults) {
  console.log(formatRuntimeLogCheck(result));
}

const report = {
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  passed: checkResults.every((check) => check.passed)
    && portBindings.passed
    && containerHealth.every((check) => check.passed)
    && runtimeLogCheckResults.every((check) => check.passed),
  endpoints,
  checks: checkResults,
  containerHealth,
  runtimeLogChecks: runtimeLogCheckResults,
  portBindings,
};

mkdirSync(outputDir, { recursive: true });
const mdPath = path.join(outputDir, `phase2-monitoring-smoke-${timestamp}.md`);
const jsonPath = path.join(outputDir, `phase2-monitoring-smoke-${timestamp}.json`);
writeFileSync(mdPath, buildMarkdown(report));
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote ${path.relative(repoRoot, mdPath)}`);
console.log(`Wrote ${path.relative(repoRoot, jsonPath)}`);

if (!report.passed) {
  process.exitCode = 1;
}
