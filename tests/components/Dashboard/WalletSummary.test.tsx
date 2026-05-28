import { act,render,screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { WalletSummary } from '../../../components/Dashboard/WalletSummary';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats}</span>,
}));

vi.mock('lucide-react', () => ({
  Wallet: () => <span data-testid="wallet-icon" />,
  ChevronRight: () => <span data-testid="chevron-right-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertTriangle: () => <span data-testid="alert-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Cpu: () => <span data-testid="cpu-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
}));

const renderWalletSummary = (ui: ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('WalletSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty-state row when no wallets exist', () => {
    renderWalletSummary(
      <WalletSummary selectedNetwork="testnet3" filteredWallets={[]} totalBalance={0} />
    );

    expect(screen.getByText('Testnet3 Wallets')).toBeInTheDocument();
    expect(screen.getByText(/No testnet3 wallets yet/i)).toBeInTheDocument();
  });

  it('renders wallet rows, sync states, and navigates on row click', async () => {
    const user = userEvent.setup();
    const wallets = [
      { id: 'w1', name: 'Alpha', type: 'single_sig', balance: 1000, syncInProgress: true },
      { id: 'w2', name: 'Beta', type: 'multi_sig', balance: 2000, lastSyncStatus: 'success', lastSyncedAt: new Date('2026-01-01T00:00:00Z').toISOString() },
      { id: 'w3', name: 'Gamma', type: 'single_sig', balance: 3000, lastSyncStatus: 'failed' },
      { id: 'w4', name: 'Delta', type: 'single_sig', balance: 4000, lastSyncedAt: new Date('2026-01-01T00:00:00Z').toISOString() },
      { id: 'w5', name: 'Epsilon', type: 'single_sig', balance: 5000 },
    ] as any[];

    renderWalletSummary(
      <WalletSummary
        selectedNetwork="mainnet"
        filteredWallets={wallets as any}
        totalBalance={15000}
      />
    );

    expect(screen.getByText('Mainnet Wallets')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Multisig')).toBeInTheDocument();
    expect(screen.getAllByText('Single Sig').length).toBeGreaterThan(0);

    expect(screen.getByText('Syncing in progress\u2026')).toBeInTheDocument();
    expect(screen.getByText('Sync failed')).toBeInTheDocument();
    expect(screen.getByText('Never synced')).toBeInTheDocument();
    expect(screen.getByText(/Last synced:/)).toBeInTheDocument();
    expect(screen.getByText(/Cached from/)).toBeInTheDocument();

    await user.click(screen.getByText('Alpha'));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/w1');
  });

  it('uses zero-percent distribution fallback and success title fallback when totals/sync timestamp are missing', () => {
    const wallets = [
      {
        id: 'w-zero',
        name: 'ZeroPercent',
        type: 'single_sig',
        balance: 12345,
        lastSyncStatus: 'success',
        lastSyncedAt: undefined,
      },
    ] as any[];

    const { container } = renderWalletSummary(
      <WalletSummary
        selectedNetwork="mainnet"
        filteredWallets={wallets as any}
        totalBalance={0}
      />
    );

    // Bar segment has min-width but 0% width style on wrapper
    const segment = container.querySelector('[style*="width: 0%"]') as HTMLElement;
    expect(segment).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
  });

  it('animates wallet distribution bars after mount', () => {
    vi.useFakeTimers();
    try {
      const wallets = [
        { id: 'w-animated', name: 'Animated', type: 'single_sig', balance: 5000 },
      ] as any[];

      const { container } = renderWalletSummary(
        <WalletSummary selectedNetwork="mainnet" filteredWallets={wallets} totalBalance={5000} />
      );

      const segment = container.querySelector('.relative[style*="width"]') as HTMLElement;
      expect(segment).toHaveStyle({ width: '0%', minWidth: '0px' });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(segment).toHaveStyle({ width: '100%', minWidth: '4px' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('triggers cross-highlight on bar segment and table row hover', async () => {
    const user = userEvent.setup();
    const wallets = [
      { id: 'w1', name: 'Alpha', type: 'single_sig', balance: 5000, lastSyncStatus: 'success' },
      { id: 'w2', name: 'Beta', type: 'single_sig', balance: 5000, lastSyncStatus: 'success' },
    ] as any[];

    const { container } = renderWalletSummary(
      <WalletSummary selectedNetwork="mainnet" filteredWallets={wallets} totalBalance={10000} />
    );

    // Hover the first bar segment to trigger onMouseEnter/onMouseLeave (lines 97-98)
    const barSegments = container.querySelectorAll('.relative[style*="width"]');
    expect(barSegments.length).toBe(2);

    await user.hover(barSegments[0]);
    // Tooltip should appear with percentage text
    expect(screen.getByText('50.0% of total')).toBeInTheDocument();

    await user.unhover(barSegments[0]);
    // Tooltip should disappear
    expect(screen.queryByText('50.0% of total')).not.toBeInTheDocument();

    // Hover a table row to trigger onMouseEnter/onMouseLeave (line 163)
    const betaRow = screen.getByText('Beta').closest('tr')!;
    await user.hover(betaRow);
    await user.unhover(betaRow);
  });
});
