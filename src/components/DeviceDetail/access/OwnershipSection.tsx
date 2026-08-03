import React from 'react';
import type { DeviceShareInfo } from '../../../types';
import { DeviceOwnerCard } from './DeviceOwnerCard';
import { getDeviceOwnerDisplay } from './accessSectionData';

interface OwnershipSectionProps {
  deviceShareInfo: DeviceShareInfo | null;
  username: string | undefined;
  isOwner: boolean;
  onTransfer: () => void;
}

export const OwnershipSection: React.FC<OwnershipSectionProps> = ({
  deviceShareInfo,
  username,
  isOwner,
  onTransfer,
}) => (
  <div className="surface-elevated rounded-xl p-5 border border-sanctuary-200 dark:border-sanctuary-800">
    <DeviceOwnerCard
      owner={getDeviceOwnerDisplay(deviceShareInfo, username)}
      isOwner={isOwner}
      onTransfer={onTransfer}
    />
  </div>
);
