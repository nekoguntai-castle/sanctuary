import { cleanup,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { RecentTransactions } from '../../../src/components/Dashboard/RecentTransactions';

const mockNavigate = vi.fn();
const mockTransactionList = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../src/components/TransactionList', () => ({
  TransactionList: (props: any) => {
    mockTransactionList(props);
    return (
      <div data-testid="transaction-list">
        <button onClick={() => props.onWalletClick?.('wallet-1')}>Trigger Wallet</button>
        <button onClick={() => props.onTransactionClick?.({ id: 'tx-1', txid: 'abc123', walletId: 'wallet-2' })}>
          Trigger Tx
        </button>
      </div>
    );
  },
}));

const mockPreferences = new Map<string, unknown>();

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
  Activity: () => <span data-testid="activity-icon" />,
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
  ChevronUp: () => <span data-testid="chevron-up-icon" />,
  ChevronLeft: () => <span data-testid="chevron-left-icon" />,
  ChevronRight: () => <span data-testid="chevron-right-icon" />,
}));

const pagingProps = (overrides: Record<string, unknown> = {}) => ({
  page: 0,
  pageSize: 10,
  hasPreviousPage: false,
  hasNextPage: false,
  isFetching: false,
  onPageChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  ...overrides,
});

describe('RecentTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreferences.clear();
  });

  it('renders activity section and forwards props to TransactionList', () => {
    const recentTx = [{ id: 'tx-a', walletId: 'wallet-1' }] as any[];
    const wallets = [{ id: 'wallet-1', name: 'Main' }] as any[];

    render(
      <RecentTransactions
        recentTx={recentTx as any}
        wallets={wallets as any}
        confirmationThreshold={2}
        deepConfirmationThreshold={6}
        {...pagingProps()}
      />
    );

    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
    expect(screen.getByTestId('transaction-list')).toBeInTheDocument();

    const passed = mockTransactionList.mock.calls[0][0];
    expect(passed.transactions).toEqual(recentTx);
    expect(passed.wallets).toEqual(wallets);
    expect(passed.showWalletBadge).toBe(true);
    expect(passed.confirmationThreshold).toBe(2);
    expect(passed.deepConfirmationThreshold).toBe(6);
  });

  it('navigates on wallet and transaction callbacks', async () => {
    const user = userEvent.setup();
    render(
      <RecentTransactions
        recentTx={[] as any}
        wallets={[] as any}
        confirmationThreshold={1}
        deepConfirmationThreshold={3}
        {...pagingProps()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Trigger Wallet' }));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1');

    await user.click(screen.getByRole('button', { name: 'Trigger Tx' }));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-2?tx=abc123');
  });

  describe('pagination controls', () => {
    const renderPaged = (overrides: Record<string, unknown> = {}, rows = 3) =>
      render(
        <RecentTransactions
          recentTx={Array.from({ length: rows }, (_, i) => ({ id: `tx-${i}` })) as any}
          wallets={[] as any}
          confirmationThreshold={1}
          deepConfirmationThreshold={3}
          {...pagingProps(overrides)}
        />
      );

    it('hides the whole footer when everything fits on one page', () => {
      renderPaged({ hasPreviousPage: false, hasNextPage: false });

      // Not just the arrows: an Entries selector next to two dead arrows is
      // three controls all saying "there is nothing more".
      expect(screen.queryByTestId('activity-pagination')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Next activity page')).not.toBeInTheDocument();
      expect(screen.queryByText('Entries')).not.toBeInTheDocument();
    });

    it('shows the footer once a second page exists', () => {
      renderPaged({ hasNextPage: true });

      expect(screen.getByTestId('activity-pagination')).toBeInTheDocument();
      expect(screen.getByLabelText('Previous activity page')).toBeDisabled();
      expect(screen.getByLabelText('Next activity page')).toBeEnabled();
    });

    it('cannot page back from the first page or forward from a short last page', () => {
      renderPaged({ page: 0, hasPreviousPage: false, hasNextPage: true });
      expect(screen.getByLabelText('Previous activity page')).toBeDisabled();

      cleanup();

      renderPaged({ page: 3, hasPreviousPage: true, hasNextPage: false });
      expect(screen.getByLabelText('Next activity page')).toBeDisabled();
    });

    it('requests the neighbouring page on activation', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      renderPaged({ page: 2, hasPreviousPage: true, hasNextPage: true, onPageChange });

      await user.click(screen.getByLabelText('Next activity page'));
      expect(onPageChange).toHaveBeenCalledWith(3);

      await user.click(screen.getByLabelText('Previous activity page'));
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it('locks both arrows while a page is in flight', () => {
      renderPaged({ page: 1, hasPreviousPage: true, hasNextPage: true, isFetching: true });

      // A second click before the request settles would skip a page.
      expect(screen.getByLabelText('Previous activity page')).toBeDisabled();
      expect(screen.getByLabelText('Next activity page')).toBeDisabled();
    });

    it('offers the three page sizes and reports the chosen one', async () => {
      const user = userEvent.setup();
      const onPageSizeChange = vi.fn();
      renderPaged({ hasNextPage: true, onPageSizeChange });

      const select = screen.getByLabelText(/Entries/);
      expect(
        Array.from(select.querySelectorAll('option')).map(o => o.textContent)
      ).toEqual(['5', '10', '20']);

      await user.selectOptions(select, '20');
      expect(onPageSizeChange).toHaveBeenCalledWith(20);
    });

    it('states the visible range rather than inventing a total', () => {
      renderPaged({ page: 1, pageSize: 10, hasPreviousPage: true, hasNextPage: true }, 10);

      // The endpoint returns a page and never counts the set, so "of 57" would
      // be a number nothing produced.
      expect(screen.getAllByText('Showing 11–20').length).toBeGreaterThan(0);
    });
  });

  describe('section collapse', () => {
    const renderSection = (
      recentTx: any[] = [{ id: 'tx-a', walletId: 'wallet-1' }],
      overrides: Partial<ReturnType<typeof pagingProps>> = {}
    ) =>
      render(
        <RecentTransactions
          recentTx={recentTx as any}
          wallets={[] as any}
          confirmationThreshold={1}
          deepConfirmationThreshold={3}
          {...pagingProps(overrides)}
        />
      );

    const disclosure = () => screen.getByRole('button', { name: /Recent Activity/ });

    it('starts expanded with the activity body reachable', () => {
      renderSection();

      expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
      const body = document.getElementById(disclosure().getAttribute('aria-controls')!);
      expect(body).not.toBeNull();
      expect(body).not.toHaveAttribute('hidden');
      expect(screen.getByTestId('transaction-list')).toBeInTheDocument();
    });

    it('collapses on activation and persists under its own preference key', async () => {
      const user = userEvent.setup();
      renderSection();

      await user.click(disclosure());

      expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
      const body = document.getElementById(disclosure().getAttribute('aria-controls')!);
      expect(body).toHaveAttribute('hidden');
      expect(mockPreferences.get('viewSettings.dashboard.recentActivityCollapsed')).toBe(true);
      // The wallets section must not be dragged along with it.
      expect(mockPreferences.has('viewSettings.dashboard.walletsCollapsed')).toBe(false);
    });

    it('does not give the card shell a hover lift it cannot honour', () => {
      renderSection();

      const card = screen.getByTestId('dashboard-recent-activity');
      expect(card.className).not.toContain('card-interactive');
      // The disclosure remains a real control.
      expect(disclosure()).toBeInTheDocument();
    });

    it('honours a persisted collapsed preference on mount', () => {
      mockPreferences.set('viewSettings.dashboard.recentActivityCollapsed', true);
      renderSection();

      expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    });

    it('summarises the visible range while collapsed', async () => {
      const user = userEvent.setup();
      renderSection([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { page: 1, pageSize: 3 });

      await user.click(disclosure());
      // Truthful about position without inventing a total the endpoint never returns.
      expect(screen.getByText('Showing 4–6')).toBeInTheDocument();
    });

    it('says so plainly when there is nothing to summarise', async () => {
      const user = userEvent.setup();
      renderSection([]);

      await user.click(disclosure());
      expect(screen.getByText('No activity')).toBeInTheDocument();
    });
  });
});
