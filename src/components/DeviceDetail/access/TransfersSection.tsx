import React from 'react';
import { PendingTransfersPanel } from '../../PendingTransfersPanel';
import type { TransferCompletionCallback } from '../../PendingTransfersPanel';

interface TransfersSectionProps {
  deviceId: string;
  onTransferComplete: TransferCompletionCallback;
}

export const TransfersSection: React.FC<TransfersSectionProps> = ({
  deviceId,
  onTransferComplete,
}) => {
  return (
    <PendingTransfersPanel
      resourceType="device"
      resourceId={deviceId}
      onTransferComplete={onTransferComplete}
    />
  );
};
