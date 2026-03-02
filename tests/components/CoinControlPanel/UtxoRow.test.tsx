import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UtxoRow } from '../../../components/CoinControlPanel/UtxoRow';

vi.mock('../../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (amount: number) => `${amount} sats`,
  }),
}));

vi.mock('../../../components/DustWarningBadge', () => ({
  DustWarningBadge: () => <span data-testid="dust-warning">dust</span>,
}));

vi.mock('../../../components/PrivacyBadge', () => ({
  PrivacyBadge: () => <span data-testid="privacy-badge">privacy</span>,
}));

vi.mock('../../../utils/utxoAge', () => ({
  calculateUTXOAge: () => ({ category: 'young', shortText: '2d' }),
  getAgeCategoryColor: () => 'text-sanctuary-500',
}));

describe('CoinControlPanel UtxoRow', () => {
  const baseUtxo = {
    txid: 'txid-1',
    vout: 0,
    address: 'bc1qexampleaddress1234567890',
    amount: 50_000,
    confirmations: 12,
    date: '2026-01-01T00:00:00Z',
    frozen: false,
    spent: false,
    spendable: true,
  } as any;

  it('renders utxo label when present and toggles by id', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <UtxoRow
        utxo={{ ...baseUtxo, label: 'Payroll', lockedByDraftId: 'draft-1', lockedByDraftLabel: 'Payroll Draft' }}
        isSelected={false}
        isDisabled={false}
        feeRate={2}
        strategy="manual"
        onToggle={onToggle}
      />
    );

    expect(screen.getByText('Payroll')).toBeInTheDocument();
    expect(screen.getByText('Payroll Draft')).toBeInTheDocument();

    fireEvent.click(container.firstChild as HTMLElement);
    expect(onToggle).toHaveBeenCalledWith('txid-1:0');
  });

  it('uses Draft fallback when locked label is missing and omits optional label', () => {
    render(
      <UtxoRow
        utxo={{ ...baseUtxo, label: '', lockedByDraftId: 'draft-2', lockedByDraftLabel: '' }}
        isSelected={false}
        isDisabled={false}
        feeRate={2}
        strategy="manual"
        onToggle={vi.fn()}
      />
    );

    expect(screen.queryByText('Payroll')).not.toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
});
