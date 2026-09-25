import { fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import type { Timeframe } from '../../../src/api/transactions/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BalanceChart } from '../../../src/components/WalletList/BalanceChart';

const history = vi.hoisted(() => ({ calls: [] as string[], data: [] as unknown[] }));
const currency = vi.hoisted(() => ({ unit: 'btc' as 'btc' | 'sats' }));

// The hovered point's balance. Recharts renders a bare `value` when the
// Tooltip has no formatter, which is how the chart showed raw sats as an
// integer regardless of the BTC/sats preference.
const HOVERED_SATS = 123_456_789;

// Mirrors CurrencyPreferencesContext's `format` with the same shared helpers,
// so the assertions below check the real BTC and sats output shapes.
vi.mock('../../../src/contexts/CurrencyContext', async () => {
  const { formatBTC, satsToBTC } = await import('@sanctuary/shared/utils/bitcoin');
  return {
    useCurrency: () => ({
      unit: currency.unit,
      format: (sats: number) =>
        currency.unit === 'sats' ? `${sats.toLocaleString()} sats` : `${formatBTC(satsToBTC(sats))} BTC`,
    }),
  };
});

vi.mock('../../../src/hooks/queries/useWallets', () => ({
  useBalanceHistory: (_ids: string[], _balance: number, timeframe: string) => {
    history.calls.push(timeframe);
    return { data: history.data };
  },
}));

vi.mock('../../../src/hooks/useDelayedRender', () => ({ useDelayedRender: () => true }));

vi.mock('../../../src/components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats}</span>,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children, data }: { children: React.ReactNode; data: unknown[] }) => (
    <div data-testid="area-chart" data-points={data.length}>{children}</div>
  ),
  Area: () => null,
  XAxis: ({ type, dataKey, ticks, tickFormatter }: {
    type?: string;
    dataKey?: string;
    ticks?: number[];
    tickFormatter?: (value: number) => string;
  }) => (
    <span
      data-testid="x-axis"
      data-type={type}
      data-key={dataKey}
      data-tick-count={ticks?.length ?? 0}
      data-tick-labels={ticks && tickFormatter ? ticks.map(tickFormatter).join('|') : ''}
    />
  ),
  Tooltip: ({ labelFormatter, formatter }: {
    labelFormatter?: (label: unknown) => string;
    formatter?: (value: number, name: string) => unknown;
  }) => (
    <>
      <span data-testid="tooltip-label">{labelFormatter?.(Date.UTC(2026, 0, 1, 12))}</span>
      <span data-testid="tooltip-value">
        {formatter ? [formatter(HOVERED_SATS, 'value')].flat().join(' | ') : String(HOVERED_SATS)}
      </span>
    </>
  ),
}));

const now = Date.now();

describe('BalanceChart', () => {
  beforeEach(() => {
    currency.unit = 'btc';
    history.calls = [];
    history.data = [
      { name: 'Start', value: 1000, timestamp: new Date(now - 30 * 86_400_000).toISOString() },
      { name: 'Now', value: 2000, timestamp: new Date(now).toISOString() },
    ];
  });

  // The page owns the period (the wallet cards follow it too), so the chart is
  // driven through props; this stands in for the page's saved preference.
  function Page({
    initial = '1M',
    onChange = () => undefined,
  }: { initial?: Timeframe; onChange?: (t: Timeframe) => void }) {
    const [timeframe, setTimeframe] = useState<Timeframe>(initial);
    return (
      <BalanceChart
        totalBalance={2000}
        walletCount={2}
        walletIds={['a', 'b']}
        selectedNetwork="mainnet"
        timeframe={timeframe}
        onTimeframeChange={(next) => {
          onChange(next);
          setTimeframe(next);
        }}
      />
    );
  }

  const renderChart = (props: { initial?: Timeframe; onChange?: (t: Timeframe) => void } = {}) =>
    render(<Page {...props} />);

  it('shows the period it is given and reports a new selection to its owner', () => {
    const onChange = vi.fn();
    renderChart({ initial: '1Y', onChange });

    expect(history.calls).toEqual(['1Y']);
    expect(screen.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '1D' }));

    expect(onChange).toHaveBeenCalledWith('1D');
    expect(screen.getByRole('button', { name: '1D' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1Y' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('plots against real time rather than evenly spaced categories', () => {
    renderChart();
    const axis = screen.getByTestId('x-axis');
    expect(axis).toHaveAttribute('data-type', 'number');
    expect(axis).toHaveAttribute('data-key', 't');
  });

  it('labels the default month view with dates', () => {
    renderChart();
    expect(history.calls).toContain('1M');
    const labels = screen.getByTestId('x-axis').getAttribute('data-tick-labels')!.split('|');
    expect(labels.length).toBeGreaterThanOrEqual(4);
    const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    // Ticks count back weekly from today's local midnight, so today is one.
    expect(labels).toContain(monthDay.format(new Date(now).setHours(0, 0, 0, 0)));
  });

  it('labels the week view with weekdays', () => {
    renderChart();
    fireEvent.click(screen.getByRole('button', { name: '1W' }));
    expect(history.calls).toContain('1W');
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    const expected = new Set(
      Array.from({ length: 7 }, (_, index) => weekday.format(Date.UTC(2026, 0, 5 + index, 12)))
    );
    const labels = screen.getByTestId('x-axis').getAttribute('data-tick-labels')!.split('|');
    expect(labels).toHaveLength(7);
    expect(new Set(labels)).toEqual(expected);
  });

  it('labels the day view with hours', () => {
    renderChart();
    fireEvent.click(screen.getByRole('button', { name: '1D' }));
    expect(Number(screen.getByTestId('x-axis').getAttribute('data-tick-count'))).toBeGreaterThanOrEqual(5);
  });

  it('formats the tooltip label from the hovered time', () => {
    renderChart();
    const expected = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      .format(Date.UTC(2026, 0, 1, 12));
    expect(screen.getByTestId('tooltip-label')).toHaveTextContent(expected);
  });

  it('shows the hovered balance in BTC with decimals when the unit is BTC', () => {
    currency.unit = 'btc';
    renderChart();
    const value = screen.getByTestId('tooltip-value');
    expect(value).toHaveTextContent('1.23456789 BTC');
    expect(value).toHaveTextContent('Balance');
    expect(value.textContent).not.toContain(String(HOVERED_SATS));
  });

  it('shows the hovered balance as whole sats when the unit is sats', () => {
    currency.unit = 'sats';
    renderChart();
    const value = screen.getByTestId('tooltip-value');
    expect(value).toHaveTextContent(`${HOVERED_SATS.toLocaleString()} sats`);
    expect(value.textContent).not.toContain('BTC');
  });
});
