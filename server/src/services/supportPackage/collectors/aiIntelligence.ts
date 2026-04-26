/**
 * AI / Treasury Intelligence Collector
 *
 * Reports AI container health plus conversation/message/insight counts.
 * Never includes prompts, responses, insight titles, or analysis text —
 * those contain user-authored content and wallet-inferred recommendations.
 */

import { consoleRepository, intelligenceRepository, systemSettingRepository } from '../../../repositories';
import { checkHealth } from '../../ai/health';
import { getErrorMessage } from '../../../utils/errors';
import { safeJsonParseUntyped } from '../../../utils/safeJson';
import {
  AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
  AI_PROVIDER_PROFILES_KEY,
  buildAIProviderProfileState,
} from '../../ai/providerProfile';
import { AI_PROVIDER_CREDENTIALS_KEY } from '../../ai/providerCredentials';
import { registerCollector } from './registry';

registerCollector('aiIntelligence', async () => {
  const [healthResult, statsResult, consoleStatsResult, providerProfileResult] =
    await Promise.allSettled([
      checkHealth(),
      intelligenceRepository.getSupportStats(),
      consoleRepository.getSupportStats(),
      getAIProviderProfileSupportState(),
    ]);

  const health =
    healthResult.status === 'fulfilled'
      ? {
          available: healthResult.value.available,
          containerAvailable: healthResult.value.containerAvailable ?? null,
          hasModel: Boolean(healthResult.value.model),
          hasEndpoint: Boolean(healthResult.value.endpoint),
          error: healthResult.value.error ?? null,
        }
      : { error: getErrorMessage(healthResult.reason) };

  if (statsResult.status === 'rejected') {
    return {
      health,
      providerProfiles: settleProviderProfileResult(providerProfileResult),
      consoleStats: settleConsoleStatsResult(consoleStatsResult),
      statsError: getErrorMessage(statsResult.reason),
    };
  }

  return {
    health,
    providerProfiles: settleProviderProfileResult(providerProfileResult),
    consoleStats: settleConsoleStatsResult(consoleStatsResult),
    ...statsResult.value,
  };
});

async function getAIProviderProfileSupportState(): Promise<
  Record<string, unknown>
> {
  const settings = await systemSettingRepository.findByKeys([
    'aiEndpoint',
    'aiModel',
    AI_PROVIDER_PROFILES_KEY,
    AI_ACTIVE_PROVIDER_PROFILE_ID_KEY,
    AI_PROVIDER_CREDENTIALS_KEY,
  ]);
  const values = Object.fromEntries(
    settings.map((setting) => [
      setting.key,
      safeJsonParseUntyped(setting.value, undefined, `setting:${setting.key}`),
    ]),
  );
  const profileState = buildAIProviderProfileState({
    endpoint: values.aiEndpoint,
    model: values.aiModel,
    providerProfiles: values[AI_PROVIDER_PROFILES_KEY],
    activeProviderProfileId: values[AI_ACTIVE_PROVIDER_PROFILE_ID_KEY],
    providerCredentials: values[AI_PROVIDER_CREDENTIALS_KEY],
  });
  const profiles = profileState.aiProviderProfiles;

  return {
    count: profiles.length,
    activeProviderType: profileState.aiActiveProviderProfile.providerType,
    activeCredentialConfigured:
      profileState.aiActiveProviderProfile.credentialState.configured,
    activeCredentialNeedsReview:
      profileState.aiActiveProviderProfile.credentialState.needsReview,
    configuredCredentialCount: profiles.filter(
      (profile) => profile.credentialState.configured,
    ).length,
    needsReviewCredentialCount: profiles.filter(
      (profile) => profile.credentialState.needsReview,
    ).length,
    providerTypeCounts: profiles.reduce<Record<string, number>>((counts, profile) => {
      counts[profile.providerType] = (counts[profile.providerType] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

function settleProviderProfileResult(
  result: PromiseSettledResult<Record<string, unknown>>,
): Record<string, unknown> {
  if (result.status === 'fulfilled') {
    return result.value;
  }

  return { error: getErrorMessage(result.reason) };
}

function settleConsoleStatsResult(
  result: PromiseSettledResult<Record<string, number>>,
): Record<string, unknown> {
  if (result.status === 'fulfilled') {
    return result.value;
  }

  return { error: getErrorMessage(result.reason) };
}
