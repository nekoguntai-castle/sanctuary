import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  counters: [] as Array<{ options: unknown; inc: ReturnType<typeof vi.fn> }>,
  histograms: [] as Array<{ options: unknown; observe: ReturnType<typeof vi.fn> }>,
}));

vi.mock('prom-client', () => ({
  Counter: vi.fn(function Counter(this: unknown, options: unknown) {
    const instance = { options, inc: vi.fn() };
    mocks.counters.push(instance);
    return instance;
  }),
  Histogram: vi.fn(function Histogram(this: unknown, options: unknown) {
    const instance = { options, observe: vi.fn() };
    mocks.histograms.push(instance);
    return instance;
  }),
}));

vi.mock('../../../src/observability/metrics/registry', () => ({
  registry: {},
}));

import {
  mcpAuthFailuresTotal,
  mcpRateLimitHitsTotal,
  mcpRequestDuration,
  mcpRequestsTotal,
  recordMcpRequest,
} from '../../../src/mcp/metrics';

describe('MCP metrics', () => {
  it('registers counters and histograms and records requests', () => {
    expect(mcpRequestsTotal).toBe(mocks.counters[0]);
    expect(mcpAuthFailuresTotal).toBe(mocks.counters[1]);
    expect(mcpRateLimitHitsTotal).toBe(mocks.counters[2]);
    expect(mcpRequestDuration).toBe(mocks.histograms[0]);

    recordMcpRequest('tools/call', 200, 0.123);

    expect(mocks.counters[0].inc).toHaveBeenCalledWith({ operation: 'tools/call', status: '200' });
    expect(mocks.histograms[0].observe).toHaveBeenCalledWith({ operation: 'tools/call', status: '200' }, 0.123);
  });
});
