import { Counter, Histogram } from 'prom-client';
import { registry } from '../observability/metrics/registry';

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
    operation,
    status: String(status),
  };
  mcpRequestsTotal.inc(labels);
  mcpRequestDuration.observe(labels, durationSeconds);
}
