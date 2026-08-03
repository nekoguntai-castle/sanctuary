import React from 'react';
import { X } from 'lucide-react';
import { useReceiveModalState } from './useReceiveModalState';
import { ReceiveModalContent } from './ReceiveModalContent';
import type { ReceiveModalProps } from './receiveModalTypes';

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  walletId,
  addresses,
  onClose,
  onNavigateToSettings,
  onFetchUnusedAddresses,
}) => {
  const receive = useReceiveModalState({
    walletId,
    addresses,
    onClose,
    onNavigateToSettings,
    onFetchUnusedAddresses,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={receive.handleClose}
    >
      <div
        className="surface-elevated rounded-xl max-w-md w-full p-6 shadow-xl border border-sanctuary-200 dark:border-sanctuary-700 animate-modal-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-50">
            Receive Bitcoin
          </h3>
          <button
            onClick={receive.handleClose}
            className="text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <ReceiveModalContent walletId={walletId} receive={receive} />
      </div>
    </div>
  );
};
