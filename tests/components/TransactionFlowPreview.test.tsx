import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TransactionFlowPreview } from '../../components/TransactionFlowPreview';

const mockFormatFiat = vi.hoisted(() => vi.fn((sats: number) => `$${(sats / 100000).toFixed(2)}`));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats} sats`,
    formatFiat: mockFormatFiat,
    showFiat: true,
  }),
}));

describe('TransactionFlowPreview', () => {
  beforeEach(() => {
    mockFormatFiat.mockImplementation((sats: number) => `$${(sats / 100000).toFixed(2)}`);
  });

  it('returns null when no inputs and outputs', () => {
    const { container } = render(
      <TransactionFlowPreview
        inputs={[]}
        outputs={[]}
        fee={0}
        feeRate={1}
        totalInput={0}
        totalOutput={0}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders inputs, outputs, fee, and totals', () => {
    render(
      <TransactionFlowPreview
        inputs={[{ txid: 'tx1', vout: 0, address: 'bc1q1234567890abcdef', amount: 50000, label: 'Savings' }]}
        outputs={[
          { address: 'bc1qoutput1', amount: 30000 },
          { address: 'bc1qchange1', amount: 18000, isChange: true, label: 'Change' },
        ]}
        fee={2000}
        feeRate={5}
        totalInput={50000}
        totalOutput={48000}
        isEstimate={true}
      />
    );

    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('(est.)')).toBeInTheDocument();
    expect(screen.getByText('1 in')).toBeInTheDocument();
    expect(screen.getByText('2 out')).toBeInTheDocument();
    // ~50000 sats appears twice (input amount and total input) - use getAllByText
    expect(screen.getAllByText('~50000 sats')).toHaveLength(2);
    expect(screen.getByText('~30000 sats')).toBeInTheDocument();
    expect(screen.getByText('~18000 sats')).toBeInTheDocument();
    expect(screen.getByText('Fee (5 sat/vB)')).toBeInTheDocument();
    // Fee uses toLocaleString() which adds comma formatting
    expect(screen.getByText('~2,000 sats')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.getByText('change')).toBeInTheDocument();
    expect(screen.getByText('Change')).toBeInTheDocument();
    expect(screen.getByText('~48000 sats')).toBeInTheDocument();
  });

  it('renders no-input placeholder and hides fiat values when fiat formatter returns null', () => {
    mockFormatFiat.mockReturnValue(null);

    render(
      <TransactionFlowPreview
        inputs={[]}
        outputs={[{ address: 'bc1qoutputonly', amount: 12000 }]}
        fee={0}
        feeRate={1}
        totalInput={12000}
        totalOutput={12000}
      />
    );

    expect(screen.getByText('No inputs')).toBeInTheDocument();
    expect(screen.queryByText('$0.12')).not.toBeInTheDocument();
  });

  it('renders no-outputs placeholder when outputs are empty and fee is zero', () => {
    render(
      <TransactionFlowPreview
        inputs={[{ txid: 'tx-empty-out', vout: 1, address: 'bc1qinputonly', amount: 15000 }]}
        outputs={[]}
        fee={0}
        feeRate={1}
        totalInput={15000}
        totalOutput={0}
      />
    );

    expect(screen.getByText('No outputs')).toBeInTheDocument();
  });

  it('does not render no-outputs placeholder when fee exists', () => {
    render(
      <TransactionFlowPreview
        inputs={[{ txid: 'tx-fee', vout: 0, address: 'bc1qinputfee', amount: 18000 }]}
        outputs={[]}
        fee={500}
        feeRate={2}
        totalInput={18000}
        totalOutput={17500}
      />
    );

    expect(screen.getByText('Fee (2 sat/vB)')).toBeInTheDocument();
    expect(screen.queryByText('No outputs')).not.toBeInTheDocument();
  });
});
