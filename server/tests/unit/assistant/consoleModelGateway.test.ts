import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAIConfig: vi.fn(),
  getContainerUrl: vi.fn(() => 'http://ai-proxy:3100'),
  syncConfigToContainer: vi.fn(),
  buildAIProxyJsonHeaders: vi.fn(() => ({
    'Content-Type': 'application/json',
    'X-AI-Service-Secret': 'service-secret',
  })),
  fetch: vi.fn(),
}));

vi.mock('../../../src/services/ai/config', () => ({
  getAIConfig: mocks.getAIConfig,
  getContainerUrl: mocks.getContainerUrl,
  syncConfigToContainer: mocks.syncConfigToContainer,
}));

vi.mock('../../../src/services/ai/proxyClient', () => ({
  buildAIProxyJsonHeaders: mocks.buildAIProxyJsonHeaders,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  planConsoleTools,
  synthesizeConsoleAnswer,
} from '../../../src/assistant/console/modelGateway';

describe('console model gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetch as unknown as typeof fetch;
    mocks.getAIConfig.mockResolvedValue({
      enabled: true,
      endpoint: 'http://lan-llm:11434',
      model: 'llama3.2',
      providerProfileId: 'lan-profile',
    });
    mocks.syncConfigToContainer.mockResolvedValue(true);
  });

  it('plans tools through the service-authenticated AI proxy without forwarding user bearer tokens', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        toolCalls: [{ name: 'get_fee_estimates', input: {}, reason: 'need fees' }],
        warnings: [],
      }),
    });

    const result = await planConsoleTools({
      prompt: 'what are fees?',
      scope: { kind: 'general' },
      maxToolCalls: 4,
      tools: [{
        name: 'get_fee_estimates',
        title: 'Fee estimates',
        description: 'Read fees',
        sensitivity: 'public',
        requiredScope: 'none',
        inputFields: [],
      }],
    });

    expect(result).toMatchObject({
      providerProfileId: 'lan-profile',
      model: 'llama3.2',
      toolCalls: [{ name: 'get_fee_estimates' }],
    });
    expect(mocks.syncConfigToContainer).toHaveBeenCalledWith(expect.objectContaining({ model: 'llama3.2' }));
    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://ai-proxy:3100/console/plan',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Service-Secret': 'service-secret',
        },
      })
    );
    expect(mocks.buildAIProxyJsonHeaders).toHaveBeenCalledWith();
    expect(mocks.fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    expect(timeoutSpy).toHaveBeenCalledWith(125000);
    timeoutSpy.mockRestore();
  });

  it('uses a configured positive Console gateway timeout when provided', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const previousTimeout = process.env.CONSOLE_GATEWAY_TIMEOUT_MS;
    process.env.CONSOLE_GATEWAY_TIMEOUT_MS = '2500';
    vi.resetModules();
    const gatewayWithConfiguredTimeout = await import(
      '../../../src/assistant/console/modelGateway'
    );
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ toolCalls: [], warnings: [] }),
    });

    try {
      await gatewayWithConfiguredTimeout.planConsoleTools({
        prompt: 'what are fees?',
        scope: { kind: 'general' },
        maxToolCalls: 1,
        tools: [{
          name: 'get_fee_estimates',
          title: 'Fee estimates',
          description: 'Read fees',
          sensitivity: 'public',
          requiredScope: 'none',
          inputFields: [],
        }],
      });

      expect(timeoutSpy).toHaveBeenCalledWith(2500);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.CONSOLE_GATEWAY_TIMEOUT_MS;
      } else {
        process.env.CONSOLE_GATEWAY_TIMEOUT_MS = previousTimeout;
      }
      timeoutSpy.mockRestore();
      vi.resetModules();
    }
  });

  it('defaults missing plan arrays to empty arrays', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });

    await expect(planConsoleTools({
      prompt: 'answer directly',
      scope: { kind: 'general' },
      maxToolCalls: 4,
      tools: [{
        name: 'get_fee_estimates',
        title: 'Fee estimates',
        description: 'Read fees',
        sensitivity: 'public',
        requiredScope: 'authenticated',
        inputFields: [],
      }],
    })).resolves.toMatchObject({ toolCalls: [], warnings: [] });
  });


  it('synthesizes answers from compact tool results', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ response: 'Current fee estimate is available.' }),
    });

    const result = await synthesizeConsoleAnswer({
      prompt: 'summarize',
      scope: { kind: 'general' },
      toolResults: [{
        toolName: 'get_fee_estimates',
        status: 'completed',
        sensitivity: 'public',
        facts: { summary: 'Fee estimates available.' },
      }],
    });

    expect(result).toEqual({
      providerProfileId: 'lan-profile',
      model: 'llama3.2',
      response: 'Current fee estimate is available.',
    });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({
      prompt: 'summarize',
      toolResults: [{ facts: { summary: 'Fee estimates available.' } }],
    });
  });

  it('fails closed before proxy fetch when no provider is configured', async () => {
    mocks.getAIConfig.mockResolvedValue({ enabled: false, endpoint: '', model: '' });

    await expect(
      planConsoleTools({
        prompt: 'hello',
        scope: { kind: 'general' },
        maxToolCalls: 1,
        tools: [{
          name: 'get_fee_estimates',
          title: 'Fee estimates',
          description: 'Read fees',
          sensitivity: 'public',
          requiredScope: 'none',
          inputFields: [],
        }],
      })
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when provider config cannot sync to the proxy', async () => {
    mocks.syncConfigToContainer.mockResolvedValue(false);

    await expect(
      planConsoleTools({
        prompt: 'hello',
        scope: { kind: 'general' },
        maxToolCalls: 1,
        tools: [{
          name: 'get_fee_estimates',
          title: 'Fee estimates',
          description: 'Read fees',
          sensitivity: 'public',
          requiredScope: 'authenticated',
          inputFields: [],
        }],
      })
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('converts failed proxy responses into service unavailable errors', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockResolvedValue({ error: 'AI endpoint not available' }),
    });

    await expect(
      synthesizeConsoleAnswer({
        prompt: 'summarize',
        scope: { kind: 'general' },
        toolResults: [],
      })
    ).rejects.toMatchObject({
      message:
        'AI proxy /console/synthesize request failed: AI endpoint not available',
      statusCode: 503,
      details: {
        path: '/console/synthesize',
        proxyError: 'AI endpoint not available',
        status: 502,
      },
    });
  });

  it('uses proxy message fields when failed proxy responses omit error fields', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 504,
      json: vi.fn().mockResolvedValue({ message: 'Provider timed out' }),
    });

    await expect(
      synthesizeConsoleAnswer({
        prompt: 'summarize',
        scope: { kind: 'general' },
        toolResults: [],
      })
    ).rejects.toMatchObject({
      message:
        'AI proxy /console/synthesize request failed: Provider timed out',
      details: {
        proxyError: 'Provider timed out',
        status: 504,
      },
    });
  });

  it('falls back to a generic proxy failure when proxy error JSON is empty or malformed', async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: vi.fn().mockResolvedValue({}),
    });

    await expect(
      synthesizeConsoleAnswer({
        prompt: 'summarize',
        scope: { kind: 'general' },
        toolResults: [],
      })
    ).rejects.toMatchObject({
      message: 'AI proxy /console/synthesize request failed',
      details: { status: 502 },
    });

    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    });

    await expect(
      synthesizeConsoleAnswer({
        prompt: 'summarize',
        scope: { kind: 'general' },
        toolResults: [],
      })
    ).rejects.toMatchObject({
      message: 'AI proxy /console/synthesize request failed',
      details: { status: 503 },
    });
  });

  it('converts network errors into service unavailable errors', async () => {
    mocks.fetch.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(
      synthesizeConsoleAnswer({
        prompt: 'summarize',
        scope: { kind: 'general' },
        toolResults: [],
      })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('returns an empty string when synthesis response is absent', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });

    await expect(
      synthesizeConsoleAnswer({
        prompt: 'summarize',
        scope: { kind: 'general' },
        toolResults: [],
      })
    ).resolves.toMatchObject({ response: '' });
  });
});
