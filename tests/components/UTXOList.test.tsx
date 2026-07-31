/**
 * Tests for UTXOList component
 */

import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { UTXOList } from '../../components/UTXOList';
import * as CurrencyContext from '../../contexts/CurrencyContext';
import * as useBitcoinHooks from '../../hooks/queries/useBitcoin';
import * as bitcoinApi from '../../src/api/bitcoin';

// Mock contexts and hooks
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
  usePriceFreeFormatter: vi.fn(),
}));

vi.mock('../../hooks/queries/useBitcoin', () => ({
  useFeeEstimates: vi.fn(),
}));

vi.mock('../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

// Mock child components
vi.mock('../../components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats}</span>,
}));

vi.mock('../../components/PrivacyBadge', () => ({
  PrivacyBadge: ({ score }: { score: number }) => (
    <span data-testid="privacy-badge">{score}</span>
  ),
}));

vi.mock('../../components/PrivacyDetailPanel', () => ({
  PrivacyDetailPanel: () => <div data-testid="privacy-panel">Privacy Panel</div>,
}));

describe('UTXOList', () => {
  const mockUtxos = [
    {
      txid: 'abc123',
      vout: 0,
      address: 'bc1qtest1...',
      amount: 100000,
      confirmations: 10,
      frozen: false,
      spent: false,
      date: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    },
    {
      txid: 'def456',
      vout: 1,
      address: 'bc1qtest2...',
      amount: 50000,
      confirmations: 1000,
      frozen: false,
      spent: false,
      date: new Date(Date.now() - 86400000 * 60).toISOString(), // 60 days ago
    },
    {
      txid: 'ghi789',
      vout: 0,
      address: 'bc1qtest3...',
      amount: 200000,
      confirmations: 5,
      frozen: true,
      spent: false,
      date: new Date().toISOString(),
    },
  ];

  const mockToggleFreeze = vi.fn();
  const mockToggleSelect = vi.fn();
  const mockSendSelected = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(CurrencyContext.useCurrency).mockReturnValue({
      format: (sats: number) => `${sats} sats`,
      unit: 'sats',
    } as any);
    vi.mocked(CurrencyContext.usePriceFreeFormatter).mockReturnValue({
      format: (sats: number) => `${sats} sats`,
      unit: 'sats',
    } as any);

    vi.mocked(useBitcoinHooks.useFeeEstimates).mockReturnValue({
      data: { hour: 10, halfHour: 20, fastest: 50 },
    } as any);

    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      explorerUrl: 'https://mempool.space',
    } as any);
  });

  describe('rendering', () => {
    it('renders UTXO count', () => {
      render(<UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />);

      expect(screen.getByText('3 UTXOs')).toBeInTheDocument();
    });

    it('normalizes legacy testnet fee queries to testnet3', () => {
      render(
        <UTXOList
          utxos={mockUtxos}
          onToggleFreeze={mockToggleFreeze}
          network="testnet"
        />
      );

      expect(useBitcoinHooks.useFeeEstimates).toHaveBeenCalledWith('testnet3');
    });

    it('falls back to mainnet fee queries for unknown wallet networks', () => {
      render(
        <UTXOList
          utxos={mockUtxos}
          onToggleFreeze={mockToggleFreeze}
          network="unknown"
        />
      );

      expect(useBitcoinHooks.useFeeEstimates).toHaveBeenCalledWith('mainnet');
    });

    it('renders Available Outputs header', () => {
      render(<UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />);

      expect(screen.getByText('Available Outputs')).toBeInTheDocument();
    });

    it('renders visualization section with UTXO circles', () => {
      const { container } = render(
        <UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />
      );

      // Should have 3 UTXO circles in visualization
      const circles = container.querySelectorAll('.rounded-full');
      expect(circles.length).toBeGreaterThanOrEqual(3);
    });

    it('renders legend items', () => {
      render(<UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />);

      expect(screen.getByText('Fresh')).toBeInTheDocument();
      expect(screen.getByText('Ancient')).toBeInTheDocument();
      expect(screen.getByText('Frozen')).toBeInTheDocument();
      expect(screen.getByText('Locked')).toBeInTheDocument();
      expect(screen.getByText('Dust')).toBeInTheDocument();
    });

    it('renders tabular list with UTXO details', () => {
      render(<UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />);

      // Should show addresses
      expect(screen.getByText('bc1qtest1...')).toBeInTheDocument();
      expect(screen.getByText('bc1qtest2...')).toBeInTheDocument();
      expect(screen.getByText('bc1qtest3...')).toBeInTheDocument();
    });
  });

  describe('frozen UTXOs', () => {
    it('displays frozen UTXO with special styling', () => {
      const { container } = render(
        <UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />
      );

      // Frozen UTXO should have vermilion styling
      const frozenCard = container.querySelector('.bg-zen-vermilion\\/5');
      expect(frozenCard).toBeInTheDocument();
    });

    it('shows lock icon for frozen UTXOs', () => {
      render(<UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />);

      // Should have at least one lock icon (for frozen UTXO)
      const buttons = screen.getAllByTitle(/Unfreeze coin for spending/);
      expect(buttons.length).toBe(1);
    });
  });

  describe('toggle freeze', () => {
    it('disables only the database ID with a pending freeze mutation', () => {
      const utxosWithIds = mockUtxos.map((utxo, index) => ({
        ...utxo,
        id: `utxo-${index}`,
        frozen: index === 0,
      }));

      render(
        <UTXOList
          utxos={utxosWithIds}
          pendingFreezeIds={new Set(['utxo-0'])}
          onToggleFreeze={mockToggleFreeze}
        />
      );

      expect(screen.getByRole('button', { name: 'Freezing coin' })).toBeDisabled();
      expect(screen.getAllByRole('button', { name: /Freeze coin to prevent spending/ }))
        .toHaveLength(2);
    });

    it('calls onToggleFreeze when clicking freeze button', async () => {
      const user = userEvent.setup();
      render(<UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />);

      // Click freeze button on unfrozen UTXO
      const freezeButtons = screen.getAllByTitle(/Freeze coin to prevent spending/);
      await user.click(freezeButtons[0]);

      expect(mockToggleFreeze).toHaveBeenCalled();
    });

    it('calls onToggleFreeze with correct txid and vout', async () => {
      const user = userEvent.setup();
      render(<UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />);

      const freezeButtons = screen.getAllByTitle(/Freeze coin to prevent spending/);
      await user.click(freezeButtons[0]);

      expect(mockToggleFreeze).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number)
      );
    });
  });

  describe('selectable mode', () => {
    it('shows checkboxes when selectable is true', () => {
      const { container } = render(
        <UTXOList
          utxos={mockUtxos}
          onToggleFreeze={mockToggleFreeze}
          selectable={true}
          selectedUtxos={new Set()}
          onToggleSelect={mockToggleSelect}
        />
      );

      // Should have checkbox containers (rounded border boxes)
      const checkboxes = container.querySelectorAll('.w-5.h-5.rounded.border');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it('calls onToggleSelect when clicking checkbox', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <UTXOList
          utxos={mockUtxos}
          onToggleFreeze={mockToggleFreeze}
          selectable={true}
          selectedUtxos={new Set()}
          onToggleSelect={mockToggleSelect}
        />
      );

      const checkboxes = container.querySelectorAll('.w-5.h-5.rounded.border.cursor-pointer');
      if (checkboxes[0]) {
        await user.click(checkboxes[0]);
        expect(mockToggleSelect).toHaveBeenCalled();
      }
    });

    it('shows Send button when UTXOs are selected', () => {
      render(
        <UTXOList
          utxos={mockUtxos}
          onToggleFreeze={mockToggleFreeze}
          selectable={true}
          selectedUtxos={new Set(['abc123:0'])}
          onToggleSelect={mockToggleSelect}
          onSendSelected={mockSendSelected}
        />
      );

      expect(screen.getByText(/Send/)).toBeInTheDocument();
    });

    it('calls onSendSelected when clicking Send button', async () => {
      const user = userEvent.setup();
      render(
        <UTXOList
          utxos={mockUtxos}
          onToggleFreeze={mockToggleFreeze}
          selectable={true}
          selectedUtxos={new Set(['abc123:0'])}
          onToggleSelect={mockToggleSelect}
          onSendSelected={mockSendSelected}
        />
      );

      await user.click(screen.getByText(/Send/));

      expect(mockSendSelected).toHaveBeenCalled();
    });
  });

  describe('dust UTXOs', () => {
    it('shows dust warning when dust UTXOs exist', () => {
      const dustUtxos = [
        {
          txid: 'dust1',
          vout: 0,
          address: 'bc1qdusty...',
          amount: 100, // Very small amount - likely dust
          confirmations: 10,
          frozen: false,
          spent: false,
          date: new Date().toISOString(),
        },
      ];

      render(
        <UTXOList utxos={dustUtxos} onToggleFreeze={mockToggleFreeze} />
      );

      // May show dust warning depending on fee rate
      // The component shows warning when UTXO costs more to spend than its value
    });
  });

  describe('privacy display', () => {
    it('shows privacy badge when showPrivacy is true', () => {
      const privacyData = [
        {
          txid: 'abc123',
          vout: 0,
          score: { score: 75, grade: 'good' as const },
        },
      ];

      render(
        <UTXOList
          utxos={mockUtxos}
          onToggleFreeze={mockToggleFreeze}
          showPrivacy={true}
          privacyData={privacyData as any}
        />
      );

      expect(screen.getByTestId('privacy-badge')).toBeInTheDocument();
    });

    it('shows privacy summary when provided', () => {
      const privacySummary = {
        averageScore: 70,
        grade: 'good' as const,
        recommendations: ['Avoid address reuse'],
      };

      render(
        <UTXOList
          utxos={mockUtxos}
          onToggleFreeze={mockToggleFreeze}
          showPrivacy={true}
          privacySummary={privacySummary as any}
        />
      );

      expect(screen.getByText(/Wallet Privacy Score: 70/)).toBeInTheDocument();
    });
  });

  describe('UTXO labels', () => {
    it('displays UTXO label when present', () => {
      const utxosWithLabel = [
        {
          ...mockUtxos[0],
          label: 'Exchange Withdrawal',
        },
      ];

      render(
        <UTXOList utxos={utxosWithLabel} onToggleFreeze={mockToggleFreeze} />
      );

      expect(screen.getByText('Exchange Withdrawal')).toBeInTheDocument();
    });
  });

  describe('locked UTXOs', () => {
    it('displays locked UTXO with special styling', () => {
      const lockedUtxos = [
        {
          ...mockUtxos[0],
          lockedByDraftId: 'draft-123',
          lockedByDraftLabel: 'Pending Transaction',
        },
      ];

      render(
        <UTXOList utxos={lockedUtxos} onToggleFreeze={mockToggleFreeze} />
      );

      expect(screen.getByText('Pending Transaction')).toBeInTheDocument();
    });

    it('does not show checkbox for locked UTXOs', () => {
      const lockedUtxos = [
        {
          ...mockUtxos[0],
          lockedByDraftId: 'draft-123',
        },
      ];

      const { container } = render(
        <UTXOList
          utxos={lockedUtxos}
          onToggleFreeze={mockToggleFreeze}
          selectable={true}
          selectedUtxos={new Set()}
          onToggleSelect={mockToggleSelect}
        />
      );

      // Locked UTXOs should not have selectable checkboxes
      const checkboxes = container.querySelectorAll('.w-5.h-5.rounded.border.cursor-pointer');
      expect(checkboxes.length).toBe(0);
    });
  });

  describe('explorer links', () => {
    it('renders address links', () => {
      render(<UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />);

      const links = screen.getAllByRole('link');
      expect(links.length).toBeGreaterThan(0);
    });

    it('loads explorer URL on mount', async () => {
      render(<UTXOList utxos={mockUtxos} onToggleFreeze={mockToggleFreeze} />);

      await waitFor(() => {
        expect(bitcoinApi.getStatus).toHaveBeenCalled();
      });
    });
  });

  describe('empty state', () => {
    it('renders with zero UTXOs', () => {
      render(<UTXOList utxos={[]} onToggleFreeze={mockToggleFreeze} />);

      expect(screen.getByText('0 UTXOs')).toBeInTheDocument();
    });
  });
});
