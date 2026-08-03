import React from 'react';
import { PendingTransfersPanel } from '../../PendingTransfersPanel';

interface TransfersSectionProps {
  deviceId: string;
  onTransferComplete: () => void;
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
