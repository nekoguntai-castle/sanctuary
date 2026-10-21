import { describe, expect, it } from 'vitest';

import { InvalidInputError } from '../../../../src/errors/ApiError';
import {
  HISTORICAL_PRICE_START_MS,
  HistoricalPriceMapUnsupportedError,
  HistoricalPriceUnavailableError,
  assertNonEmptyPriceMap,
  coinGeckoUtcDate,
  isHistoricalPassThroughError,
  normalizeCurrencyCode,
  resolveHistoricalCurrencyPrice,
  resolveSupportedCurrency,
  toHistoricalUtcDay,
  utcDayLabel,
} from '../../../../src/services/price/historicalLookup';

const usdOnly = { supportsCurrency: (code: string) => code === 'USD' };

describe('historicalLookup', () => {
  it('normalises currency codes', () => {
    expect(normalizeCurrencyCode(' eur ')).toBe('EUR');
  });

  describe('resolveSupportedCurrency', () => {
    it('returns the upper-cased code the provider supports', () => {
      expect(resolveSupportedCurrency(' usd', usdOnly)).toBe('USD');
    });

    it('rejects a code the provider does not support', () => {
      expect(() => resolveSupportedCurrency('zzz', usdOnly)).toThrow(InvalidInputError);
      expect(() => resolveSupportedCurrency('zzz', usdOnly)).toThrow('Unsupported currency: ZZZ');
    });

    it('rejects every code when no history-capable provider is registered', () => {
      expect(() => resolveSupportedCurrency('USD', undefined)).toThrow(InvalidInputError);
    });
  });

  describe('toHistoricalUtcDay', () => {
    it('normalises to the UTC day', () => {
      expect(toHistoricalUtcDay(new Date('2026-01-01T18:30:00.000Z')).toISOString()).toBe(
        '2026-01-01T00:00:00.000Z',
      );
    });

    it('accepts the first history day and rejects the day before', () => {
      expect(toHistoricalUtcDay(new Date('2013-04-28T23:59:59.000Z')).getTime()).toBe(
        HISTORICAL_PRICE_START_MS,
      );
      expect(() => toHistoricalUtcDay(new Date('2013-04-27T23:59:59.999Z'))).toThrow(
        'Historical prices are available from 2013-04-28',
      );
    });

    it('rejects an Invalid Date and a non-Date value', () => {
      expect(() => toHistoricalUtcDay(new Date('nope'))).toThrow(InvalidInputError);
      expect(() => toHistoricalUtcDay('2024-01-01' as unknown as Date)).toThrow('Invalid date');
    });
  });

  it('formats UTC day labels', () => {
    const instant = new Date('2026-01-01T18:30:00.000Z');
    expect(utcDayLabel(instant)).toBe('2026-01-01');
    expect(coinGeckoUtcDate(instant)).toBe('01-01-2026');
  });

  describe('assertNonEmptyPriceMap', () => {
    it('returns a non-empty map', () => {
      const map = { usd: 1 };
      expect(assertNonEmptyPriceMap(map, '2024-01-01')).toBe(map);
    });

    it.each([undefined, {}])('reports %j as not available', (map) => {
      expect(() => assertNonEmptyPriceMap(map, '2024-01-01')).toThrow(
        HistoricalPriceUnavailableError,
      );
    });
  });

  describe('resolveHistoricalCurrencyPrice', () => {
    const map = { usd: 70000, eur: 0 } as Record<string, number>;

    it('looks the code up in lower case', () => {
      expect(resolveHistoricalCurrencyPrice(map, 'USD')).toBe(70000);
    });

    it.each(['ZZZ', 'CONSTRUCTOR', 'EUR'])('rejects %s as unsupported', (code) => {
      expect(() => resolveHistoricalCurrencyPrice(map, code)).toThrow(
        `Unsupported currency: ${code}`,
      );
    });
  });

  it('passes only typed lookup errors through', () => {
    expect(isHistoricalPassThroughError(new InvalidInputError('x'))).toBe(true);
    expect(isHistoricalPassThroughError(new HistoricalPriceMapUnsupportedError('p'))).toBe(true);
    expect(isHistoricalPassThroughError(new HistoricalPriceUnavailableError('d'))).toBe(false);
    expect(isHistoricalPassThroughError(new Error('x'))).toBe(false);
  });

  it('names its error classes', () => {
    expect(new HistoricalPriceMapUnsupportedError('coingecko')).toMatchObject({
      name: 'HistoricalPriceMapUnsupportedError',
      message: 'No provider with historical map support (coingecko)',
    });
    expect(new HistoricalPriceUnavailableError('2024-01-01').name).toBe(
      'HistoricalPriceUnavailableError',
    );
  });
});
