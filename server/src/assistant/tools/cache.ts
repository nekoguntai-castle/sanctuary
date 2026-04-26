import { assistantReadRepository } from '../../repositories';

function isStale(createdAt: Date, maxAgeMs: number): boolean {
  return Date.now() - createdAt.getTime() > maxAgeMs;
}

export async function getCachedFeeEstimates() {
  const estimate = await assistantReadRepository.getLatestFeeEstimate();

  if (!estimate) {
    return {
      available: false,
      fastest: null,
      halfHour: null,
      hour: null,
      source: 'database',
      asOf: null,
      stale: true,
    };
  }

  return {
    available: true,
    fastest: estimate.fastest,
    halfHour: estimate.halfHour,
    hour: estimate.hour,
    source: 'database',
    asOf: estimate.createdAt.toISOString(),
    stale: isStale(estimate.createdAt, 10 * 60 * 1000),
  };
}

export async function getCachedBtcPrice(currency = 'USD') {
  const normalizedCurrency = currency.trim().toUpperCase();
  const price = await assistantReadRepository.getLatestPrice(normalizedCurrency);

  if (!price) {
    return {
      available: false,
      currency: normalizedCurrency,
      price: null,
      source: 'database',
      asOf: null,
      stale: true,
    };
  }

  return {
    available: true,
    currency: price.currency,
    price: price.price,
    source: price.source,
    asOf: price.createdAt.toISOString(),
    stale: isStale(price.createdAt, 10 * 60 * 1000),
  };
}
