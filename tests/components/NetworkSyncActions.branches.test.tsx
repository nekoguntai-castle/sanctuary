import { act,fireEvent,render,screen } from '@testing-library/react';
import React from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { NetworkSyncActions } from '../../src/components/NetworkSyncActions';
import type { TabNetwork } from '../../src/components/NetworkTabs';
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

const WALLETS = [
  { id: 'w1', name: 'Alpha' },
  { id: 'w2', name: 'Beta' },
];

const renderActions = (
  overrides: Partial<React.ComponentProps<typeof NetworkSyncActions>> = {}
) => {
  const onSyncStarted = vi.fn();
  render(
    <NetworkSyncActions
      network={'mainnet' as TabNetwork}
      walletCount={2}
      wallets={WALLETS}
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
      requested: 2,
      merged: 0,
      rejected: 0,
      indeterminate: 0,
      walletIds: ['w1', 'w2'],
      outcomes: [
        { walletId: 'w1', status: 'requested', generation: 1, wakeup: 'enqueued' },
        { walletId: 'w2', status: 'requested', generation: 1, wakeup: 'enqueued' },
      ],
    });
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValue({
      success: true,
      queued: 2,
      walletIds: ['w1', 'w2'],
      acceptedWalletIds: ['w1', 'w2'],
      deduplicatedWalletIds: [],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [],
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
      requested: 1,
      merged: 0,
      rejected: 0,
      indeterminate: 0,
      walletIds: ['w1'],
      outcomes: [
        { walletId: 'w1', status: 'requested', generation: 2, wakeup: 'enqueued' },
      ],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync All Testnet3' }));
    });

    expect(screen.getByText('Requested sync for 1 new wallet.')).toBeInTheDocument();
    expect(onSyncStarted).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText('Requested sync for 1 new wallet.')).not.toBeInTheDocument();
  });

  it('renders fallback sync error for unknown error types', async () => {
    renderActions({ walletCount: 2, onSyncStarted: undefined });
    vi.mocked(syncApi.syncNetworkWallets).mockRejectedValueOnce({});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync All Mainnet' }));
    });

    expect(screen.getByText('Failed to queue wallets for sync')).toBeInTheDocument();
  });

  it('surfaces merged and deferred durable sync outcomes as a warning', async () => {
    renderActions();
    vi.mocked(syncApi.syncNetworkWallets).mockResolvedValueOnce({
      success: true,
      requested: 1,
      merged: 1,
      rejected: 0,
      indeterminate: 0,
      walletIds: ['w1', 'w2'],
      outcomes: [
        { walletId: 'w1', status: 'requested', generation: 3, wakeup: 'unavailable' },
        { walletId: 'w2', status: 'merged', generation: 7, wakeup: 'deferred_retry' },
      ],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync All Mainnet' }));
    });

    expect(screen.getByText(
      'Requested sync for 1 new wallet; 1 wallet merged with existing work; Alpha (saved for recovery); Beta (waiting for retry).',
    )).toHaveClass('text-warning-600');
  });

  it('does not present an all-merged sync batch as newly requested', async () => {
    renderActions();
    vi.mocked(syncApi.syncNetworkWallets).mockResolvedValueOnce({
      success: true,
      requested: 0,
      merged: 2,
      rejected: 0,
      indeterminate: 0,
      walletIds: ['w1', 'w2'],
      outcomes: [
        { walletId: 'w1', status: 'merged', generation: 3, wakeup: 'enqueued' },
        { walletId: 'w2', status: 'merged', generation: 7, wakeup: 'enqueued' },
      ],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync All Mainnet' }));
    });

    expect(screen.getByText(
      'Requested sync for 0 new wallets; 2 wallets merged with existing work.',
    )).toHaveClass('text-warning-600');
  });

  it('names every rejected and indeterminate wallet in a partial sync batch', async () => {
    renderActions();
    vi.mocked(syncApi.syncNetworkWallets).mockResolvedValueOnce({
      success: true,
      requested: 0,
      merged: 0,
      rejected: 1,
      indeterminate: 1,
      walletIds: ['w1', 'w2'],
      outcomes: [
        { walletId: 'w1', status: 'rejected', reason: 'blocked' },
        { walletId: 'w2', status: 'indeterminate', reason: 'admission_error' },
      ],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync All Mainnet' }));
    });

    expect(screen.getByText(
      'Requested sync for 0 new wallets; 1 wallet rejected: Alpha (wallet sync is temporarily gated); 1 wallet with unknown admission state: Beta (admission result unknown).',
    )).toHaveClass('text-warning-600');
  });

  it('preserves unknown server reason codes in partial sync diagnostics', async () => {
    renderActions();
    vi.mocked(syncApi.syncNetworkWallets).mockResolvedValueOnce({
      success: true,
      requested: 0,
      merged: 0,
      rejected: 1,
      indeterminate: 1,
      walletIds: ['w1', 'w2'],
      outcomes: [
        { walletId: 'w1', status: 'rejected', reason: 'future_rejection' },
        { walletId: 'w2', status: 'indeterminate', reason: 'future_unknown' },
      ],
    } as unknown as syncApi.NetworkSyncResult);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync All Mainnet' }));
    });

    expect(screen.getByText(
      'Requested sync for 0 new wallets; 1 wallet rejected: Alpha (future_rejection); 1 wallet with unknown admission state: Beta (future_unknown).',
    )).toHaveClass('text-warning-600');
  });

  it('renders singular resync message and clears it after timeout', async () => {
    vi.useFakeTimers();
    const { onSyncStarted } = renderActions({ walletCount: 1 });
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 1,
      walletIds: ['w1'],
      acceptedWalletIds: ['w1'],
      deduplicatedWalletIds: [],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText('Queued 1 wallet for resync.')).toBeInTheDocument();
    expect(onSyncStarted).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(
      screen.queryByText('Queued 1 wallet for resync.')
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

  it('surfaces partial full-resync enqueue results', async () => {
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 1,
      walletIds: ['w1'],
      acceptedWalletIds: ['w1'],
      deduplicatedWalletIds: [],
      rejectedWallets: [{ walletId: 'w2', reason: 'queue_error' }],
      indeterminateWallets: [],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText(
      'Queued 1 wallet for resync; 1 rejected: Beta (queue error).',
    )).toBeInTheDocument();
  });

  it('names durable full-resync requests that are awaiting queue recovery', async () => {
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 0,
      walletIds: [],
      acceptedWalletIds: ['w1'],
      deduplicatedWalletIds: ['w2'],
      deferredWalletIds: ['w1', 'w2'],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText(
      'Queued 0 wallets for resync; 2 awaiting queue recovery: Alpha, Beta.',
    )).toHaveClass('text-warning-600');
  });

  it('renders a rejection as an error, not a green success line', async () => {
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 1,
      walletIds: ['w1'],
      acceptedWalletIds: ['w1'],
      deduplicatedWalletIds: [],
      rejectedWallets: [{ walletId: 'w2', reason: 'queue_unavailable' }],
      indeterminateWallets: [],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(
      screen.getByText(/1 rejected: Beta \(queue unavailable\)/)
    ).toHaveClass('text-rose-600');
  });

  it('does not call a batch that queued nothing a success', async () => {
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 0,
      walletIds: ['w1', 'w2'],
      acceptedWalletIds: [],
      deduplicatedWalletIds: ['w1', 'w2'],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    const line = screen.getByText(
      'Queued 0 wallets for resync; 2 already queued: Alpha, Beta.'
    );
    expect(line).toHaveClass('text-warning-600');
    expect(line).not.toHaveClass('text-success-600');
  });

  it('keeps a non-success resync result on screen instead of timing it out', async () => {
    vi.useFakeTimers();
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 0,
      walletIds: ['w1', 'w2'],
      acceptedWalletIds: [],
      deduplicatedWalletIds: ['w1', 'w2'],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(
      screen.getByText('Queued 0 wallets for resync; 2 already queued: Alpha, Beta.')
    ).toBeInTheDocument();
  });

  it('surfaces deduplicated full-resync intentions', async () => {
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 1,
      walletIds: ['w1', 'w2'],
      acceptedWalletIds: ['w1'],
      deduplicatedWalletIds: ['w2'],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText(
      'Queued 1 wallet for resync; 1 already queued: Beta.',
    )).toBeInTheDocument();
  });

  it('surfaces indeterminate full-resync queue state without calling it rejected', async () => {
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 1,
      walletIds: ['w1'],
      acceptedWalletIds: ['w1'],
      deduplicatedWalletIds: [],
      rejectedWallets: [],
      indeterminateWallets: [{ walletId: 'w2', reason: 'queue_state_unknown' }],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText(
      'Queued 1 wallet for resync; 1 queue state unknown: Beta.',
    )).toBeInTheDocument();
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
  });

  // C5: a regtest wallet is rendered under the Mainnet tab but never reaches
  // findByNetworkWithSyncStatus, so a batch that omits it must say so.
  it('names wallets the batch could not reach at all', async () => {
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 1,
      walletIds: ['w1'],
      acceptedWalletIds: ['w1'],
      deduplicatedWalletIds: [],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [{ walletId: 'w2', reason: 'network_not_syncable' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText(
      'Queued 1 wallet for resync; 1 not on a syncable network: Beta.',
    )).toBeInTheDocument();
    // Not green: the user can see Beta in this tab and it was never queued.
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
  });

  it('prints an unrecognised rejection reason verbatim rather than blanking it', async () => {
    renderActions();
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 1,
      walletIds: ['w1'],
      acceptedWalletIds: ['w1'],
      deduplicatedWalletIds: [],
      rejectedWallets: [{ walletId: 'w2', reason: 'moon_phase' as never }],
      indeterminateWallets: [],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText(
      'Queued 1 wallet for resync; 1 rejected: Beta (moon_phase).',
    )).toBeInTheDocument();
  });

  it('names an unknown wallet id rather than dropping it', async () => {
    renderActions({ wallets: [] });
    vi.mocked(syncApi.resyncNetworkWallets).mockResolvedValueOnce({
      success: true,
      queued: 1,
      walletIds: ['w1'],
      acceptedWalletIds: ['w1'],
      deduplicatedWalletIds: ['w9'],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Full Resync All Mainnet' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resync All Wallets' }));
    });

    expect(screen.getByText(
      'Queued 1 wallet for resync; 1 already queued: w9.',
    )).toBeInTheDocument();
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
