import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { CoinControlPanel } from '../../components/CoinControlPanel/CoinControlPanel';
import type { UTXO } from '../../types';

type UIStrategy = 'auto' | 'privacy' | 'manual' | 'consolidate';

// Mock the transactions API
vi.mock('../../src/api/transactions', () => ({
  getWalletPrivacy: vi.fn().mockResolvedValue({
    utxos: [
      {
        txid: 'abc123',
        vout: 0,
        score: { score: 85, grade: 'excellent' },
      },
      {
        txid: 'def456',
        vout: 1,
        score: { score: 60, grade: 'fair' },
      },
      {
        txid: 'ghi789',
        vout: 0,
        score: { score: 80, grade: 'good' },
      },
    ],
    summary: { averageScore: 75, grade: 'good' },
  }),
  analyzeSpendPrivacy: vi.fn().mockResolvedValue({
    score: 72,
    grade: 'good',
    linkedAddresses: 2,
    warnings: ['Spending from multiple addresses links them together'],
  }),
}));

// Mock the CurrencyContext
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    format: (sats: number) => `${sats.toLocaleString()} sats`,
    formatBtc: (sats: number) => `${(sats / 100000000).toFixed(8)} BTC`,
    currency: 'sats',
    setCurrency: vi.fn(),
    btcPrice: 50000,
  }),
}));

// Mock the logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('CoinControlPanel', () => {
  let mockOnToggleSelect: (utxoId: string) => void;
  let mockOnStrategyChange: (strategy: UIStrategy) => void;
  let mockOnSetSelectedUtxos: (utxoIds: Set<string>) => void;

  const mockUtxos: UTXO[] = [
    {
      id: 'utxo-1',
      txid: 'abc123',
      vout: 0,
      amount: 50000,
      address: 'bc1qexampleaddress1',
      confirmations: 6,
      frozen: false,
      scriptType: 'native_segwit',
    },
    {
      id: 'utxo-2',
      txid: 'def456',
      vout: 1,
      amount: 500, // dust at 10 sat/vB (68 vB input * 10 = 680 sats threshold)
      address: 'bc1qexampleaddress2',
      confirmations: 3,
      frozen: false,
      scriptType: 'native_segwit',
    },
    {
      id: 'utxo-3',
      txid: 'ghi789',
      vout: 0,
      amount: 100000,
      address: 'bc1qexampleaddress3',
      confirmations: 100,
      frozen: true,
      scriptType: 'native_segwit',
    },
  ];

  const mockLockedUtxo: UTXO = {
    id: 'utxo-4',
    txid: 'jkl012',
    vout: 0,
    amount: 75000,
    address: 'bc1qexampleaddress4',
    confirmations: 10,
    frozen: false,
    lockedByDraftId: 'draft-123',
    lockedByDraftLabel: 'Payment to Alice',
    scriptType: 'native_segwit',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnToggleSelect = vi.fn();
    mockOnStrategyChange = vi.fn();
    mockOnSetSelectedUtxos = vi.fn();
  });

  const renderPanel = (props: Partial<React.ComponentProps<typeof CoinControlPanel>> = {}) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <CoinControlPanel
          walletId="wallet-1"
          utxos={mockUtxos}
          selectedUtxos={new Set()}
          onToggleSelect={mockOnToggleSelect}
          onSetSelectedUtxos={mockOnSetSelectedUtxos}
          feeRate={10}
          targetAmount={0}
          strategy="auto"
          onStrategyChange={mockOnStrategyChange}
          {...props}
        />
      </QueryClientProvider>
    );
  };

  describe('Collapsed state', () => {
    it('starts collapsed by default', () => {
      renderPanel();

      // Should show collapsed header
      expect(screen.getByText(/Coin Control/)).toBeInTheDocument();
      // Should not show UTXO list
      expect(screen.queryByText('Select Inputs')).not.toBeInTheDocument();
    });

    it('shows "Coin Control (Auto)" when collapsed with no selection', () => {
      renderPanel({ strategy: 'auto', selectedUtxos: new Set() });

      expect(screen.getByText('Coin Control (Auto)')).toBeInTheDocument();
    });

    it('shows "Coin Control (3 selected)" when UTXOs selected', () => {
      renderPanel({
        selectedUtxos: new Set(['abc123:0', 'def456:1', 'ghi789:0']),
      });

      expect(screen.getByText('Coin Control (3 selected)')).toBeInTheDocument();
    });

    it('shows strategy name when no UTXOs selected', () => {
      renderPanel({ strategy: 'privacy', selectedUtxos: new Set() });

      expect(screen.getByText('Coin Control (Privacy)')).toBeInTheDocument();
    });

    it('shows selection count instead of strategy when UTXOs selected', () => {
      renderPanel({
        strategy: 'manual',
        selectedUtxos: new Set(['abc123:0']),
      });

      expect(screen.getByText('Coin Control (1 selected)')).toBeInTheDocument();
    });
  });

  describe('Expand/collapse behavior', () => {
    it('expands on click', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        // In auto mode, shows "Inputs (auto-selected)" instead of "Select Inputs"
        expect(screen.getByText('Inputs (auto-selected)')).toBeInTheDocument();
      });
    });

    it('shows strategy selector when expanded', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('Selection Strategy')).toBeInTheDocument();
        expect(screen.getByText('Auto')).toBeInTheDocument();
        expect(screen.getByText('Privacy')).toBeInTheDocument();
        expect(screen.getByText('Manual')).toBeInTheDocument();
        expect(screen.getByText('Consolidate')).toBeInTheDocument();
      });
    });

    it('collapses when clicking header again', async () => {
      renderPanel();

      // Expand
      fireEvent.click(screen.getByText(/Coin Control/));
      await waitFor(() => {
        expect(screen.getByText('Inputs (auto-selected)')).toBeInTheDocument();
      });

      // Collapse
      fireEvent.click(screen.getByText(/Coin Control/));
      await waitFor(() => {
        expect(screen.queryByText('Inputs (auto-selected)')).not.toBeInTheDocument();
      });
    });

    it('shows chevron icon in header', () => {
      renderPanel();

      const headerButton = screen.getByText(/Coin Control/).closest('button');
      expect(headerButton?.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('UTXO list rendering', () => {
    it('renders UTXO list when expanded', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('50,000 sats')).toBeInTheDocument();
        expect(screen.getByText('500 sats')).toBeInTheDocument();
        expect(screen.getByText('100,000 sats')).toBeInTheDocument();
      });
    });

    it('shows address prefix for each UTXO', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        // Address is truncated to 16 chars + "..."
        // bc1qexampleaddress1 (18 chars) -> bc1qexampleaddre... (16 chars + ...)
        // All 3 UTXOs have similar addresses so there should be 3 matches
        const addressElements = screen.getAllByText('bc1qexampleaddre...');
        expect(addressElements).toHaveLength(3);
      });
    });

    it('shows age for each UTXO', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      // Ages are calculated from confirmations (10 min per block):
      // 6 confs = 60 mins = 1h, 3 confs = 30 mins = 30m, 100 confs = 1000 mins ≈ 16h
      await waitFor(() => {
        expect(screen.getByText('1h')).toBeInTheDocument();
        expect(screen.getByText('30m')).toBeInTheDocument();
        expect(screen.getByText('16h')).toBeInTheDocument();
      });
    });
  });

  describe('UTXO selection', () => {
    it('toggles UTXO selection on click in manual mode', async () => {
      // UTXO selection is only allowed in manual mode
      renderPanel({ strategy: 'manual' });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('50,000 sats')).toBeInTheDocument();
      });

      // Click on the first UTXO row
      fireEvent.click(screen.getByText('50,000 sats').closest('div[class*="p-4"]')!);

      expect(mockOnToggleSelect).toHaveBeenCalledWith('abc123:0');
    });

    it('does not allow UTXO selection in non-manual mode', async () => {
      renderPanel({ strategy: 'privacy' });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('50,000 sats')).toBeInTheDocument();
      });

      // Click on the first UTXO row - should not toggle
      fireEvent.click(screen.getByText('50,000 sats').closest('div[class*="p-4"]')!);

      expect(mockOnToggleSelect).not.toHaveBeenCalled();
    });

    it('shows checkmark for selected UTXOs', async () => {
      renderPanel({
        selectedUtxos: new Set(['abc123:0']),
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        // There are 2 elements with "50,000 sats" - one in the UTXO list, one in the footer
        const satsElements = screen.getAllByText('50,000 sats');
        expect(satsElements.length).toBeGreaterThanOrEqual(1);
      });

      // Find the UTXO row (first element with "50,000 sats" in the list)
      const satsElements = screen.getAllByText('50,000 sats');
      // The UTXO list item should be the one with font-mono class
      const utxoAmountElement = satsElements.find(el => el.className.includes('font-mono'));
      const utxoRow = utxoAmountElement?.closest('div[class*="p-4"]');
      const checkbox = utxoRow?.querySelector('.bg-sanctuary-800');
      expect(checkbox).toBeInTheDocument();
    });

    it('shows selected count in header', async () => {
      renderPanel({
        selectedUtxos: new Set(['abc123:0', 'def456:1']),
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('2 selected')).toBeInTheDocument();
      });
    });
  });

  describe('Dust UTXO warning', () => {
    it('shows dust warning badge for dust UTXOs', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        // The 500 sats UTXO is dust at 10 sat/vB
        expect(screen.getByText('DUST')).toBeInTheDocument();
      });
    });

    it('does not show dust warning for non-dust UTXOs', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        // Should only have one DUST badge (for the 500 sats UTXO)
        const dustBadges = screen.getAllByText('DUST');
        expect(dustBadges).toHaveLength(1);
      });
    });

    it('does not show dust warning for frozen UTXOs', async () => {
      // Even if a frozen UTXO would be dust, we don't show the warning
      const frozenDustUtxos: UTXO[] = [
        {
          id: 'frozen-dust',
          txid: 'frozen123',
          vout: 0,
          amount: 100, // Would be dust
          address: 'bc1qfrozen',
          confirmations: 10,
          frozen: true,
          scriptType: 'native_segwit',
        },
      ];

      renderPanel({ utxos: frozenDustUtxos });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.queryByText('DUST')).not.toBeInTheDocument();
      });
    });
  });

  describe('Frozen UTXOs', () => {
    it('shows frozen indicator for frozen UTXOs', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('Frozen')).toBeInTheDocument();
      });
    });

    it('frozen UTXOs have reduced opacity', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        const frozenRow = screen.getByText('Frozen').closest('div[class*="p-4"]');
        expect(frozenRow?.className).toContain('opacity-70');
      });
    });

    it('frozen UTXOs cannot be selected', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('Frozen')).toBeInTheDocument();
      });

      // Click on frozen UTXO row
      const frozenRow = screen.getByText('Frozen').closest('div[class*="p-4"]');
      fireEvent.click(frozenRow!);

      // Should not have called toggle with the frozen UTXO's ID
      expect(mockOnToggleSelect).not.toHaveBeenCalledWith('ghi789:0');
    });
  });

  describe('Locked UTXOs', () => {
    it('shows draft label for locked UTXOs', async () => {
      renderPanel({
        utxos: [...mockUtxos, mockLockedUtxo],
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('Payment to Alice')).toBeInTheDocument();
      });
    });

    it('locked UTXOs cannot be selected', async () => {
      renderPanel({
        utxos: [mockLockedUtxo],
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('Payment to Alice')).toBeInTheDocument();
      });

      // Click on locked UTXO row
      const lockedRow = screen.getByText('Payment to Alice').closest('div[class*="p-4"]');
      fireEvent.click(lockedRow!);

      // Should not have called toggle
      expect(mockOnToggleSelect).not.toHaveBeenCalledWith('jkl012:0');
    });
  });

  describe('Disabled state', () => {
    it('header has opacity styling when disabled', () => {
      renderPanel({ disabled: true });

      const header = screen.getByText(/Coin Control/).closest('button');
      expect(header?.className).toContain('opacity-60');
    });

    it('header has cursor-not-allowed when disabled', () => {
      renderPanel({ disabled: true });

      const header = screen.getByText(/Coin Control/).closest('button');
      expect(header?.className).toContain('cursor-not-allowed');
    });
  });

  describe('Selected total footer', () => {
    it('shows selected total when UTXOs are selected (when expanded)', async () => {
      renderPanel({
        selectedUtxos: new Set(['abc123:0']),
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('Selected Total:')).toBeInTheDocument();
      });
    });

    it('calculates correct total for multiple selected UTXOs', async () => {
      renderPanel({
        selectedUtxos: new Set(['abc123:0', 'def456:1']),
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        // 50000 + 500 = 50500
        expect(screen.getByText('50,500 sats')).toBeInTheDocument();
      });
    });

    it('shows correct UTXO count in footer', async () => {
      renderPanel({
        selectedUtxos: new Set(['abc123:0', 'def456:1']),
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('2 UTXOs')).toBeInTheDocument();
      });
    });

    it('uses singular "UTXO" for single selection', async () => {
      renderPanel({
        selectedUtxos: new Set(['abc123:0']),
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('1 UTXO')).toBeInTheDocument();
      });
    });

    it('does not show footer when no UTXOs selected', async () => {
      renderPanel({
        strategy: 'manual',
        selectedUtxos: new Set(),
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('Select Inputs')).toBeInTheDocument();
      });

      expect(screen.queryByText('Selected Total:')).not.toBeInTheDocument();
    });
  });

  describe('Strategy change handling', () => {
    it('calls onStrategyChange when strategy button clicked', async () => {
      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('Privacy')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Privacy'));

      expect(mockOnStrategyChange).toHaveBeenCalledWith('privacy');
    });
  });

  describe('API integration', () => {
    it('calls getWalletPrivacy API on expand', async () => {
      const { getWalletPrivacy } = await import('../../src/api/transactions');

      renderPanel();

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(getWalletPrivacy).toHaveBeenCalledWith('wallet-1');
      });
    });

    it('does not call API when collapsed', async () => {
      const { getWalletPrivacy } = await import('../../src/api/transactions');

      renderPanel();

      // Don't expand - just check API wasn't called
      expect(getWalletPrivacy).not.toHaveBeenCalled();
    });
  });

  describe('Privacy card display', () => {
    it('shows privacy card when UTXOs selected and analysis completes', async () => {
      renderPanel({
        selectedUtxos: new Set(['abc123:0']),
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      // Wait for the debounced analysis to complete
      await waitFor(() => {
        expect(screen.getByText('Privacy Impact')).toBeInTheDocument();
      }, { timeout: 1000 });
    });

    it('does not show privacy card when no UTXOs selected', async () => {
      renderPanel({
        strategy: 'manual',
        selectedUtxos: new Set(),
      });

      fireEvent.click(screen.getByText(/Coin Control/));

      await waitFor(() => {
        expect(screen.getByText('Select Inputs')).toBeInTheDocument();
      });

      expect(screen.queryByText('Privacy Impact')).not.toBeInTheDocument();
    });

    it('handles rapid selection changes without race conditions', async () => {
      const analyzeSpendPrivacy = vi.fn();
      let resolvers: Array<(value: any) => void> = [];

      // Mock API to delay responses and let us control resolution order
      analyzeSpendPrivacy.mockImplementation(() => {
        return new Promise((resolve) => {
          resolvers.push(resolve);
        });
      });

      const mockModule = await import('../../src/api/transactions');
      vi.spyOn(mockModule, 'analyzeSpendPrivacy').mockImplementation(analyzeSpendPrivacy);

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <CoinControlPanel
            walletId="test-wallet"
            utxos={mockUtxos}
            selectedUtxos={new Set(['abc123:0'])}
            onToggleSelect={mockOnToggleSelect}
            onSetSelectedUtxos={vi.fn()}
            feeRate={10}
            targetAmount={50000}
            strategy="manual"
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText(/Coin Control/));

      // Wait for panel to expand and first request to start
      await waitFor(() => {
        expect(screen.getByText('Selection Strategy')).toBeInTheDocument();
      });

      // Wait for debounce and first API call
      await new Promise(resolve => setTimeout(resolve, 350));
      expect(analyzeSpendPrivacy).toHaveBeenCalledTimes(1);

      // Rapid second selection - should invalidate request 1 and start request 2
      rerender(
        <QueryClientProvider client={queryClient}>
          <CoinControlPanel
            walletId="test-wallet"
            utxos={mockUtxos}
            selectedUtxos={new Set(['abc123:0', 'def456:1'])}
            onToggleSelect={mockOnToggleSelect}
            onSetSelectedUtxos={vi.fn()}
            feeRate={10}
            targetAmount={50000}
            strategy="manual"
          />
        </QueryClientProvider>
      );

      // Wait for debounce and second API call
      await new Promise(resolve => setTimeout(resolve, 350));
      expect(analyzeSpendPrivacy).toHaveBeenCalledTimes(2);

      // Resolve request 1 (old, stale) - should be ignored
      resolvers[0]({
        score: 50,
        grade: 'poor',
        linkedAddresses: 10,
        warnings: ['STALE DATA - Should not appear'],
      });

      // Resolve request 2 (new, fresh) - should be used
      resolvers[1]({
        score: 80,
        grade: 'good',
        linkedAddresses: 2,
        warnings: ['Fresh data'],
      });

      // Wait for state updates
      await waitFor(() => {
        expect(screen.getByText('Privacy Impact')).toBeInTheDocument();
      });

      // Should show data from request 2 (latest), not request 1 (stale)
      expect(screen.queryByText('STALE DATA - Should not appear')).not.toBeInTheDocument();
      expect(screen.getByText('Fresh data')).toBeInTheDocument();
    });
  });
});
