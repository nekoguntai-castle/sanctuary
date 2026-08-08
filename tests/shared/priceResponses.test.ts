import { describe, expect, it } from 'vitest';

import { AggregatedPriceSchema, PriceSourceSchema } from '../../shared/schemas/priceResponses';

const source = { provider: 'kraken', price: 64887, currency: 'USD' };
const price = {
  price: 64887,
  currency: 'USD',
  median: 64887,
  average: 64890,
  timestamp: '2026-08-08T00:00:00.000Z',
  sources: [source],
};

describe('AggregatedPriceSchema', () => {
  it('accepts a well-formed price, with and without a 24h change', () => {
    expect(AggregatedPriceSchema.parse(price)).toEqual(price);
    expect(AggregatedPriceSchema.parse({ ...price, change24h: -3.21 }).change24h).toBe(-3.21);
  });

  it('rejects the NaN that turns every fiat figure in the app into NaN', () => {
    // `CurrencyContext` guards on `btcPrice === null`, which NaN passes, and
    // `satsToBTC(sats) * NaN` is NaN — silently, everywhere at once.
    expect(AggregatedPriceSchema.safeParse({ ...price, price: Number.NaN }).success).toBe(false);
    expect(AggregatedPriceSchema.safeParse({ ...price, price: null }).success).toBe(false);
    expect(AggregatedPriceSchema.safeParse({ ...price, price: '64887' }).success).toBe(false);
    expect(AggregatedPriceSchema.safeParse({ ...price, price: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it('rejects a non-string timestamp rather than rendering "Invalid Date"', () => {
    expect(AggregatedPriceSchema.safeParse({ ...price, timestamp: null }).success).toBe(false);
    expect(AggregatedPriceSchema.safeParse({ ...price, timestamp: 1754611200000 }).success).toBe(false);
  });

  it('lets the cosmetic 24h badge be absent or null without vetoing the price', () => {
    // The server omits it when no provider reports one, and PriceContext
    // normalises with `?? null`. A percentage badge must not be able to reject
    // the response that carries the price every fiat figure derives from.
    expect(AggregatedPriceSchema.safeParse({ ...price, change24h: undefined }).success).toBe(true);
    expect(AggregatedPriceSchema.safeParse({ ...price, change24h: null }).success).toBe(true);
  });

  it('still rejects a 24h change that is neither a number nor absent', () => {
    // Permissive is not the same as unchecked: if it is something stranger, we
    // do not know what it is.
    expect(AggregatedPriceSchema.safeParse({ ...price, change24h: Number.NaN }).success).toBe(false);
    expect(AggregatedPriceSchema.safeParse({ ...price, change24h: '-3.21' }).success).toBe(false);
  });

  it('accepts an empty source list but not a missing one', () => {
    expect(AggregatedPriceSchema.parse({ ...price, sources: [] }).sources).toEqual([]);
    const { sources: _sources, ...missing } = price;
    expect(AggregatedPriceSchema.safeParse(missing).success).toBe(false);
  });

  it('keeps fields it does not declare', () => {
    const full = { ...price, cached: true, someFutureField: 1 };
    expect(AggregatedPriceSchema.parse(full)).toEqual(full);
  });
});

describe('PriceSourceSchema', () => {
  it('accepts a source and rejects a non-numeric price', () => {
    expect(PriceSourceSchema.parse(source)).toEqual(source);
    expect(PriceSourceSchema.safeParse({ ...source, price: null }).success).toBe(false);
  });
});
