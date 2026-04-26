import { describe, expect, it } from 'vitest';
import {
  buildAIProviderProfileState,
  createDefaultAIProviderProfile,
  parseAIProviderProfiles,
  replaceAIProviderProfile,
  requireAIProviderProfiles,
} from '../../../src/services/ai/providerProfile';

const lanOllamaProfile = {
  id: 'lan-ollama',
  name: 'LAN Ollama',
  providerType: 'ollama' as const,
  endpoint: 'http://lan-llm:11434',
  model: 'llama3.2:3b',
  capabilities: { chat: true, toolCalls: false, strictJson: true },
};

describe('AI provider profile domain model', () => {
  it('creates the default Ollama profile from legacy endpoint and model values', () => {
    expect(createDefaultAIProviderProfile('http://ollama:11434', 'llama3.2:3b')).toMatchObject({
      id: 'default-ollama',
      providerType: 'ollama',
      endpoint: 'http://ollama:11434',
      model: 'llama3.2:3b',
    });
  });

  it('parses valid profiles and rejects duplicate profile IDs', () => {
    expect(parseAIProviderProfiles([lanOllamaProfile])).toEqual([lanOllamaProfile]);
    expect(parseAIProviderProfiles([lanOllamaProfile, { ...lanOllamaProfile, name: 'Duplicate' }])).toBeNull();
  });

  it('requires non-empty valid profile arrays', () => {
    expect(requireAIProviderProfiles([lanOllamaProfile])).toEqual([lanOllamaProfile]);
    expect(() => requireAIProviderProfiles([])).toThrow('AI provider profiles must be a non-empty array');
    expect(() => requireAIProviderProfiles([{ ...lanOllamaProfile, id: '' }])).toThrow(
      'AI provider profiles must be a non-empty array',
    );
  });

  it('falls back to the first profile when the requested active profile is missing', () => {
    const state = buildAIProviderProfileState({
      providerProfiles: [lanOllamaProfile],
      activeProviderProfileId: 'missing-profile',
    });

    expect(state.aiActiveProviderProfileId).toBe('lan-ollama');
    expect(state.aiActiveProviderProfile).toEqual(lanOllamaProfile);
  });

  it('replaces existing profiles and appends new profiles', () => {
    const updatedProfile = { ...lanOllamaProfile, model: 'qwen2.5:7b' };
    const appendedProfile = {
      ...lanOllamaProfile,
      id: 'lab-openai-compatible',
      name: 'Lab OpenAI Compatible',
      providerType: 'openai-compatible' as const,
    };

    expect(replaceAIProviderProfile([lanOllamaProfile], updatedProfile)).toEqual([updatedProfile]);
    expect(replaceAIProviderProfile([lanOllamaProfile], appendedProfile)).toEqual([
      lanOllamaProfile,
      appendedProfile,
    ]);
  });
});
