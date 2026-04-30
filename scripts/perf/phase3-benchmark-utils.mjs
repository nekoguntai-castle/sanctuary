import { execFileSync } from 'node:child_process';
import { isIP } from 'node:net';

export function renderMarkdown(result) {
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
    ...result.scenarios.map((scenario) =>
      [
        escapeCell(scenario.name),
        scenario.kind,
        scenario.status,
        scenario.requests,
        scenario.successes,
        scenario.errors,
        scenario.latency.p50Ms ?? '',
        scenario.latency.p95Ms ?? '',
        scenario.latency.p99Ms ?? '',
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    ),
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
    `Backup source: ${result.environment.fixture.backupSource || 'none'}`,
  );
  if (result.environment.fixture.error) {
    lines.push(`Provision error: ${result.environment.fixture.error}`);
  }
  if (result.environment.fixture.backupError) {
    lines.push(`Backup error: ${result.environment.fixture.backupError}`);
  }

  lines.push('', '## Health Snapshot', '');

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
      : 'Benchmark evidence captured for the configured scenarios. Compare p95/p99 and failure rates against the Phase 3 gates before promoting this run.',
  );

  return `${lines.join('\n')}\n`;
}

export function deriveWebSocketUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/ws';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function isLocalUrl(value) {
  const hostname = new URL(value).hostname;
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
}

export function isPrivateNetworkUrl(value) {
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, '');
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const [first, second] = hostname.split('.').map((part) => Number.parseInt(part, 10));
    return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254);
  }
  if (ipVersion === 6) {
    const normalized = hostname.toLowerCase();
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return false;
}

export function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

export function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }
}

export function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function readCommit() {
  if (process.env.SANCTUARY_BENCHMARK_COMMIT) {
    return process.env.SANCTUARY_BENCHMARK_COMMIT;
  }

  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function sanitizeUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/token|secret|password|key/i.test(key)) {
      url.searchParams.set(key, '[redacted]');
    }
  }
  return url.toString();
}

export function summarizeDurations(values) {
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

export async function runPool(total, limit, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, total) }, async () => {
    while (next < total) {
      next += 1;
      await worker();
    }
  });
  await Promise.all(workers);
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

function escapeCell(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ');
}

function round(value) {
  return Math.round(value * 100) / 100;
}
