/**
 * AI Status Route
 *
 * GET /ai/status - Check AI availability and model information
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { aiService } from '../../services/aiService';
import { createLogger } from '../../utils/logger';
import type { RequestHandler } from 'express';

const log = createLogger('AI-API');

export function createStatusRouter(aiRateLimiter: RequestHandler): Router {
  const router = Router();

  router.get('/status', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
    try {
      const enabled = await aiService.isEnabled();

      if (!enabled) {
        return res.json({
          available: false,
          message: 'AI is disabled or not configured',
        });
      }

      const health = await aiService.checkHealth();

      res.json({
        available: health.available,
        model: health.model,
        endpoint: health.endpoint,
        containerAvailable: health.containerAvailable,
        error: health.error,
      });
    } catch (error) {
      log.error('AI status check failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to check AI status',
      });
    }
  });

  return router;
}
