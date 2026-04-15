import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WalletType } from '../../../types';
import {
  createWalletData,
  mocks,
  WalletDetailComponent as WalletDetail,
} from './WalletDetailWrapperTestHarness';

export const registerWalletDetailWrapperGuardContracts = () => {
  describe('guarded and failure paths', () => {
    it('handles failures and guarded no-op branches', async () => {
      const user = userEvent.setup();
      mocks.freezeUTXO.mockRejectedValueOnce(new Error('freeze failed'));
      mocks.generateAddresses.mockRejectedValueOnce(new Error('generate failed'));
      mocks.updateWallet.mockRejectedValueOnce(new Error('update failed'));
      mocks.deleteWallet.mockRejectedValueOnce(new Error('delete failed'));

      mocks.walletDataState = createWalletData({
        hasMoreAddresses: false,
      });

      render(<WalletDetail />);

      await user.click(screen.getByRole('button', { name: /addresses/i }));
      await user.click(screen.getByRole('button', { name: 'addr-load-more' }));
      expect(mocks.loadAddresses).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'addr-generate' }));
      await waitFor(() => {
        expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Generate Addresses');
      });

      await user.click(screen.getByRole('button', { name: /utxos/i }));
      await user.click(screen.getByRole('button', { name: 'utxo-freeze-missing' }));
      expect(mocks.freezeUTXO).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'utxo-freeze' }));
      await waitFor(() => {
        expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Freeze UTXO');
      });

      await user.click(screen.getByRole('button', { name: /settings/i }));
      await user.click(screen.getByRole('button', { name: 'settings-update' }));
      await waitFor(() => {
        expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Update Failed');
      });

      await user.click(screen.getByRole('button', { name: 'settings-delete' }));
      await user.click(screen.getByRole('button', { name: 'delete-confirm' }));
      await waitFor(() => {
        expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Delete Failed');
      });
    });

    it('skips id-gated actions when wallet id is absent', async () => {
      const user = userEvent.setup();
      mocks.routeId = undefined;

      render(<WalletDetail />);

      await user.click(screen.getByRole('button', { name: /addresses/i }));
      await user.click(screen.getByRole('button', { name: 'addr-generate' }));
      expect(mocks.generateAddresses).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /settings/i }));
      await user.click(screen.getByRole('button', { name: 'settings-update' }));
      expect(mocks.updateWallet).not.toHaveBeenCalled();
    });

    it('covers remaining WalletDetail fallback and guard branches', async () => {
      const user = userEvent.setup();
      const walletWithFallbacks = {
        ...createWalletData().wallet,
        type: WalletType.MULTI_SIG,
        network: undefined,
        descriptor: undefined,
        userRole: undefined,
      };

      mocks.locationState = { activeTab: 'stats' };
      mocks.walletDataState = createWalletData({
        wallet: walletWithFallbacks,
        utxoStats: [],
        loadingUtxoStats: true,
      });

      const { rerender } = render(<WalletDetail />);
      expect(screen.getByTestId('stats-tab')).toBeInTheDocument();
      expect(mocks.loadUtxosForStats).not.toHaveBeenCalled();

      mocks.walletDataState = createWalletData({
        wallet: walletWithFallbacks,
        utxoStats: [{ id: 'stats-utxo', txid: 'stats-tx', vout: 1, amount: 2000 }],
        loadingUtxoStats: false,
      });
      rerender(<WalletDetail />);
      expect(screen.getByTestId('stats-utxo-id')).toHaveTextContent('stats-utxo');

      mocks.locationState = { activeTab: 'addresses' };
      rerender(<WalletDetail />);
      expect(screen.getByTestId('addr-descriptor')).toHaveTextContent('null');
      expect(screen.getByTestId('addr-network')).toHaveTextContent('mainnet');

      await user.click(screen.getByRole('button', { name: /transactions/i }));
      await user.click(screen.getByRole('button', { name: 'tx-labels-change' }));
      expect(mocks.fetchData).toHaveBeenCalledWith(true);

      await user.click(screen.getByRole('button', { name: 'header-receive' }));
      expect(screen.getByTestId('receive-modal')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'receive-close' }));

      await user.click(screen.getByRole('button', { name: /utxos/i }));
      expect(screen.getByTestId('utxo-network')).toHaveTextContent('mainnet');
      expect(screen.getByTestId('utxo-role')).toHaveTextContent('viewer');

      mocks.locationState = { activeTab: 'drafts' };
      rerender(<WalletDetail />);
      expect(screen.getByTestId('transactions-tab')).toBeInTheDocument();
      expect(screen.queryByTestId('drafts-tab')).not.toBeInTheDocument();

      mocks.walletDataState = createWalletData({
        wallet: {
          ...walletWithFallbacks,
          userRole: 'owner',
        },
        utxoStats: [{ id: 'stats-utxo', txid: 'stats-tx', vout: 1, amount: 2000 }],
        loadingUtxoStats: false,
      });
      mocks.locationState = { activeTab: 'drafts' };
      rerender(<WalletDetail />);
      expect(screen.getByTestId('drafts-role')).toHaveTextContent('owner');
      expect(screen.getByTestId('drafts-type')).toHaveTextContent(WalletType.MULTI_SIG);
      await user.click(screen.getByRole('button', { name: 'drafts-single' }));
      expect(mocks.addAppNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: '1 pending draft' }),
      );

      mocks.locationState = { activeTab: 'access' };
      rerender(<WalletDetail />);
      expect(screen.getByTestId('access-role')).toHaveTextContent('owner');

      mocks.locationState = { activeTab: 'log' };
      rerender(<WalletDetail />);
      expect(screen.getByTestId('log-tab')).toBeInTheDocument();

      mocks.fetchData.mockClear();
      mocks.routeId = undefined;
      mocks.locationState = { activeTab: 'tx' };
      rerender(<WalletDetail />);
      await user.click(screen.getByRole('button', { name: 'tx-labels-change' }));
      expect(mocks.fetchData).not.toHaveBeenCalled();

      mocks.locationState = { activeTab: 'settings' };
      rerender(<WalletDetail />);
      await user.click(screen.getByRole('button', { name: 'settings-delete' }));
      await user.click(screen.getByRole('button', { name: 'delete-confirm' }));
      expect(mocks.deleteWallet).not.toHaveBeenCalled();
    });
  });
};
