import { z } from 'zod';

import { encrypt } from '../../utils/encryption';

export const AI_PROVIDER_CREDENTIALS_KEY = 'aiProviderCredentials';
export const AI_PROVIDER_CREDENTIAL_UPDATES_KEY = 'aiProviderCredentialUpdates';

export const AI_PROVIDER_CREDENTIAL_TYPES = ['api-key'] as const;
export const AI_PROVIDER_CREDENTIAL_DISABLED_REASONS = ['restored'] as const;

const AIProviderCredentialRecordSchema = z
  .object({
    type: z.enum(AI_PROVIDER_CREDENTIAL_TYPES).default('api-key'),
    encryptedApiKey: z.string().trim().min(1).max(8192).optional(),
    configuredAt: z.string().datetime().optional(),
    disabledReason: z.enum(AI_PROVIDER_CREDENTIAL_DISABLED_REASONS).optional(),
  })
  .strict();

export const AIProviderCredentialsSchema = z.record(
  z.string().trim().min(1).max(100),
  AIProviderCredentialRecordSchema,
);

const AIProviderCredentialUpdateSchema = z
  .object({
    profileId: z.string().trim().min(1).max(100),
    type: z.enum(AI_PROVIDER_CREDENTIAL_TYPES).default('api-key'),
    apiKey: z.string().max(8192).optional(),
    clear: z.boolean().default(false),
  })
  .strict();

export const AIProviderCredentialUpdatesSchema = z
  .array(AIProviderCredentialUpdateSchema)
  .max(20)
  .superRefine((updates, context) => {
    const profileIds = new Set<string>();
    for (const [index, update] of updates.entries()) {
      if (profileIds.has(update.profileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'AI provider credential updates must reference each profile at most once',
          path: [index, 'profileId'],
        });
        return;
      }
      profileIds.add(update.profileId);
    }
  });

export type AIProviderCredentialRecord = z.infer<
  typeof AIProviderCredentialRecordSchema
>;
export type AIProviderCredentialMap = z.infer<
  typeof AIProviderCredentialsSchema
>;
export type AIProviderCredentialUpdate = z.infer<
  typeof AIProviderCredentialUpdateSchema
>;
export type AIProviderCredentialDisabledReason =
  (typeof AI_PROVIDER_CREDENTIAL_DISABLED_REASONS)[number];

export interface AIProviderCredentialState {
  type: 'none' | (typeof AI_PROVIDER_CREDENTIAL_TYPES)[number];
  configured: boolean;
  needsReview: boolean;
  configuredAt?: string;
  disabledReason?: AIProviderCredentialDisabledReason;
}

export interface DisabledAIProviderCredentialsResult {
  credentials: AIProviderCredentialMap;
  disabledCount: number;
}

export function parseAIProviderCredentials(
  value: unknown,
): AIProviderCredentialMap {
  const result = AIProviderCredentialsSchema.safeParse(value);
  return result.success ? result.data : {};
}

export function parseAIProviderCredentialUpdates(
  value: unknown,
): AIProviderCredentialUpdate[] | null {
  const result = AIProviderCredentialUpdatesSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function getAIProviderCredentialState(
  record: AIProviderCredentialRecord | undefined,
): AIProviderCredentialState {
  if (!record) {
    return {
      type: 'none',
      configured: false,
      needsReview: false,
    };
  }

  const configured = Boolean(record.encryptedApiKey) && !record.disabledReason;
  return {
    type: record.type,
    configured,
    needsReview: Boolean(record.disabledReason),
    ...(record.configuredAt ? { configuredAt: record.configuredAt } : {}),
    ...(record.disabledReason ? { disabledReason: record.disabledReason } : {}),
  };
}

export function attachAIProviderCredentialState<T extends { id: string }>(
  profiles: T[],
  credentials: AIProviderCredentialMap,
): Array<T & { credentialState: AIProviderCredentialState }> {
  return profiles.map((profile) => ({
    ...profile,
    credentialState: getAIProviderCredentialState(credentials[profile.id]),
  }));
}

export function pruneAIProviderCredentials(
  credentials: AIProviderCredentialMap,
  validProfileIds: Iterable<string>,
): AIProviderCredentialMap {
  const validIds = new Set(validProfileIds);
  const prunedCredentials: AIProviderCredentialMap = {};

  for (const [profileId, credential] of Object.entries(credentials)) {
    if (validIds.has(profileId)) {
      prunedCredentials[profileId] = credential;
    }
  }

  return prunedCredentials;
}

export function applyAIProviderCredentialUpdates(
  credentials: AIProviderCredentialMap,
  updatesValue: unknown,
  validProfileIds: Iterable<string>,
  now = new Date(),
): AIProviderCredentialMap {
  const updates = parseAIProviderCredentialUpdates(updatesValue);
  if (!updates) {
    throw new Error('AI provider credential updates must be a valid array');
  }

  const validIds = new Set(validProfileIds);
  const nextCredentials = pruneAIProviderCredentials(credentials, validIds);
  const configuredAt = now.toISOString();

  for (const update of updates) {
    if (!validIds.has(update.profileId)) {
      throw new Error(
        'AI provider credentials must reference an existing profile',
      );
    }

    if (update.clear || update.apiKey === '') {
      delete nextCredentials[update.profileId];
      continue;
    }

    if (update.apiKey === undefined) {
      continue;
    }

    nextCredentials[update.profileId] = {
      type: update.type,
      encryptedApiKey: encrypt(update.apiKey),
      configuredAt,
    };
  }

  return nextCredentials;
}

export function disableAIProviderCredentialsForRestore(
  value: unknown,
): DisabledAIProviderCredentialsResult {
  const credentials = parseAIProviderCredentials(value);
  let disabledCount = 0;
  const disabledCredentials: AIProviderCredentialMap = {};

  for (const [profileId, credential] of Object.entries(credentials)) {
    if (
      credential.encryptedApiKey &&
      credential.disabledReason !== 'restored'
    ) {
      disabledCount++;
    }

    disabledCredentials[profileId] = {
      type: credential.type,
      ...(credential.configuredAt
        ? { configuredAt: credential.configuredAt }
        : {}),
      disabledReason: 'restored',
    };
  }

  return { credentials: disabledCredentials, disabledCount };
}
