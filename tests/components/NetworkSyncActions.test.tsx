import { act,fireEvent,render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
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
    (syncApi.syncNetworkWallets as ReturnType<typeof vi.fn>).mockResolvedValue({ queued: 3 });
    (syncApi.resyncNetworkWallets as ReturnType<typeof vi.fn>).mockResolvedValue({
      queued: 3,
      acceptedWalletIds: ['w1', 'w2', 'w3'],
      deduplicatedWalletIds: [],
      rejectedWallets: [],
      indeterminateWallets: [],
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

      expect(screen.getByText('Queued 3 wallets for sync')).toBeInTheDocument();
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
