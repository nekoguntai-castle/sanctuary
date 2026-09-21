import type {
  AIProviderCapabilities,
  AIProviderCredentialUpdate,
  AIProviderType,
  SystemSettingsUpdate,
} from '../../api/admin';
import {
  replaceProviderProfile,
  stripProviderCredentialState,
  type EditableProviderProfile,
} from './providerProfileModel';

interface ActiveProviderFields {
  id: string;
  name: string;
  providerType: AIProviderType;
  endpoint: string;
  model: string;
  capabilities: AIProviderCapabilities;
}

export function buildActiveProviderProfile(
  fields: ActiveProviderFields,
  overrides?: { endpoint?: string; model?: string },
): EditableProviderProfile {
  return {
    id: fields.id,
    name: fields.name.trim() || 'Unnamed provider',
    providerType: fields.providerType,
    endpoint: overrides?.endpoint ?? fields.endpoint.trim(),
    model: overrides?.model ?? fields.model.trim(),
    capabilities: fields.capabilities,
  };
}

export function buildProviderSettingsUpdate(
  profiles: EditableProviderProfile[],
  activeProfile: EditableProviderProfile,
  credentialUpdate?: AIProviderCredentialUpdate[],
): SystemSettingsUpdate {
  const nextProfiles = replaceProviderProfile(profiles, activeProfile).map(
    stripProviderCredentialState,
  );

  return {
    aiEndpoint: activeProfile.endpoint,
    aiModel: activeProfile.model,
    aiProviderProfiles: nextProfiles,
    aiActiveProviderProfileId: activeProfile.id,
    ...(credentialUpdate
      ? { aiProviderCredentialUpdates: credentialUpdate }
      : {}),
  };
}

export function buildCredentialUpdate(
  profileId: string,
  apiKey: string,
  clear: boolean,
): AIProviderCredentialUpdate[] | undefined {
  if (!apiKey && !clear) return undefined;
  return [{ profileId, type: 'api-key', apiKey, clear }];
}

export function providerLabel(type: AIProviderType): string {
  return type === 'openai-compatible' ? 'OpenAI-compatible' : 'Ollama';
}
