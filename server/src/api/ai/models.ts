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
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import { aiService } from '../../services/aiService';
import type { RequestHandler } from 'express';

const ModelBodySchema = z.object({
  model: z.string().trim().min(1, 'Model name is required'),
});

export function createModelsRouter(aiRateLimiter: RequestHandler): Router {
  const router = Router();

  /**
   * POST /api/v1/ai/detect-ollama
   * Auto-detect Ollama at common endpoints
   */
  router.post('/detect-ollama', authenticate, aiRateLimiter, asyncHandler(async (_req, res) => {
    const result = await aiService.detectOllama();
    res.json(result);
  }));

  /**
   * GET /api/v1/ai/models
   * List available models from configured endpoint
   */
  router.get('/models', authenticate, aiRateLimiter, asyncHandler(async (_req, res) => {
    const result = await aiService.listModels();

    if (result.error) {
      return res.status(502).json({
        error: 'Bad Gateway',
        message: result.error,
      });
    }

    res.json(result);
  }));

  /**
   * POST /api/v1/ai/pull-model
   * Pull (download) a model from Ollama
   */
  router.post(
    '/pull-model',
    authenticate,
    requireAdmin,
    aiRateLimiter,
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
    authenticate,
    requireAdmin,
    aiRateLimiter,
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
