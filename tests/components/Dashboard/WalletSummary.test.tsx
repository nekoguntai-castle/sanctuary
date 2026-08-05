import { act,fireEvent,render,screen,within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { WalletSummary } from '../../../src/components/Dashboard/WalletSummary';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../src/components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats}</span>,
}));

const mockPreferences = new Map<string, unknown>();

// Stateful mock: the real hook re-renders on write, and the expand/collapse
// assertions depend on that. A plain map-backed stub would never re-render.
vi.mock('../../../src/hooks/useUserPreference', async () => {
  const { useState } = await import('react');
  return {
    useUserPreference: (key: string, defaultValue: unknown) => {
      const [value, setValue] = useState(
        mockPreferences.has(key) ? mockPreferences.get(key) : defaultValue
      );
      return [
        value,
        (newValue: unknown) => {
          mockPreferences.set(key, newValue);
          setValue(newValue);
        },
      ];
    },
  };
});

vi.mock('lucide-react', () => ({
  Wallet: () => <span data-testid="wallet-icon" />,
  ChevronRight: () => <span data-testid="chevron-right-icon" />,
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
  ChevronUp: () => <span data-testid="chevron-up-icon" />,
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
    mockPreferences.clear();
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

    // The name is a real link, so a click on it navigates via the router
    // rather than the row's convenience handler.
    const alphaLink = screen.getByRole('link', { name: 'Alpha' });
    expect(alphaLink).toHaveAttribute('href', '/wallets/w1');
    await user.click(alphaLink);
    expect(mockNavigate).not.toHaveBeenCalled();

    // Clicking elsewhere in the row still navigates.
    await user.click(screen.getByText('Multisig'));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/w2');
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

  it('mirrors hover-driven cross-highlight when a row is focused via keyboard', () => {
    const wallets = [
      { id: 'w1', name: 'Alpha', type: 'single_sig', balance: 5000, lastSyncStatus: 'success' },
      { id: 'w2', name: 'Beta', type: 'single_sig', balance: 5000, lastSyncStatus: 'success' },
    ] as any[];

    renderWalletSummary(
      <WalletSummary selectedNetwork="mainnet" filteredWallets={wallets} totalBalance={10000} />
    );

    const betaRow = screen.getByText('Beta').closest('tr') as HTMLTableRowElement;
    fireEvent.focus(betaRow);
    expect(screen.getByText('50.0% of total')).toBeInTheDocument();

    fireEvent.blur(betaRow);
    expect(screen.queryByText('50.0% of total')).not.toBeInTheDocument();
  });

  it('exposes each wallet as a real link rather than a focusable row', async () => {
    const user = userEvent.setup();
    const wallets = [
      { id: 'w1', name: 'Alpha', type: 'single_sig', balance: 5000, lastSyncStatus: 'success' },
    ] as any[];

    renderWalletSummary(
      <WalletSummary selectedNetwork="mainnet" filteredWallets={wallets} totalBalance={5000} />
    );

    const row = screen.getByText('Alpha').closest('tr') as HTMLTableRowElement;
    // The row is no longer a tab stop: the link is the real control, and a
    // focusable row on top of it would be a second, role-less stop for the
    // same destination.
    expect(row.hasAttribute('tabindex')).toBe(false);

    const link = screen.getByRole('link', { name: 'Alpha' });
    expect(link).toHaveAttribute('href', '/wallets/w1');

    // Enter on the focused link activates it natively; the row handler is
    // never involved.
    link.focus();
    expect(link).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('leaves modified clicks to the browser instead of navigating in place', async () => {
    const user = userEvent.setup();
    const wallets = [
      { id: 'w1', name: 'Alpha', type: 'single_sig', balance: 5000, lastSyncStatus: 'success' },
    ] as any[];

    renderWalletSummary(
      <WalletSummary selectedNetwork="mainnet" filteredWallets={wallets} totalBalance={5000} />
    );

    // navigate() has no modifier awareness, so a Cmd/Ctrl-click on the row must
    // be a no-op rather than silently discarding the current page.
    const balanceCell = screen.getAllByTestId('amount')[0];
    await user.keyboard('{Meta>}');
    await user.click(balanceCell);
    await user.keyboard('{/Meta}');
    expect(mockNavigate).not.toHaveBeenCalled();

    // An unmodified click on the same cell still navigates.
    await user.click(balanceCell);
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/w1');
  });

  const makeWallets = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `w${i}`,
      name: `Wallet ${i}`,
      type: 'single_sig',
      balance: 1000,
      lastSyncStatus: 'success',
    })) as any[];

  it('renders every wallet without a toggle at or below the row cap', () => {
    renderWalletSummary(
      <WalletSummary
        selectedNetwork="mainnet"
        filteredWallets={makeWallets(6)}
        totalBalance={6000}
      />
    );

    expect(screen.getByText('Wallet 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('truncates to the row cap and reveals the rest on toggle', async () => {
    const user = userEvent.setup();

    renderWalletSummary(
      <WalletSummary
        selectedNetwork="mainnet"
        filteredWallets={makeWallets(9)}
        totalBalance={9000}
      />
    );

    expect(screen.getByText('Wallet 5')).toBeInTheDocument();
    expect(screen.queryByText('Wallet 6')).not.toBeInTheDocument();

    // The distribution bar keeps every wallet even while the table is truncated.
    expect(document.querySelectorAll('.relative[style*="width"]')).toHaveLength(9);

    // Two chevrons now live in this card: the section disclosure in the header
    // and the row-cap toggle at the foot. They are deliberately separate
    // controls, so scope the icon assertions to the toggle rather than the
    // document — an unscoped query matches both.
    const toggle = screen.getByRole('button', { name: /Show all 9 wallets/ });
    expect(within(toggle).getByTestId('chevron-down-icon')).toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByText('Wallet 8')).toBeInTheDocument();
    const showLess = screen.getByRole('button', { name: /Show less/ });
    expect(within(showLess).getByTestId('chevron-up-icon')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show less/ }));
    expect(screen.queryByText('Wallet 8')).not.toBeInTheDocument();
  });

  describe('section collapse', () => {
    const disclosure = () => screen.getByRole('button', { name: /Wallets/ });

    const renderSection = (walletCount = 3) =>
      renderWalletSummary(
        <WalletSummary
          selectedNetwork="mainnet"
          filteredWallets={makeWallets(walletCount)}
          totalBalance={9000}
        />
      );

    it('starts expanded with the wallet body reachable', () => {
      renderSection();

      expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
      const body = document.getElementById(disclosure().getAttribute('aria-controls')!);
      expect(body).not.toHaveAttribute('hidden');
    });

    it('collapses under a key distinct from the row-cap preference', async () => {
      const user = userEvent.setup();
      renderSection();

      await user.click(disclosure());

      expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
      expect(mockPreferences.get('viewSettings.dashboard.walletsCollapsed')).toBe(true);
      // walletsExpanded still owns the six-row/all-rows choice and must not be
      // touched by whole-section disclosure.
      expect(mockPreferences.has('viewSettings.dashboard.walletsExpanded')).toBe(false);
    });

    it('summarises wallet count and total balance while collapsed', async () => {
      const user = userEvent.setup();
      renderSection(4);

      await user.click(disclosure());

      // Scoped to the summary: the mocked Amount renders a bare number, and the
      // wallet rows render amounts of their own.
      const summary = screen.getByText('4 wallets').parentElement!;
      expect(within(summary).getByTestId('amount')).toHaveTextContent('9000');
    });

    it('keeps the row-cap toggle working independently of section collapse', async () => {
      const user = userEvent.setup();
      renderSection(9);

      await user.click(screen.getByRole('button', { name: /Show all 9 wallets/ }));

      expect(screen.getByText('Wallet 8')).toBeInTheDocument();
      expect(mockPreferences.get('viewSettings.dashboard.walletsExpanded')).toBe(true);
      // Expanding rows must not have collapsed or disturbed the section itself.
      expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
      expect(mockPreferences.has('viewSettings.dashboard.walletsCollapsed')).toBe(false);
    });
  });

  it('honours a previously persisted expanded preference on mount', () => {
    mockPreferences.set('viewSettings.dashboard.walletsExpanded', true);

    renderWalletSummary(
      <WalletSummary
        selectedNetwork="mainnet"
        filteredWallets={makeWallets(9)}
        totalBalance={9000}
      />
    );

    expect(screen.getByText('Wallet 8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show less/ })).toBeInTheDocument();
  });

});
