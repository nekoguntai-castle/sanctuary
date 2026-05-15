/**
 * AI provider discovery and model listing routes.
 *
 * POST /ai/detect-ollama - Auto-detect Ollama at common endpoints
 * GET /ai/models - List available models
 */

import { Router } from 'express';
import expressRateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { rateLimitByUser } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import config from '../../config';
import { aiService } from '../../services/aiService';

const aiAuthLimiter = expressRateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.apiDefaultLimit,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: {
    error: 'Too Many Requests',
    message: 'API request rate limit exceeded. Please slow down.',
  },
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
    aiAuthLimiter,
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
    aiAuthLimiter,
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
    aiAuthLimiter,
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

  return router;
}
