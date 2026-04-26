import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSupportStats, mockCheckHealth, mockFindSettingsByKeys, collectorMap } = vi.hoisted(() => ({
  mockGetSupportStats: vi.fn(),
  mockCheckHealth: vi.fn(),
  mockFindSettingsByKeys: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/repositories', () => ({
  intelligenceRepository: {
    getSupportStats: mockGetSupportStats,
  },
  systemSettingRepository: {
    findByKeys: mockFindSettingsByKeys,
  },
}));

vi.mock('../../../../src/services/ai/health', () => ({
  checkHealth: mockCheckHealth,
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/aiIntelligence';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('aiIntelligence collector', () => {
  beforeEach(() => {
    mockGetSupportStats.mockReset();
    mockCheckHealth.mockReset();
    mockFindSettingsByKeys.mockReset();
    mockFindSettingsByKeys.mockResolvedValue([]);
  });

  const getCollector = () => {
    const c = collectorMap.get('aiIntelligence');
    if (!c) throw new Error('aiIntelligence collector not registered');
    return c;
  };

  it('registers itself as aiIntelligence', () => {
    expect(collectorMap.has('aiIntelligence')).toBe(true);
  });

  it('returns health and stats on success, omitting endpoint/model strings', async () => {
    mockCheckHealth.mockResolvedValue({
      available: true,
      model: 'llama3',
      endpoint: 'http://ai:3100',
      containerAvailable: true,
    });
    mockGetSupportStats.mockResolvedValue({
      conversationCount: 4,
      messageCountLast7d: 50,
      insightsByTypeStatus: [{ type: 'utxo_health', status: 'active', count: 2 }],
      insightsBySeverity: { info: 2 },
      activeInsightCount: 2,
    });

    const result = await getCollector()(makeContext());
    const health = result.health as Record<string, unknown>;
    expect(health.available).toBe(true);
    expect(health.hasModel).toBe(true);
    expect(health.hasEndpoint).toBe(true);
    expect(health).not.toHaveProperty('model');
    expect(health).not.toHaveProperty('endpoint');
    expect(result.conversationCount).toBe(4);
    expect(result.providerProfiles).toMatchObject({
      count: 1,
      activeProviderType: 'ollama',
      configuredCredentialCount: 0,
    });
  });

  it('returns redacted provider profile credential metadata without endpoint, model, or secrets', async () => {
    mockCheckHealth.mockResolvedValue({ available: true });
    mockGetSupportStats.mockResolvedValue({
      conversationCount: 0,
      messageCountLast7d: 0,
      insightsByTypeStatus: [],
      insightsBySeverity: {},
      activeInsightCount: 0,
    });
    mockFindSettingsByKeys.mockResolvedValue([
      {
        key: 'aiProviderProfiles',
        value: JSON.stringify([
          {
            id: 'lan-ollama',
            name: 'LAN Ollama',
            providerType: 'openai-compatible',
            endpoint: 'http://lan-llm:8000/v1',
            model: 'private-model',
            capabilities: { chat: true, toolCalls: true, strictJson: true },
          },
        ]),
      },
      { key: 'aiActiveProviderProfileId', value: JSON.stringify('lan-ollama') },
      {
        key: 'aiProviderCredentials',
        value: JSON.stringify({
          'lan-ollama': {
            type: 'api-key',
            encryptedApiKey: 'encrypted-secret',
            configuredAt: '2026-04-26T00:00:00.000Z',
          },
        }),
      },
    ]);

    const result = await getCollector()(makeContext());
    const json = JSON.stringify(result);

    expect(result.providerProfiles).toMatchObject({
      count: 1,
      activeProviderType: 'openai-compatible',
      activeCredentialConfigured: true,
      activeCredentialNeedsReview: false,
      configuredCredentialCount: 1,
      needsReviewCredentialCount: 0,
      providerTypeCounts: { 'openai-compatible': 1 },
    });
    expect(json).not.toContain('lan-llm');
    expect(json).not.toContain('private-model');
    expect(json).not.toContain('encrypted-secret');
  });

  it('reports health error without failing the whole collector', async () => {
    mockCheckHealth.mockRejectedValue(new Error('container unreachable'));
    mockGetSupportStats.mockResolvedValue({
      conversationCount: 0,
      messageCountLast7d: 0,
      insightsByTypeStatus: [],
      insightsBySeverity: {},
      activeInsightCount: 0,
    });

    const result = await getCollector()(makeContext());
    const health = result.health as Record<string, unknown>;
    expect(health.error).toBe('container unreachable');
    expect(result.conversationCount).toBe(0);
  });

  it('reports stats error when repository fails', async () => {
    mockCheckHealth.mockResolvedValue({
      available: false,
      error: 'AI is disabled in settings',
    });
    mockGetSupportStats.mockRejectedValue(new Error('db down'));

    const result = await getCollector()(makeContext());
    expect(result.statsError).toBe('db down');
  });

  it('reports provider profile metadata errors without failing the collector', async () => {
    mockCheckHealth.mockResolvedValue({ available: true });
    mockGetSupportStats.mockResolvedValue({
      conversationCount: 0,
      messageCountLast7d: 0,
      insightsByTypeStatus: [],
      insightsBySeverity: {},
      activeInsightCount: 0,
    });
    mockFindSettingsByKeys.mockRejectedValue(new Error('settings unavailable'));

    const result = await getCollector()(makeContext());
    expect(result.providerProfiles).toEqual({ error: 'settings unavailable' });
  });

  it('never includes message content or insight titles', async () => {
    mockCheckHealth.mockResolvedValue({ available: true });
    mockGetSupportStats.mockResolvedValue({
      conversationCount: 1,
      messageCountLast7d: 1,
      insightsByTypeStatus: [{ type: 'anomaly', status: 'active', count: 1 }],
      insightsBySeverity: { critical: 1 },
      activeInsightCount: 1,
    });

    const result = await getCollector()(makeContext());
    const json = JSON.stringify(result);
    expect(json).not.toContain('content');
    expect(json).not.toContain('title');
    expect(json).not.toContain('analysis');
  });
});
