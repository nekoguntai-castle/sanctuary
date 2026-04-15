import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  createSharingState,
  mocks,
  WalletDetailComponent as WalletDetail,
} from './WalletDetailWrapperTestHarness';

export const registerWalletDetailWrapperInteractionContracts = () => {
  describe('successful interaction paths', () => {
    it('handles header actions, tab interactions, modals, and successful API paths', async () => {
      const user = userEvent.setup();

      mocks.locationState = { highlightTxId: 'tx-highlight' };
      mocks.walletSharingState = createSharingState({
        deviceSharePrompt: {
          show: true,
          targetUserId: 'user-2',
          targetUsername: 'bob',
          devices: [{ id: 'device-1' }],
        },
      });

      render(<WalletDetail />);

      await user.click(screen.getByRole('button', { name: 'header-send' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1/send');

      await user.click(screen.getByRole('button', { name: 'header-sync' }));
      expect(mocks.syncHandler).toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'header-resync' }));
      expect(mocks.fullResyncHandler).toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'header-receive' }));
      expect(screen.getByTestId('receive-modal')).toBeInTheDocument();

      mocks.getAddresses.mockResolvedValueOnce([
        { id: 'a1', address: 'bc1qtest', isChange: false, used: false, index: 0, derivationPath: "m/84'/0'/0'/0/0", balance: 0 },
      ] as any);
      await user.click(screen.getByRole('button', { name: 'receive-fetch-unused' }));
      await waitFor(() => {
        expect(mocks.getAddresses).toHaveBeenCalledWith('wallet-1', { used: false, change: false, limit: 10 });
      });

      mocks.getAddresses
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'a2', address: 'bc1qfresh', isChange: false, used: false, index: 54, derivationPath: "m/84'/0'/0'/0/54", balance: 0 },
        ] as any);
      await user.click(screen.getByRole('button', { name: 'receive-fetch-unused' }));
      await waitFor(() => {
        expect(mocks.generateAddresses).toHaveBeenCalledWith('wallet-1', 10);
      });

      await user.click(screen.getByRole('button', { name: 'receive-settings' }));
      expect(screen.getByTestId('settings-tab')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'header-export' }));
      expect(screen.getByTestId('export-modal')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'export-close' }));
      expect(screen.queryByTestId('export-modal')).not.toBeInTheDocument();

      expect(screen.getByTestId('device-share-modal')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'device-share-confirm' }));
      expect(mocks.shareDevices).toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'device-share-dismiss' }));
      expect(mocks.dismissSharePrompt).toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /addresses/i }));
      expect(screen.getByTestId('addresses-tab')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'addr-load-more' }));
      expect(mocks.loadAddresses).toHaveBeenCalledWith('wallet-1', 25, 25, false);

      await user.click(screen.getByRole('button', { name: 'addr-generate' }));
      await waitFor(() => {
        expect(mocks.generateAddresses).toHaveBeenCalledWith('wallet-1', 10);
      });
      expect(mocks.loadAddressSummary).toHaveBeenCalledWith('wallet-1');
      expect(mocks.loadAddresses).toHaveBeenCalledWith('wallet-1', 25, 0, true);

      await user.click(screen.getByRole('button', { name: 'addr-edit-labels' }));
      await user.click(screen.getByRole('button', { name: 'addr-toggle-label' }));
      await user.click(screen.getByRole('button', { name: 'addr-save-labels' }));
      await waitFor(() => {
        expect(mocks.setAddressLabels).toHaveBeenCalledWith(
          'addr-1',
          expect.arrayContaining(['label-1', 'label-2']),
        );
      });

      await user.click(screen.getByRole('button', { name: 'addr-show-qr' }));
      expect(screen.getByTestId('qr-modal')).toHaveTextContent('bc1q-test-qr');
      await user.click(screen.getByRole('button', { name: 'qr-close' }));
      expect(screen.queryByTestId('qr-modal')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /utxos/i }));
      await user.click(screen.getByRole('button', { name: 'utxo-select' }));
      await user.click(screen.getByRole('button', { name: 'utxo-send-selected' }));
      expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1/send', {
        state: { preSelected: ['utxo-1'] },
      });

      await user.click(screen.getByRole('button', { name: 'utxo-freeze' }));
      await waitFor(() => {
        expect(mocks.freezeUTXO).toHaveBeenCalledWith('utxo-1', true);
      });

      await user.click(screen.getByRole('button', { name: /drafts/i }));
      await user.click(screen.getByRole('button', { name: 'drafts-add' }));
      expect(mocks.addAppNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'pending_drafts' }),
      );
      await user.click(screen.getByRole('button', { name: 'drafts-clear' }));
      expect(mocks.removeNotificationsByType).toHaveBeenCalledWith('pending_drafts', 'wallet-1');

      await user.click(screen.getByRole('button', { name: /transactions/i }));
      expect(screen.getByText('tx-highlight')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'tx-export' }));
      expect(screen.getByTestId('tx-export-modal')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'tx-export-close' }));
      expect(screen.queryByTestId('tx-export-modal')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /access/i }));
      await user.click(screen.getByRole('button', { name: 'access-transfer' }));
      expect(screen.getByTestId('transfer-modal')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'transfer-close' }));
      expect(screen.queryByTestId('transfer-modal')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'access-transfer' }));
      expect(screen.getByTestId('transfer-modal')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'transfer-confirm' }));
      expect(mocks.transferComplete).toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: /settings/i }));
      await user.click(screen.getByRole('button', { name: 'settings-update' }));
      expect(mocks.updateWallet).toHaveBeenCalledWith('wallet-1', {
        name: 'Renamed Wallet',
        descriptor: 'desc-new',
      });

      await user.click(screen.getByRole('button', { name: 'settings-repair' }));
      expect(mocks.repairHandler).toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'settings-export' }));
      expect(screen.getByTestId('export-modal')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'export-close' }));
      expect(screen.queryByTestId('export-modal')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'settings-delete' }));
      expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'delete-close' }));
      expect(screen.queryByTestId('delete-modal')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'settings-delete' }));
      expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'delete-confirm' }));
      await waitFor(() => {
        expect(mocks.deleteWallet).toHaveBeenCalledWith('wallet-1');
      });
      expect(mocks.navigate).toHaveBeenCalledWith('/wallets');
    });
  });
};
