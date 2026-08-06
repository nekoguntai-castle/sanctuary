import { describe, expect, it } from 'vitest';
import {
  buildBalanceAxis,
  buildTickFormatter,
} from '../../../src/components/Dashboard/PriceChart/balanceAxisModel';
import type { PriceChartPoint } from '../../../src/components/Dashboard/PriceChart/types';

const points = (...sats: number[]): PriceChartPoint[] =>
  sats.map((value, index) => ({ name: `p${index}`, sats: value }));

const labelsFor = (axis: ReturnType<typeof buildBalanceAxis>, unit: 'sats' | 'btc') =>
  axis.ticks.map(buildTickFormatter(axis, unit));

describe('buildBalanceAxis', () => {
  it('fits the domain to the data rather than to zero', () => {
    // The reported defect: a large balance moving a little. Against recharts'
    // default [0, 'auto'] this draws as a flat line; the whole point of the
    // fitted domain is that the low bound sits near the data, not at 0.
    const axis = buildBalanceAxis(points(1_240_380_000, 1_240_810_000), 1_240_380_000);

    expect(axis.domain[0]).toBeGreaterThan(1_200_000_000);
    expect(axis.domain[0]).toBeLessThan(1_240_380_000);
    expect(axis.domain[1]).toBeGreaterThan(1_240_810_000);
  });

  it('leaves headroom on both sides so the line does not touch the edges', () => {
    const axis = buildBalanceAxis(points(1000, 2000), 1000);

    expect(axis.domain[0]).toBeLessThan(1000);
    expect(axis.domain[1]).toBeGreaterThan(2000);
  });

  it('centres a perfectly flat series in a band instead of collapsing the domain', () => {
    const axis = buildBalanceAxis(points(500_000_000, 500_000_000), 500_000_000);

    const [low, high] = axis.domain;
    expect(high).toBeGreaterThan(low);
    const midpoint = (low + high) / 2;
    expect(Math.abs(midpoint - 500_000_000)).toBeLessThan(axis.spanSats / 4);
  });

  it('floors the domain at zero for a non-negative series', () => {
    const axis = buildBalanceAxis(points(10, 100_000), 10);

    expect(axis.domain[0]).toBe(0);
  });

  it('does not invert the domain for a negative series', () => {
    // The zero floor must not apply here: clamping the low bound above the data
    // inverts the domain, recharts repairs it silently, and the supplied ticks
    // then fall outside the rendered range and are filtered away.
    const axis = buildBalanceAxis(points(-5000, -5000), -5000);

    expect(axis.domain[0]).toBeLessThan(axis.domain[1]);
    expect(axis.domain[0]).toBeLessThanOrEqual(-5000);
    expect(axis.spanSats).toBeGreaterThan(0);
  });

  it('keeps the opening balance inside the domain so the reference line renders', () => {
    const axis = buildBalanceAxis(points(900, 1000), 100_000);

    expect(axis.domain[0]).toBeLessThanOrEqual(100_000);
    expect(axis.domain[1]).toBeGreaterThanOrEqual(100_000);
  });

  it('ignores non-finite readings rather than producing a NaN domain', () => {
    const axis = buildBalanceAxis(
      [
        { name: 'a', sats: Number.NaN },
        { name: 'b', sats: 1000 },
        { name: 'c', sats: Number.POSITIVE_INFINITY },
        { name: 'd', sats: 2000 },
      ],
      1000
    );

    expect(Number.isFinite(axis.domain[0])).toBe(true);
    expect(Number.isFinite(axis.domain[1])).toBe(true);
    expect(axis.domain[1]).toBeLessThan(10_000);
  });

  it('ignores a non-finite opening balance', () => {
    const axis = buildBalanceAxis(points(1000, 2000), Number.NaN);

    expect(Number.isFinite(axis.domain[0])).toBe(true);
    expect(Number.isFinite(axis.domain[1])).toBe(true);
  });

  it('survives an empty series with a renderable domain and a full tick set', () => {
    const axis = buildBalanceAxis([], Number.NaN);

    expect(axis.domain[1]).toBeGreaterThan(axis.domain[0]);
    expect(axis.ticks).toHaveLength(3);
    expect(axis.ticks.every((tick) => Number.isFinite(tick))).toBe(true);
  });

  it('never collapses two ticks onto the same value', () => {
    // Rounded integer ticks on a tiny span used to yield [0, 1, 1]; recharts
    // drops the collided one on minTickGap and the axis silently loses a tick.
    // A zero balance is the ordinary first-paint state, not an edge case.
    for (const axis of [
      buildBalanceAxis(points(0, 0), 0),
      buildBalanceAxis([], 0),
      buildBalanceAxis(points(1, 1), 1),
      buildBalanceAxis(points(0, 1), 0),
    ]) {
      expect(new Set(axis.ticks).size).toBe(axis.ticks.length);
      expect(axis.ticks[0]).toBeLessThan(axis.ticks[1]);
      expect(axis.ticks[1]).toBeLessThan(axis.ticks[2]);
    }
  });

  it('returns three ascending integer ticks spanning the domain', () => {
    const axis = buildBalanceAxis(points(1_000_000, 2_000_000), 1_000_000);

    expect(axis.ticks).toHaveLength(3);
    expect(axis.ticks[0]).toBe(axis.domain[0]);
    expect(axis.ticks[2]).toBe(axis.domain[1]);
    expect(axis.ticks.every(Number.isInteger)).toBe(true);
  });

  it('reports span and step consistent with the domain', () => {
    const axis = buildBalanceAxis(points(4000, 9000), 4000);

    expect(axis.spanSats).toBe(axis.domain[1] - axis.domain[0]);
    expect(axis.stepSats).toBe(axis.spanSats / 2);
    expect(axis.stepSats).toBeGreaterThan(0);
  });
});

describe('buildTickFormatter', () => {
  it('keeps sats ticks distinguishable on a tight span', () => {
    // Regression: precision used to be fixed at 0-or-1 decimal of the
    // abbreviated unit, so a 12 BTC balance moving 36,000 sats printed
    // "1200.0M" three times — the very defect the labelled axis exists to
    // prevent, on the DEFAULT unit.
    const axis = buildBalanceAxis(points(1_200_000_000, 1_200_036_000), 1_200_000_000);

    expect(new Set(labelsFor(axis, 'sats')).size).toBe(3);
  });

  it('keeps sats ticks distinguishable for a flat balance at every scale', () => {
    for (const balance of [10_000, 50_000, 5_000_000, 10_000_000, 100_000_000]) {
      const axis = buildBalanceAxis(points(balance, balance), balance);

      expect(new Set(labelsFor(axis, 'sats')).size, `flat balance ${balance}`).toBe(3);
    }
  });

  it('keeps BTC ticks distinguishable on a tight span', () => {
    const axis = buildBalanceAxis(points(1_240_380_000, 1_240_440_000), 1_240_380_000);

    expect(new Set(labelsFor(axis, 'btc')).size).toBe(3);
  });

  it('applies one suffix across the whole axis rather than per value', () => {
    // A per-value threshold produced mixed columns like ["9995k","10.0M"].
    const axis = buildBalanceAxis(points(9_995_000, 10_005_000), 9_995_000);
    const labels = labelsFor(axis, 'sats');

    const suffixes = new Set(labels.map((label) => label.replace(/[\d.,-]/g, '')));
    expect(suffixes.size).toBe(1);
  });

  it('does not print eight decimals when the BTC span is wide', () => {
    const axis = buildBalanceAxis(points(100_000_000, 500_000_000), 100_000_000);

    expect(labelsFor(axis, 'btc')[0]).toMatch(/^\d+\.\d{2}$/);
  });

  it('abbreviates large sats figures instead of printing every digit', () => {
    const axis = buildBalanceAxis(points(120_000_000, 200_000_000), 120_000_000);

    for (const label of labelsFor(axis, 'sats')) {
      expect(label).toMatch(/M$/);
      expect(label.length).toBeLessThanOrEqual(10);
    }
  });

  it('prints small sats figures exactly, with no suffix or decimals', () => {
    const axis = buildBalanceAxis(points(800, 900), 800);

    for (const label of labelsFor(axis, 'sats')) {
      expect(label).toMatch(/^\d+$/);
    }
  });

  it('keeps every label short enough for the axis gutter', () => {
    // The axis reserves a fixed width; a formatter that can emit an
    // arbitrarily long string would overflow into the plot.
    for (const [low, high] of [
      [0, 0],
      [1, 2],
      [800, 900],
      [1_200_000_000, 1_200_036_000],
      [90_000_000_000, 90_000_000_100],
    ]) {
      const axis = buildBalanceAxis(points(low, high), low);

      for (const unit of ['sats', 'btc'] as const) {
        for (const label of labelsFor(axis, unit)) {
          expect(label.length, `${unit} ${low}-${high}: ${label}`).toBeLessThanOrEqual(11);
        }
      }
    }
  });
});
