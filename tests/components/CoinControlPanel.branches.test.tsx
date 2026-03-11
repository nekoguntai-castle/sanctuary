import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CoinControlPanel } from '../../components/CoinControlPanel/CoinControlPanel';
import type { UTXO } from '../../types';

const {
  mockGetWalletPrivacy,
  mockAnalyzeSpendPrivacy,
  mockSelectUtxos,
} = vi.hoisted(() => ({
  mockGetWalletPrivacy: vi.fn(),
  mockAnalyzeSpendPrivacy: vi.fn(),
  mockSelectUtxos: vi.fn(),
}));

vi.mock('../../src/api/transactions', () => ({
  getWalletPrivacy: (...args: unknown[]) => mockGetWalletPrivacy(...args),
  analyzeSpendPrivacy: (...args: unknown[]) => mockAnalyzeSpendPrivacy(...args),
  selectUtxos: (...args: unknown[]) => mockSelectUtxos(...args),
}));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats} sats`,
  }),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('CoinControlPanel branch coverage', () => {
  const utxos: UTXO[] = [
    {
      id: 'u1',
      txid: 'abc123',
      vout: 0,
      amount: 50_000,
      address: 'bc1qexampleaddress1',
      confirmations: 6,
      frozen: false,
      scriptType: 'native_segwit',
    },
    {
      id: 'u2',
      txid: 'zero000',
      vout: 1,
      amount: 0,
      address: 'bc1qexampleaddress2',
      confirmations: 3,
      frozen: false,
      scriptType: 'native_segwit',
    },
  ];

  const makeProps = (overrides: Partial<React.ComponentProps<typeof CoinControlPanel>> = {}) => ({
    walletId: 'wallet-1',
    utxos,
    selectedUtxos: new Set<string>(),
    onToggleSelect: vi.fn(),
    onSetSelectedUtxos: vi.fn(),
    feeRate: 10,
    targetAmount: 0,
    strategy: 'auto' as const,
    onStrategyChange: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWalletPrivacy.mockResolvedValue({
      utxos: [],
      summary: { averageScore: 0, grade: 'poor' },
    });
    mockAnalyzeSpendPrivacy.mockResolvedValue({
      score: 60,
      grade: 'fair',
      linkedAddresses: 1,
      warnings: [],
    });
    mockSelectUtxos.mockResolvedValue({
      selected: [{ txid: 'abc123', vout: 0 }],
      totalAmount: 50_000,
    });
  });

  it('clears selection instead of API selecting when target amount is zero', async () => {
    const props = makeProps({ targetAmount: 0 });
    render(<CoinControlPanel {...props} />);

    fireEvent.click(screen.getByText(/Coin Control/));
    await waitFor(() => {
      expect(screen.getByText('Selection Strategy')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Privacy'));
    expect(props.onStrategyChange).toHaveBeenCalledWith('privacy');
    expect(mockSelectUtxos).not.toHaveBeenCalled();

    const latestCall = (props.onSetSelectedUtxos as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(latestCall).toBeDefined();
    expect((latestCall?.[0] as Set<string>).size).toBe(0);
  });

  it('uses feeRate fallback of 1 when feeRate is zero for auto strategy selection', async () => {
    const props = makeProps({ targetAmount: 50_000, feeRate: 0 });
    render(<CoinControlPanel {...props} />);

    fireEvent.click(screen.getByText(/Coin Control/));
    await waitFor(() => {
      expect(screen.getByText('Selection Strategy')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Consolidate'));
    await waitFor(() => {
      expect(mockSelectUtxos).toHaveBeenCalledWith(
        'wallet-1',
        expect.objectContaining({
          amount: 50_000,
          feeRate: 1,
        })
      );
    });
  });

  it('shows strategy error message when API selection fails', async () => {
    mockSelectUtxos.mockRejectedValueOnce(new Error('selection backend failed'));
    const props = makeProps({ targetAmount: 50_000 });
    render(<CoinControlPanel {...props} />);

    fireEvent.click(screen.getByText(/Coin Control/));
    await waitFor(() => {
      expect(screen.getByText('Selection Strategy')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Privacy'));
    await waitFor(() => {
      expect(screen.getByText('selection backend failed')).toBeInTheDocument();
    });
  });

  it('switches expanded panel copy to locked mode when rerendered disabled and shows zero-total warning', async () => {
    const props = makeProps({
      strategy: 'manual',
      selectedUtxos: new Set(['zero000:1']),
    });
    const { rerender } = render(<CoinControlPanel {...props} />);

    fireEvent.click(screen.getByText(/Coin Control/));
    await waitFor(() => {
      expect(screen.getByText('Select Inputs')).toBeInTheDocument();
    });

    rerender(
      <CoinControlPanel
        {...props}
        disabled
      />
    );

    expect(screen.getByText('Selected Inputs (locked)')).toBeInTheDocument();
    expect(screen.getByText('Selected inputs have zero balance or are unspendable.')).toBeInTheDocument();
  });
});
