import React from 'react';
import { AddressQRModal } from '../modals';
import type { WalletDetailModalsProps } from './types';

type AddressQrModalMountProps = Pick<WalletDetailModalsProps, 'qrModalAddress' | 'onCloseQrModal'>;

export const AddressQrModalMount: React.FC<AddressQrModalMountProps> = ({
  qrModalAddress,
  onCloseQrModal,
}) => {
  if (!qrModalAddress) {
    return null;
  }

  return (
    <AddressQRModal
      address={qrModalAddress}
      onClose={onCloseQrModal}
    />
  );
};
