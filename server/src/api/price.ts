/**
 * Price API Routes
 *
 * API endpoints for Bitcoin price data
 */

import { Router, Request, Response } from "express";
import expressRateLimit from "express-rate-limit";
import { z } from "zod";
import { getPriceService } from "../services/price";
import { normalizeCurrencyCode } from "../services/price/historicalLookup";
import { createLogger } from "../utils/logger";
import {
  authenticate,
  requireAuthenticatedUser,
  requireAdmin,
} from "../middleware/auth";
import { rateLimitByUser } from "../middleware/rateLimit";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../errors/errorHandler";
import { ErrorCodes, InvalidInputError } from "../errors/ApiError";

/** Maximum distinct currencies accepted by GET /price/multiple */
const MAX_MULTIPLE_CURRENCIES = 20;

/** Days parameter: integer between 1 and 365 */
const HistoryDaysSchema = z.coerce.number().int().min(1).max(365);

const ConvertToFiatBodySchema = z.object({
  sats: z.number(),
  currency: z.string().optional().default("USD"),
});

const ConvertToSatsBodySchema = z.object({
  amount: z.number(),
  currency: z.string().optional().default("USD"),
});

const CacheDurationBodySchema = z.object({
  duration: z.number().nonnegative(),
});

const ProviderTestBodySchema = z.object({
  currency: z.string().optional().default("USD"),
});

const ProviderEnablementBodySchema = z.object({
  enabled: z.boolean(),
});

/** A single-valued currency query parameter, trimmed and upper-cased */
function readCurrencyQuery(value: unknown): string {
  if (value === undefined) return "USD";
  if (typeof value !== "string") {
    throw new InvalidInputError("currency must be a single value", "currency");
  }
  return normalizeCurrencyCode(value);
}

const router = Router();
const log = createLogger("PRICE:ROUTE");
const priceService = getPriceService();
const priceAdminCodeqlLimiter = expressRateLimit({
  windowMs: 60_000,
  limit: 1000,
  standardHeaders: false,
  legacyHeaders: false,
});
const priceAdminPolicyLimiter = rateLimitByUser("admin:default");

/**
 * GET /api/v1/price
 * Get current Bitcoin price
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { currency = "USD" } = req.query;

    // useCache is deliberately ignored: this route is public, so reads always
    // go through the cache (with single-flight refresh) and cannot force a
    // provider fan-out.
    const price = await priceService.getPrice(currency as string, true);

    res.json(price);
  }),
);

/**
 * GET /api/v1/price/multiple
 * Get prices for multiple currencies
 */
router.get(
  "/multiple",
  asyncHandler(async (req, res) => {
    const { currencies } = req.query;

    if (typeof currencies !== "string") {
      throw new InvalidInputError(
        "currencies parameter is required (comma-separated)",
      );
    }

    // Case-insensitive dedupe; the response is keyed by the upper-cased code
    const currencyList = [
      ...new Set(
        currencies
          .split(",")
          .map((c) => c.trim().toUpperCase())
          .filter((c) => c.length > 0),
      ),
    ];

    if (currencyList.length === 0) {
      throw new InvalidInputError(
        "currencies parameter is required (comma-separated)",
      );
    }
    if (currencyList.length > MAX_MULTIPLE_CURRENCIES) {
      throw new InvalidInputError(
        `At most ${MAX_MULTIPLE_CURRENCIES} currencies may be requested at once`,
      );
    }

    const supported = new Set(priceService.getSupportedCurrencies());
    const unsupported = currencyList.filter((c) => !supported.has(c));
    if (unsupported.length > 0) {
      throw new InvalidInputError(
        `Unsupported currencies: ${unsupported.join(", ")}`,
      );
    }

    const prices = await priceService.getPrices(currencyList);

    res.json(prices);
  }),
);

/**
 * GET /api/v1/price/from/:provider
 * Get price from specific provider
 */
router.get(
  "/from/:provider",
  asyncHandler(async (req, res) => {
    const { provider } = req.params;
    const { currency = "USD" } = req.query;

    const price = await priceService.getPriceFrom(provider, currency as string);

    res.json(price);
  }),
);

/**
 * POST /api/v1/price/convert/to-fiat
 * Convert satoshis to fiat
 */
router.post(
  "/convert/to-fiat",
  validate(
    { body: ConvertToFiatBodySchema },
    { message: "sats must be a number", code: ErrorCodes.INVALID_INPUT },
  ),
  asyncHandler(async (req, res) => {
    const { sats, currency = "USD" } = req.body;

    const fiatAmount = await priceService.convertToFiat(sats, currency);

    res.json({
      sats,
      fiatAmount,
      currency,
    });
  }),
);

/**
 * POST /api/v1/price/convert/to-sats
 * Convert fiat to satoshis
 */
router.post(
  "/convert/to-sats",
  validate(
    { body: ConvertToSatsBodySchema },
    { message: "amount must be a number", code: ErrorCodes.INVALID_INPUT },
  ),
  asyncHandler(async (req, res) => {
    const { amount, currency = "USD" } = req.body;

    const sats = await priceService.convertToSats(amount, currency);

    res.json({
      amount,
      currency,
      sats,
    });
  }),
);

/**
 * GET /api/v1/price/currencies
 * Get list of supported currencies
 */
router.get("/currencies", (_req: Request, res: Response) => {
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
router.get("/providers", (_req: Request, res: Response) => {
  const providers = priceService.getProviders();
  res.json({
    providers,
    count: providers.length,
  });
});

/**
 * GET /api/v1/price/providers/status
 * Get known provider metadata and current enablement
 */
router.get(
  "/providers/status",
  priceAdminCodeqlLimiter,
  authenticate,
  priceAdminPolicyLimiter,
  requireAdmin,
  (_req: Request, res: Response) => {
    const providers = priceService.getProviderDiagnostics();
    res.json({
      providers,
      count: providers.length,
    });
  },
);

/**
 * PATCH /api/v1/price/providers/:provider
 * Enable or disable a known price provider
 */
router.patch(
  "/providers/:provider",
  priceAdminCodeqlLimiter,
  authenticate,
  priceAdminPolicyLimiter,
  requireAdmin,
  validate(
    { body: ProviderEnablementBodySchema },
    { message: "enabled must be a boolean", code: ErrorCodes.INVALID_INPUT },
  ),
  asyncHandler(async (req, res) => {
    const { provider } = req.params;
    const { enabled } = req.body;
    const providers = await priceService.setProviderEnabled(
      provider,
      enabled,
      requireAuthenticatedUser(req).userId,
    );

    res.json({
      provider: provider.trim().toLowerCase(),
      enabled,
      providers,
      count: providers.length,
    });
  }),
);

/**
 * POST /api/v1/price/providers/test
 * Test all known price providers
 */
router.post(
  "/providers/test",
  priceAdminCodeqlLimiter,
  authenticate,
  priceAdminPolicyLimiter,
  requireAdmin,
  validate(
    { body: ProviderTestBodySchema },
    { message: "currency must be a string", code: ErrorCodes.INVALID_INPUT },
  ),
  asyncHandler(async (req, res) => {
    const { currency = "USD" } = req.body;
    const providers = await priceService.testAllProviders(currency);
    res.json({
      currency: currency.toUpperCase(),
      providers,
    });
  }),
);

/**
 * POST /api/v1/price/providers/:provider/test
 * Test a single known price provider
 */
router.post(
  "/providers/:provider/test",
  priceAdminCodeqlLimiter,
  authenticate,
  priceAdminPolicyLimiter,
  requireAdmin,
  validate(
    { body: ProviderTestBodySchema },
    { message: "currency must be a string", code: ErrorCodes.INVALID_INPUT },
  ),
  asyncHandler(async (req, res) => {
    const { provider } = req.params;
    const { currency = "USD" } = req.body;

    const result = await priceService.testProvider(provider, currency);
    res.json(result);
  }),
);

/**
 * GET /api/v1/price/health
 * Health check for price providers
 */
router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const health = await priceService.healthCheck();
    res.json(health);
  }),
);

/**
 * GET /api/v1/price/cache/stats
 * Get cache statistics (admin only)
 */
router.get(
  "/cache/stats",
  priceAdminCodeqlLimiter,
  authenticate,
  priceAdminPolicyLimiter,
  requireAdmin,
  (_req: Request, res: Response) => {
    const stats = priceService.getCacheStats();
    res.json(stats);
  },
);

/**
 * POST /api/v1/price/cache/clear
 * Clear price cache (admin only)
 */
router.post(
  "/cache/clear",
  priceAdminCodeqlLimiter,
  authenticate,
  priceAdminPolicyLimiter,
  requireAdmin,
  asyncHandler(async (req, res) => {
    log.info("Cache cleared by admin", {
      userId: requireAuthenticatedUser(req).userId,
    });
    await priceService.clearCache();
    res.json({
      message: "Cache cleared successfully",
    });
  }),
);

/**
 * POST /api/v1/price/cache/duration
 * Set cache duration (admin only)
 */
router.post(
  "/cache/duration",
  priceAdminCodeqlLimiter,
  authenticate,
  priceAdminPolicyLimiter,
  requireAdmin,
  validate(
    { body: CacheDurationBodySchema },
    {
      message: "duration must be a positive number (milliseconds)",
      code: ErrorCodes.INVALID_INPUT,
    },
  ),
  (req: Request, res: Response) => {
    const { duration } = req.body;

    log.info("Cache duration updated by admin", {
      userId: requireAuthenticatedUser(req).userId,
      duration,
    });
    priceService.setCacheDuration(duration);

    res.json({
      message: "Cache duration updated",
      duration,
    });
  },
);

/**
 * GET /api/v1/price/historical
 * Get historical Bitcoin price for a specific date
 */
router.get(
  "/historical",
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    const currency = readCurrencyQuery(req.query.currency);

    if (!date) {
      throw new InvalidInputError(
        "date parameter is required (YYYY-MM-DD or ISO format)",
      );
    }

    // Parse date
    const parsedDate = new Date(date as string);

    if (isNaN(parsedDate.getTime())) {
      throw new InvalidInputError(
        "Invalid date format. Use YYYY-MM-DD or ISO format",
      );
    }

    // Check if date is in the future
    if (parsedDate > new Date()) {
      throw new InvalidInputError("Date cannot be in the future");
    }

    const price = await priceService.getHistoricalPrice(currency, parsedDate);

    res.json({
      date: parsedDate.toISOString(),
      currency,
      price,
      provider: "coingecko",
    });
  }),
);

/**
 * GET /api/v1/price/history
 * Get price history over a date range
 */
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const { days = "30" } = req.query;
    const currency = readCurrencyQuery(req.query.currency);

    const daysResult = HistoryDaysSchema.safeParse(days);
    if (!daysResult.success) {
      throw new InvalidInputError("days must be a number between 1 and 365");
    }

    const history = await priceService.getPriceHistory(
      currency,
      daysResult.data,
    );

    res.json({
      currency,
      days: daysResult.data,
      dataPoints: history.length,
      history: history.map(({ timestamp, price }) => ({
        timestamp: timestamp.toISOString(),
        price,
      })),
      provider: "coingecko",
    });
  }),
);

export default router;
