/**
 * AI Feature Routes
 *
 * POST /ai/suggest-label - Get label suggestion for a transaction
 * POST /ai/query - Execute a natural language query
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import { aiService } from '../../services/aiService';
import { createLogger } from '../../utils/logger';
import type { RequestHandler } from 'express';

const log = createLogger('AI-API');

export function createFeaturesRouter(aiRateLimiter: RequestHandler): Router {
  const router = Router();

  /**
   * POST /api/v1/ai/suggest-label
   * Get label suggestion for a transaction
   *
   * Request body:
   *   - transactionId: string - Transaction ID to suggest label for
   *
   * The AI container fetches sanitized transaction data internally.
   * This ensures no sensitive data (addresses, txids) is exposed.
   */
  router.post('/suggest-label', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
    try {
      const { transactionId } = req.body;

      // Validation
      if (!transactionId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'transactionId is required',
        });
      }

      const enabled = await aiService.isEnabled();
      if (!enabled) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'AI is not enabled or configured',
        });
      }

      // Get auth token to pass to AI container
      const authToken = req.headers.authorization?.replace('Bearer ', '') || '';

      const suggestion = await aiService.suggestTransactionLabel(transactionId, authToken);

      if (!suggestion) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'AI endpoint is not available or returned no suggestion',
        });
      }

      res.json({
        suggestion,
      });
    } catch (error) {
      log.error('AI label suggestion failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to generate label suggestion',
      });
    }
  });

  /**
   * POST /api/v1/ai/query
   * Execute a natural language query
   *
   * Request body:
   *   - query: string - Natural language query
   *   - walletId: string - Wallet ID for context
   *
   * Returns a structured query that the frontend can execute.
   */
  router.post('/query', authenticate, aiRateLimiter, async (req: Request, res: Response) => {
    try {
      const { query, walletId } = req.body;

      // Validation
      if (!query || !walletId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Query and walletId are required',
        });
      }

      const enabled = await aiService.isEnabled();
      if (!enabled) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'AI is not enabled or configured',
        });
      }

      // Get auth token to pass to AI container
      const authToken = req.headers.authorization?.replace('Bearer ', '') || '';

      const result = await aiService.executeNaturalQuery(query, walletId, authToken);

      if (!result) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: 'AI endpoint is not available or could not process query',
        });
      }

      res.json(result);
    } catch (error) {
      log.error('AI natural query failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to execute natural language query',
      });
    }
  });

  return router;
}
