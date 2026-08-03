/**
 * TransferConfirmationModal Component
 *
 * Modal dialog for confirming transfer actions (accept, decline, cancel, confirm).
 * Each action variant shows appropriate messaging and form fields.
 */

import React from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import { Button } from '../ui/Button';
import type { TransferAction, ConfirmModalState } from './useTransferActions';

interface TransferConfirmationModalProps {
  modal: ConfirmModalState;
  actionLoading: string | null;
  declineReason: string;
  onDeclineReasonChange: (reason: string) => void;
  onClose: () => void;
  onAccept: (transferId: string) => void;
  onDecline: (transferId: string) => void;
  onCancel: (transferId: string) => void;
  onConfirm: (transferId: string) => void;
}

export const TransferConfirmationModal: React.FC<TransferConfirmationModalProps> = ({
  modal,
  actionLoading,
  declineReason,
  onDeclineReasonChange,
  onClose,
  onAccept,
  onDecline,
  onCancel,
  onConfirm,
}) => {
  const isLoading = actionLoading === modal.transferId;

  const handleAction = (action: TransferAction) => {
    const handlers: Record<TransferAction, (id: string) => void> = {
      accept: onAccept,
      decline: onDecline,
      cancel: onCancel,
      confirm: onConfirm,
    };
    handlers[action](modal.transferId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 max-w-md w-full shadow-2xl animate-fade-in-up p-6">
        {modal.action === 'accept' && (
          <>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              Accept Transfer?
            </h3>
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mb-6">
              The current owner will be asked to confirm the transfer. You will become the owner once they confirm.
            </p>
            <div className="flex justify-end space-x-3">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => handleAction('accept')}
                isLoading={isLoading}
              >
                Accept Transfer
              </Button>
            </div>
          </>
        )}

        {modal.action === 'decline' && (
          <>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              Decline Transfer?
            </h3>
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mb-4">
              The transfer will be cancelled and the owner will be notified.
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300 mb-2">
                Reason (optional)
              </label>
              <textarea
                value={declineReason}
                onChange={(e) => onDeclineReasonChange(e.target.value)}
                placeholder="Let them know why..."
                rows={2}
                className="w-full px-3 py-2 surface-muted border border-sanctuary-200 dark:border-sanctuary-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sanctuary-900 dark:text-sanctuary-100 resize-none text-sm"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="secondary" onClick={() => { onClose(); onDeclineReasonChange(''); }}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => handleAction('decline')}
                isLoading={isLoading}
              >
                Decline Transfer
              </Button>
            </div>
          </>
        )}

        {modal.action === 'cancel' && (
          <>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              Cancel Transfer?
            </h3>
            <p className="text-sm text-sanctuary-600 dark:text-sanctuary-400 mb-6">
              This transfer will be cancelled. You can initiate a new transfer later if needed.
            </p>
            <div className="flex justify-end space-x-3">
              <Button variant="secondary" onClick={onClose}>
                Keep Transfer
              </Button>
              <Button
                variant="danger"
                onClick={() => handleAction('cancel')}
                isLoading={isLoading}
              >
                Cancel Transfer
              </Button>
            </div>
          </>
        )}

        {modal.action === 'confirm' && (
          <>
            <h3 className="text-lg font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">
              Confirm Transfer?
            </h3>
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg mb-6">
              <div className="flex items-start">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mr-2 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <p className="font-medium">This action is irreversible</p>
                  <p className="mt-1 text-xs">
                    Ownership will be transferred immediately. You may retain viewer access depending on the transfer settings.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={() => handleAction('confirm')}
                isLoading={isLoading}
              >
                <Send className="w-4 h-4 mr-2" />
                Complete Transfer
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
