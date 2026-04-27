import type {
  AIProviderCapabilities,
  AIProviderProfile,
  AIProviderType,
} from '../../src/api/admin';

export const DEFAULT_PROVIDER_CAPABILITIES: AIProviderCapabilities = {
  chat: true,
  toolCalls: false,
  strictJson: true,
};

export interface EditableProviderProfile {
  id: string;
  name: string;
  providerType: AIProviderType;
  endpoint: string;
  model: string;
  capabilities: AIProviderCapabilities;
  credentialState?: AIProviderProfile['credentialState'];
}

interface ProviderSettingsInput {
  aiEndpoint?: string;
  aiModel?: string;
  aiProviderProfiles?: AIProviderProfile[];
  aiActiveProviderProfileId?: string;
  aiActiveProviderProfile?: AIProviderProfile;
}

export function createDefaultProviderProfile(endpoint = '', model = ''): EditableProviderProfile {
  return {
    id: 'default-ollama',
    name: 'Default Ollama',
    providerType: 'ollama',
    endpoint,
    model,
    capabilities: { ...DEFAULT_PROVIDER_CAPABILITIES },
  };
}

export function createProviderProfile(id: string): EditableProviderProfile {
  return {
    id,
    name: 'New provider',
    providerType: 'openai-compatible',
    endpoint: '',
    model: '',
    capabilities: {
      chat: true,
      toolCalls: true,
      strictJson: true,
    },
  };
}

export function normalizeProviderProfiles(settings: ProviderSettingsInput): {
  profiles: EditableProviderProfile[];
  activeProfileId: string;
  activeProfile: EditableProviderProfile;
} {
  const fallback = createDefaultProviderProfile(settings.aiEndpoint, settings.aiModel);
  const profiles = settings.aiProviderProfiles?.length ? settings.aiProviderProfiles : [fallback];
  const firstProfile = profiles[0];
  const requestedId =
    settings.aiActiveProviderProfile?.id ||
    settings.aiActiveProviderProfileId ||
    firstProfile.id;
  const activeProfile =
    settings.aiActiveProviderProfile ||
    profiles.find((profile) => profile.id === requestedId) ||
    firstProfile;

  return {
    profiles: profiles.map(toEditableProviderProfile),
    activeProfileId: activeProfile.id,
    activeProfile: toEditableProviderProfile(activeProfile),
  };
}

export function replaceProviderProfile(
  profiles: EditableProviderProfile[],
  profile: EditableProviderProfile,
): EditableProviderProfile[] {
  const nextProfiles = profiles.map((candidate) => (
    candidate.id === profile.id ? profile : candidate
  ));
  return nextProfiles.some((candidate) => candidate.id === profile.id)
    ? nextProfiles
    : [...nextProfiles, profile];
}

export function stripProviderCredentialState(
  profile: EditableProviderProfile,
): Omit<EditableProviderProfile, 'credentialState'> {
  const { credentialState: _credentialState, ...storedProfile } = profile;
  return storedProfile;
}

export function toCredentialStatusText(profile: EditableProviderProfile): string {
  const state = profile.credentialState;
  if (!state || state.type === 'none') return 'No credential';
  if (state.needsReview) return 'Needs review';
  return state.configured ? 'Configured' : 'No credential';
}

function toEditableProviderProfile(profile: AIProviderProfile | EditableProviderProfile): EditableProviderProfile {
  return {
    id: profile.id,
    name: profile.name,
    providerType: profile.providerType,
    endpoint: profile.endpoint,
    model: profile.model,
    capabilities: {
      chat: profile.capabilities.chat,
      toolCalls: profile.capabilities.toolCalls,
      strictJson: profile.capabilities.strictJson,
    },
    ...(profile.credentialState ? { credentialState: profile.credentialState } : {}),
  };
}
