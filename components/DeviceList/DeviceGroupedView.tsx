/**
 * DeviceList Grouped View
 *
 * Displays devices grouped by type in a card layout.
 */

import React from 'react';
import { HardwareDeviceModel, Device } from '../../types';
import { useNavigate } from 'react-router-dom';
import { DeviceTypeGroupCard } from './DeviceGroupedCards';
import type { DeviceGroupedDeleteState, DeviceGroupedEditState } from './types';

interface DeviceGroupedViewProps {
  groupedDevices: Record<string, Device[]>;
  editState: DeviceGroupedEditState;
  deleteState: DeviceGroupedDeleteState;
  deviceModels: HardwareDeviceModel[];
  getDeviceDisplayName: (type: string) => string;
  getWalletCount: (device: Device) => number;
  handleEdit: (device: Device) => void;
  handleSave: (device: Device) => void;
  handleDelete: (device: Device) => void;
  walletFilter: string;
  exclusiveDeviceIds: Set<string>;
}

export const DeviceGroupedView: React.FC<DeviceGroupedViewProps> = ({
  groupedDevices,
  editState,
  deleteState,
  deviceModels,
  getDeviceDisplayName,
  getWalletCount,
  handleEdit,
  handleSave,
  handleDelete,
  walletFilter,
  exclusiveDeviceIds,
}) => {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 animate-fade-in">
      {(Object.entries(groupedDevices) as [string, Device[]][]).map(([type, groupDevices]) => (
        <DeviceTypeGroupCard
          key={type}
          type={type}
          devices={groupDevices}
          editState={editState}
          deleteState={deleteState}
          deviceModels={deviceModels}
          getDeviceDisplayName={getDeviceDisplayName}
          getWalletCount={getWalletCount}
          handleEdit={handleEdit}
          handleSave={handleSave}
          handleDelete={handleDelete}
          walletFilter={walletFilter}
          exclusiveDeviceIds={exclusiveDeviceIds}
          onOpenDevice={(deviceId) => navigate(`/devices/${deviceId}`)}
        />
      ))}
    </div>
  );
};
