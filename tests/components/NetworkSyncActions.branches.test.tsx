import { act,fireEvent,render,screen } from '@testing-library/react';
import React from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { NetworkSyncActions } from '../../components/NetworkSyncActions';
import type { TabNetwork } from '../../components/NetworkTabs';
import * as syncApi from '../../src/api/sync';

vi.mock('../../src/api/sync', () => ({
  syncNetworkWallets: vi.fn(),
  resyncNetworkWallets: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  RefreshCw: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="icon-refresh" {...props} />
  ),
  AlertTriangle: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-testid="icon-alert" {...props} />
  ),
  X: (props: React.HTMLAttributes<HTMLSpanElement>) => <span data-testid="icon-x" {...props} />,
}));

const renderActions = (
  overrides: Partial<React.ComponentProps<typeof NetworkSyncActions>> = {}
) => {
  const onSyncStarted = vi.fn();
  render(
    <NetworkSyncActions
      network={'mainnet' as TabNetwork}
      walletCount={2}
      onSyncStarted={onSyncStarted}
      {...overrides}
    />
  );
  return { onSyncStarted };
};

describe('NetworkSyncActions branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(syncApi.syncNetworkWallets).mockResolvedValue({
      success: true,
      queued: 2,
      walletIds: ['w1', 'w2'],
    });
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValue({
      success: true,
      queued: 2,
      walletIds: ['w1', 'w2'],
      deletedTransactions: 25,
      skipped: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders singular sync message and clears it after timeout', async () => {
    vi.useFakeTimers();
    const { onSyncStarted } = renderActions({ walletCount: 1, network: 'testnet3' });
    vi.mocked(syncApi.syncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 1,
      walletIds: ['w1'],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync All Testnet3' }));
    });

    expect(screen.getByText('Queued 1 wallet for sync')).toBeInTheDocument();
    expect(onSyncStarted).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText('Queued 1 wallet for sync')).not.toBeInTheDocument();
  });

  it('renders fallback sync error for unknown error types', async () => {
    renderActions({ walletCount: 2, onSyncStarted: undefined });
    vi.mocked(syncApi.syncNetworkWallets).mockRejectedValueOnce({});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync All Mainnet' }));
    });

    expect(screen.getByText('Failed to queue wallets for sync')).toBeInTheDocument();
  });

  it('renders singular resync message and clears it after timeout', async () => {
    vi.useFakeTimers();
    const { onSyncStarted } = renderActions({ walletCount: 1 });
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      deletedTransactions: 2,
      queued: 1,
      walletIds: ['w1'],
      skipped: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText('Cleared 2 transactions. Queued 1 wallet for resync.')).toBeInTheDocument();
    expect(onSyncStarted).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(
      screen.queryByText('Cleared 2 transactions. Queued 1 wallet for resync.')
    ).not.toBeInTheDocument();
  });

  it('renders fallback resync error message for unknown error types', async () => {
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockRejectedValueOnce({});

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText('Failed to resync wallets')).toBeInTheDocument();
  });

  it('handles compact dialog close via Cancel and X controls', () => {
    renderActions({ compact: true, walletCount: 3 });

    fireEvent.click(screen.getByTitle('Full resync all Mainnet wallets'));
    expect(screen.getByText('Full Resync All Mainnet Wallets')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Full Resync All Mainnet Wallets')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Full resync all Mainnet wallets'));
    const xButton = screen.getAllByTestId('icon-x')[0].closest('button');
    expect(xButton).not.toBeNull();
    fireEvent.click(xButton as HTMLButtonElement);
    expect(screen.queryByText('Full Resync All Mainnet Wallets')).not.toBeInTheDocument();
  });

  it('applies compact disabled styling when no wallets are available', () => {
    renderActions({ compact: true, walletCount: 0 });

    const syncButton = screen.getByTitle('Sync all Mainnet wallets');
    const resyncButton = screen.getByTitle('Full resync all Mainnet wallets');

    expect(syncButton).toBeDisabled();
    expect(resyncButton).toBeDisabled();
    expect(syncButton).toHaveClass('cursor-not-allowed');
    expect(resyncButton).toHaveClass('cursor-not-allowed');
  });

  it('shows singular wallet wording in compact resync confirmation', () => {
    renderActions({ compact: true, walletCount: 1 });

    fireEvent.click(screen.getByTitle('Full resync all Mainnet wallets'));
    expect(screen.getByText('Clear all transaction history for 1 wallet')).toBeInTheDocument();
  });

  it('applies compact syncing state with spinner and disabled controls', async () => {
    vi.mocked(syncApi.syncNetworkWallets).mockImplementation(
      () => new Promise(() => undefined)
    );

    renderActions({ compact: true, walletCount: 2 });

    await act(async () => {
      fireEvent.click(screen.getByTitle('Sync all Mainnet wallets'));
    });
    expect(screen.getByTitle('Syncing...')).toBeDisabled();
    expect(screen.getByTestId('icon-refresh')).toHaveClass('animate-spin');
    expect(screen.getByTitle('Full resync all Mainnet wallets')).toBeDisabled();
  });

  it('applies compact resync state with pulse icon and disabled controls', async () => {
    vi.mocked(syncApi.resyncNetworkWallets).mockImplementation(
      () => new Promise(() => undefined)
    );

    renderActions({ compact: true, walletCount: 2 });

    fireEvent.click(screen.getByTitle('Full resync all Mainnet wallets'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });
    expect(screen.getByTitle('Resyncing...')).toBeDisabled();
    expect(screen.getAllByTestId('icon-alert').some(icon => icon.className.includes('animate-pulse'))).toBe(true);
    expect(screen.getByTitle('Sync all Mainnet wallets')).toBeDisabled();
  });
});
