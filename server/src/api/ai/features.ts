/**
 * AI Feature Routes
 *
 * POST /ai/suggest-label - Get label suggestion for a transaction
 * POST /ai/query - Execute a natural language query
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import { aiService } from '../../services/aiService';
import type { RequestHandler } from 'express';

const SuggestLabelBodySchema = z.object({
  transactionId: z.string().trim().min(1, 'transactionId is required'),
});

const QueryBodySchema = z.object({
  query: z.string().trim().min(1, 'Query and walletId are required'),
  walletId: z.string().trim().min(1, 'Query and walletId are required'),
});

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
  router.post(
    '/suggest-label',
    authenticate,
    aiRateLimiter,
    validate(
      { body: SuggestLabelBodySchema },
      { message: 'transactionId is required', code: ErrorCodes.INVALID_INPUT }
    ),
    asyncHandler(async (req, res) => {
      const { transactionId } = req.body;

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
    })
  );

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
  router.post(
    '/query',
    authenticate,
    aiRateLimiter,
    validate(
      { body: QueryBodySchema },
      { message: 'Query and walletId are required', code: ErrorCodes.INVALID_INPUT }
    ),
    asyncHandler(async (req, res) => {
      const { query, walletId } = req.body;

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
    })
  );

  return router;
}
