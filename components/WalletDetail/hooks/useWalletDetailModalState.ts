import { useCallback, useState } from 'react';
import { createLogger } from '../../../utils/logger';
import * as walletsApi from '../../../src/api/wallets';
import type { TabType } from '../types';

const log = createLogger('WalletDetail');

export function useWalletDetailModalState({
  walletId,
  navigate,
  handleError,
  handleTransferComplete,
  setActiveTab,
}: {
  walletId: string | undefined;
  navigate: (path: string) => void;
  handleError: (error: unknown, title?: string) => void;
  handleTransferComplete: () => void;
  setActiveTab: (tab: TabType) => void;
}) {
  const [showExport, setShowExport] = useState(false);
  const [showTransactionExport, setShowTransactionExport] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [qrModalAddress, setQrModalAddress] = useState<string | null>(null);
  const [showReceive, setShowReceive] = useState(false);

  const handleConfirmDelete = useCallback(async () => {
    if (!walletId) return;

    try {
      await walletsApi.deleteWallet(walletId);
      navigate('/wallets');
    } catch (err) {
      log.error('Failed to delete wallet', { error: err });
      handleError(err, 'Delete Failed');
    }
  }, [walletId, navigate, handleError]);

  const handleNavigateReceiveToSettings = () => {
    setShowReceive(false);
    setActiveTab('settings');
  };

  const handleTransferInitiated = () => {
    setShowTransferModal(false);
    handleTransferComplete();
  };

  return {
    showExport,
    openExport: () => setShowExport(true),
    closeExport: () => setShowExport(false),
    showTransactionExport,
    openTransactionExport: () => setShowTransactionExport(true),
    closeTransactionExport: () => setShowTransactionExport(false),
    showDelete,
    openDelete: () => setShowDelete(true),
    closeDelete: () => setShowDelete(false),
    showTransferModal,
    openTransferModal: () => setShowTransferModal(true),
    closeTransferModal: () => setShowTransferModal(false),
    qrModalAddress,
    setQrModalAddress,
    closeQrModal: () => setQrModalAddress(null),
    showReceive,
    openReceive: () => setShowReceive(true),
    closeReceive: () => setShowReceive(false),
    handleConfirmDelete,
    handleNavigateReceiveToSettings,
    handleTransferInitiated,
  };
}
