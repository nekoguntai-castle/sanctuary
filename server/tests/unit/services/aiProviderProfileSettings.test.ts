import { describe, expect, it, vi } from 'vitest';

const { mockEncrypt, mockIsEncrypted } = vi.hoisted(() => ({
  mockEncrypt: vi.fn((value: string) => `encrypted:${value}`),
  mockIsEncrypted: vi.fn((value: string) => value.startsWith('encrypted:')),
}));

vi.mock('../../../src/utils/encryption', () => ({
  encrypt: mockEncrypt,
  isEncrypted: mockIsEncrypted,
}));

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

  it('returns redacted credential state without exposing stored provider credentials', () => {
    const response = {
      aiProviderProfiles: [lanOllamaProfile],
      aiActiveProviderProfileId: 'lan-ollama',
      aiProviderCredentials: {
        'lan-ollama': {
          type: 'api-key',
          encryptedApiKey: 'encrypted:secret',
          configuredAt: '2026-04-26T00:00:00.000Z',
        },
      },
    };

    applyAIProviderProfileSettings(response);

    expect(response.aiProviderCredentials).toBeUndefined();
    expect(response.aiActiveProviderProfile).toMatchObject({
      id: 'lan-ollama',
      credentialState: {
        type: 'api-key',
        configured: true,
        needsReview: false,
        configuredAt: '2026-04-26T00:00:00.000Z',
      },
    });
    expect(JSON.stringify(response)).not.toContain('encrypted:secret');
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

  it('stores encrypted write-only credential updates and strips direct credential writes', () => {
    const normalized = normalizeAIProviderProfileSettingsUpdate(
      {
        aiProviderCredentialUpdates: [{ profileId: 'lan-ollama', apiKey: 'plain-secret' }],
        aiProviderCredentials: {
          'lan-ollama': { type: 'api-key', encryptedApiKey: 'attacker-controlled' },
        },
      },
      {
        aiProviderProfiles: [lanOllamaProfile],
        aiActiveProviderProfileId: 'lan-ollama',
      },
    );

    expect(mockEncrypt).toHaveBeenCalledWith('plain-secret');
    expect(normalized.aiProviderCredentialUpdates).toBeUndefined();
    expect(normalized.aiProviderCredentials).toMatchObject({
      'lan-ollama': {
        type: 'api-key',
        encryptedApiKey: 'encrypted:plain-secret',
      },
    });
  });

  it('prunes credentials when provider profiles are replaced', () => {
    const normalized = normalizeAIProviderProfileSettingsUpdate(
      {
        aiProviderProfiles: [lanOllamaProfile],
      },
      {
        aiProviderProfiles: [lanOllamaProfile],
        aiActiveProviderProfileId: 'lan-ollama',
        aiProviderCredentials: {
          'lan-ollama': { type: 'api-key', encryptedApiKey: 'encrypted:kept' },
          removed: { type: 'api-key', encryptedApiKey: 'encrypted:removed' },
        },
      },
    );

    expect(normalized.aiProviderCredentials).toEqual({
      'lan-ollama': { type: 'api-key', encryptedApiKey: 'encrypted:kept' },
    });
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

  it('rejects invalid credential update payloads through the settings adapter', () => {
    expect(() =>
      normalizeAIProviderProfileSettingsUpdate(
        {
          aiProviderCredentialUpdates: [{ profileId: 'missing-profile', apiKey: 'secret' }],
        },
        {
          aiProviderProfiles: [lanOllamaProfile],
          aiActiveProviderProfileId: 'lan-ollama',
        },
      ),
    ).toThrow('AI provider credential updates must reference existing profiles and valid secrets');
  });
});
