import { Counter, Histogram } from 'prom-client';
import { registry } from '../observability/metrics/registry';
import { assistantReadToolRegistry } from '../assistant/tools';
import { MCP_PROMPT_NAME_VALUES } from './promptNames';

/**
 * JSON-RPC methods that are always safe to record verbatim: this is a small,
 * fixed vocabulary independent of any caller-supplied name.
 */
const ALLOWLISTED_JSONRPC_METHODS = new Set([
  'initialize',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'prompts/list',
  'prompts/get',
  'notifications/initialized',
  'batch',
  'unknown',
]);

// Computed once (not per-call): the registry of read tools is fixed at
// process startup, so there is no reason to re-derive this set on every
// request.
let registeredToolNames: Set<string> | null = null;

function getRegisteredToolNames(): Set<string> {
  if (!registeredToolNames) {
    registeredToolNames = new Set(assistantReadToolRegistry.list().map(definition => definition.name));
  }
  return registeredToolNames;
}

const REGISTERED_PROMPT_NAMES = new Set<string>(MCP_PROMPT_NAME_VALUES);

/**
 * Bounds an MCP operation label to a finite set of values so that an
 * unauthenticated or malicious caller cannot mint unbounded Prometheus
 * series by supplying arbitrary tool/prompt/resource names or JSON-RPC
 * methods. Unregistered names collapse to their bucket's "other" value.
 */
export function metricOperationLabel(operation: string): string {
  if (ALLOWLISTED_JSONRPC_METHODS.has(operation)) {
    return operation;
  }
  if (operation.startsWith('tool:')) {
    const name = operation.slice('tool:'.length);
    return getRegisteredToolNames().has(name) ? operation : 'tool:other';
  }
  if (operation.startsWith('prompt:')) {
    const name = operation.slice('prompt:'.length);
    return REGISTERED_PROMPT_NAMES.has(name) ? operation : 'prompt:other';
  }
  if (operation.startsWith('resource:')) {
    return operation === 'resource:sanctuary:' ? operation : 'resource:other';
  }
  return 'other';
}

export const mcpRequestsTotal = new Counter({
  name: 'sanctuary_mcp_requests_total',
  help: 'Total MCP HTTP requests',
  labelNames: ['operation', 'status'] as const,
  registers: [registry],
});

export const mcpRequestDuration = new Histogram({
  name: 'sanctuary_mcp_request_duration_seconds',
  help: 'MCP HTTP request duration in seconds',
  labelNames: ['operation', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const mcpAuthFailuresTotal = new Counter({
  name: 'sanctuary_mcp_auth_failures_total',
  help: 'Total MCP authentication failures',
  labelNames: ['reason'] as const,
  registers: [registry],
});

export const mcpRateLimitHitsTotal = new Counter({
  name: 'sanctuary_mcp_rate_limit_hits_total',
  help: 'Total MCP requests rejected by rate limits',
  registers: [registry],
});

export function recordMcpRequest(operation: string, status: number, durationSeconds: number): void {
  const labels = {
    operation: metricOperationLabel(operation),
    status: String(status),
  };
  mcpRequestsTotal.inc(labels);
  mcpRequestDuration.observe(labels, durationSeconds);
}
