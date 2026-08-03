import React from 'react';
import { ExportModal } from '../modals';
import type { WalletDetailModalsProps } from './types';

type ExportModalMountProps = Pick<
  WalletDetailModalsProps,
  | 'showExport'
  | 'walletId'
  | 'walletName'
  | 'walletType'
  | 'walletScriptType'
  | 'walletDescriptor'
  | 'walletQuorum'
  | 'walletTotalSigners'
  | 'devices'
  | 'onCloseExport'
  | 'onError'
>;

export const ExportModalMount: React.FC<ExportModalMountProps> = ({
  showExport,
  walletId,
  walletName,
  walletType,
  walletScriptType,
  walletDescriptor,
  walletQuorum,
  walletTotalSigners,
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
      scriptType={walletScriptType}
      descriptor={walletDescriptor}
      quorum={walletQuorum}
      totalSigners={walletTotalSigners}
      devices={devices}
      onClose={onCloseExport}
      onError={onError}
    />
  );
};
