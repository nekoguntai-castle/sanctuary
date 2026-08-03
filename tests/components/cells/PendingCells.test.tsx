import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BalanceCell, PendingCell } from '../../../src/components/cells/WalletCells/PendingCells';

describe('PendingCells', () => {
  it('renders a dash when no pending data exists', () => {
    const { container } = render(
      <PendingCell
        item={{ pendingData: undefined } as any}
        column={{ id: 'pending', label: 'Pending' }}
      />
    );

    expect(container.querySelector('.text-sanctuary-300')).toBeInTheDocument();
  });

  it('omits pending fiat delta when fiat formatting is suppressed for pending value', () => {
    const formatFiat = vi.fn((sats: number) => (sats === 1000 ? '$10.00' : null));

    render(
      <BalanceCell
        wallet={{
          id: 'wallet-1',
          balance: 1000,
          network: 'testnet',
          pendingData: {
            net: 50,
            count: 1,
            hasIncoming: true,
            hasOutgoing: false,
          },
        } as any}
        currency={{
          format: (sats: number) => `${sats} sats`,
          formatFiat,
          showFiat: true,
        }}
      />
    );

    expect(screen.getByText('1000 sats')).toBeInTheDocument();
    expect(screen.getByText('$10.00')).toBeInTheDocument();
    expect(screen.queryByText('+$0.50')).not.toBeInTheDocument();
    expect(formatFiat).toHaveBeenCalledWith(50, { network: 'testnet' });
  });
});
