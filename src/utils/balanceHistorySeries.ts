/**
 * Turns the balance-history endpoint's points into a series drawn against real
 * time, in the reader's own timezone.
 *
 * The endpoint only reports buckets that saw activity. Drawn as evenly spaced
 * categories, that squeezed a quiet month into one gap and stretched a busy
 * week across the chart, and left the axis with whatever labels the server's
 * UTC locale produced — no hours on 1D, no weekdays on 1W. Here the balance is
 * sampled on a regular local grid instead, and the axis gets ticks chosen for
 * the period being shown.
 */

import type { Timeframe } from '../api/transactions/types';

/** The selectable periods, in the order the selectors show them. */
export const BALANCE_TIMEFRAMES: readonly Timeframe[] = ['1D', '1W', '1M', '1Y', 'ALL'];

/** Narrows a stored preference, which is untyped JSON, to a period. */
export function isBalanceTimeframe(value: unknown): value is Timeframe {
  return (BALANCE_TIMEFRAMES as readonly unknown[]).includes(value);
}

export interface BalanceHistoryInput {
  value: number;
  /** ISO instant the balance held at. Points without one cannot be placed. */
  timestamp?: string;
}

export interface BalanceSeriesPoint {
  /** Epoch milliseconds. */
  t: number;
  value: number;
}

export interface BalanceTimeAxis {
  /**
   * Spread onto a recharts `<XAxis>`. Real time, not categories: a quiet month
   * and a busy week take the width they actually span.
   */
  xAxisProps: {
    dataKey: 't';
    type: 'number';
    scale: 'time';
    domain: [number, number];
    ticks: number[];
    tickFormatter: (t: number) => string;
    interval: 'preserveStartEnd';
    minTickGap: number;
  };
  /** Fuller label for a tooltip, which has room for more than a tick. */
  formatTooltip: (t: number) => string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Matches the server's `getTimeframeStartDate`. */
const PERIOD_MS: Record<Exclude<Timeframe, 'ALL'>, number> = {
  '1D': DAY_MS,
  '1W': 7 * DAY_MS,
  '1M': 30 * DAY_MS,
  '1Y': 365 * DAY_MS,
};

type Scale = 'hours' | 'weekdays' | 'days' | 'months' | 'years';

type Step = (date: Date) => void;

const stepHour: Step = date => date.setHours(date.getHours() + 1, 0, 0, 0);
const stepDay: Step = date => {
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
};
const stepMonth: Step = date => {
  date.setMonth(date.getMonth() + 1, 1);
  date.setHours(0, 0, 0, 0);
};

/**
 * Every local boundary of `step` strictly inside (start, end). Stepping with
 * local setters rather than fixed millisecond offsets keeps midnights on
 * midnight across daylight-saving changes.
 */
function boundariesBetween(start: number, end: number, step: Step): number[] {
  const out: number[] = [];
  const cursor = new Date(start);
  step(cursor);
  while (cursor.getTime() < end) {
    out.push(cursor.getTime());
    step(cursor);
  }
  return out;
}

function scaleFor(timeframe: Timeframe, spanMs: number): Scale {
  switch (timeframe) {
    case '1D':
      return 'hours';
    case '1W':
      return 'weekdays';
    case '1M':
      return 'days';
    case '1Y':
      return 'months';
    case 'ALL':
      if (spanMs <= 2 * DAY_MS) return 'hours';
      if (spanMs <= 45 * DAY_MS) return 'days';
      if (spanMs <= 3 * 365 * DAY_MS) return 'months';
      return 'years';
  }
}

/** Sampling resolution per scale: fine enough to show movement, bounded in size. */
const GRID_STEP: Record<Scale, Step> = {
  hours: stepHour,
  weekdays: stepHour,
  days: stepDay,
  months: stepDay,
  years: stepMonth,
};

function placedPoints(history: readonly BalanceHistoryInput[]): BalanceSeriesPoint[] {
  return history
    .map(point => ({ t: point.timestamp ? Date.parse(point.timestamp) : Number.NaN, value: point.value }))
    .filter(point => Number.isFinite(point.t) && Number.isFinite(point.value))
    .sort((a, b) => a.t - b.t);
}

/**
 * The balance sampled on a regular local grid from the start of the period to
 * `now`. Between reported points the balance holds at the last one — it only
 * changes when a transaction confirms.
 */
export function buildBalanceSeries(
  history: readonly BalanceHistoryInput[],
  timeframe: Timeframe,
  now: number = Date.now()
): BalanceSeriesPoint[] {
  const placed = placedPoints(history);

  if (placed.length === 0) {
    // Nothing can be placed in time (the client-side placeholder, or an older
    // response). The latest usable value is still the current balance.
    const finite = history.filter(point => Number.isFinite(point.value));
    const value = finite.length > 0 ? finite[finite.length - 1].value : 0;
    const start = timeframe === 'ALL' ? now - DAY_MS : now - PERIOD_MS[timeframe];
    return [{ t: start, value }, { t: now, value }];
  }

  let start = timeframe === 'ALL' ? placed[0].t : now - PERIOD_MS[timeframe];
  // An all-time history that opened moments ago still needs a visible width.
  if (now - start < HOUR_MS) start = now - DAY_MS;

  const scale = scaleFor(timeframe, now - start);
  const grid = [start, ...boundariesBetween(start, now, GRID_STEP[scale]), now];

  const series: BalanceSeriesPoint[] = [];
  let cursor = -1;
  for (const t of grid) {
    while (cursor + 1 < placed.length && placed[cursor + 1].t <= t) cursor++;
    // Before the first reported point the balance is that point's opening one.
    series.push({ t, value: placed[Math.max(cursor, 0)].value });
  }
  return series;
}

function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions) {
  const format = new Intl.DateTimeFormat(locale, options);
  return (t: number) => format.format(t);
}

/**
 * Ticks and labels for a series from `buildBalanceSeries`, chosen for the
 * period: hours for a day, weekdays for a week, dates for a month, months for
 * a year, and whichever of those fits an all-time span.
 */
export function buildBalanceTimeAxis(
  series: readonly Pick<BalanceSeriesPoint, 't'>[],
  timeframe: Timeframe,
  locale?: string
): BalanceTimeAxis {
  const start = series.length > 0 ? series[0].t : 0;
  const end = series.length > 0 ? series[series.length - 1].t : 0;
  const { ticks, formatTick, formatTooltip } = ticksFor(scaleFor(timeframe, end - start), start, end, locale);
  return {
    xAxisProps: {
      dataKey: 't',
      type: 'number',
      scale: 'time',
      domain: [start, end],
      ticks,
      tickFormatter: formatTick,
      interval: 'preserveStartEnd',
      minTickGap: 12,
    },
    formatTooltip,
  };
}

function ticksFor(
  scale: Scale,
  start: number,
  end: number,
  locale: string | undefined
): { ticks: number[]; formatTick: (t: number) => string; formatTooltip: (t: number) => string } {
  switch (scale) {
    case 'hours':
      return {
        // Every fourth local hour: six labels across a day.
        ticks: boundariesBetween(start, end, stepHour).filter(t => new Date(t).getHours() % 4 === 0),
        formatTick: formatter(locale, { hour: 'numeric' }),
        formatTooltip: formatter(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
      };
    case 'weekdays':
      return {
        ticks: boundariesBetween(start, end, stepDay),
        formatTick: formatter(locale, { weekday: 'short' }),
        formatTooltip: formatter(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }),
      };
    case 'days': {
      // Weekly, counted back from the latest midnight so today's week is whole.
      const midnights = boundariesBetween(start, end, stepDay);
      return {
        ticks: midnights.filter((_, index) => (midnights.length - 1 - index) % 7 === 0),
        formatTick: formatter(locale, { month: 'short', day: 'numeric' }),
        formatTooltip: formatter(locale, { weekday: 'short', month: 'short', day: 'numeric' }),
      };
    }
    case 'months': {
      const month = formatter(locale, { month: 'short' });
      // January is labelled with its year, so a span crossing New Year says
      // which is which. ("Jan 26" would read as a date.)
      const year = formatter(locale, { year: 'numeric' });
      return {
        ticks: boundariesBetween(start, end, stepMonth),
        formatTick: t => (new Date(t).getMonth() === 0 ? year(t) : month(t)),
        formatTooltip: formatter(locale, { month: 'short', day: 'numeric', year: 'numeric' }),
      };
    }
    case 'years':
      return {
        ticks: boundariesBetween(start, end, stepMonth).filter(t => new Date(t).getMonth() === 0),
        formatTick: formatter(locale, { year: 'numeric' }),
        formatTooltip: formatter(locale, { month: 'short', year: 'numeric' }),
      };
  }
}
