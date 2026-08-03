import React from 'react';
import { DeleteModal } from '../modals';
import type { WalletDetailModalsProps } from './types';

type DeleteModalMountProps = Pick<WalletDetailModalsProps, 'showDelete' | 'onConfirmDelete' | 'onCloseDelete'>;

export const DeleteModalMount: React.FC<DeleteModalMountProps> = ({
  showDelete,
  onConfirmDelete,
  onCloseDelete,
}) => {
  if (!showDelete) {
    return null;
  }

  return (
    <DeleteModal
      onConfirm={onConfirmDelete}
      onClose={onCloseDelete}
    />
  );
};
