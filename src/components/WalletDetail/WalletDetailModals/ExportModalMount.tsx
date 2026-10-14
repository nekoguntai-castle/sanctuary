import React from 'react';
import { ExportModal } from '../modals';
import type { WalletDetailModalsProps } from './types';

type ExportModalMountProps = Pick<
  WalletDetailModalsProps,
  | 'showExport'
  | 'walletId'
  | 'walletName'
  | 'walletType'
  | 'walletDescriptor'
  | 'devices'
  | 'onCloseExport'
  | 'onError'
>;

export const ExportModalMount: React.FC<ExportModalMountProps> = ({
  showExport,
  walletId,
  walletName,
  walletType,
  walletDescriptor,
  devices,
  onCloseExport,
  onError,
}) => {
  if (!showExport || !walletId) {
    return null;
  }

  return (
    <ExportModal
      walletId={walletId}
      walletName={walletName}
      walletType={walletType}
      descriptor={walletDescriptor}
      devices={devices}
      onClose={onCloseExport}
      onError={onError}
    />
  );
};
