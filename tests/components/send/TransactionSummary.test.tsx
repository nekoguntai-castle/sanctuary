import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TransactionSummary } from '../../../components/send/steps/review/TransactionSummary';

vi.mock('../../../components/TransactionFlowPreview', () => ({
  TransactionFlowPreview: (props: any) => (
    <div data-testid="tx-flow-preview">{props.isEstimate ? 'estimate' : 'final'}</div>
  ),
}));

vi.mock('../../../components/FiatDisplay', () => ({
  FiatDisplay: ({ sats }: { sats: number }) => <span>{`fiat:${sats}`}</span>,
}));

function buildProps(overrides: Record<string, unknown> = {}) {
  const goToStep = vi.fn();
  return {
    state: {
      transactionType: 'standard',
      feeRate: 3,
      outputs: [
        { address: 'bc1qrecipient0', amount: '1200', sendMax: true },
        { address: 'bc1qrecipient1', amount: '800', sendMax: false },
      ],
      payjoinUrl: 'https://payjoin.example',
      rbfEnabled: true,
      useDecoys: true,
      decoyCount: 2,
      showCoinControl: true,
      selectedUTXOs: new Set(['u1', 'u2']),
    } as any,
    flowData: {
      inputs: [{ label: 'in-1', amount: 2400 }],
      outputs: [{ label: 'out-1', amount: 2000 }],
      totalInput: 2400,
      totalOutput: 2000,
      fee: 400,
    },
    txData: null,
    payjoinStatus: 'pending',
    changeAmount: 300,
    selectedTotal: 2400,
    estimatedFee: 400,
    totalOutputAmount: 2000,
    txTypeLabel: 'Standard Send',
    isDraftMode: false,
    format: (sats: number) => `${sats} sats`,
    goToStep,
    ...overrides,
  };
}

describe('TransactionSummary', () => {
  it('renders review mode summary and triggers edit callbacks', () => {
    const props = buildProps();
    render(<TransactionSummary {...props} />);

    expect(screen.getByText('Review Transaction')).toBeInTheDocument();
    expect(screen.getByTestId('tx-flow-preview')).toHaveTextContent('estimate');
    expect(screen.getByText('Payjoin enabled')).toBeInTheDocument();
    expect(screen.getByText('2000 sats')).toBeInTheDocument();
    expect(screen.getByText('2400 sats')).toBeInTheDocument();
    expect(screen.getAllByText('Change').length).toBeGreaterThan(0);
    expect(screen.getByText('Decoy Outputs')).toBeInTheDocument();
    expect(screen.getByText('2 UTXOs selected')).toBeInTheDocument();
    expect(screen.getByText('RBF (Replace-By-Fee)')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const editButtons = screen.getAllByText('Edit');
    fireEvent.click(editButtons[0]);
    fireEvent.click(editButtons[1]);

    expect(props.goToStep).toHaveBeenCalledWith('type');
    expect(props.goToStep).toHaveBeenCalledWith('outputs');
  });

  it('renders draft mode with locked parameters and fallback payjoin text', () => {
    const props = buildProps({
      state: {
        transactionType: 'consolidation',
        feeRate: 2,
        outputs: [{ address: 'bc1qdraft', amount: '500', sendMax: false }],
        payjoinUrl: 'https://payjoin.example',
        rbfEnabled: false,
        useDecoys: false,
        decoyCount: 0,
        showCoinControl: false,
        selectedUTXOs: new Set(['u1']),
      },
      txData: { fee: 150 },
      payjoinStatus: 'failed',
      changeAmount: 0,
      selectedTotal: 1000,
      estimatedFee: 200,
      totalOutputAmount: 500,
      txTypeLabel: 'Consolidation',
      isDraftMode: true,
    });
    render(<TransactionSummary {...props} />);

    expect(screen.getByText('Resume Draft')).toBeInTheDocument();
    expect(screen.getByText('Saved Draft - Parameters Locked')).toBeInTheDocument();
    expect(screen.getByTestId('tx-flow-preview')).toHaveTextContent('final');
    expect(screen.getByText('Payjoin (fallback)')).toBeInTheDocument();
    expect(screen.getAllByText('500 sats').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('650 sats')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();

    expect(screen.queryByText('Change')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Decoy Outputs')).not.toBeInTheDocument();
    expect(screen.queryByText('Coin Control')).not.toBeInTheDocument();
  });

  it('hides flow preview when inputs or outputs are empty and handles singular UTXO label', () => {
    const props = buildProps({
      state: {
        transactionType: 'standard',
        feeRate: 1,
        outputs: [{ address: '', amount: '0', sendMax: false }],
        payjoinUrl: '',
        rbfEnabled: true,
        useDecoys: false,
        decoyCount: 0,
        showCoinControl: true,
        selectedUTXOs: new Set(['only-one']),
      },
      flowData: {
        inputs: [],
        outputs: [],
        totalInput: 0,
        totalOutput: 0,
        fee: 0,
      },
      changeAmount: 0,
      selectedTotal: 0,
      estimatedFee: 10,
      totalOutputAmount: 0,
    });
    render(<TransactionSummary {...props} />);

    expect(screen.queryByTestId('tx-flow-preview')).not.toBeInTheDocument();
    expect(screen.getByText('(no address)')).toBeInTheDocument();
    expect(screen.getByText('1 UTXO selected')).toBeInTheDocument();
  });
});
