import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UtxoRow } from '../../../components/send/steps/OutputsStep/UtxoRow';

vi.mock('../../../utils/utxoAge', () => ({
  calculateUTXOAge: () => ({ category: 'aged', shortText: '2d' }),
  getAgeCategoryColor: () => 'text-sanctuary-500',
}));

vi.mock('../../../components/PrivacyBadge', () => ({
  PrivacyBadge: () => <span data-testid="privacy-badge">privacy</span>,
}));

describe('UtxoRow branch coverage', () => {
  const baseUtxo = {
    txid: 'txid-1',
    vout: 0,
    address: 'bc1qexampleaddress1234567890abcdefghij',
    amount: 50_000,
    confirmations: 2,
    date: '2026-01-01T00:00:00Z',
    frozen: false,
    spent: false,
    spendable: true,
  } as any;

  it('toggles selectable rows and renders low-confirmation branch without privacy badge', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <UtxoRow
        utxo={baseUtxo}
        selected={false}
        onToggle={onToggle}
        format={(amount) => `${amount} sats`}
        formatFiat={() => '$0.50'}
      />
    );

    fireEvent.click(container.firstChild as HTMLElement);

    expect(onToggle).toHaveBeenCalledWith('txid-1:0');
    expect(screen.getByText('2 conf')).toBeInTheDocument();
    expect(screen.queryByTestId('privacy-badge')).not.toBeInTheDocument();
  });

  it('does not toggle when row is not selectable', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <UtxoRow
        utxo={{ ...baseUtxo, txid: 'txid-2', vout: 1, confirmations: 12, frozen: true }}
        selectable={false}
        selected={false}
        privacyInfo={{ score: { grade: 'A', score: 90 } } as any}
        onToggle={onToggle}
        format={(amount) => `${amount} sats`}
        formatFiat={() => '$0.50'}
      />
    );

    fireEvent.click(container.firstChild as HTMLElement);

    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByTestId('privacy-badge')).toBeInTheDocument();
  });
});
