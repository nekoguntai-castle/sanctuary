import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import { BlockVisualizer } from '../../src/components/BlockVisualizer';
import type { PendingTransaction } from '../../src/types';

vi.mock('lucide-react', () => ({
  ArrowRight: () => <span data-testid="arrow-right" />,
  Clock: () => <span data-testid="clock-icon" />,
  Boxes: () => <span data-testid="boxes-icon" />,
  ExternalLink: () => <span data-testid="external-link" />,
}));

describe('BlockVisualizer', () => {
  it('renders pending and confirmed blocks', async () => {
    render(
      <BlockVisualizer
        blocks={[
          {
            height: 'mempool',
            medianFee: 12,
            feeRange: '10-20',
            size: 1.2,
            time: '5m',
            status: 'pending',
          },
          {
            height: 800000,
            medianFee: 5,
            feeRange: '3-7',
            size: 1.5,
            time: 'Just now',
            status: 'confirmed',
          },
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Mempool (Pending)')).toBeInTheDocument();
      expect(screen.getByText('Blockchain (Confirmed)')).toBeInTheDocument();
    });

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Just now')).toBeInTheDocument();
  });

  it('calls onBlockClick with median fee', async () => {
    const user = userEvent.setup();
    const onBlockClick = vi.fn();

    render(
      <BlockVisualizer
        blocks={[
          {
            height: 'mempool',
            medianFee: 15,
            feeRange: '10-20',
            size: 1.0,
            time: '2m',
            status: 'pending',
          },
        ]}
        onBlockClick={onBlockClick}
      />
    );

    const feeNode = await screen.findByText('15');
    const blockButton = feeNode.closest('button');
    expect(blockButton).not.toBeNull();

    await user.click(blockButton!);
    expect(onBlockClick).toHaveBeenCalledWith(15);
  });

  it('renders pending transaction dots when provided', async () => {
    const pendingTxs: PendingTransaction[] = [
      {
        txid: 'tx1',
        walletId: 'wallet-1',
        amount: 10000,
        fee: 50,
        feeRate: 2,
        type: 'sent',
        timeInQueue: 120,
        createdAt: '2025-01-01T00:00:00.000Z',
        recipient: 'bc1qtest',
      },
    ];

    render(
      <BlockVisualizer
        blocks={[
          {
            height: 'mempool',
            medianFee: 8,
            feeRange: '5-10',
            size: 1.0,
            time: '1m',
            status: 'pending',
          },
        ]}
        pendingTxs={pendingTxs}
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle('Sending 2 sat/vB')).toBeInTheDocument();
    });
  });
});
