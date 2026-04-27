import { describe, expect, it } from 'vitest';
import {
  createDefaultProviderProfile,
  normalizeProviderProfiles,
  replaceProviderProfile,
  stripProviderCredentialState,
  toCredentialStatusText,
} from '../../../components/AISettings/providerProfileModel';

describe('AI provider profile model', () => {
  it('builds a default profile from legacy endpoint and model settings', () => {
    const state = normalizeProviderProfiles({
      aiEndpoint: 'http://ollama.local:11434',
      aiModel: 'llama3.2:3b',
    });

    expect(state.activeProfile).toMatchObject({
      id: 'default-ollama',
      endpoint: 'http://ollama.local:11434',
      model: 'llama3.2:3b',
      providerType: 'ollama',
    });
    expect(state.profiles).toHaveLength(1);
  });

  it('keeps provider credential state out of stored profile updates', () => {
    const profile = {
      ...createDefaultProviderProfile(),
      credentialState: {
        type: 'api-key' as const,
        configured: true,
        needsReview: false,
      },
    };

    expect(stripProviderCredentialState(profile)).not.toHaveProperty('credentialState');
    expect(toCredentialStatusText(profile)).toBe('Configured');
    expect(toCredentialStatusText({ ...profile, credentialState: undefined })).toBe('No credential');
    expect(toCredentialStatusText({
      ...profile,
      credentialState: {
        type: 'api-key',
        configured: false,
        needsReview: false,
      },
    })).toBe('No credential');
    expect(toCredentialStatusText({
      ...profile,
      credentialState: {
        type: 'api-key',
        configured: false,
        needsReview: true,
        disabledReason: 'restored',
      },
    })).toBe('Needs review');
  });

  it('honors active profile references from the backend response', () => {
    const defaultProfile = createDefaultProviderProfile('http://ollama:11434', 'llama3.2:3b');
    const remoteProfile = {
      ...defaultProfile,
      id: 'remote-openai',
      name: 'Remote OpenAI',
      providerType: 'openai-compatible' as const,
      capabilities: {
        chat: true,
        toolCalls: true,
        strictJson: true,
      },
    };

    expect(normalizeProviderProfiles({
      aiProviderProfiles: [defaultProfile, remoteProfile],
      aiActiveProviderProfileId: 'remote-openai',
    }).activeProfile).toMatchObject({ id: 'remote-openai' });
    expect(normalizeProviderProfiles({
      aiProviderProfiles: [defaultProfile, remoteProfile],
      aiActiveProviderProfileId: 'missing-provider',
    }).activeProfile).toMatchObject({ id: 'default-ollama' });
    expect(normalizeProviderProfiles({
      aiProviderProfiles: [defaultProfile],
      aiActiveProviderProfile: remoteProfile,
    }).activeProfile).toMatchObject({ id: 'remote-openai' });
    expect(normalizeProviderProfiles({
      aiProviderProfiles: [],
      aiActiveProviderProfileId: '',
      aiEndpoint: 'http://fallback:11434',
      aiModel: 'fallback-model',
    }).activeProfile).toMatchObject({
      id: 'default-ollama',
      endpoint: 'http://fallback:11434',
      model: 'fallback-model',
    });
  });

  it('replaces existing provider profiles and appends new profiles', () => {
    const defaultProfile = createDefaultProviderProfile();
    const replacement = { ...defaultProfile, name: 'LAN Ollama' };
    const added = { ...defaultProfile, id: 'remote-openai', name: 'Remote' };

    expect(replaceProviderProfile([defaultProfile], replacement)).toEqual([replacement]);
    expect(replaceProviderProfile([defaultProfile], added)).toEqual([defaultProfile, added]);
  });
});
