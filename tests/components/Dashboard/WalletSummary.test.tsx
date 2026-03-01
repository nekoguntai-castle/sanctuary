import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
}));

describe('WalletSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty-state row when no wallets exist', () => {
    render(
      <WalletSummary selectedNetwork="testnet" filteredWallets={[]} totalBalance={0} />
    );

    expect(screen.getByText('Testnet Wallets')).toBeInTheDocument();
    expect(screen.getByText(/No testnet wallets found/i)).toBeInTheDocument();
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

    render(
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

    expect(screen.getByTitle('Syncing...')).toBeInTheDocument();
    expect(screen.getByTitle('Sync failed')).toBeInTheDocument();
    expect(screen.getByTitle('Never synced')).toBeInTheDocument();
    expect(screen.getByTitle(/Synced/)).toBeInTheDocument();
    expect(screen.getByTitle(/Cached from/)).toBeInTheDocument();

    await user.click(screen.getByText('Alpha'));
    expect(mockNavigate).toHaveBeenCalledWith('/wallets/w1');
  });
});
