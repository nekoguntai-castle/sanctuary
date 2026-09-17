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

// The real module pulls in the full assistant/services/Prisma dependency graph
// (it is imported by console/service.ts and others), which this narrow metrics
// unit test has no business loading. Stub it with a single deterministic
// registered tool name so the label-bounding helper's "known tool" branch is
// exercised without dragging that graph into this test file.
const REGISTERED_TOOL_NAME = 'test_registered_tool';
vi.mock('../../../src/assistant/tools', () => ({
  assistantReadToolRegistry: {
    list: () => [{ name: REGISTERED_TOOL_NAME }],
  },
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

  it('bounds fifty distinct unregistered tool names to tool:other', () => {
    for (let i = 0; i < 50; i += 1) {
      recordMcpRequest(`tool:zzz-not-registered-${i}`, 401, 0.01);
    }

    const incCalls = mocks.counters[0].inc.mock.calls;
    const observeCalls = mocks.histograms[0].observe.mock.calls;
    expect(incCalls.length).toBeGreaterThanOrEqual(50);
    expect(observeCalls.length).toBeGreaterThanOrEqual(50);
    const recentInc = incCalls.slice(-50);
    const recentObserve = observeCalls.slice(-50);
    for (const call of recentInc) {
      expect(call[0]).toEqual({ operation: 'tool:other', status: '401' });
    }
    for (const call of recentObserve) {
      expect(call[0]).toEqual({ operation: 'tool:other', status: '401' });
      expect(call[1]).toBe(0.01);
    }
  });

  it('keeps the label for a registered tool name', () => {
    recordMcpRequest(`tool:${REGISTERED_TOOL_NAME}`, 200, 0.02);

    expect(mocks.counters[0].inc).toHaveBeenCalledWith({
      operation: `tool:${REGISTERED_TOOL_NAME}`,
      status: '200',
    });
    expect(mocks.histograms[0].observe).toHaveBeenCalledWith(
      { operation: `tool:${REGISTERED_TOOL_NAME}`, status: '200' },
      0.02
    );
  });

  it('bounds an unregistered prompt name to prompt:other', () => {
    recordMcpRequest('prompt:nope', 200, 0.03);

    expect(mocks.counters[0].inc).toHaveBeenCalledWith({ operation: 'prompt:other', status: '200' });
    expect(mocks.histograms[0].observe).toHaveBeenCalledWith(
      { operation: 'prompt:other', status: '200' },
      0.03
    );
  });

  it('keeps the label for a registered prompt name', () => {
    recordMcpRequest('prompt:transaction_analysis', 200, 0.04);

    expect(mocks.counters[0].inc).toHaveBeenCalledWith({
      operation: 'prompt:transaction_analysis',
      status: '200',
    });
  });

  it('bounds a non-sanctuary resource scheme to resource:other', () => {
    recordMcpRequest('resource:javascript:', 200, 0.05);

    expect(mocks.counters[0].inc).toHaveBeenCalledWith({ operation: 'resource:other', status: '200' });
  });

  it('keeps the label for the sanctuary resource scheme', () => {
    recordMcpRequest('resource:sanctuary:', 200, 0.06);

    expect(mocks.counters[0].inc).toHaveBeenCalledWith({
      operation: 'resource:sanctuary:',
      status: '200',
    });
  });

  it('bounds an unknown raw method to other', () => {
    recordMcpRequest('not-a-real-method', 400, 0.07);

    expect(mocks.counters[0].inc).toHaveBeenCalledWith({ operation: 'other', status: '400' });
  });

  it.each([
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
  ])('keeps the allowlisted JSON-RPC method %s', (method) => {
    recordMcpRequest(method, 200, 0.08);

    expect(mocks.counters[0].inc).toHaveBeenCalledWith({ operation: method, status: '200' });
  });
});
