import { InvalidInputError } from '../../errors/ApiError';
import {
  AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
  AI_PROVIDER_PROFILES_KEY,
  buildAIProviderProfileState,
  findAIProviderProfile,
  replaceAIProviderProfile,
  requireAIProviderProfiles,
  type AIProviderProfile,
} from './providerProfile';

export type AIProviderSettingsRecord = Record<string, unknown>;

export const AI_PROVIDER_PROFILE_SETTING_KEYS = [
  'aiEndpoint',
  'aiModel',
  AI_PROVIDER_PROFILES_KEY,
  AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
] as const;

export function applyAIProviderProfileSettings(response: AIProviderSettingsRecord): void {
  const providerState = buildAIProviderProfileState({
    endpoint: response.aiEndpoint,
    model: response.aiModel,
    providerProfiles: response[AI_PROVIDER_PROFILES_KEY],
    activeProviderProfileId: response[AI_ACTIVE_PROVIDER_PROFILE_ID_KEY],
  });

  response[AI_PROVIDER_PROFILES_KEY] = providerState.aiProviderProfiles;
  response[AI_ACTIVE_PROVIDER_PROFILE_ID_KEY] = providerState.aiActiveProviderProfileId;
  response.aiActiveProviderProfile = providerState.aiActiveProviderProfile;
  response.aiEndpoint = providerState.aiActiveProviderProfile.endpoint;
  response.aiModel = providerState.aiActiveProviderProfile.model;
}

export function hasAIProviderProfileSettingUpdate(updates: AIProviderSettingsRecord): boolean {
  return (
    Object.prototype.hasOwnProperty.call(updates, 'aiEndpoint') ||
    Object.prototype.hasOwnProperty.call(updates, 'aiModel') ||
    Object.prototype.hasOwnProperty.call(updates, AI_PROVIDER_PROFILES_KEY) ||
    Object.prototype.hasOwnProperty.call(updates, AI_ACTIVE_PROVIDER_PROFILE_ID_KEY)
  );
}

export function sanitizeAIProviderProfileSettingsUpdate(updates: AIProviderSettingsRecord): AIProviderSettingsRecord {
  const sanitizedUpdates = { ...updates };
  delete sanitizedUpdates.aiActiveProviderProfile;
  return sanitizedUpdates;
}

export function normalizeAIProviderProfileSettingsUpdate(
  updates: AIProviderSettingsRecord,
  currentResponse: AIProviderSettingsRecord,
): AIProviderSettingsRecord {
  const sanitizedUpdates = sanitizeAIProviderProfileSettingsUpdate(updates);

  if (!hasAIProviderProfileSettingUpdate(sanitizedUpdates)) {
    return sanitizedUpdates;
  }

  const profiles = resolveProviderProfilesForUpdate(sanitizedUpdates, currentResponse);
  const activeProfile = resolveActiveProviderProfileForUpdate(sanitizedUpdates, currentResponse, profiles);
  const profileWithEndpointModel = {
    ...activeProfile,
    endpoint: typeof sanitizedUpdates.aiEndpoint === 'string' ? sanitizedUpdates.aiEndpoint : activeProfile.endpoint,
    model: typeof sanitizedUpdates.aiModel === 'string' ? sanitizedUpdates.aiModel : activeProfile.model,
  };
  const nextProfiles = replaceAIProviderProfile(profiles, profileWithEndpointModel);

  return {
    ...sanitizedUpdates,
    [AI_PROVIDER_PROFILES_KEY]: nextProfiles,
    [AI_ACTIVE_PROVIDER_PROFILE_ID_KEY]: profileWithEndpointModel.id,
    aiEndpoint: profileWithEndpointModel.endpoint,
    aiModel: profileWithEndpointModel.model,
  };
}

function resolveProviderProfilesForUpdate(
  updates: AIProviderSettingsRecord,
  currentResponse: AIProviderSettingsRecord,
): AIProviderProfile[] {
  if (!Object.prototype.hasOwnProperty.call(updates, AI_PROVIDER_PROFILES_KEY)) {
    return buildAIProviderProfileState({
      endpoint: currentResponse.aiEndpoint,
      model: currentResponse.aiModel,
      providerProfiles: currentResponse[AI_PROVIDER_PROFILES_KEY],
      activeProviderProfileId: currentResponse[AI_ACTIVE_PROVIDER_PROFILE_ID_KEY],
    }).aiProviderProfiles;
  }

  try {
    return requireAIProviderProfiles(updates[AI_PROVIDER_PROFILES_KEY]);
  } catch {
    throw new InvalidInputError('AI provider profiles must be a non-empty array of valid profiles');
  }
}

function resolveActiveProviderProfileForUpdate(
  updates: AIProviderSettingsRecord,
  currentResponse: AIProviderSettingsRecord,
  profiles: AIProviderProfile[],
): AIProviderProfile {
  const requestedActiveId = resolveRequestedActiveProviderProfileId(updates, currentResponse, profiles);
  const activeProfile = findAIProviderProfile(profiles, String(requestedActiveId));

  if (!activeProfile) {
    throw new InvalidInputError('Active AI provider profile must reference an existing profile');
  }

  return activeProfile;
}

function resolveRequestedActiveProviderProfileId(
  updates: AIProviderSettingsRecord,
  currentResponse: AIProviderSettingsRecord,
  profiles: AIProviderProfile[],
): unknown {
  if (typeof updates[AI_ACTIVE_PROVIDER_PROFILE_ID_KEY] === 'string') {
    return updates[AI_ACTIVE_PROVIDER_PROFILE_ID_KEY];
  }

  if (Object.prototype.hasOwnProperty.call(updates, AI_PROVIDER_PROFILES_KEY)) {
    return profiles[0]?.id;
  }

  return currentResponse[AI_ACTIVE_PROVIDER_PROFILE_ID_KEY];
}
