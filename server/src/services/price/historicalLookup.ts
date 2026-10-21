/**
 * Historical price lookup helpers
 *
 * Pure validation and keying for PriceService.getHistoricalPrice and
 * getPriceHistory: currency normalisation and allowlisting, UTC day keys, the
 * CoinGecko history cutoff, and the typed errors that reach callers unwrapped.
 */

import { InvalidInputError } from "../../errors/ApiError";

/** CoinGecko's first BTC history day, 2013-04-28 (UTC). */
export const HISTORICAL_PRICE_START_MS = Date.UTC(2013, 3, 28);

/** Short negative-cache lifetime for a day the provider has no prices for. */
export const HISTORICAL_UNAVAILABLE_TTL_SEC = 60;

/** The history-capable provider has no per-day price map method. */
export class HistoricalPriceMapUnsupportedError extends Error {
  constructor(providerName: string) {
    super(`No provider with historical map support (${providerName})`);
    this.name = "HistoricalPriceMapUnsupportedError";
  }
}

/** The provider returned no prices for the requested day. */
export class HistoricalPriceUnavailableError extends Error {
  constructor(dayLabel: string) {
    super(`Historical price not available on ${dayLabel}`);
    this.name = "HistoricalPriceUnavailableError";
  }
}

export function normalizeCurrencyCode(currency: string): string {
  return currency.trim().toUpperCase();
}

/**
 * Upper-case a currency and require the history provider's static list to
 * accept it. No health check and no upstream request is made here.
 */
export function resolveSupportedCurrency(
  currency: string,
  provider: { supportsCurrency(code: string): boolean } | undefined,
): string {
  const code = normalizeCurrencyCode(currency);
  if (!provider?.supportsCurrency(code)) {
    throw new InvalidInputError(`Unsupported currency: ${code}`, "currency");
  }
  return code;
}

/** Normalise a date to its UTC day, rejecting invalid and pre-history dates. */
export function toHistoricalUtcDay(date: Date): Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new InvalidInputError("Invalid date", "date");
  }
  const day = new Date(date.getTime());
  day.setUTCHours(0, 0, 0, 0);
  if (day.getTime() < HISTORICAL_PRICE_START_MS) {
    throw new InvalidInputError(
      "Historical prices are available from 2013-04-28",
      "date",
    );
  }
  return day;
}

/** YYYY-MM-DD of a UTC day. */
export function utcDayLabel(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** CoinGecko's DD-MM-YYYY for the UTC day of an instant. */
export function coinGeckoUtcDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getUTCFullYear()}`;
}

/** Require a non-empty upstream price map (an empty one is never cached). */
export function assertNonEmptyPriceMap(
  priceMap: Record<string, number> | undefined,
  dayLabel: string,
): Record<string, number> {
  if (!priceMap || Object.keys(priceMap).length === 0) {
    throw new HistoricalPriceUnavailableError(dayLabel);
  }
  return priceMap;
}

/** Look one caller's currency up in a day's map (keys are lower case). */
export function resolveHistoricalCurrencyPrice(
  priceMap: Record<string, number>,
  currency: string,
): number {
  const key = currency.toLowerCase();
  const price = Object.prototype.hasOwnProperty.call(priceMap, key)
    ? priceMap[key]
    : undefined;
  if (typeof price !== "number" || !(price > 0)) {
    throw new InvalidInputError(`Unsupported currency: ${currency}`, "currency");
  }
  return price;
}

/** Errors the historical catch blocks rethrow unchanged instead of wrapping. */
export function isHistoricalPassThroughError(error: unknown): boolean {
  return (
    error instanceof InvalidInputError ||
    error instanceof HistoricalPriceMapUnsupportedError
  );
}
