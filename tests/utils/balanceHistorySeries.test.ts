import { describe, expect, it } from 'vitest';
import { buildBalanceSeries, buildBalanceTimeAxis } from '../../src/utils/balanceHistorySeries';

// Times are built in the host's local zone, the zone the charts draw in, so
// the expected labels hold wherever the suite runs. (Reassigning
// process.env.TZ at runtime does not reach vitest's worker threads.)
const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();
const iso = (t: number) => new Date(t).toISOString();

// Tue 22 Sep 2026, 14:30 local.
const NOW = local(2026, 9, 22, 14, 30);

const flat = [
  { name: 'Start', value: 5000 },
  { name: 'Now', value: 5000 },
];

function labels(timeframe: '1D' | '1W' | '1M' | '1Y' | 'ALL', history = flat as { value: number; timestamp?: string }[]) {
  const series = buildBalanceSeries(history, timeframe, NOW);
  const axis = buildBalanceTimeAxis(series, timeframe, 'en-US');
  return axis.xAxisProps.ticks.map(axis.xAxisProps.tickFormatter);
}

describe('balance history axis labels', () => {
  it('labels a day with local hours', () => {
    expect(labels('1D')).toEqual(['4 PM', '8 PM', '12 AM', '4 AM', '8 AM', '12 PM']);
  });

  it('labels a week with weekdays', () => {
    expect(labels('1W')).toEqual(['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
  });

  it('labels a month with the month and day of month, weekly back from today', () => {
    expect(labels('1M')).toEqual(['Aug 25', 'Sep 1', 'Sep 8', 'Sep 15', 'Sep 22']);
  });

  it('labels a year with months, putting the year in place of January', () => {
    expect(labels('1Y')).toEqual([
      'Oct', 'Nov', 'Dec', '2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
    ]);
  });

  it('labels a multi-year all-time span with years', () => {
    const history = [
      { value: 0, timestamp: '2021-06-03T00:00:00.000Z' },
      { value: 5000, timestamp: new Date(NOW).toISOString() },
    ];
    expect(labels('ALL', history)).toEqual(['2022', '2023', '2024', '2025', '2026']);
  });

  it('labels an all-time span of months with months', () => {
    const history = [
      { value: 0, timestamp: iso(local(2026, 5, 10, 12)) },
      { value: 5000, timestamp: new Date(NOW).toISOString() },
    ];
    expect(labels('ALL', history)).toEqual(['Jun', 'Jul', 'Aug', 'Sep']);
  });

  it('labels a short all-time span with dates rather than years', () => {
    const history = [
      { value: 0, timestamp: iso(local(2026, 9, 1, 12)) },
      { value: 5000, timestamp: new Date(NOW).toISOString() },
    ];
    expect(labels('ALL', history)).toEqual(['Sep 8', 'Sep 15', 'Sep 22']);
  });

  it('formats a tooltip label with more detail than a tick', () => {
    const series = buildBalanceSeries(flat, '1M', NOW);
    const axis = buildBalanceTimeAxis(series, '1M', 'en-US');
    expect(axis.formatTooltip(NOW)).toBe('Tue, Sep 22');
  });
});

describe('buildBalanceSeries', () => {
  it('spaces points evenly in time, however sparse the reported buckets', () => {
    const history = [
      { value: 100, timestamp: new Date(NOW - 30 * 86_400_000).toISOString() },
      { value: 150, timestamp: iso(local(2026, 8, 30, 3)) },
      { value: 120, timestamp: iso(local(2026, 9, 21, 18)) },
      { value: 120, timestamp: new Date(NOW).toISOString() },
    ];

    const series = buildBalanceSeries(history, '1M', NOW);

    // Opening, 30 local midnights, now.
    expect(series).toHaveLength(32);
    expect(series[0]).toEqual({ t: NOW - 30 * 86_400_000, value: 100 });
    expect(series[series.length - 1]).toEqual({ t: NOW, value: 120 });
    const gaps = series.slice(2, -1).map((point, index) => point.t - series[index + 1].t);
    // Every interior gap is a local day (no DST change falls in this window
    // in any zone that observes one).
    expect(new Set(gaps)).toEqual(new Set([86_400_000]));
  });

  it('holds the balance at the last reported point until the next one', () => {
    const history = [
      { value: 100, timestamp: new Date(NOW - 86_400_000).toISOString() },
      { value: 300, timestamp: iso(local(2026, 9, 22, 10)) },
      { value: 300, timestamp: new Date(NOW).toISOString() },
    ];

    const series = buildBalanceSeries(history, '1D', NOW);
    const at = (t: number) => series.find(point => point.t === t)?.value;

    expect(at(local(2026, 9, 22, 9))).toBe(100);
    expect(at(local(2026, 9, 22, 10))).toBe(300);
    expect(at(local(2026, 9, 22, 11))).toBe(300);
  });

  it('draws a flat line at the latest value when no point carries a timestamp', () => {
    const series = buildBalanceSeries([{ value: 1 }, { value: 7 }], '1W', NOW);
    expect(series).toEqual([
      { t: NOW - 7 * 86_400_000, value: 7 },
      { t: NOW, value: 7 },
    ]);
  });

  it('draws a flat zero line for an empty history', () => {
    expect(buildBalanceSeries([], '1D', NOW)).toEqual([
      { t: NOW - 86_400_000, value: 0 },
      { t: NOW, value: 0 },
    ]);
  });

  it('ignores points that cannot be placed or valued', () => {
    const series = buildBalanceSeries(
      [
        { value: 50, timestamp: 'not-a-date' },
        { value: Number.NaN, timestamp: new Date(NOW - 3_600_000).toISOString() },
        { value: 80, timestamp: new Date(NOW - 86_400_000).toISOString() },
      ],
      '1D',
      NOW
    );
    expect(new Set(series.map(point => point.value))).toEqual(new Set([80]));
  });

  it('gives an all-time history that opened moments ago a day of width', () => {
    const history = [
      { value: 10, timestamp: new Date(NOW).toISOString() },
      { value: 10, timestamp: new Date(NOW).toISOString() },
    ];
    const series = buildBalanceSeries(history, 'ALL', NOW);
    expect(series[0].t).toBe(NOW - 86_400_000);
    expect(series[series.length - 1].t).toBe(NOW);
  });

  it('opens a placeholder all-time line a day back', () => {
    expect(buildBalanceSeries(flat, 'ALL', NOW)[0].t).toBe(NOW - 86_400_000);
  });

  it('keeps local midnights on midnight across a daylight-saving change', () => {
    // Spans the end of DST on 25 Oct (EU) and 1 Nov (US) 2026; a trivially
    // true check in a zone without DST.
    const now = local(2026, 11, 10, 12);
    const series = buildBalanceSeries([{ value: 1, timestamp: new Date(now).toISOString() }], '1M', now);
    expect(series.length).toBeGreaterThan(20);
    const hours = new Set(series.slice(1, -1).map(point => new Date(point.t).getHours()));
    expect(hours).toEqual(new Set([0]));
  });

  it('samples monthly for a multi-year all-time span', () => {
    const history = [
      { value: 0, timestamp: '2020-01-15T00:00:00.000Z' },
      { value: 1, timestamp: new Date(NOW).toISOString() },
    ];
    const series = buildBalanceSeries(history, 'ALL', NOW);
    const interior = series.slice(1, -1).map(point => new Date(point.t));
    expect(interior.every(date => date.getDate() === 1 && date.getHours() === 0)).toBe(true);
  });
});

describe('buildBalanceTimeAxis', () => {
  it('tolerates an empty series', () => {
    const axis = buildBalanceTimeAxis([], '1D', 'en-US');
    expect(axis.xAxisProps.domain).toEqual([0, 0]);
    expect(axis.xAxisProps.ticks).toEqual([]);
  });

  it('spans the whole series', () => {
    const series = buildBalanceSeries(flat, '1W', NOW);
    expect(buildBalanceTimeAxis(series, '1W').xAxisProps.domain).toEqual([NOW - 7 * 86_400_000, NOW]);
  });

  it.each(['1D', '1W', '1Y'] as const)('formats %s tooltips', timeframe => {
    const series = buildBalanceSeries(flat, timeframe, NOW);
    expect(buildBalanceTimeAxis(series, timeframe, 'en-US').formatTooltip(NOW)).toMatch(/Sep|Tue/);
  });

  it('formats all-time tooltips for a multi-year span', () => {
    const series = buildBalanceSeries(
      [{ value: 0, timestamp: '2020-01-15T00:00:00.000Z' }],
      'ALL',
      NOW
    );
    expect(buildBalanceTimeAxis(series, 'ALL', 'en-US').formatTooltip(NOW)).toBe('Sep 2026');
  });
});
