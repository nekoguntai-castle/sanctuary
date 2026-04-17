import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  createWalletData,
  mocks,
  WalletDetailComponent as WalletDetail,
} from './WalletDetailWrapperTestHarness';

export const registerWalletDetailWrapperStateContracts = () => {
  describe('state and route handling', () => {
    it('shows loading, error, and no-wallet fallback states', async () => {
      const user = userEvent.setup();

      mocks.walletDataState = createWalletData({ loading: true, wallet: null });
      const { rerender } = render(<WalletDetail />);
      expect(screen.getByText('Loading wallet...')).toBeInTheDocument();

      mocks.walletDataState = createWalletData({ loading: false, error: 'boom', wallet: null });
      rerender(<WalletDetail />);
      expect(screen.getByText('Failed to Load Wallet')).toBeInTheDocument();
      expect(screen.getByText('boom')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /retry/i }));
      expect(mocks.setError).toHaveBeenCalledWith(null);
      expect(mocks.fetchData).toHaveBeenCalled();

      mocks.walletDataState = createWalletData({ loading: false, error: null, wallet: null });
      rerender(<WalletDetail />);
      expect(screen.getByText('Loading wallet...')).toBeInTheDocument();
    });

    it('applies location-driven active tab changes and stats data bootstrap', async () => {
      mocks.locationState = { activeTab: 'stats' };
      mocks.walletDataState = createWalletData({
        utxoStats: [],
        loadingUtxoStats: false,
      });
      const { rerender } = render(<WalletDetail />);

      expect(screen.getByTestId('stats-tab')).toBeInTheDocument();
      expect(mocks.loadUtxosForStats).toHaveBeenCalledWith('wallet-1');

      mocks.locationState = { activeTab: 'addresses' };
      rerender(<WalletDetail />);

      await waitFor(() => {
        expect(screen.getByTestId('addresses-tab')).toBeInTheDocument();
      });
    });

    it('ignores invalid router-provided tab values', () => {
      const { rerender } = render(<WalletDetail />);

      mocks.locationState = { activeTab: 'not-a-tab' };
      rerender(<WalletDetail />);

      expect(screen.getByTestId('transactions-tab')).toBeInTheDocument();
    });

    it('handles repeated and pre-wallet router tab updates', () => {
      const { rerender } = render(<WalletDetail />);

      mocks.locationState = { activeTab: 'tx' };
      rerender(<WalletDetail />);
      expect(screen.getByTestId('transactions-tab')).toBeInTheDocument();

      mocks.walletDataState = createWalletData({ loading: false, error: null, wallet: null });
      mocks.locationState = { activeTab: 'stats' };
      rerender(<WalletDetail />);
      expect(screen.getByText('Loading wallet...')).toBeInTheDocument();
    });

    it('runs hook onDataRefresh callbacks wired into sync and sharing hooks', async () => {
      render(<WalletDetail />);

      expect(mocks.walletSyncHookArgs?.onDataRefresh).toEqual(expect.any(Function));
      expect(mocks.walletSharingHookArgs?.onDataRefresh).toEqual(expect.any(Function));

      mocks.fetchData.mockClear();

      await mocks.walletSyncHookArgs.onDataRefresh();
      expect(mocks.fetchData).toHaveBeenCalledWith(true);

      mocks.fetchData.mockClear();

      await mocks.walletSharingHookArgs.onDataRefresh();
      expect(mocks.fetchData).toHaveBeenCalledWith(true);
    });

    it('loads admin wallet-agent badges and clears them on failure', async () => {
      mocks.user = { id: 'admin-1', username: 'admin', isAdmin: true };
      mocks.getWalletAgents.mockResolvedValueOnce([
        {
          id: 'agent-1',
          name: 'Funding Agent',
          fundingWalletId: 'wallet-1',
          operationalWalletId: 'wallet-2',
          operationalWallet: { name: 'Agent Ops' },
          status: 'active',
        },
      ]);

      const { rerender } = render(<WalletDetail />);

      await waitFor(() => {
        expect(screen.getByTestId('wallet-agent-links')).toHaveTextContent('funding:Agent Ops');
      });
      expect(mocks.getWalletAgents).toHaveBeenCalledWith({ walletId: 'wallet-1' });

      mocks.getWalletAgents.mockRejectedValueOnce(new Error('agent lookup failed'));
      mocks.routeId = 'wallet-2';
      rerender(<WalletDetail />);

      await waitFor(() => {
        expect(screen.getByTestId('wallet-agent-links')).toHaveTextContent('none');
      });
      expect(mocks.getWalletAgents).toHaveBeenCalledWith({ walletId: 'wallet-2' });
    });

    it('renders all admin wallet-agent badge fallback labels', async () => {
      mocks.user = { id: 'admin-1', username: 'admin', isAdmin: true };
      mocks.getWalletAgents.mockResolvedValueOnce([
        {
          id: 'agent-1',
          name: 'Funding Agent',
          fundingWalletId: 'wallet-1',
          operationalWalletId: 'wallet-2',
          status: 'active',
        },
        {
          id: 'agent-2',
          name: 'Operational Agent',
          fundingWalletId: 'wallet-3',
          operationalWalletId: 'wallet-1',
          fundingWallet: { name: 'Agent Funding' },
          status: 'paused',
        },
        {
          id: 'agent-3',
          name: 'Operational Fallback Agent',
          fundingWalletId: 'wallet-4',
          operationalWalletId: 'wallet-1',
          status: 'active',
        },
      ]);

      render(<WalletDetail />);

      await waitFor(() => {
        expect(screen.getByTestId('wallet-agent-links')).toHaveTextContent(
          'funding:wallet-2|operational:Agent Funding|operational:wallet-4'
        );
      });
    });

    it('does not set wallet-agent links after the admin link request is cancelled', async () => {
      mocks.user = { id: 'admin-1', username: 'admin', isAdmin: true };
      let resolveAgents!: (agents: any[]) => void;
      const agentsPromise = new Promise<any[]>((resolve) => {
        resolveAgents = resolve;
      });
      mocks.getWalletAgents.mockReturnValueOnce(agentsPromise);

      const { unmount } = render(<WalletDetail />);
      unmount();
      resolveAgents([
        {
          id: 'agent-1',
          name: 'Late Agent',
          fundingWalletId: 'wallet-1',
          operationalWalletId: 'wallet-2',
          operationalWallet: { name: 'Late Ops' },
          status: 'active',
        },
      ]);

      await expect(agentsPromise).resolves.toHaveLength(1);
    });

    it('does not clear wallet-agent links after a cancelled admin link request rejects', async () => {
      mocks.user = { id: 'admin-1', username: 'admin', isAdmin: true };
      let rejectAgents!: (error: Error) => void;
      const agentsPromise = new Promise<any[]>((_resolve, reject) => {
        rejectAgents = reject;
      });
      mocks.getWalletAgents.mockReturnValueOnce(agentsPromise);

      const { unmount } = render(<WalletDetail />);
      unmount();
      rejectAgents(new Error('late agent lookup failed'));

      await expect(agentsPromise).rejects.toThrow('late agent lookup failed');
    });
  });
};
