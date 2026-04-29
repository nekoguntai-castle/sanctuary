/**
 * Price Provider Types
 *
 * Type definitions for the price provider registry architecture.
 */

import type { IProvider } from "../../providers/types";

/**
 * Price data returned by providers
 */
export interface PriceData {
  provider: string;
  price: number;
  currency: string;
  timestamp: Date;
  change24h?: number;
}

/**
 * Aggregated price from multiple sources
 */
export interface AggregatedPrice {
  price: number;
  currency: string;
  sources: PriceData[];
  median: number;
  average: number;
  timestamp: Date;
  cached: boolean;
  stale?: boolean;
  change24h?: number;
}

/**
 * Metadata for a known price provider.
 */
export interface PriceProviderInfo {
  name: string;
  priority: number;
  supportedCurrencies: string[];
  enabled: boolean;
}

/**
 * Result from a one-off provider connectivity/price test.
 */
export interface PriceProviderTestResult {
  provider: string;
  enabled: boolean;
  ok: boolean;
  currency: string;
  latencyMs: number;
  price?: number;
  timestamp?: Date;
  error?: string;
}

/**
 * Price history data point
 */
export interface PriceHistoryPoint {
  timestamp: Date;
  price: number;
}

/**
 * Price provider interface
 * Extends base IProvider with price-specific methods
 */
export interface IPriceProvider extends IProvider {
  /**
   * Currencies supported by this provider
   */
  readonly supportedCurrencies: string[];

  /**
   * Fetch current Bitcoin price
   */
  getPrice(currency: string): Promise<PriceData>;

  /**
   * Fetch current Bitcoin price for diagnostics without affecting health state.
   */
  testPrice?(currency: string): Promise<PriceData>;

  /**
   * Check if provider supports a specific currency
   */
  supportsCurrency(currency: string): boolean;
}

/**
 * Extended price provider with historical data support
 */
export interface IPriceProviderWithHistory extends IPriceProvider {
  /**
   * Get historical price for a specific date
   */
  getHistoricalPrice(date: Date, currency: string): Promise<PriceData>;

  /**
   * Get price history over a date range
   */
  getPriceHistory(days: number, currency: string): Promise<PriceHistoryPoint[]>;
}

/**
 * Check if provider supports historical data
 */
export function hasHistoricalSupport(
  provider: IPriceProvider,
): provider is IPriceProviderWithHistory {
  return (
    "getHistoricalPrice" in provider &&
    "getPriceHistory" in provider &&
    typeof (provider as IPriceProviderWithHistory).getHistoricalPrice ===
      "function" &&
    typeof (provider as IPriceProviderWithHistory).getPriceHistory ===
      "function"
  );
}
