/**
 * AI / Treasury Intelligence Collector
 *
 * Reports AI container health plus conversation/message/insight counts.
 * Never includes prompts, responses, insight titles, or analysis text —
 * those contain user-authored content and wallet-inferred recommendations.
 */

import { intelligenceRepository } from '../../../repositories';
import { checkHealth } from '../../ai/health';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('aiIntelligence', async () => {
  const [healthResult, statsResult] = await Promise.allSettled([
    checkHealth(),
    intelligenceRepository.getSupportStats(),
  ]);

  const health = healthResult.status === 'fulfilled'
    ? {
        available: healthResult.value.available,
        containerAvailable: healthResult.value.containerAvailable ?? null,
        hasModel: Boolean(healthResult.value.model),
        hasEndpoint: Boolean(healthResult.value.endpoint),
        error: healthResult.value.error ?? null,
      }
    : { error: getErrorMessage(healthResult.reason) };

  if (statsResult.status === 'rejected') {
    return { health, statsError: getErrorMessage(statsResult.reason) };
  }

  return {
    health,
    ...statsResult.value,
  };
});
