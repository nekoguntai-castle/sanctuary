import { render,screen } from '@testing-library/react';
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
}));

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
      />
    );

    await user.click(screen.getByRole('button', { name: 'Trigger Wallet' }));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1');

    await user.click(screen.getByRole('button', { name: 'Trigger Tx' }));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-2?tx=abc123');
  });

  describe('section collapse', () => {
    const renderSection = (recentTx: any[] = [{ id: 'tx-a', walletId: 'wallet-1' }]) =>
      render(
        <RecentTransactions
          recentTx={recentTx as any}
          wallets={[] as any}
          confirmationThreshold={1}
          deepConfirmationThreshold={3}
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

    it('summarises the loaded rows while collapsed', async () => {
      const user = userEvent.setup();
      renderSection([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

      await user.click(disclosure());
      expect(screen.getByText('3 shown')).toBeInTheDocument();
    });

    it('says so plainly when there is nothing to summarise', async () => {
      const user = userEvent.setup();
      renderSection([]);

      await user.click(disclosure());
      expect(screen.getByText('No activity')).toBeInTheDocument();
    });
  });
});
