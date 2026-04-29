/**
 * Price API
 *
 * API calls for Bitcoin price data
 */

import apiClient from "./client";

export interface PriceSource {
  provider: string;
  price: number;
  currency: string;
  timestamp: string;
  change24h?: number;
}

export interface AggregatedPrice {
  price: number;
  currency: string;
  sources: PriceSource[];
  median: number;
  average: number;
  timestamp: string;
  cached: boolean;
  change24h?: number;
}

export interface ConvertToFiatRequest {
  sats: number;
  currency?: string;
}

export interface ConvertToFiatResponse {
  sats: number;
  fiatAmount: number;
  currency: string;
}

export interface ConvertToSatsRequest {
  amount: number;
  currency?: string;
}

export interface ConvertToSatsResponse {
  amount: number;
  currency: string;
  sats: number;
}

export interface ProviderHealth {
  healthy: boolean;
  providers: Record<string, boolean>;
}

export interface PriceProviderInfo {
  name: string;
  priority: number;
  supportedCurrencies: string[];
  enabled: boolean;
}

export interface PriceProviderTestResult {
  provider: string;
  enabled: boolean;
  ok: boolean;
  currency: string;
  latencyMs: number;
  price?: number;
  timestamp?: string;
  error?: string;
}

export interface CacheStats {
  size: number;
  entries: string[];
}

/**
 * Get current Bitcoin price
 */
export async function getPrice(
  currency: string = "USD",
  useCache: boolean = true,
): Promise<AggregatedPrice> {
  return apiClient.get<AggregatedPrice>("/price", {
    currency,
    useCache: String(useCache),
  });
}

/**
 * Get prices for multiple currencies
 */
export async function getMultiplePrices(
  currencies: string[],
): Promise<Record<string, AggregatedPrice>> {
  return apiClient.get<Record<string, AggregatedPrice>>("/price/multiple", {
    currencies: currencies.join(","),
  });
}

/**
 * Get price from a specific provider
 */
export async function getPriceFromProvider(
  provider: string,
  currency: string = "USD",
): Promise<PriceSource> {
  return apiClient.get<PriceSource>(`/price/from/${provider}`, { currency });
}

/**
 * Convert satoshis to fiat
 */
export async function convertToFiat(
  data: ConvertToFiatRequest,
): Promise<ConvertToFiatResponse> {
  return apiClient.post<ConvertToFiatResponse>("/price/convert/to-fiat", data);
}

/**
 * Convert fiat to satoshis
 */
export async function convertToSats(
  data: ConvertToSatsRequest,
): Promise<ConvertToSatsResponse> {
  return apiClient.post<ConvertToSatsResponse>("/price/convert/to-sats", data);
}

/**
 * Get list of supported currencies
 */
export async function getSupportedCurrencies(): Promise<{
  currencies: string[];
  count: number;
}> {
  return apiClient.get<{ currencies: string[]; count: number }>(
    "/price/currencies",
  );
}

/**
 * Get list of available providers
 */
export async function getProviders(): Promise<{
  providers: string[];
  count: number;
}> {
  return apiClient.get<{ providers: string[]; count: number }>(
    "/price/providers",
  );
}

/**
 * Get known providers with current enablement.
 */
export async function getProviderDiagnostics(): Promise<{
  providers: PriceProviderInfo[];
  count: number;
}> {
  return apiClient.get<{ providers: PriceProviderInfo[]; count: number }>(
    "/price/providers/status",
  );
}

/**
 * Test a single price provider from the running deployment.
 */
export async function testPriceProvider(
  provider: string,
  currency: string = "USD",
): Promise<PriceProviderTestResult> {
  return apiClient.post<PriceProviderTestResult>(
    `/price/providers/${provider}/test`,
    { currency },
  );
}

/**
 * Test all known price providers from the running deployment.
 */
export async function testAllPriceProviders(
  currency: string = "USD",
): Promise<{ currency: string; providers: PriceProviderTestResult[] }> {
  return apiClient.post<{
    currency: string;
    providers: PriceProviderTestResult[];
  }>("/price/providers/test", {
    currency,
  });
}

/**
 * Check provider health
 */
export async function checkProviderHealth(): Promise<ProviderHealth> {
  return apiClient.get<ProviderHealth>("/price/health");
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<CacheStats> {
  return apiClient.get<CacheStats>("/price/cache/stats");
}

/**
 * Clear price cache
 */
export async function clearCache(): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>("/price/cache/clear");
}

/**
 * Set cache duration
 */
export async function setCacheDuration(
  duration: number,
): Promise<{ message: string; duration: number }> {
  return apiClient.post<{ message: string; duration: number }>(
    "/price/cache/duration",
    { duration },
  );
}
