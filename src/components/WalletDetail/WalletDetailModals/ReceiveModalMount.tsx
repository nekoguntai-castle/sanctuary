import React from 'react';
import { ReceiveModal } from '../modals';
import type { WalletDetailModalsProps } from './types';

type ReceiveModalMountProps = Pick<
  WalletDetailModalsProps,
  'showReceive' | 'walletId' | 'addresses' | 'onCloseReceive' | 'onNavigateToSettings' | 'onFetchUnusedAddresses'
>;

export const ReceiveModalMount: React.FC<ReceiveModalMountProps> = ({
  showReceive,
  walletId,
  addresses,
  onCloseReceive,
  onNavigateToSettings,
  onFetchUnusedAddresses,
}) => {
  if (!showReceive || !walletId) {
    return null;
  }

  return (
    <ReceiveModal
      walletId={walletId}
      addresses={addresses}
      onClose={onCloseReceive}
      onNavigateToSettings={onNavigateToSettings}
      onFetchUnusedAddresses={onFetchUnusedAddresses}
    />
  );
};
