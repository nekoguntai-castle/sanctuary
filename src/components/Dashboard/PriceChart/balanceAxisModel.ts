import { satsToBTC } from '@sanctuary/shared/utils/bitcoin';
import type { BitcoinUnit } from '../../../contexts/CurrencyPreferencesContext';
import type { PriceChartPoint } from './types';

export interface BalanceAxis {
  /** `[low, high]` in sats, ready for recharts' `YAxis domain`. Always ascending. */
  domain: [number, number];
  /** Explicit tick values in sats, strictly ascending. */
  ticks: number[];
  /** `high - low`. Always > 0. */
  spanSats: number;
  /** Gap between adjacent ticks. Always > 0. Drives label precision. */
  stepSats: number;
}

/** Fraction of the data range left as breathing room above and below the line. */
const HEADROOM = 0.15;

/**
 * Half-width of the band drawn around a perfectly flat series, as a fraction of
 * the balance. Small enough that a flat line reads as flat rather than as noise
 * blown up to fill the plot.
 */
const FLAT_BAND = 0.0005;

/** Number of labelled ticks. Low, middle, high. */
const TICK_COUNT = 3;

/**
 * Smallest span that still yields distinct integer ticks.
 *
 * Sats are integers and ticks are rounded, so a span below this collapses two
 * ticks onto the same value — recharts then drops one on `minTickGap` and the
 * axis silently changes shape.
 */
const MIN_SPAN = 2 * (TICK_COUNT - 1);

/**
 * Fits the Y axis to the data instead of to zero.
 *
 * recharts defaults a numeric Y axis to `[0, 'auto']`. For a balance of 12 BTC
 * that moves 0.03% across the period, that draws the whole series as a flat
 * line pinned to the top of a 0-to-12 scale — the reported defect. Fitting the
 * domain to the data is what makes the movement visible at all.
 *
 * A non-zero baseline can mislead, so this is only half the fix: the axis
 * renders labelled ticks (see `buildTickFormatter`) and the chart draws a
 * reference line at the period's opening balance, so the reader can see both
 * where the scale starts and what the movement is measured against.
 *
 * `openingSats` is folded into the domain because the reference line is drawn
 * at that value — a domain that excluded it would clip the line out of view.
 */
export function buildBalanceAxis(
  points: readonly PriceChartPoint[],
  openingSats: number
): BalanceAxis {
  const values = points
    .map((point) => point?.sats)
    .filter((sats): sats is number => Number.isFinite(sats));

  if (Number.isFinite(openingSats)) {
    values.push(openingSats);
  }

  // No usable reading at all. Any domain is arbitrary; pick one that renders
  // without dividing by zero rather than handing recharts a NaN.
  const min = values.length === 0 ? 0 : Math.min(...values);
  const max = values.length === 0 ? 0 : Math.max(...values);
  const range = max - min;

  // A flat series has no range to take headroom from. Centre it in a narrow
  // band so the line sits mid-plot; without this it would pin to an edge, or
  // to a zero-height domain that recharts cannot scale.
  const padding =
    range === 0 ? Math.max(Math.abs(max) * FLAT_BAND, MIN_SPAN) : range * HEADROOM;

  // Floor at zero only when the data itself is non-negative. Clamping a
  // genuinely negative series would invert the domain — recharts repairs
  // that silently, after which the supplied ticks fall outside the rendered
  // range and get filtered away.
  const rawLow = Math.floor(min - padding);
  const low = min >= 0 ? Math.max(0, rawLow) : rawLow;
  const high = Math.max(Math.ceil(max + padding), low + MIN_SPAN);

  const spanSats = high - low;
  const stepSats = spanSats / (TICK_COUNT - 1);
  const ticks = Array.from({ length: TICK_COUNT }, (_, index) =>
    Math.round(low + stepSats * index)
  );

  return { domain: [low, high], ticks, spanSats, stepSats };
}

/**
 * Characters a tick label may occupy, suffix included. The axis reserves a
 * fixed gutter; anything longer overflows into the plot.
 */
const MAX_LABEL_CHARS = 10;

/** Digits left of the decimal point, which the label must always show. */
function integerDigits(value: number): number {
  return Math.floor(Math.abs(value)).toFixed(0).length;
}

/**
 * Decimal places that keep adjacent ticks distinguishable without overflowing
 * the gutter.
 *
 * The gap between ticks is what has to survive rounding — with a step of
 * 0.0015 BTC, two decimals would print three identical labels. One place finer
 * than the step keeps them apart without printing noise.
 *
 * The ceiling is the label budget minus the integer part, so a large figure
 * gives up precision rather than width: 900 BTC to eight places is twelve
 * characters and lands on top of the chart.
 */
function decimalsForStep(step: number, largest: number, bounds: { min: number; max: number }) {
  // −1 for the decimal point itself.
  const affordable = MAX_LABEL_CHARS - 1 - integerDigits(largest);
  const ceiling = Math.max(bounds.min, Math.min(bounds.max, affordable));

  // `buildBalanceAxis` guarantees a positive step, so no guard here. A zero
  // step would still degrade cleanly rather than throw: -log10(0) is Infinity,
  // which the min() below collapses back to the ceiling.
  const needed = Math.ceil(-Math.log10(step)) + 1;
  return Math.max(bounds.min, Math.min(ceiling, needed));
}

/** Abbreviation applied uniformly across the axis, chosen from its magnitude. */
function satsScale(axis: BalanceAxis): { divisor: number; suffix: string } {
  const magnitude = Math.max(Math.abs(axis.domain[0]), Math.abs(axis.domain[1]));

  if (magnitude >= 10_000_000) {
    return { divisor: 1_000_000, suffix: 'M' };
  }

  if (magnitude >= 10_000) {
    return { divisor: 1_000, suffix: 'k' };
  }

  return { divisor: 1, suffix: '' };
}

/**
 * Builds the tick formatter for one axis, in the unit the reader has selected.
 *
 * Scale and precision are decided ONCE from the axis rather than per value.
 * Per-value choices produce a mixed column (`9995k`, `10.0M`, `10.0M`) and,
 * worse, a fixed precision reproduces the very defect this module exists to
 * fix: three identical labels. `sats` is the default unit, so getting that
 * branch right is the common case, not the edge.
 *
 * Labels stay compact on purpose — a tick column is a few characters wide, and
 * a full eight-decimal BTC string or a grouped nine-digit sats figure would eat
 * the plot.
 */
export function buildTickFormatter(axis: BalanceAxis, unit: BitcoinUnit): (sats: number) => string {
  const largest = Math.max(Math.abs(axis.domain[0]), Math.abs(axis.domain[1]));

  if (unit === 'btc') {
    // Floor of two: BTC is money, and a lone decimal place reads as a
    // truncated figure rather than a rounded one.
    const decimals = decimalsForStep(satsToBTC(axis.stepSats), satsToBTC(largest), {
      min: 2,
      max: 8,
    });
    return (sats: number) => satsToBTC(sats).toFixed(decimals);
  }

  const { divisor, suffix } = satsScale(axis);
  // Capped below the BTC allowance: an abbreviated column is already a rounded
  // view. Movements finer than that resolution still show in the line's shape
  // and against the opening reference line. Whole sats take no decimals at all.
  const decimals = decimalsForStep(axis.stepSats / divisor, largest / divisor, {
    min: 0,
    max: divisor === 1 ? 0 : 4 - suffix.length,
  });

  return (sats: number) => `${(sats / divisor).toFixed(decimals)}${suffix}`;
}
