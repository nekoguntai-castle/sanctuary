import React from 'react';
import { TransferOwnershipForm } from './TransferOwnershipModal/TransferOwnershipForm';
import { TransferOwnershipHeader } from './TransferOwnershipModal/TransferOwnershipHeader';
import type { TransferOwnershipModalProps } from './TransferOwnershipModal/types';
import { useTransferOwnershipModal } from './TransferOwnershipModal/useTransferOwnershipModal';

export const TransferOwnershipModal: React.FC<TransferOwnershipModalProps> = ({
  resourceType,
  resourceId,
  resourceName,
  onClose,
  onTransferInitiated,
}) => {
  const modal = useTransferOwnershipModal({
    resourceType,
    resourceId,
    onTransferInitiated,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-lg w-full shadow-2xl animate-modal-enter">
        <TransferOwnershipHeader
          resourceLabel={modal.resourceLabel}
          resourceName={resourceName}
          onClose={onClose}
        />
        <TransferOwnershipForm
          modal={modal}
          onClose={onClose}
        />
      </div>
    </div>
  );
};
