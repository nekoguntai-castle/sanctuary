import { useMemo } from 'react';
import type { Device, HardwareDeviceModel } from '../../types';
import { createDeviceCellRenderers } from '../cells/DeviceCells';
import {
  buildWalletOptions,
  countUnassignedDevices,
  filterAndSortDevices,
  getDeviceCounts,
  getDeviceDisplayName as resolveDeviceDisplayName,
  getExclusiveDeviceIds,
  getWalletCount,
  groupDevicesByType,
  resolveWalletFilter,
} from './deviceListData';
import type {
  DeviceGroupedDeleteState,
  DeviceGroupedEditState,
  OwnershipFilter,
  SortField,
  SortOrder,
  WalletFilter,
} from './types';

export function useDeviceListDerivedData({
  devices,
  deviceModels,
  sortBy,
  sortOrder,
  ownershipFilter,
  walletFilter,
  editState,
  deleteState,
  handleEdit,
  handleSave,
  handleDelete,
}: {
  devices: Device[];
  deviceModels: HardwareDeviceModel[];
  sortBy: SortField;
  sortOrder: SortOrder;
  ownershipFilter: OwnershipFilter;
  walletFilter: WalletFilter;
  editState: DeviceGroupedEditState;
  deleteState: DeviceGroupedDeleteState;
  handleEdit: (device: Device) => void;
  handleSave: (device: Device) => Promise<void>;
  handleDelete: (device: Device) => Promise<void>;
}) {
  const { ownedCount, sharedCount } = useMemo(() => getDeviceCounts(devices), [devices]);
  const walletOptions = useMemo(() => buildWalletOptions(devices), [devices]);
  const unassignedCount = useMemo(() => countUnassignedDevices(devices), [devices]);
  const effectiveWalletFilter = useMemo(
    () => resolveWalletFilter(walletFilter, walletOptions),
    [walletFilter, walletOptions]
  );
  const sortedDevices = useMemo(
    () => filterAndSortDevices({ devices, sortBy, sortOrder, ownershipFilter, effectiveWalletFilter }),
    [devices, sortBy, sortOrder, ownershipFilter, effectiveWalletFilter]
  );
  const exclusiveDeviceIds = useMemo(
    () => getExclusiveDeviceIds(devices, effectiveWalletFilter),
    [devices, effectiveWalletFilter]
  );
  const groupedDevices = useMemo(() => groupDevicesByType(sortedDevices), [sortedDevices]);
  const getDeviceDisplayName = (type: string): string => resolveDeviceDisplayName(type, deviceModels);
  const cellRenderers = useMemo(
    () => createDeviceCellRenderers(
      editState,
      deleteState,
      { handleEdit, handleSave, handleDelete },
      { getDeviceDisplayName, deviceModels },
      { walletFilter: effectiveWalletFilter, exclusiveDeviceIds }
    ),
    [
      editState.editingId,
      editState.editValue,
      editState.editType,
      deleteState.deleteConfirmId,
      deleteState.deleteError,
      deviceModels,
      effectiveWalletFilter,
      exclusiveDeviceIds
    ]
  );

  return {
    ownedCount,
    sharedCount,
    walletOptions,
    unassignedCount,
    effectiveWalletFilter,
    sortedDevices,
    exclusiveDeviceIds,
    groupedDevices,
    getDeviceDisplayName,
    getWalletCount,
    cellRenderers,
  };
}
