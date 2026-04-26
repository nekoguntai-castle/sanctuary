import { describe, expect, it } from 'vitest';
import {
  applyAIProviderProfileSettings,
  normalizeAIProviderProfileSettingsUpdate,
} from '../../../src/services/ai/providerProfileSettings';

const lanOllamaProfile = {
  id: 'lan-ollama',
  name: 'LAN Ollama',
  providerType: 'ollama' as const,
  endpoint: 'http://lan-llm:11434',
  model: 'llama3.2:3b',
  capabilities: { chat: true, toolCalls: false, strictJson: true },
};

describe('AI provider profile settings adapter', () => {
  it('derives a default typed provider profile from legacy endpoint settings', () => {
    const response = {
      aiEndpoint: 'http://ollama:11434',
      aiModel: 'llama3.2:3b',
    };

    applyAIProviderProfileSettings(response);

    expect(response.aiActiveProviderProfileId).toBe('default-ollama');
    expect(response.aiProviderProfiles).toEqual([
      expect.objectContaining({
        id: 'default-ollama',
        providerType: 'ollama',
        endpoint: 'http://ollama:11434',
        model: 'llama3.2:3b',
      }),
    ]);
    expect(response.aiEndpoint).toBe('http://ollama:11434');
    expect(response.aiModel).toBe('llama3.2:3b');
  });

  it('mirrors endpoint and model updates into the active typed provider profile', () => {
    const normalized = normalizeAIProviderProfileSettingsUpdate(
      {
        aiEndpoint: 'http://new-lan-llm:11434',
        aiModel: 'qwen2.5:7b',
      },
      {
        aiProviderProfiles: [lanOllamaProfile],
        aiActiveProviderProfileId: 'lan-ollama',
      },
    );

    expect(normalized.aiActiveProviderProfileId).toBe('lan-ollama');
    expect(normalized.aiProviderProfiles).toEqual([
      expect.objectContaining({
        id: 'lan-ollama',
        endpoint: 'http://new-lan-llm:11434',
        model: 'qwen2.5:7b',
      }),
    ]);
  });

  it('uses the first replacement profile as active when no active profile ID is supplied', () => {
    const normalized = normalizeAIProviderProfileSettingsUpdate(
      {
        aiProviderProfiles: [
          lanOllamaProfile,
          {
            ...lanOllamaProfile,
            id: 'openai-compatible-lab',
            name: 'OpenAI Compatible Lab',
            providerType: 'openai-compatible' as const,
            endpoint: 'http://lab-llm:8000/v1',
          },
        ],
      },
      {},
    );

    expect(normalized.aiActiveProviderProfileId).toBe('lan-ollama');
    expect(normalized.aiEndpoint).toBe('http://lan-llm:11434');
    expect(normalized.aiModel).toBe('llama3.2:3b');
  });

  it('strips derived active provider profile objects from update payloads', () => {
    const normalized = normalizeAIProviderProfileSettingsUpdate(
      {
        registrationEnabled: true,
        aiActiveProviderProfile: { id: 'derived-profile' },
      },
      {},
    );

    expect(normalized).toEqual({ registrationEnabled: true });
  });

  it('rejects active profile IDs that do not exist in the provider profile list', () => {
    expect(() =>
      normalizeAIProviderProfileSettingsUpdate(
        {
          aiActiveProviderProfileId: 'missing-profile',
        },
        {
          aiProviderProfiles: [lanOllamaProfile],
          aiActiveProviderProfileId: 'lan-ollama',
        },
      ),
    ).toThrow('Active AI provider profile must reference an existing profile');
  });
});
