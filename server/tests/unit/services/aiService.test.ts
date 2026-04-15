import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errJson, okJson, setting } from './aiServiceTestHarness';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  systemSettingFindMany: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  systemSettingRepository: {
    findByKeys: mocks.systemSettingFindMany,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function mockConfiguredAiSettings() {
  mocks.systemSettingFindMany.mockResolvedValue([
    setting('aiEnabled', true),
    setting('aiEndpoint', 'http://ollama:11434'),
    setting('aiModel', 'llama3.2'),
  ] as any);
}

describe('aiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.systemSettingFindMany.mockResolvedValue([]);
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch as unknown as typeof fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns enabled=true only when all required settings are configured', async () => {
    mockConfiguredAiSettings();

    const mod = await import('../../../src/services/aiService');
    await expect(mod.isEnabled()).resolves.toBe(true);
  });

  it('ignores unknown AI settings keys while parsing config', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
      setting('aiUnknownKey', 'ignored'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.isEnabled()).resolves.toBe(true);
  });

  it('returns disabled when settings lookup fails', async () => {
    mocks.systemSettingFindMany.mockRejectedValue(new Error('db down'));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.isEnabled()).resolves.toBe(false);
  });

  it('returns false when AI container health endpoint throws', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('unreachable'));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.isContainerAvailable()).resolves.toBe(false);
  });

  it('returns disabled health when AI is turned off', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', false),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health.available).toBe(false);
    expect(health.error).toContain('disabled');
  });

  it('reports container unavailable when /health check fails', async () => {
    mockConfiguredAiSettings();
    mocks.fetch.mockResolvedValueOnce(errJson(503, { error: 'down' }));

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health.available).toBe(false);
    expect(health.containerAvailable).toBe(false);
    expect(health.error).toContain('container');
  });

  it('syncs config and reports healthy AI container', async () => {
    mockConfiguredAiSettings();
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: 'ok' }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ available: true }));

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health).toMatchObject({
      available: true,
      model: 'llama3.2',
      endpoint: 'http://ollama:11434',
      containerAvailable: true,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      'http://ai:3100/config',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('reports unavailable when endpoint or model is missing', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health).toEqual({
      available: false,
      error: 'AI endpoint or model not configured',
    });
  });

  it('reports unavailable when AI test endpoint fails', async () => {
    mockConfiguredAiSettings();
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: 'ok' }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(502, { error: 'test failed' }));

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health).toEqual({
      available: false,
      model: 'llama3.2',
      endpoint: 'http://ollama:11434',
      containerAvailable: true,
      error: 'AI container test failed',
    });
  });

  it('reports invalid response when AI test payload is malformed', async () => {
    mockConfiguredAiSettings();
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: 'ok' }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson('not-an-object'));

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health).toEqual({
      available: false,
      model: 'llama3.2',
      endpoint: 'http://ollama:11434',
      containerAvailable: true,
      error: 'Invalid response from AI container',
    });
  });

  it('reports test connection failure when AI test request throws', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ status: 'ok' }))
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error('socket hang up'));

    const mod = await import('../../../src/services/aiService');
    const health = await mod.checkHealth();

    expect(health).toEqual({
      available: false,
      model: 'llama3.2',
      endpoint: 'http://ollama:11434',
      containerAvailable: true,
      error: 'Failed to test AI connection',
    });
  });

  it('suggests transaction labels from AI container', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ suggestion: 'Payroll income' }));

    const mod = await import('../../../src/services/aiService');
    const suggestion = await mod.suggestTransactionLabel('tx-1', 'token-abc');

    expect(suggestion).toBe('Payroll income');
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      'http://ai:3100/suggest-label',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-abc',
        }),
      })
    );
  });

  it('returns null label suggestion when AI is not configured', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.suggestTransactionLabel('tx-2', 'token-abc')).resolves.toBeNull();
  });

  it('returns null label suggestion when AI container returns non-ok', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(400, { error: 'bad input' }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.suggestTransactionLabel('tx-3', 'token-abc')).resolves.toBeNull();
  });

  it('returns null label suggestion when non-ok error body is unreadable', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('invalid json')),
      } as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.suggestTransactionLabel('tx-3b', 'token-abc')).resolves.toBeNull();
  });

  it('returns null label suggestion when response payload is invalid', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({}));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.suggestTransactionLabel('tx-4', 'token-abc')).resolves.toBeNull();
  });

  it('returns null when label suggestion is an empty string', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ suggestion: '' }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.suggestTransactionLabel('tx-empty', 'token-abc')).resolves.toBeNull();
  });

  it('returns null label suggestion when fetch throws', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error('timeout'));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.suggestTransactionLabel('tx-5', 'token-abc')).resolves.toBeNull();
  });

  it('returns null for invalid natural query response payloads', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ invalid: true }));

    const mod = await import('../../../src/services/aiService');
    const result = await mod.executeNaturalQuery('show latest', 'wallet-1', 'token-xyz');

    expect(result).toBeNull();
  });

  it('returns null for natural query when AI is not configured', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', false),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.executeNaturalQuery('show latest', 'wallet-1', 'token-xyz')).resolves.toBeNull();
  });

  it('returns null for natural query when AI container returns non-ok', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(422, { error: 'invalid request' }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.executeNaturalQuery('show latest', 'wallet-1', 'token-xyz')).resolves.toBeNull();
  });

  it('returns null for natural query when non-ok error body is unreadable', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: vi.fn().mockRejectedValue(new Error('invalid json')),
      } as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.executeNaturalQuery('show latest', 'wallet-1', 'token-xyz')).resolves.toBeNull();
  });

  it('returns null when natural query response has query=null', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ query: null }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.executeNaturalQuery('show latest', 'wallet-1', 'token-xyz')).resolves.toBeNull();
  });

  it('returns null for natural query when fetch throws', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error('timeout'));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.executeNaturalQuery('show latest', 'wallet-1', 'token-xyz')).resolves.toBeNull();
  });

  it('detects Ollama and validates response format', async () => {
    mocks.fetch.mockResolvedValueOnce(okJson({ found: true, endpoint: 'http://localhost:11434' }));

    const mod = await import('../../../src/services/aiService');
    const result = await mod.detectOllama();

    expect(result).toEqual({
      found: true,
      endpoint: 'http://localhost:11434',
    });
  });

  it('returns detectOllama failure when container returns non-ok', async () => {
    mocks.fetch.mockResolvedValueOnce(errJson(500, { error: 'boom' }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.detectOllama()).resolves.toEqual({
      found: false,
      message: 'Detection failed',
    });
  });

  it('returns detectOllama invalid format when payload is malformed', async () => {
    mocks.fetch.mockResolvedValueOnce(okJson('bad-payload'));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.detectOllama()).resolves.toEqual({
      found: false,
      message: 'Invalid response format',
    });
  });

  it('returns detectOllama unavailable when request throws', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('down'));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.detectOllama()).resolves.toEqual({
      found: false,
      message: 'AI container not available',
    });
  });

  it('returns list-models error when endpoint is missing', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiModel', 'llama3.2'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    const result = await mod.listModels();

    expect(result.models).toEqual([]);
    expect(result.error).toContain('endpoint');
  });

  it('lists models through the AI container', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({
        models: [{ name: 'llama3.2', size: 123, modifiedAt: '2026-01-01T00:00:00Z' }],
      }));

    const mod = await import('../../../src/services/aiService');
    const result = await mod.listModels();

    expect(result.models).toHaveLength(1);
    expect(result.models[0].name).toBe('llama3.2');
  });

  it('returns list-models fallback error when response body is not readable', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('invalid json')),
      } as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.listModels()).resolves.toEqual({
      models: [],
      error: 'Failed to list models',
    });
  });

  it('returns list-models invalid response when payload is malformed', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ nope: true }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.listModels()).resolves.toEqual({
      models: [],
      error: 'Invalid response format',
    });
  });

  it('returns list-models connection error when request throws', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error('connection refused'));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.listModels()).resolves.toEqual({
      models: [],
      error: 'Cannot connect to AI container',
    });
  });

  it('handles pull and delete model error responses', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(500, { error: 'pull failed' }))
      .mockResolvedValueOnce(errJson(500, { error: 'delete failed' }));

    const mod = await import('../../../src/services/aiService');
    const pull = await mod.pullModel('llama3.2');
    const del = await mod.deleteModel('llama3.2');

    expect(pull).toEqual({ success: false, error: 'pull failed' });
    expect(del).toEqual({ success: false, error: 'delete failed' });
  });

  it('returns pull-model fallback error when error payload omits message', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(500, {}));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.pullModel('llama3.2')).resolves.toEqual({
      success: false,
      error: 'Pull failed',
    });
  });

  it('returns pull-model fallback error when non-ok body is unreadable', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('invalid json')),
      } as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.pullModel('llama3.2')).resolves.toEqual({
      success: false,
      error: 'Pull failed',
    });
  });

  it('returns pull-model endpoint missing error', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiModel', 'llama3.2'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.pullModel('llama3.2')).resolves.toEqual({
      success: false,
      error: 'No AI endpoint configured',
    });
  });

  it('pulls model successfully when AI container returns success', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ success: true, model: 'llama3.2', status: 'pulling' }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.pullModel('llama3.2')).resolves.toEqual({
      success: true,
      model: 'llama3.2',
      status: 'pulling',
    });
  });

  it('returns pull-model invalid response when payload is malformed', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ model: 'llama3.2' }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.pullModel('llama3.2')).resolves.toEqual({
      success: false,
      error: 'Invalid response format',
    });
  });

  it('returns pull-model operation failure when request throws', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error('timeout'));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.pullModel('llama3.2')).resolves.toEqual({
      success: false,
      error: 'Pull operation failed',
    });
  });

  it('returns delete-model endpoint missing error', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiModel', 'llama3.2'),
    ] as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.deleteModel('llama3.2')).resolves.toEqual({
      success: false,
      error: 'No AI endpoint configured',
    });
  });

  it('deletes model successfully when AI container returns success', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(okJson({ model: 'llama3.2' }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.deleteModel('llama3.2')).resolves.toEqual({
      success: true,
      model: 'llama3.2',
    });
  });

  it('returns delete-model fallback error when error payload omits message', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce(errJson(500, {}));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.deleteModel('llama3.2')).resolves.toEqual({
      success: false,
      error: 'Delete failed',
    });
  });

  it('returns delete-model fallback error when non-ok body is unreadable', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockRejectedValue(new Error('invalid json')),
      } as any);

    const mod = await import('../../../src/services/aiService');
    await expect(mod.deleteModel('llama3.2')).resolves.toEqual({
      success: false,
      error: 'Delete failed',
    });
  });

  it('returns delete-model operation failure when request throws', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch
      .mockResolvedValueOnce(okJson({ success: true }))
      .mockRejectedValueOnce(new Error('connection reset'));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.deleteModel('llama3.2')).resolves.toEqual({
      success: false,
      error: 'Delete operation failed',
    });
  });

  it('forceSyncConfig returns false when config sync request fails', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch.mockRejectedValue(new Error('connection refused'));

    const mod = await import('../../../src/services/aiService');
    const synced = await mod.forceSyncConfig();

    expect(synced).toBe(false);
  });

  it('forceSyncConfig sends configured AI config secret header when present', async () => {
    const previousSecret = process.env.AI_CONFIG_SECRET;
    process.env.AI_CONFIG_SECRET = 'test-secret';
    try {
      mocks.systemSettingFindMany.mockResolvedValue([
        setting('aiEnabled', true),
        setting('aiEndpoint', 'http://ollama:11434'),
        setting('aiModel', 'llama3.2'),
      ] as any);
      mocks.fetch.mockResolvedValueOnce(okJson({ synced: true }));

      const mod = await import('../../../src/services/aiService');
      await expect(mod.forceSyncConfig()).resolves.toBe(true);
      expect(mocks.fetch).toHaveBeenCalledWith(
        'http://ai:3100/config',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-AI-Config-Secret': 'test-secret',
          }),
        })
      );
    } finally {
      if (previousSecret === undefined) {
        delete process.env.AI_CONFIG_SECRET;
      } else {
        process.env.AI_CONFIG_SECRET = previousSecret;
      }
    }
  });

  it('forceSyncConfig returns false when config sync returns non-ok response', async () => {
    mocks.systemSettingFindMany.mockResolvedValue([
      setting('aiEnabled', true),
      setting('aiEndpoint', 'http://ollama:11434'),
      setting('aiModel', 'llama3.2'),
    ] as any);
    mocks.fetch.mockResolvedValueOnce(errJson(500, { error: 'sync failed' }));

    const mod = await import('../../../src/services/aiService');
    await expect(mod.forceSyncConfig()).resolves.toBe(false);
  });
});
