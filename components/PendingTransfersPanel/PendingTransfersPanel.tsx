/**
 * PendingTransfersPanel Component
 *
 * Displays pending ownership transfers for a resource (wallet or device).
 * Shows both incoming transfers (to accept/decline) and outgoing transfers (to confirm/cancel).
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { TransferCard } from './TransferCard';
import { TransferConfirmationModal } from './TransferConfirmationModal';
import { useTransferActions } from './useTransferActions';
import type { TransferAction } from './useTransferActions';

export interface PendingTransfersPanelProps {
  resourceType: 'wallet' | 'device';
  resourceId: string;
  onTransferComplete?: () => void;
}

export const PendingTransfersPanel: React.FC<PendingTransfersPanelProps> = ({
  resourceType,
  resourceId,
  onTransferComplete,
}) => {
  const {
    loading,
    error,
    actionLoading,
    confirmModal,
    declineReason,
    incomingPending,
    outgoingPending,
    awaitingConfirmation,
    hasTransfers,
    setConfirmModal,
    setDeclineReason,
    handleAccept,
    handleDecline,
    handleCancel,
    handleConfirm,
  } = useTransferActions(resourceType, resourceId, onTransferComplete);

  const openModal = (transferId: string, action: TransferAction) => {
    setConfirmModal({ transferId, action });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-24 surface-secondary rounded-lg" />
      </div>
    );
  }

  if (!hasTransfers) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Error Display */}
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300 text-sm flex items-start">
          <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Incoming Pending Transfers */}
      {incomingPending.map(transfer => (
        <TransferCard
          key={transfer.id}
          transfer={transfer}
          variant="incoming"
          actionLoading={actionLoading}
          onAction={openModal}
        />
      ))}

      {/* Awaiting Confirmation */}
      {awaitingConfirmation.map(transfer => (
        <TransferCard
          key={transfer.id}
          transfer={transfer}
          variant="awaiting_confirmation"
          actionLoading={actionLoading}
          onAction={openModal}
        />
      ))}

      {/* Outgoing Pending */}
      {outgoingPending.map(transfer => (
        <TransferCard
          key={transfer.id}
          transfer={transfer}
          variant="outgoing"
          actionLoading={actionLoading}
          onAction={openModal}
        />
      ))}

      {/* Confirmation Modal */}
      {confirmModal && (
        <TransferConfirmationModal
          modal={confirmModal}
          actionLoading={actionLoading}
          declineReason={declineReason}
          onDeclineReasonChange={setDeclineReason}
          onClose={() => setConfirmModal(null)}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
};
