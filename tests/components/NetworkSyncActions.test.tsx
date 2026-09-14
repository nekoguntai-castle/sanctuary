import { act,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { NetworkSyncActions } from '../../src/components/NetworkSyncActions';
import { TabNetwork } from '../../src/components/NetworkTabs';

// Mock the sync API
vi.mock('../../src/api/sync', () => ({
  syncNetworkWallets: vi.fn(),
  resyncNetworkWallets: vi.fn(),
}));

import * as syncApi from '../../src/api/sync';

describe('NetworkSyncActions', () => {
  const mockOnSyncStarted = vi.fn();

  const defaultProps = {
    network: 'mainnet' as TabNetwork,
    walletCount: 3,
    onSyncStarted: mockOnSyncStarted,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (syncApi.syncNetworkWallets as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      requested: 3,
      merged: 0,
      walletIds: ['w1', 'w2', 'w3'],
      outcomes: [
        { walletId: 'w1', status: 'requested', generation: 1, wakeup: 'enqueued' },
        { walletId: 'w2', status: 'requested', generation: 1, wakeup: 'enqueued' },
        { walletId: 'w3', status: 'requested', generation: 1, wakeup: 'enqueued' },
      ],
    });
    (syncApi.resyncNetworkWallets as ReturnType<typeof vi.fn>).mockResolvedValue({
      queued: 3,
      acceptedWalletIds: ['w1', 'w2', 'w3'],
      deduplicatedWalletIds: [],
      rejectedWallets: [],
      indeterminateWallets: [],
      excludedWallets: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Rendering', () => {
    it('should render sync and resync buttons', () => {
      render(<NetworkSyncActions {...defaultProps} />);

      expect(screen.getByText('Sync All Mainnet')).toBeInTheDocument();
      expect(screen.getByText('Full Resync All Mainnet')).toBeInTheDocument();
    });

    it('should display correct network label', () => {
      render(<NetworkSyncActions {...defaultProps} network="testnet3" />);

      expect(screen.getByText('Sync All Testnet3')).toBeInTheDocument();
      expect(screen.getByText('Full Resync All Testnet3')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const { container } = render(
        <NetworkSyncActions {...defaultProps} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('Disabled state', () => {
    it('should disable buttons when walletCount is 0', () => {
      render(<NetworkSyncActions {...defaultProps} walletCount={0} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');

      expect(syncButton).toBeDisabled();
      expect(resyncButton).toBeDisabled();
    });

    it('should enable buttons when walletCount is greater than 0', () => {
      render(<NetworkSyncActions {...defaultProps} walletCount={5} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');

      expect(syncButton).not.toBeDisabled();
      expect(resyncButton).not.toBeDisabled();
    });
  });

  describe('Sync functionality', () => {
    it('should call syncNetworkWallets API when sync button is clicked', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      expect(syncApi.syncNetworkWallets).toHaveBeenCalledWith('mainnet');
    });

    it('should show loading state while syncing', async () => {
      // Make the API call hang
      (syncApi.syncNetworkWallets as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {})
      );

      render(<NetworkSyncActions {...defaultProps} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      expect(screen.getByText('Syncing...')).toBeInTheDocument();
    });

    it('should call onSyncStarted callback on successful sync', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      expect(mockOnSyncStarted).toHaveBeenCalled();
    });

    it('should show success message after sync', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      expect(screen.getByText('Requested sync for 3 new wallets.')).toBeInTheDocument();
    });

    it('should show error message on sync failure', async () => {
      (syncApi.syncNetworkWallets as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      render(<NetworkSyncActions {...defaultProps} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  describe('Resync functionality', () => {
    it('should show confirmation dialog when resync button is clicked', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');
      fireEvent.click(resyncButton!);

      expect(screen.getByText('Full Resync All Mainnet Wallets')).toBeInTheDocument();
      expect(screen.getByText(/Clear all transaction history/)).toBeInTheDocument();
    });

    it('should close dialog when cancel is clicked', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');
      fireEvent.click(resyncButton!);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(screen.queryByText('Full Resync All Mainnet Wallets')).not.toBeInTheDocument();
    });

    it('should close dialog when X button is clicked', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');
      fireEvent.click(resyncButton!);

      // Find the close button (X icon button)
      const closeButton = screen.getByRole('button', { name: '' });
      fireEvent.click(closeButton);

      expect(screen.queryByText('Full Resync All Mainnet Wallets')).not.toBeInTheDocument();
    });

    it('should call resyncNetworkWallets API when confirmed', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      // Open dialog
      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');
      fireEvent.click(resyncButton!);

      // Confirm
      const confirmButton = screen.getByText('Resync All Wallets');
      await act(async () => {
        fireEvent.click(confirmButton);
      });

      expect(syncApi.resyncNetworkWallets).toHaveBeenCalledWith('mainnet');
    });

    it('should show success message after resync', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      // Open dialog
      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');
      fireEvent.click(resyncButton!);

      // Confirm
      const confirmButton = screen.getByText('Resync All Wallets');
      await act(async () => {
        fireEvent.click(confirmButton);
      });

      expect(screen.getByText('Queued 3 wallets for resync.')).toBeInTheDocument();
    });

    it('should call onSyncStarted callback on successful resync', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      // Open dialog
      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');
      fireEvent.click(resyncButton!);

      // Confirm
      const confirmButton = screen.getByText('Resync All Wallets');
      await act(async () => {
        fireEvent.click(confirmButton);
      });

      expect(mockOnSyncStarted).toHaveBeenCalled();
    });
  });

  describe('Cross-network state isolation', () => {
    it('does not leak Sync All spinner or result into a network switched to mid-flight', async () => {
      let resolveSync: ((value: syncApi.NetworkSyncResult) => void) | undefined;
      (syncApi.syncNetworkWallets as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<syncApi.NetworkSyncResult>((resolve) => {
          resolveSync = resolve;
        })
      );

      const { rerender } = render(<NetworkSyncActions {...defaultProps} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      expect(screen.getByText('Syncing...')).toBeInTheDocument();

      // Switch to testnet before the mainnet sync resolves. Testnet never
      // started a sync, so it must not inherit mainnet's spinner.
      rerender(<NetworkSyncActions {...defaultProps} network="testnet3" />);

      expect(screen.getByText('Sync All Testnet3')).toBeInTheDocument();
      expect(screen.queryByText('Syncing...')).not.toBeInTheDocument();

      await act(async () => {
        resolveSync?.({
          success: true,
          requested: 3,
          merged: 0,
          rejected: 0,
          indeterminate: 0,
          walletIds: ['w1', 'w2', 'w3'],
          outcomes: [
            { walletId: 'w1', status: 'requested', generation: 1, wakeup: 'enqueued' },
            { walletId: 'w2', status: 'requested', generation: 1, wakeup: 'enqueued' },
            { walletId: 'w3', status: 'requested', generation: 1, wakeup: 'enqueued' },
          ],
        });
      });

      // The mainnet result banner must not render under testnet.
      expect(screen.queryByText(/Requested sync for 3 new wallets/)).not.toBeInTheDocument();
      expect(screen.getByText('Sync All Testnet3')).toBeInTheDocument();
      expect(screen.queryByText('Syncing...')).not.toBeInTheDocument();
    });

    it('does not leak a Sync All error into a network switched to before rejection', async () => {
      let rejectSync: ((reason: unknown) => void) | undefined;
      (syncApi.syncNetworkWallets as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<syncApi.NetworkSyncResult>((_resolve, reject) => {
          rejectSync = reject;
        })
      );

      const { rerender } = render(<NetworkSyncActions {...defaultProps} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      rerender(<NetworkSyncActions {...defaultProps} network="testnet3" />);

      await act(async () => {
        rejectSync?.(new Error('Network error'));
      });

      // The mainnet failure must not render as a testnet error banner.
      expect(screen.queryByText('Network error')).not.toBeInTheDocument();
      expect(screen.getByText('Sync All Testnet3')).toBeInTheDocument();
    });

    it('does not leak Resync All spinner or result into a network switched to mid-flight', async () => {
      let resolveResync: ((value: syncApi.NetworkResyncResult) => void) | undefined;
      (syncApi.resyncNetworkWallets as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<syncApi.NetworkResyncResult>((resolve) => {
          resolveResync = resolve;
        })
      );

      const { rerender } = render(<NetworkSyncActions {...defaultProps} />);

      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');
      fireEvent.click(resyncButton!);

      const confirmButton = screen.getByText('Resync All Wallets');
      await act(async () => {
        fireEvent.click(confirmButton);
      });

      expect(screen.getByText('Resyncing...')).toBeInTheDocument();

      // Switch to testnet before the mainnet resync resolves.
      rerender(<NetworkSyncActions {...defaultProps} network="testnet3" />);

      expect(screen.getByText('Full Resync All Testnet3')).toBeInTheDocument();
      expect(screen.queryByText('Resyncing...')).not.toBeInTheDocument();

      await act(async () => {
        resolveResync?.({
          success: true,
          queued: 3,
          walletIds: ['w1', 'w2', 'w3'],
          acceptedWalletIds: ['w1', 'w2', 'w3'],
          deduplicatedWalletIds: [],
          rejectedWallets: [],
          indeterminateWallets: [],
          excludedWallets: [],
        });
      });

      // The mainnet resync banner must not render under testnet.
      expect(screen.queryByText(/Queued 3 wallets for resync/)).not.toBeInTheDocument();
      expect(screen.getByText('Full Resync All Testnet3')).toBeInTheDocument();
      expect(screen.queryByText('Resyncing...')).not.toBeInTheDocument();
    });

    it('clears a pending auto-clear timer when the network changes, so it cannot clear a later result', async () => {
      const { rerender } = render(<NetworkSyncActions {...defaultProps} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      // The mainnet success armed a 5s auto-clear timer (deadline t=5000).
      expect(screen.getByText('Requested sync for 3 new wallets.')).toBeInTheDocument();

      rerender(<NetworkSyncActions {...defaultProps} network="testnet3" />);
      expect(screen.queryByText('Requested sync for 3 new wallets.')).not.toBeInTheDocument();

      // Wait past the point where testnet's own sync starts, then run one.
      // It shows its own banner and arms its own 5s timer (deadline t=8000).
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      const testnetSyncButton = screen.getByText('Sync All Testnet3').closest('button');
      await act(async () => {
        fireEvent.click(testnetSyncButton!);
      });

      expect(screen.getByText('Requested sync for 3 new wallets.')).toBeInTheDocument();

      // t=5000: the leaked mainnet timer's original deadline. If the switch
      // had not cancelled it, it would fire here and wipe testnet's fresh
      // result 3s early.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByText('Requested sync for 3 new wallets.')).toBeInTheDocument();

      // t=8000: testnet's own deadline — now it is correct for the result to clear.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.queryByText('Requested sync for 3 new wallets.')).not.toBeInTheDocument();
    });

    it('does not leak a Resync All error into a network switched to before rejection', async () => {
      let rejectResync: ((reason: unknown) => void) | undefined;
      (syncApi.resyncNetworkWallets as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<syncApi.NetworkResyncResult>((_resolve, reject) => {
          rejectResync = reject;
        })
      );

      const { rerender } = render(<NetworkSyncActions {...defaultProps} />);

      const resyncButton = screen.getByText('Full Resync All Mainnet').closest('button');
      fireEvent.click(resyncButton!);

      const confirmButton = screen.getByText('Resync All Wallets');
      await act(async () => {
        fireEvent.click(confirmButton);
      });

      rerender(<NetworkSyncActions {...defaultProps} network="testnet3" />);

      await act(async () => {
        rejectResync?.(new Error('Network error'));
      });

      // The mainnet failure must not render as a testnet error banner.
      expect(screen.queryByText('Network error')).not.toBeInTheDocument();
      expect(screen.getByText('Full Resync All Testnet3')).toBeInTheDocument();
      expect(screen.queryByText('Resyncing...')).not.toBeInTheDocument();
    });

    it('a second sync on the same network cancels the first sync auto-clear timer', async () => {
      render(<NetworkSyncActions {...defaultProps} />);

      const syncButton = screen.getByText('Sync All Mainnet').closest('button');

      // First sync at t=0 arms an auto-clear timer for t=5000.
      await act(async () => {
        fireEvent.click(syncButton!);
      });
      expect(screen.getByText('Requested sync for 3 new wallets.')).toBeInTheDocument();

      // Second sync at t=2000 must cancel the first timer and arm its own,
      // for t=7000 — not leave the first timer free to fire at t=5000.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      await act(async () => {
        fireEvent.click(syncButton!);
      });
      expect(screen.getByText('Requested sync for 3 new wallets.')).toBeInTheDocument();

      // t=5000: the first timer's original deadline. The result must survive.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText('Requested sync for 3 new wallets.')).toBeInTheDocument();

      // t=7000: the second timer's deadline — now the result correctly clears.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByText('Requested sync for 3 new wallets.')).not.toBeInTheDocument();
    });
  });

  describe('Different networks', () => {
    it('should work with testnet3', async () => {
      render(<NetworkSyncActions {...defaultProps} network="testnet3" />);

      const syncButton = screen.getByText('Sync All Testnet3').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      expect(syncApi.syncNetworkWallets).toHaveBeenCalledWith('testnet3');
    });

    it('should work with signet', async () => {
      render(<NetworkSyncActions {...defaultProps} network="signet" />);

      const syncButton = screen.getByText('Sync All Signet').closest('button');
      await act(async () => {
        fireEvent.click(syncButton!);
      });

      expect(syncApi.syncNetworkWallets).toHaveBeenCalledWith('signet');
    });
  });
});
