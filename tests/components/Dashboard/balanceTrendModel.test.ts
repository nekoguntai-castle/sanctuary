import { describe, expect, it } from 'vitest';
import {
  buildBalanceTrend,
  formatBalanceTrend,
} from '../../../src/components/Dashboard/PriceChart/balanceTrendModel';
import type { PriceChartPoint } from '../../../src/components/Dashboard/PriceChart/types';

const points = (...sats: number[]): PriceChartPoint[] =>
  sats.map((value, index) => ({ name: `p${index}`, sats: value }));

describe('buildBalanceTrend', () => {
  it('reports growth between the first and last reading', () => {
    const trend = buildBalanceTrend(points(1_000_000, 1_050_000, 1_125_000), '1W');

    expect(trend.direction).toBe('gain');
    expect(trend.openingSats).toBe(1_000_000);
    expect(trend.closingSats).toBe(1_125_000);
    expect(trend.deltaSats).toBe(125_000);
    expect(trend.percentChange).toBeCloseTo(12.5);
    expect(trend.timeframeLabel).toBe('the past week');
  });

  it('reports a decline with a negative delta', () => {
    const trend = buildBalanceTrend(points(200_000, 150_000), '1M');

    expect(trend.direction).toBe('loss');
    expect(trend.deltaSats).toBe(-50_000);
    expect(trend.percentChange).toBeCloseTo(-25);
    expect(trend.timeframeLabel).toBe('the past month');
  });

  it('reports flat when the balance ends where it started', () => {
    // Deliberately not flat in the middle: only the endpoints define the change.
    const trend = buildBalanceTrend(points(500_000, 900_000, 500_000), '1D');

    expect(trend.direction).toBe('flat');
    expect(trend.deltaSats).toBe(0);
    expect(trend.timeframeLabel).toBe('the past day');
  });

  it('treats an empty history as flat rather than guessing', () => {
    const trend = buildBalanceTrend([], '1Y');

    expect(trend.direction).toBe('flat');
    expect(trend.openingSats).toBe(0);
    expect(trend.closingSats).toBe(0);
    expect(trend.deltaSats).toBe(0);
    expect(trend.percentChange).toBeNull();
    expect(trend.timeframeLabel).toBe('the past year');
  });

  it('treats a single reading as a position, not a movement', () => {
    const trend = buildBalanceTrend(points(750_000), 'ALL');

    expect(trend.direction).toBe('flat');
    expect(trend.openingSats).toBe(750_000);
    expect(trend.closingSats).toBe(750_000);
    expect(trend.deltaSats).toBe(0);
    expect(trend.timeframeLabel).toBe('all time');
  });

  it('never divides by a zero opening balance', () => {
    const trend = buildBalanceTrend(points(0, 100_000), '1W');

    expect(trend.direction).toBe('gain');
    expect(trend.deltaSats).toBe(100_000);
    // Not Infinity, and not NaN: a first deposit has no percentage basis.
    expect(trend.percentChange).toBeNull();
  });

  it('ignores readings that are not finite numbers', () => {
    const trend = buildBalanceTrend(
      [
        { name: 'a', sats: Number.NaN },
        { name: 'b', sats: 100_000 },
        { name: 'c', sats: 140_000 },
      ],
      '1W'
    );

    expect(trend.openingSats).toBe(100_000);
    expect(trend.deltaSats).toBe(40_000);
  });

  it('falls back to flat when no reading is usable', () => {
    const trend = buildBalanceTrend([{ name: 'a', sats: Number.NaN }], '1W');

    expect(trend.direction).toBe('flat');
    expect(trend.openingSats).toBe(0);
  });
});

describe('formatBalanceTrend', () => {
  it('writes the sign out rather than relying on colour', () => {
    const gain = formatBalanceTrend(buildBalanceTrend(points(1_000_000, 1_125_000), '1W'));
    expect(gain).toBe('+125,000 sats (+12.5%) over the past week');

    const loss = formatBalanceTrend(buildBalanceTrend(points(200_000, 150_000), '1M'));
    expect(loss).toBe('-50,000 sats (-25.0%) over the past month');
  });

  it('omits the percentage when there is no basis for one', () => {
    const trend = buildBalanceTrend(points(0, 100_000), '1D');

    expect(formatBalanceTrend(trend)).toBe('+100,000 sats over the past day');
  });

  it('states flat plainly', () => {
    expect(formatBalanceTrend(buildBalanceTrend(points(5, 5), 'ALL'))).toBe(
      'No change over all time'
    );
  });
});
