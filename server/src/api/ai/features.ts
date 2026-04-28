/**
 * AI Feature Routes
 *
 * POST /ai/suggest-label - Get label suggestion for a transaction
 * POST /ai/query - Execute a natural language query
 */

import { Router } from 'express';
import expressRateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, extractAccessToken } from '../../middleware/auth';
import { rateLimitByUser } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes } from '../../errors/ApiError';
import config from '../../config';
import { aiService } from '../../services/aiService';

const SuggestLabelBodySchema = z.object({
  transactionId: z.string().trim().min(1, 'transactionId is required'),
});

const QueryBodySchema = z.object({
  query: z.string().trim().min(1, 'Query and walletId are required'),
  walletId: z.string().trim().min(1, 'Query and walletId are required'),
});

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

function authTokenForProxy(req: Parameters<typeof extractAccessToken>[0]): string {
  return extractAccessToken(req) ?? '';
}

export function createFeaturesRouter(): Router {
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
    aiAuthLimiter,
    authenticate,
    rateLimitByUser('ai:analyze'),
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

      const suggestion = await aiService.suggestTransactionLabel(
        transactionId,
        authTokenForProxy(req)
      );

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
    aiAuthLimiter,
    authenticate,
    rateLimitByUser('ai:analyze'),
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

      const result = await aiService.executeNaturalQuery(
        query,
        walletId,
        authTokenForProxy(req)
      );

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
