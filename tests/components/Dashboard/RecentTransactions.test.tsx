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

vi.mock('lucide-react', () => ({
  Activity: () => <span data-testid="activity-icon" />,
}));

describe('RecentTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
