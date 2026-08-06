import { act,render,screen } from '@testing-library/react';
import React from 'react';
import { describe,expect,it,vi } from 'vitest';
import { AnimatedPrice,PriceChart } from '../../../src/components/Dashboard/PriceChart';

vi.mock('../../../src/components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats}</span>,
}));

// Mutable so a case can switch units without re-mocking. The axis reads `unit`
// and builds its own compact labels; the tooltip is handed `format`, the
// app-wide formatter, so it renders exactly as amounts do everywhere else.
const currencyUnit = { current: 'sats' as 'sats' | 'btc' };

vi.mock('../../../src/contexts/CurrencyContext', () => ({
  usePriceFreeFormatter: () => ({
    format: (sats: number) =>
      currencyUnit.current === 'btc'
        ? `${(sats / 100_000_000).toFixed(8)} BTC`
        : `${sats.toLocaleString()} sats`,
    unit: currencyUnit.current,
  }),
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => {
    const childArray = React.Children.toArray(children);
    const isSvgDefinition = (child: React.ReactNode) => (
      React.isValidElement(child) && child.type === 'defs'
    );
    return (
      <div data-testid="area-chart">
        <svg data-testid="area-chart-svg">{childArray.filter(isSvgDefinition)}</svg>
        {childArray.filter((child) => !isSvgDefinition(child))}
      </div>
    );
  },
  Area: () => <span data-testid="area" />,
  XAxis: () => <span data-testid="x-axis" />,
  // Surfaces the axis configuration rather than swallowing it: a bare stub
  // would let the domain, ticks and formatter regress to recharts' zero-based
  // default — the exact defect the fitted axis exists to fix — without
  // failing anything.
  YAxis: ({ domain, ticks, tickFormatter }: {
    domain?: [number, number];
    ticks?: number[];
    tickFormatter?: (value: number) => string;
  }) => (
    <span
      data-testid="y-axis"
      data-domain={domain ? domain.join(',') : ''}
      data-ticks={ticks ? ticks.join(',') : ''}
      data-tick-labels={ticks && tickFormatter ? ticks.map(tickFormatter).join(',') : ''}
    />
  ),
  ReferenceLine: ({ y }: { y?: number }) => <span data-testid="reference-line" data-y={y} />,
  Tooltip: ({ content }: { content: React.ReactElement<Record<string, unknown>> }) => (
    <div data-testid="tooltip">
      <div data-testid="tooltip-inactive">{React.cloneElement(content, { active: false, payload: [], label: '' })}</div>
      <div data-testid="tooltip-active">{React.cloneElement(content, { active: true, payload: [{ value: 42000 }], label: 'Jan 1' })}</div>
    </div>
  ),
}));

describe('PriceChart', () => {
  it('renders the total balance and the chart', () => {
    render(
      <PriceChart
        totalBalance={123456}
        chartReady={true}
        timeframe="1W"
        chartData={[{ name: 'Jan', sats: 1000 }]}
        pendingTotals={{ incoming: 0, outgoing: 0 }}
        walletCount={1}
      />
    );

    expect(screen.getByTestId('amount')).toHaveTextContent('123456');
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    // The period selector moved to the page header — it scopes the activity
    // summary as well as this chart, so it no longer lives in this card.
    expect(screen.queryByRole('button', { name: '1M' })).not.toBeInTheDocument();
  });

  it('renders chart tooltip with active and inactive states', () => {
    render(
      <PriceChart
        totalBalance={100}
        chartReady={true}
        timeframe="1D"
        chartData={[{ name: 'Jan', sats: 1000 }]}
        pendingTotals={{ incoming: 0, outgoing: 0 }}
        walletCount={1}
      />
    );

    // Inactive tooltip renders nothing
    expect(screen.getByTestId('tooltip-inactive')).toBeEmptyDOMElement();
    // Active tooltip renders the value
    expect(screen.getByTestId('tooltip-active')).toHaveTextContent('42,000 sats');
    expect(screen.getByTestId('tooltip-active')).toHaveTextContent('Jan 1');
  });

  it('hides chart body when chartReady is false', () => {
    render(
      <PriceChart
        totalBalance={1}
        chartReady={false}
        timeframe="1D"
        chartData={[{ name: 'Now', sats: 1 }]}
        pendingTotals={{ incoming: 0, outgoing: 0 }}
        walletCount={1}
      />
    );

    expect(screen.queryByTestId('responsive-container')).not.toBeInTheDocument();
  });

  const renderChart = (props: Record<string, unknown> = {}) =>
    render(
      <PriceChart
        totalBalance={123456}
        chartReady={true}
        timeframe="1W"
        chartData={[{ name: 'Jan', sats: 1000 }]}
        pendingTotals={{ incoming: 0, outgoing: 0 }}
        walletCount={1}
        {...props}
      />
    );

  it('shows an incoming pending total', () => {
    renderChart({ pendingTotals: { incoming: 50000, outgoing: 0 }, walletCount: 3 });

    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getAllByTestId('amount').map((n) => n.textContent)).toContain('50000');
    expect(screen.getByText('across 3 wallets')).toBeInTheDocument();
  });

  it('shows an outgoing pending total as a positive figure', () => {
    renderChart({ pendingTotals: { incoming: 0, outgoing: 25000 } });

    expect(screen.getAllByTestId('amount').map((n) => n.textContent)).toContain('25000');
  });

  it('shows both directions rather than netting them to nothing', () => {
    // The whole point of tracking directions separately: this would render as
    // "no pending activity" under a single signed total.
    renderChart({ pendingTotals: { incoming: 100000, outgoing: 100000 } });

    const amounts = screen.getAllByTestId('amount').map((n) => n.textContent);
    expect(amounts).toContain('100000');
    expect(amounts.filter((a) => a === '100000')).toHaveLength(2);
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('hides the pending row entirely when nothing is unconfirmed', () => {
    renderChart({ pendingTotals: { incoming: 0, outgoing: 0 } });

    expect(screen.queryByText('pending')).not.toBeInTheDocument();
  });

  it('uses the singular wallet label for a single wallet', () => {
    renderChart({ walletCount: 1 });
    expect(screen.getByText('across 1 wallet')).toBeInTheDocument();
  });

});

describe('AnimatedPrice', () => {
  it('shows placeholder when value is null', () => {
    render(<AnimatedPrice value={null} symbol="$" />);
    expect(screen.getByText('$-----')).toBeInTheDocument();
  });

  it('handles null-to-number transition without direction indicator', () => {
    const { rerender } = render(<AnimatedPrice value={null} symbol="$" />);

    rerender(<AnimatedPrice value={2500} symbol="$" />);

    expect(screen.getByText('$2,500')).toBeInTheDocument();
    expect(screen.queryByText('↑')).not.toBeInTheDocument();
    expect(screen.queryByText('↓')).not.toBeInTheDocument();
  });

  it('shows formatted value when present', () => {
    render(<AnimatedPrice value={12345} symbol="$" />);
    expect(screen.getByText('$12,345')).toBeInTheDocument();
  });

  it('animates upward price changes and completes to final value', () => {
    const callbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const { rerender } = render(<AnimatedPrice value={100} symbol="$" />);
    rerender(<AnimatedPrice value={200} symbol="$" />);

    const start = performance.now();
    act(() => {
      callbacks[0]?.(start);
    });
    expect(screen.getByText('↑')).toBeInTheDocument();

    act(() => {
      callbacks[1]?.(start + 1000);
    });
    expect(screen.queryByText('↑')).not.toBeInTheDocument();
    expect(screen.getByText('$200')).toBeInTheDocument();
    expect(rafSpy).toHaveBeenCalled();
  });

  it('animates downward price changes and cancels animation on unmount', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const { rerender, unmount } = render(<AnimatedPrice value={200} symbol="$" />);
    rerender(<AnimatedPrice value={100} symbol="$" />);

    const start = performance.now();
    act(() => {
      callbacks[0]?.(start);
    });
    expect(screen.getByText('↓')).toBeInTheDocument();
    // Value is mid-animation (between 200→100) so match any dollar amount
    expect(screen.getByText(/^\$\d+$/)).toHaveClass('text-rose-600');

    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('does not call cancelAnimationFrame when animation id is 0', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const { rerender, unmount } = render(<AnimatedPrice value={100} symbol="$" />);
    rerender(<AnimatedPrice value={200} symbol="$" />);
    unmount();

    expect(cancelSpy).not.toHaveBeenCalled();
  });
});

describe('PriceChart balance trend', () => {
  const renderChart = (chartData: { name: string; sats: number }[], timeframe: any = '1W') =>
    render(
      <PriceChart
        totalBalance={1_125_000}
        chartReady={true}
        timeframe={timeframe}
        chartData={chartData}
        pendingTotals={{ incoming: 0, outgoing: 0 }}
        walletCount={2}
      />
    );

  it('states a gain in words, not only in colour', () => {
    renderChart([
      { name: 'a', sats: 1_000_000 },
      { name: 'b', sats: 1_125_000 },
    ]);

    const trend = screen.getByTestId('balance-trend');
    expect(trend).toHaveAttribute('data-direction', 'gain');
    // The sign and the number are in the text: a reader who cannot distinguish
    // the colours still learns which way the balance went.
    expect(trend).toHaveTextContent('+125,000 sats (+12.5%) over the past week');
  });

  it('states a loss with a negative sign', () => {
    renderChart(
      [
        { name: 'a', sats: 200_000 },
        { name: 'b', sats: 150_000 },
      ],
      '1M'
    );

    const trend = screen.getByTestId('balance-trend');
    expect(trend).toHaveAttribute('data-direction', 'loss');
    expect(trend).toHaveTextContent('-50,000 sats (-25.0%) over the past month');
  });

  it('says no change rather than showing a bare zero', () => {
    renderChart([{ name: 'a', sats: 5 }, { name: 'b', sats: 5 }], 'ALL');

    const trend = screen.getByTestId('balance-trend');
    expect(trend).toHaveAttribute('data-direction', 'flat');
    expect(trend).toHaveTextContent('No change over all time');
  });

  it('treats an empty history as flat instead of inventing a direction', () => {
    renderChart([]);

    expect(screen.getByTestId('balance-trend')).toHaveAttribute('data-direction', 'flat');
  });

  it('omits the percentage when the period opened at zero', () => {
    renderChart([
      { name: 'a', sats: 0 },
      { name: 'b', sats: 100_000 },
    ]);

    const trend = screen.getByTestId('balance-trend');
    expect(trend).toHaveTextContent('+100,000 sats over the past week');
    expect(trend.textContent).not.toContain('%');
  });

  it('drives the chart from the same direction as the annotation', () => {
    renderChart([
      { name: 'a', sats: 200_000 },
      { name: 'b', sats: 150_000 },
    ]);

    // One trend model feeds both, so the line cannot disagree with the words.
    expect(screen.getByTestId('balance-trend')).toHaveAttribute('data-direction', 'loss');
    expect(screen.getByTestId('price-chart-body')).toHaveAttribute('data-direction', 'loss');
  });

  it('keeps pending exposure separate from the confirmed period change', () => {
    render(
      <PriceChart
        totalBalance={1_000_000}
        chartReady={true}
        timeframe="1W"
        chartData={[
          { name: 'a', sats: 1_000_000 },
          { name: 'b', sats: 1_125_000 },
        ]}
        pendingTotals={{ incoming: 40_000, outgoing: 0 }}
        walletCount={2}
      />
    );

    // Unconfirmed sats must not be folded into the confirmed change.
    expect(screen.getByTestId('balance-trend')).toHaveTextContent('+125,000 sats');
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  describe('balance axis', () => {
    it('fits the y axis to the data instead of anchoring it at zero', () => {
      // The reported defect: 12.4 BTC moving 0.03%. Against recharts' default
      // [0, 'auto'] domain this draws as a flat line.
      renderChart([
        { name: 'a', sats: 1_240_380_000 },
        { name: 'b', sats: 1_240_810_000 },
      ]);

      const [low] = screen
        .getByTestId('y-axis')
        .getAttribute('data-domain')!
        .split(',')
        .map(Number);

      expect(low).toBeGreaterThan(1_000_000_000);
    });

    it('labels the ticks distinguishably rather than repeating one number', () => {
      renderChart([
        { name: 'a', sats: 1_240_380_000 },
        { name: 'b', sats: 1_240_810_000 },
      ]);

      const labels = screen.getByTestId('y-axis').getAttribute('data-tick-labels')!.split(',');

      // A truncated axis whose ticks all read "12.40" tells the reader nothing
      // about where the scale starts.
      expect(labels).toHaveLength(3);
      expect(new Set(labels).size).toBe(3);
    });

    it('marks the period opening balance so the change has a baseline', () => {
      renderChart([
        { name: 'a', sats: 900_000 },
        { name: 'b', sats: 1_000_000 },
      ]);

      expect(screen.getByTestId('reference-line')).toHaveAttribute('data-y', '900000');
    });

    it('follows the selected display unit', () => {
      currencyUnit.current = 'btc';
      try {
        renderChart([
          { name: 'a', sats: 100_000_000 },
          { name: 'b', sats: 400_000_000 },
        ]);

        const labels = screen.getByTestId('y-axis').getAttribute('data-tick-labels')!.split(',');

        // BTC labels are decimal fractions; the sats formatter would abbreviate
        // these to "100M"/"400M".
        expect(labels.every((label) => label.includes('.'))).toBe(true);
      } finally {
        currencyUnit.current = 'sats';
      }
    });

    it('renders the tooltip through the app-wide formatter, not a private copy', () => {
      currencyUnit.current = 'btc';
      try {
        renderChart([{ name: 'a', sats: 1000 }]);

        // The mocked Tooltip clones the content with a payload of 42000 sats.
        // Keeping the tooltip on `format` is what stops it drifting from how
        // amounts render everywhere else in the app.
        expect(screen.getByTestId('tooltip-active')).toHaveTextContent('0.00042000 BTC');
      } finally {
        currencyUnit.current = 'sats';
      }
    });
  });
});
