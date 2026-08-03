import React from 'react';
import { TransactionExportModal } from '../../TransactionExportModal';
import type { WalletDetailModalsProps } from './types';

type TransactionExportModalMountProps = Pick<
  WalletDetailModalsProps,
  'showTransactionExport' | 'walletId' | 'walletName' | 'onCloseTransactionExport'
>;

export const TransactionExportModalMount: React.FC<TransactionExportModalMountProps> = ({
  showTransactionExport,
  walletId,
  walletName,
  onCloseTransactionExport,
}) => {
  if (!showTransactionExport || !walletId) {
    return null;
  }

  return (
    <TransactionExportModal
      walletId={walletId}
      walletName={walletName}
      onClose={onCloseTransactionExport}
    />
  );
};
