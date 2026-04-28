/**
 * AI Status Route
 *
 * GET /ai/status - Check AI availability and model information
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { rateLimit, rateLimitByUser } from '../../middleware/rateLimit';
import { asyncHandler } from '../../errors/errorHandler';
import { aiService } from '../../services/aiService';
import { featureFlagService } from '../../services/featureFlagService';

function disabledStatus(
  assistantFeatureEnabled: boolean,
  configStatus: { configured: boolean },
) {
  return {
    enabled: false,
    configured: configStatus.configured,
    available: false,
    message: assistantFeatureEnabled
      ? 'AI is disabled'
      : 'AI assistant feature is disabled',
  };
}

function incompleteProviderStatus(configStatus: { model?: string; endpoint?: string }) {
  return {
    enabled: true,
    configured: false,
    available: false,
    model: configStatus.model,
    endpoint: configStatus.endpoint,
    message: 'AI provider is not configured',
  };
}

export function createStatusRouter(): Router {
  const router = Router();

  router.use(rateLimit('api:default'));
  router.use(authenticate);
  router.use(rateLimitByUser('ai:analyze'));

  router.get('/status', asyncHandler(async (_req, res) => {
    const [assistantFeatureEnabled, configStatus] = await Promise.all([
      featureFlagService.isEnabled('aiAssistant'),
      aiService.getConfigStatus(),
    ]);

    if (!assistantFeatureEnabled || !configStatus.enabled) {
      return res.json(disabledStatus(assistantFeatureEnabled, configStatus));
    }

    if (!configStatus.configured) {
      return res.json(incompleteProviderStatus(configStatus));
    }

    const containerAvailable = await aiService.isContainerAvailable();

    res.json({
      enabled: true,
      configured: true,
      available: containerAvailable,
      model: configStatus.model,
      endpoint: configStatus.endpoint,
      containerAvailable,
      error: containerAvailable ? undefined : 'AI proxy container is not available',
    });
  }));

  router.post('/test-connection', requireAdmin, asyncHandler(async (_req, res) => {
    const [assistantFeatureEnabled, configStatus] = await Promise.all([
      featureFlagService.isEnabled('aiAssistant'),
      aiService.getConfigStatus(),
    ]);

    if (!assistantFeatureEnabled || !configStatus.enabled) {
      return res.json(disabledStatus(assistantFeatureEnabled, configStatus));
    }

    if (!configStatus.configured) {
      return res.json(incompleteProviderStatus(configStatus));
    }

    const health = await aiService.checkHealth();

    res.json({
      enabled: true,
      configured: true,
      available: health.available,
      model: health.model,
      endpoint: health.endpoint,
      containerAvailable: health.containerAvailable,
      error: health.error,
    });
  }));

  return router;
}
