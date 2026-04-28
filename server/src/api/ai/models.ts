/**
 * AI Model Management Routes
 *
 * POST /ai/detect-ollama - Auto-detect Ollama at common endpoints
 * GET /ai/models - List available models
 * POST /ai/pull-model - Pull (download) a model
 * DELETE /ai/delete-model - Delete a model
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { rateLimit, rateLimitByUser } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import { aiService } from '../../services/aiService';

const ModelBodySchema = z.object({
  model: z.string().trim().min(1, 'Model name is required'),
});

const ProviderTypeSchema = z.enum(['ollama', 'openai-compatible']);

const ProviderDetectionBodySchema = z.object({
  endpoint: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'Endpoint must be an HTTP(S) URL'),
  preferredProviderType: ProviderTypeSchema.optional(),
  apiKey: z.string().max(8192).optional(),
});

export function createModelsRouter(): Router {
  const router = Router();

  /**
   * POST /api/v1/ai/detect-ollama
   * Auto-detect Ollama at common endpoints
   */
  router.post(
    '/detect-ollama',
    rateLimit('api:default'),
    authenticate,
    rateLimitByUser('ai:analyze'),
    asyncHandler(async (_req, res) => {
      const result = await aiService.detectOllama();
      res.json(result);
    })
  );

  /**
   * POST /api/v1/ai/detect-provider
   * Detect a provider at a typed endpoint
   */
  router.post(
    '/detect-provider',
    rateLimit('api:default'),
    authenticate,
    rateLimitByUser('ai:analyze'),
    requireAdmin,
    validate(
      { body: ProviderDetectionBodySchema },
      { message: 'Valid provider endpoint is required', code: ErrorCodes.INVALID_INPUT },
    ),
    asyncHandler(async (req, res) => {
      const result = await aiService.detectProviderEndpoint(req.body);

      if (!result.found) {
        return res.status(result.blockedReason ? 400 : 502).json({
          error: result.blockedReason ? 'Bad Request' : 'Bad Gateway',
          message: result.message || 'Provider detection failed',
        });
      }

      res.json(result);
    }),
  );

  /**
   * GET /api/v1/ai/models
   * List available models from configured endpoint
   */
  router.get(
    '/models',
    rateLimit('api:default'),
    authenticate,
    rateLimitByUser('ai:analyze'),
    asyncHandler(async (_req, res) => {
      const result = await aiService.listModels();

      if (result.error) {
        return res.status(502).json({
          error: 'Bad Gateway',
          message: result.error,
        });
      }

      res.json(result);
    })
  );

  /**
   * POST /api/v1/ai/pull-model
   * Pull (download) a model from Ollama
   */
  router.post(
    '/pull-model',
    rateLimit('api:default'),
    authenticate,
    rateLimitByUser('ai:analyze'),
    requireAdmin,
    validate(
      { body: ModelBodySchema },
      { message: 'Model name is required', code: ErrorCodes.INVALID_INPUT }
    ),
    asyncHandler(async (req, res) => {
      const { model } = req.body;

      const result = await aiService.pullModel(model);

      if (!result.success) {
        return res.status(502).json({
          error: 'Bad Gateway',
          message: result.error || 'Pull failed',
        });
      }

      res.json(result);
    })
  );

  /**
   * DELETE /api/v1/ai/delete-model
   * Delete a model from Ollama
   */
  router.delete(
    '/delete-model',
    rateLimit('api:default'),
    authenticate,
    rateLimitByUser('ai:analyze'),
    requireAdmin,
    validate(
      { body: ModelBodySchema },
      { message: 'Model name is required', code: ErrorCodes.INVALID_INPUT }
    ),
    asyncHandler(async (req, res) => {
      const { model } = req.body;

      const result = await aiService.deleteModel(model);

      if (!result.success) {
        return res.status(502).json({
          error: 'Bad Gateway',
          message: result.error || 'Delete failed',
        });
      }

      res.json(result);
    })
  );

  return router;
}
