/**
 * Price Aggregator
 *
 * Pure functions for fetching and aggregating Bitcoin prices
 * from multiple providers. No class state — takes providers as arguments
 * and returns results.
 */

import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { IPriceProvider, PriceData } from './types';

const log = createLogger('PRICE:AGG');

/** Per-provider failures are swallowed so partial results are returned. */
export async function fetchFromProviders(
  providers: IPriceProvider[],
  currency: string
): Promise<PriceData[]> {
  const promises = providers.map(async (provider) => {
    try {
      return await provider.getPrice(currency);
    } catch (error) {
      log.debug(`Failed to fetch from ${provider.name}`, { error: getErrorMessage(error) });
      return null;
    }
  });

  const results = await Promise.all(promises);
  return results.filter((r): r is PriceData => r !== null);
}

/** Returns 0 for an empty array. */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}
