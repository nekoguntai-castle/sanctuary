import { act,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe,expect,it,vi } from 'vitest';
import { AnimatedPrice,PriceChart } from '../../../components/Dashboard/PriceChart';

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
