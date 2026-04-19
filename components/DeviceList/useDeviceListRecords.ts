import { useEffect, useMemo, useState } from 'react';
import type { Device, HardwareDeviceModel, User } from '../../types';
import { useLoadingState } from '../../hooks/useLoadingState';
import { getDevices, updateDevice, deleteDevice, getDeviceModels } from '../../src/api/devices';
import { createLogger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorHandler';
import type { DeviceGroupedDeleteState, DeviceGroupedEditState } from './types';

const log = createLogger('DeviceList');

export function useDeviceListRecords(user: User | null) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editType, setEditType] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { loading, execute: runLoad } = useLoadingState({ initialLoading: true });

  useEffect(() => {
    if (!user) return;

    runLoad(async () => {
      const [deviceData, models] = await Promise.all([
        getDevices(),
        getDeviceModels()
      ]);
      setDevices(deviceData);
      setDeviceModels(models);
    });
  }, [user]);

  const editState = useMemo<DeviceGroupedEditState>(() => ({
    editingId,
    editValue,
    editType,
    setEditingId,
    setEditValue,
    setEditType,
  }), [editingId, editValue, editType]);

  const deleteState = useMemo<DeviceGroupedDeleteState>(() => ({
    deleteConfirmId,
    deleteError,
    setDeleteConfirmId,
    setDeleteError,
  }), [deleteConfirmId, deleteError]);

  return {
    devices,
    deviceModels,
    loading,
    editState,
    deleteState,
    handleEdit: (device: Device) => {
      setEditingId(device.id);
      setEditValue(device.label);
      setEditType(device.model?.slug || '');
    },
    handleSave: async (device: Device) => {
      try {
        const updateData = buildDeviceUpdate(device, editValue, editType);
        const updatedDevice = await updateDevice(device.id, updateData);
        setDevices(prev => prev.map(d => d.id === device.id ? { ...d, ...updatedDevice, label: editValue } : d));
        setEditingId(null);
      } catch (error) {
        log.error('Failed to update device', { error });
      }
    },
    handleDelete: async (device: Device) => {
      try {
        setDeleteError(null);
        await deleteDevice(device.id);
        setDevices(prev => prev.filter(d => d.id !== device.id));
        setDeleteConfirmId(null);
      } catch (error) {
        log.error('Failed to delete device', { error });
        setDeleteError(extractErrorMessage(error, 'Failed to delete device'));
      }
    },
  };
}

function buildDeviceUpdate(
  device: Device,
  editValue: string,
  editType: string
): { label?: string; modelSlug?: string } {
  const updateData: { label?: string; modelSlug?: string } = {};
  if (editValue !== device.label) updateData.label = editValue;
  if (editType !== (device.model?.slug || '')) updateData.modelSlug = editType;
  return updateData;
}
