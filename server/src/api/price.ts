/**
 * Price API Routes
 *
 * API endpoints for Bitcoin price data
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getPriceService } from '../services/price';
import { createLogger } from '../utils/logger';
import { authenticate, requireAuthenticatedUser, requireAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../errors/errorHandler';
import { ErrorCodes, InvalidInputError } from '../errors/ApiError';

/** Days parameter: integer between 1 and 365 */
const HistoryDaysSchema = z.coerce.number().int().min(1).max(365);

const ConvertToFiatBodySchema = z.object({
  sats: z.number(),
  currency: z.string().optional().default('USD'),
});

const ConvertToSatsBodySchema = z.object({
  amount: z.number(),
  currency: z.string().optional().default('USD'),
});

const CacheDurationBodySchema = z.object({
  duration: z.number().nonnegative(),
});

const router = Router();
const log = createLogger('PRICE:ROUTE');
const priceService = getPriceService();

/**
 * GET /api/v1/price
 * Get current Bitcoin price
 */
router.get('/', asyncHandler(async (req, res) => {
  const { currency = 'USD', useCache = 'true' } = req.query;

  const price = await priceService.getPrice(
    currency as string,
    useCache === 'true'
  );

  res.json(price);
}));

/**
 * GET /api/v1/price/multiple
 * Get prices for multiple currencies
 */
router.get('/multiple', asyncHandler(async (req, res) => {
  const { currencies } = req.query;

  if (!currencies) {
    throw new InvalidInputError('currencies parameter is required (comma-separated)');
  }

  const currencyList = (currencies as string).split(',').map((c) => c.trim());
  const prices = await priceService.getPrices(currencyList);

  res.json(prices);
}));

/**
 * GET /api/v1/price/from/:provider
 * Get price from specific provider
 */
router.get('/from/:provider', asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const { currency = 'USD' } = req.query;

  const price = await priceService.getPriceFrom(provider, currency as string);

  res.json(price);
}));

/**
 * POST /api/v1/price/convert/to-fiat
 * Convert satoshis to fiat
 */
router.post('/convert/to-fiat', validate(
  { body: ConvertToFiatBodySchema },
  { message: 'sats must be a number', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { sats, currency = 'USD' } = req.body;

  const fiatAmount = await priceService.convertToFiat(sats, currency);

  res.json({
    sats,
    fiatAmount,
    currency,
  });
}));

/**
 * POST /api/v1/price/convert/to-sats
 * Convert fiat to satoshis
 */
router.post('/convert/to-sats', validate(
  { body: ConvertToSatsBodySchema },
  { message: 'amount must be a number', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { amount, currency = 'USD' } = req.body;

  const sats = await priceService.convertToSats(amount, currency);

  res.json({
    amount,
    currency,
    sats,
  });
}));

/**
 * GET /api/v1/price/currencies
 * Get list of supported currencies
 */
router.get('/currencies', (_req: Request, res: Response) => {
  const currencies = priceService.getSupportedCurrencies();
  res.json({
    currencies,
    count: currencies.length,
  });
});

/**
 * GET /api/v1/price/providers
 * Get list of available price providers
 */
router.get('/providers', (_req: Request, res: Response) => {
  const providers = priceService.getProviders();
  res.json({
    providers,
    count: providers.length,
  });
});

/**
 * GET /api/v1/price/health
 * Health check for price providers
 */
router.get('/health', asyncHandler(async (_req, res) => {
  const health = await priceService.healthCheck();
  res.json(health);
}));

/**
 * GET /api/v1/price/cache/stats
 * Get cache statistics (admin only)
 */
router.get('/cache/stats', authenticate, requireAdmin, (_req: Request, res: Response) => {
  const stats = priceService.getCacheStats();
  res.json(stats);
});

/**
 * POST /api/v1/price/cache/clear
 * Clear price cache (admin only)
 */
router.post('/cache/clear', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  log.info('Cache cleared by admin', { userId: requireAuthenticatedUser(req).userId });
  await priceService.clearCache();
  res.json({
    message: 'Cache cleared successfully',
  });
}));

/**
 * POST /api/v1/price/cache/duration
 * Set cache duration (admin only)
 */
router.post('/cache/duration', authenticate, requireAdmin, validate(
  { body: CacheDurationBodySchema },
  { message: 'duration must be a positive number (milliseconds)', code: ErrorCodes.INVALID_INPUT }
), (req: Request, res: Response) => {
  const { duration } = req.body;

  log.info('Cache duration updated by admin', { userId: requireAuthenticatedUser(req).userId, duration });
  priceService.setCacheDuration(duration);

  res.json({
    message: 'Cache duration updated',
    duration,
  });
});

/**
 * GET /api/v1/price/historical
 * Get historical Bitcoin price for a specific date
 */
router.get('/historical', asyncHandler(async (req, res) => {
  const { date, currency = 'USD' } = req.query;

  if (!date) {
    throw new InvalidInputError('date parameter is required (YYYY-MM-DD or ISO format)');
  }

  // Parse date
  const parsedDate = new Date(date as string);

  if (isNaN(parsedDate.getTime())) {
    throw new InvalidInputError('Invalid date format. Use YYYY-MM-DD or ISO format');
  }

  // Check if date is in the future
  if (parsedDate > new Date()) {
    throw new InvalidInputError('Date cannot be in the future');
  }

  const price = await priceService.getHistoricalPrice(currency as string, parsedDate);

  res.json({
    date: parsedDate.toISOString(),
    currency: currency,
    price,
    provider: 'coingecko',
  });
}));

/**
 * GET /api/v1/price/history
 * Get price history over a date range
 */
router.get('/history', asyncHandler(async (req, res) => {
  const { days = '30', currency = 'USD' } = req.query;

  const daysResult = HistoryDaysSchema.safeParse(days);
  if (!daysResult.success) {
    throw new InvalidInputError('days must be a number between 1 and 365');
  }

  const history = await priceService.getPriceHistory(currency as string, daysResult.data);

  res.json({
    currency,
    days: daysResult.data,
    dataPoints: history.length,
    history: history.map(({ timestamp, price }) => ({
      timestamp: timestamp.toISOString(),
      price,
    })),
    provider: 'coingecko',
  });
}));

export default router;
