/**
 * AI Model Management Routes
 *
 * POST /ai/detect-ollama - Auto-detect Ollama at common endpoints
 * GET /ai/models - List available models
 * POST /ai/pull-model - Pull (download) a model
 * DELETE /ai/delete-model - Delete a model
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { aiService } from '../../services/aiService';
import { createLogger } from '../../utils/logger';
import type { RequestHandler } from 'express';

const log = createLogger('AI-API');

export function createModelsRouter(aiRateLimiter: RequestHandler): Router {
  const router = Router();

  /**
   * POST /api/v1/ai/detect-ollama
   * Auto-detect Ollama at common endpoints
   */
  router.post('/detect-ollama', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
    try {
      const result = await aiService.detectOllama();
      res.json(result);
    } catch (error) {
      log.error('Ollama detection failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to detect Ollama',
      });
    }
  });

  /**
   * GET /api/v1/ai/models
   * List available models from configured endpoint
   */
  router.get('/models', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
    try {
      const result = await aiService.listModels();

      if (result.error) {
        return res.status(502).json({
          error: 'Bad Gateway',
          message: result.error,
        });
      }

      res.json(result);
    } catch (error) {
      log.error('List models failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to list models',
      });
    }
  });

  /**
   * POST /api/v1/ai/pull-model
   * Pull (download) a model from Ollama
   */
  router.post('/pull-model', authenticate, requireAdmin, aiRateLimiter, async (req: Request, res: Response) => {
    try {
      const { model } = req.body;

      if (!model) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Model name is required',
        });
      }

      const result = await aiService.pullModel(model);

      if (!result.success) {
        return res.status(502).json({
          error: 'Bad Gateway',
          message: result.error || 'Pull failed',
        });
      }

      res.json(result);
    } catch (error) {
      log.error('Pull model failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to pull model',
      });
    }
  });

  /**
   * DELETE /api/v1/ai/delete-model
   * Delete a model from Ollama
   */
  router.delete('/delete-model', authenticate, requireAdmin, aiRateLimiter, async (req: Request, res: Response) => {
    try {
      const { model } = req.body;

      if (!model) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Model name is required',
        });
      }

      const result = await aiService.deleteModel(model);

      if (!result.success) {
        return res.status(502).json({
          error: 'Bad Gateway',
          message: result.error || 'Delete failed',
        });
      }

      res.json(result);
    } catch (error) {
      log.error('Delete model failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to delete model',
      });
    }
  });

  return router;
}
