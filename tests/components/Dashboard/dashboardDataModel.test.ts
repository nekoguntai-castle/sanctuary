import { describe, expect, it } from 'vitest';

import { formatFeeRate, neverAnswered } from '../../../src/components/Dashboard/hooks/dashboardDataModel';

describe('formatFeeRate', () => {
  it('formats rates by magnitude', () => {
    // >= 10 rounds to a whole number; below that a decimal is worth showing.
    expect(formatFeeRate(10.6)).toBe('11');
    expect(formatFeeRate(120)).toBe('120');
    expect(formatFeeRate(9)).toBe('9');
    expect(formatFeeRate(9.2)).toBe('9.2');
    expect(formatFeeRate(0)).toBe('0');
  });

  it('renders the placeholder while a rate is absent', () => {
    expect(formatFeeRate(undefined)).toBe('---');
  });

  // `FeeEstimates` declares these fields as `number`, but the response is never
  // validated at runtime — `apiClient.get<FeeEstimates>` is an unchecked
  // assertion. A null therefore reaches this formatter as easily as a number,
  // and `null.toFixed(1)` threw inside render, taking the dashboard down.
  it('renders the placeholder for values that are not usable rates', () => {
    const unusable: unknown[] = [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    for (const value of unusable) {
      expect(formatFeeRate(value as number | undefined)).toBe('---');
    }
  });

  it('does not throw on a non-numeric value', () => {
    expect(() => formatFeeRate('12' as unknown as number)).not.toThrow();
    expect(formatFeeRate('12' as unknown as number)).toBe('---');
  });
});

describe('neverAnswered', () => {
  it('is true only when the query failed and delivered nothing', () => {
    expect(neverAnswered(true, undefined)).toBe(true);
  });

  it('is false while a failed refetch still holds an answer', () => {
    // React Query keeps the last good data through a failed refetch. Treating
    // that as unavailable would blank a card showing perfectly good figures,
    // and would yank a genuinely new user out of the welcome state.
    expect(neverAnswered(true, [])).toBe(false);
    expect(neverAnswered(true, null)).toBe(false);
    expect(neverAnswered(true, { blocks: [] })).toBe(false);
  });

  it('is false whenever the query has not failed', () => {
    expect(neverAnswered(false, undefined)).toBe(false);
    expect(neverAnswered(undefined, undefined)).toBe(false);
    expect(neverAnswered(false, [])).toBe(false);
  });
});
