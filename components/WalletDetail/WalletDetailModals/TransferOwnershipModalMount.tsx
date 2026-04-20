import React from 'react';
import { TransferOwnershipModal } from '../../TransferOwnershipModal';
import type { WalletDetailModalsProps } from './types';

type TransferOwnershipModalMountProps = Pick<
  WalletDetailModalsProps,
  'showTransferModal' | 'walletId' | 'walletName' | 'onCloseTransferModal' | 'onTransferInitiated'
>;

export const TransferOwnershipModalMount: React.FC<TransferOwnershipModalMountProps> = ({
  showTransferModal,
  walletId,
  walletName,
  onCloseTransferModal,
  onTransferInitiated,
}) => {
  if (!showTransferModal || !walletId) {
    return null;
  }

  return (
    <TransferOwnershipModal
      resourceType="wallet"
      resourceId={walletId}
      resourceName={walletName}
      onClose={onCloseTransferModal}
      onTransferInitiated={onTransferInitiated}
    />
  );
};
