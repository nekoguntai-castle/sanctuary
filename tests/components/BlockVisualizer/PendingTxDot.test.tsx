import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingTxDot } from '../../../components/BlockVisualizer/PendingTxDot';
import type { PendingTransaction } from '../../../src/types';

vi.mock('lucide-react', () => ({
  ExternalLink: (props: React.HTMLAttributes<HTMLElement>) => (
    <span data-testid="external-link-icon" {...props} />
  ),
}));

const makeTx = (overrides: Partial<PendingTransaction> = {}): PendingTransaction => ({
  txid: 'txid-123',
  walletId: 'wallet-1',
  type: 'sent',
  amount: -25000,
  fee: 420,
  feeRate: 25,
  timeInQueue: 75,
  createdAt: '2025-01-01T00:00:00.000Z',
  recipient: 'bc1qrecipientaddress1234567890abcd',
  ...overrides,
});

describe('PendingTxDot', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('opens explorer link on click and stops click propagation', async () => {
    const user = userEvent.setup();
    const parentClick = vi.fn();
    const tx = makeTx({ txid: 'abc123', feeRate: 20 });

    render(
      <div onClick={parentClick}>
        <PendingTxDot tx={tx} explorerUrl="https://mempool.space" compact={false} />
      </div>
    );

    const button = screen.getByTitle('Sending 20 sat/vB');
    await user.click(button);

    expect(window.open).toHaveBeenCalledWith('https://mempool.space/tx/abc123', '_blank');
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('does not render tooltip content when compact mode is enabled', () => {
    const tx = makeTx({ feeRate: 6 });
    render(<PendingTxDot tx={tx} explorerUrl="https://mempool.space" compact={true} />);

    const button = screen.getByTitle('Sending 6 sat/vB');
    fireEvent.mouseEnter(button.parentElement as HTMLElement);

    expect(button.className).toContain('w-2 h-2');
    expect(screen.queryByText('Fee Rate:')).not.toBeInTheDocument();
  });

  it('shows and hides tooltip for non-compact dots', () => {
    const tx = makeTx({ feeRate: 12, timeInQueue: 120 });
    render(<PendingTxDot tx={tx} explorerUrl="https://mempool.space" compact={false} />);

    const wrapper = screen.getByTitle('Sending 12 sat/vB').parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);

    expect(screen.getByText('Fee Rate:')).toBeInTheDocument();
    expect(screen.getByText('~30 min')).toBeInTheDocument();
    expect(screen.getByText('2m')).toBeInTheDocument();
    expect(screen.getByText('To:')).toBeInTheDocument();
    expect(screen.getByText('bc1qreci...abcd')).toBeInTheDocument();
    expect(screen.getByTestId('external-link-icon')).toBeInTheDocument();

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByText('Fee Rate:')).not.toBeInTheDocument();
  });

  it('uses received styling and hides recipient row when no recipient is provided', () => {
    const tx = makeTx({ type: 'received', recipient: undefined, feeRate: 2, amount: 2000 });
    render(<PendingTxDot tx={tx} explorerUrl="https://mempool.space" compact={false} />);

    const button = screen.getByTitle('Receiving 2 sat/vB');
    fireEvent.mouseEnter(button.parentElement as HTMLElement);

    expect(button.className).toContain('bg-red-400/80');
    expect(screen.getByText('Receiving')).toBeInTheDocument();
    expect(screen.getByText('~2+ hours')).toBeInTheDocument();
    expect(screen.queryByText('To:')).not.toBeInTheDocument();
  });

  it.each([
    { feeRate: 25, eta: '~10 min' },
    { feeRate: 10, eta: '~30 min' },
    { feeRate: 5, eta: '~1 hour' },
    { feeRate: 1, eta: '~2+ hours' },
  ])('shows $eta ETA for feeRate=$feeRate', ({ feeRate, eta }) => {
    const tx = makeTx({ feeRate, recipient: undefined });
    render(<PendingTxDot tx={tx} explorerUrl="https://mempool.space" compact={false} />);

    const button = screen.getByTitle(`Sending ${feeRate} sat/vB`);
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(screen.getByText(eta)).toBeInTheDocument();
  });

  it('shows stuck state styling and ETA override', () => {
    const tx = makeTx({ feeRate: 99 });
    render(
      <PendingTxDot
        tx={tx}
        explorerUrl="https://mempool.space"
        compact={false}
        isStuck={true}
      />
    );

    const button = screen.getByTitle('Sending 99 sat/vB');
    fireEvent.mouseEnter(button.parentElement as HTMLElement);

    expect(button.className).toContain('bg-amber-500');
    expect(button.className).toContain('animate-pulse');
    expect(screen.getByText('Stuck - fee too low')).toBeInTheDocument();
  });
});
