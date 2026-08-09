import { useCallback, useLayoutEffect, useState } from 'react';
import { createLogger } from '../../../utils/logger';
import * as walletsApi from '../../../api/wallets';
import type { TabType } from '../types';
import { useWalletRouteOwnership } from './useWalletRouteOwnership';

const log = createLogger('WalletDetail');

export function useWalletDetailModalState({
  walletId,
  ownershipKey,
  navigate,
  handleError,
  handleTransferComplete,
  setActiveTab,
}: {
  walletId: string | undefined;
  ownershipKey: string;
  navigate: (path: string) => void;
  handleError: (error: unknown, title?: string) => void;
  handleTransferComplete: () => void;
  setActiveTab: (tab: TabType) => void;
}) {
  const ownership = useWalletRouteOwnership(ownershipKey);
  const [exportOwner, setExportOwner] = useState<string | null>(null);
  const [transactionExportOwner, setTransactionExportOwner] = useState<string | null>(null);
  const [deleteOwner, setDeleteOwner] = useState<string | null>(null);
  const [transferOwner, setTransferOwner] = useState<string | null>(null);
  const [qrModal, setQrModal] = useState<{ walletId: string; address: string } | null>(null);
  const [receiveOwner, setReceiveOwner] = useState<string | null>(null);

  useLayoutEffect(() => {
    setExportOwner(null);
    setTransactionExportOwner(null);
    setDeleteOwner(null);
    setTransferOwner(null);
    setQrModal(null);
    setReceiveOwner(null);
  }, [ownershipKey]);

  const handleConfirmDelete = useCallback(async () => {
    if (!walletId || deleteOwner !== walletId) return;
    const token = ownership.captureRoute(ownershipKey);
    if (!ownership.isRouteOwner(token)) return;
    const deletedWalletId = deleteOwner;

    try {
      await walletsApi.deleteWallet(deletedWalletId);
      if (ownership.isRouteOwner(token)) navigate('/wallets');
    } catch (err) {
      log.error('Failed to delete wallet', { error: err });
      if (ownership.isRouteOwner(token)) handleError(err, 'Delete Failed');
    }
  }, [deleteOwner, handleError, navigate, ownership, ownershipKey, walletId]);

  const handleNavigateReceiveToSettings = () => {
    if (receiveOwner !== walletId) return;
    if (!ownership.isRouteOwner(ownership.captureRoute(ownershipKey))) return;
    setReceiveOwner(null);
    setActiveTab('settings');
  };

  const handleTransferInitiated = () => {
    if (transferOwner !== walletId) return;
    if (!ownership.isRouteOwner(ownership.captureRoute(ownershipKey))) return;
    setTransferOwner(null);
    handleTransferComplete();
  };

  const owns = (owner: string | null) => Boolean(walletId && owner === walletId);
  const openForCurrentWallet = (setOwner: (id: string | null) => void) => {
    const token = ownership.captureRoute(ownershipKey);
    if (walletId && ownership.isRouteOwner(token)) setOwner(walletId);
  };

  return {
    showExport: owns(exportOwner),
    openExport: () => openForCurrentWallet(setExportOwner),
    closeExport: () => setExportOwner(null),
    showTransactionExport: owns(transactionExportOwner),
    openTransactionExport: () => openForCurrentWallet(setTransactionExportOwner),
    closeTransactionExport: () => setTransactionExportOwner(null),
    showDelete: owns(deleteOwner),
    openDelete: () => openForCurrentWallet(setDeleteOwner),
    closeDelete: () => setDeleteOwner(null),
    showTransferModal: owns(transferOwner),
    openTransferModal: () => openForCurrentWallet(setTransferOwner),
    closeTransferModal: () => setTransferOwner(null),
    qrModalAddress: qrModal && qrModal.walletId === walletId ? qrModal.address : null,
    setQrModalAddress: (address: string | null) => {
      const token = ownership.captureRoute(ownershipKey);
      if (ownership.isRouteOwner(token)) {
        setQrModal(address && walletId ? { walletId, address } : null);
      }
    },
    closeQrModal: () => setQrModal(null),
    showReceive: owns(receiveOwner),
    openReceive: () => openForCurrentWallet(setReceiveOwner),
    closeReceive: () => setReceiveOwner(null),
    handleConfirmDelete,
    handleNavigateReceiveToSettings,
    handleTransferInitiated,
  };
}
