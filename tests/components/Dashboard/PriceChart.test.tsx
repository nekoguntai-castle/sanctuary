import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PriceChart, AnimatedPrice } from '../../../components/Dashboard/PriceChart';

vi.mock('../../../components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats}</span>,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => <span data-testid="area" />,
  XAxis: () => <span data-testid="x-axis" />,
  YAxis: () => <span data-testid="y-axis" />,
  Tooltip: () => <span data-testid="tooltip" />,
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
      />
    );

    expect(screen.getByTestId('amount')).toHaveTextContent('123456');
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    expect(screen.getByText('1W')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '1M' }));
    expect(setTimeframe).toHaveBeenCalledWith('1M');
  });

  it('hides chart body when chartReady is false', () => {
    render(
      <PriceChart
        totalBalance={1}
        chartReady={false}
        timeframe="1D"
        setTimeframe={vi.fn()}
        chartData={[{ name: 'Now', sats: 1 }]}
      />
    );

    expect(screen.queryByTestId('responsive-container')).not.toBeInTheDocument();
  });
});

describe('AnimatedPrice', () => {
  it('shows placeholder when value is null', () => {
    render(<AnimatedPrice value={null} symbol="$" />);
    expect(screen.getByText('$-----')).toBeInTheDocument();
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

    unmount();
    expect(cancelSpy).toHaveBeenCalled();
  });
});
