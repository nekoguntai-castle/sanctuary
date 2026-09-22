import React from 'react';
import { PendingTransfersPanel } from '../../../PendingTransfersPanel';
import type { TransferCompletionCallback } from '../../../PendingTransfersPanel';

interface TransfersSectionProps {
  walletId: string;
  onTransferComplete: TransferCompletionCallback;
}

export const TransfersSection: React.FC<TransfersSectionProps> = ({
  walletId,
  onTransferComplete,
}) => (
  <PendingTransfersPanel
    resourceType="wallet"
    resourceId={walletId}
    onTransferComplete={onTransferComplete}
  />
);
