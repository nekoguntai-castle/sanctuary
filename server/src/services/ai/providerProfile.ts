import { z } from 'zod';

export const AI_PROVIDER_PROFILES_KEY = 'aiProviderProfiles';
export const AI_ACTIVE_PROVIDER_PROFILE_ID_KEY = 'aiActiveProviderProfileId';
export const DEFAULT_AI_PROVIDER_PROFILE_ID = 'default-ollama';

export const AI_PROVIDER_TYPES = ['ollama', 'openai-compatible'] as const;

export const DEFAULT_AI_PROVIDER_CAPABILITIES = {
  chat: true,
  toolCalls: false,
  strictJson: true,
} as const;

const AIProviderCapabilitiesSchema = z
  .object({
    chat: z.boolean().default(DEFAULT_AI_PROVIDER_CAPABILITIES.chat),
    toolCalls: z.boolean().default(DEFAULT_AI_PROVIDER_CAPABILITIES.toolCalls),
    strictJson: z.boolean().default(DEFAULT_AI_PROVIDER_CAPABILITIES.strictJson),
  })
  .strict();

export const AIProviderProfileSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    providerType: z.enum(AI_PROVIDER_TYPES).default('ollama'),
    endpoint: z.string().trim().max(2048),
    model: z.string().trim().max(200),
    capabilities: AIProviderCapabilitiesSchema.default(DEFAULT_AI_PROVIDER_CAPABILITIES),
  })
  .strict();

export const AIProviderProfilesSchema = z
  .array(AIProviderProfileSchema)
  .max(20)
  .superRefine((profiles, context) => {
    const profileIds = new Set<string>();

    for (const [index, profile] of profiles.entries()) {
      if (profileIds.has(profile.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AI provider profile IDs must be unique',
          path: [index, 'id'],
        });
        return;
      }
      profileIds.add(profile.id);
    }
  });

export type AIProviderType = (typeof AI_PROVIDER_TYPES)[number];
export type AIProviderProfile = z.infer<typeof AIProviderProfileSchema>;

export interface AIProviderProfileState {
  aiProviderProfiles: AIProviderProfile[];
  aiActiveProviderProfileId: string;
  aiActiveProviderProfile: AIProviderProfile;
}

interface AIProviderProfileStateInput {
  endpoint?: unknown;
  model?: unknown;
  providerProfiles?: unknown;
  activeProviderProfileId?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createDefaultAIProviderProfile(endpoint = '', model = ''): AIProviderProfile {
  return {
    id: DEFAULT_AI_PROVIDER_PROFILE_ID,
    name: 'Default Ollama',
    providerType: 'ollama',
    endpoint,
    model,
    capabilities: { ...DEFAULT_AI_PROVIDER_CAPABILITIES },
  };
}

export function parseAIProviderProfiles(value: unknown): AIProviderProfile[] | null {
  const result = AIProviderProfilesSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function requireAIProviderProfiles(value: unknown): AIProviderProfile[] {
  const profiles = parseAIProviderProfiles(value);
  if (!profiles || profiles.length === 0) {
    throw new Error('AI provider profiles must be a non-empty array of valid profiles');
  }
  return profiles;
}

export function findAIProviderProfile(profiles: AIProviderProfile[], profileId: string): AIProviderProfile | undefined {
  return profiles.find((profile) => profile.id === profileId);
}

export function buildAIProviderProfileState(input: AIProviderProfileStateInput): AIProviderProfileState {
  const fallbackProfile = createDefaultAIProviderProfile(asString(input.endpoint), asString(input.model));
  const parsedProfiles = parseAIProviderProfiles(input.providerProfiles);
  const profiles = parsedProfiles && parsedProfiles.length > 0 ? parsedProfiles : [fallbackProfile];
  const requestedActiveId = asString(input.activeProviderProfileId) || profiles[0]?.id || fallbackProfile.id;
  const activeProfile = findAIProviderProfile(profiles, requestedActiveId) ?? profiles[0] ?? fallbackProfile;

  return {
    aiProviderProfiles: profiles,
    aiActiveProviderProfileId: activeProfile.id,
    aiActiveProviderProfile: activeProfile,
  };
}

export function replaceAIProviderProfile(
  profiles: AIProviderProfile[],
  profile: AIProviderProfile,
): AIProviderProfile[] {
  let replaced = false;
  const nextProfiles = profiles.map((existingProfile) => {
    if (existingProfile.id !== profile.id) {
      return existingProfile;
    }
    replaced = true;
    return profile;
  });

  return replaced ? nextProfiles : [...nextProfiles, profile];
}
