import { act,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe,expect,it,vi } from 'vitest';
import { AnimatedPrice,PriceChart } from '../../../src/components/Dashboard/PriceChart';

vi.mock('../../../src/components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats}</span>,
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
  YAxis: () => <span data-testid="y-axis" />,
  Tooltip: ({ content }: { content: React.ReactElement<Record<string, unknown>> }) => (
    <div data-testid="tooltip">
      <div data-testid="tooltip-inactive">{React.cloneElement(content, { active: false, payload: [], label: '' })}</div>
      <div data-testid="tooltip-active">{React.cloneElement(content, { active: true, payload: [{ value: 42000 }], label: 'Jan 1' })}</div>
    </div>
  ),
}));

describe('PriceChart', () => {
  it('renders total balance and timeframe controls', async () => {
    const user = userEvent.setup();
    const setTimeframe = vi.fn();

    render(
      <PriceChart
        totalBalance={123456}
        chartReady={true}
        timeframe="1W"
        setTimeframe={setTimeframe}
        chartData={[{ name: 'Jan', sats: 1000 }]}
        pendingTotals={{ incoming: 0, outgoing: 0 }}
        walletCount={1}
      />
    );

    expect(screen.getByTestId('amount')).toHaveTextContent('123456');
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByText('1W')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1M' }));
    expect(setTimeframe).toHaveBeenCalledWith('1M');
  });

  it('renders chart tooltip with active and inactive states', () => {
    render(
      <PriceChart
        totalBalance={100}
        chartReady={true}
        timeframe="1D"
        setTimeframe={vi.fn()}
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
        setTimeframe={vi.fn()}
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
        setTimeframe={vi.fn()}
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
