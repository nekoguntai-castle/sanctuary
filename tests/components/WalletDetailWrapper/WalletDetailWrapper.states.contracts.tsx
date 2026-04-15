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
  });
};
