import React from 'react';
import { PendingTransfersPanel } from '../../../PendingTransfersPanel';

interface TransfersSectionProps {
  walletId: string;
  onTransferComplete: () => void;
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
