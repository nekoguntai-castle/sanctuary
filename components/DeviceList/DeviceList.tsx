/**
 * DeviceList Component
 *
 * Main orchestrator for device listing with list and grouped views.
 * Manages state, data loading, and delegates rendering to subcomponents.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { HardwareDevice, HardwareDeviceModel, Device } from '../../types';
import { getDevices, updateDevice, deleteDevice, getDeviceModels } from '../../src/api/devices';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import { useLoadingState } from '../../hooks/useLoadingState';
import { createLogger } from '../../utils/logger';
import { extractErrorMessage } from '../../utils/errorHandler';
import { ConfigurableTable } from '../ui/ConfigurableTable';
import {
  DEVICE_COLUMNS,
  DEFAULT_DEVICE_COLUMN_ORDER,
  DEFAULT_DEVICE_VISIBLE_COLUMNS,
  mergeDeviceColumnOrder,
} from '../columns/deviceColumns';
import { createDeviceCellRenderers, DeviceWithWallets } from '../cells/DeviceCells';
import type { ViewMode, SortField, SortOrder, OwnershipFilter, WalletFilter } from './types';
import { EmptyState } from './EmptyState';
import { DeviceListHeader } from './DeviceListHeader';
import { DeviceGroupedView } from './DeviceGroupedView';

const log = createLogger('DeviceList');

export const DeviceList: React.FC = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const { user, updatePreferences } = useUser();

  // Loading state using hook
  const { loading, execute: runLoad } = useLoadingState({ initialLoading: true });

  // Get view mode from user preferences, fallback to 'list'
  const viewMode = (user?.preferences?.viewSettings?.devices?.layout as ViewMode) || 'list';

  const setViewMode = (mode: ViewMode) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, layout: mode }
      }
    });
  };

  // Get sort settings from user preferences
  const sortBy = (user?.preferences?.viewSettings?.devices?.sortBy as SortField) || 'label';
  const sortOrder = (user?.preferences?.viewSettings?.devices?.sortOrder as SortOrder) || 'asc';
  const ownershipFilter = (user?.preferences?.viewSettings?.devices?.ownershipFilter as OwnershipFilter) || 'all';

  const setSortBy = (field: SortField) => {
    // If clicking the same field, toggle order; otherwise set new field with asc
    const newOrder = field === sortBy ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, sortBy: field, sortOrder: newOrder }
      }
    });
  };

  const setOwnershipFilter = (filter: OwnershipFilter) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, ownershipFilter: filter }
      }
    });
  };

  // Wallet filter from user preferences
  const walletFilter = (user?.preferences?.viewSettings?.devices?.walletFilter as WalletFilter) || 'all';

  const setWalletFilter = (filter: WalletFilter) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, walletFilter: filter }
      }
    });
  };

  // Get column configuration from user preferences
  const columnOrder = useMemo(
    () => mergeDeviceColumnOrder(user?.preferences?.viewSettings?.devices?.columnOrder),
    [user?.preferences?.viewSettings?.devices?.columnOrder]
  );
  const visibleColumns = user?.preferences?.viewSettings?.devices?.visibleColumns || DEFAULT_DEVICE_VISIBLE_COLUMNS;

  const handleColumnOrderChange = (newOrder: string[]) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, columnOrder: newOrder }
      }
    });
  };

  const handleColumnVisibilityChange = (columnId: string, visible: boolean) => {
    const newVisible = visible
      ? [...visibleColumns, columnId]
      : visibleColumns.filter(id => id !== columnId);
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: { ...user?.preferences?.viewSettings?.devices, visibleColumns: newVisible }
      }
    });
  };

  const handleColumnReset = () => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        devices: {
          ...user?.preferences?.viewSettings?.devices,
          columnOrder: DEFAULT_DEVICE_COLUMN_ORDER,
          visibleColumns: DEFAULT_DEVICE_VISIBLE_COLUMNS
        }
      }
    });
  };

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editType, setEditType] = useState('');
  const [deviceModels, setDeviceModels] = useState<HardwareDeviceModel[]>([]);

  // Delete state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const handleEdit = (device: Device) => {
    setEditingId(device.id);
    setEditValue(device.label);
    // Use model.slug if available, otherwise empty (model slug is what dropdown uses)
    setEditType(device.model?.slug || '');
  };

  const handleSave = async (device: Device) => {
    try {
      const updateData: { label?: string; modelSlug?: string } = {};
      if (editValue !== device.label) updateData.label = editValue;
      if (editType !== (device.model?.slug || '')) updateData.modelSlug = editType;

      const updatedDevice = await updateDevice(device.id, updateData);
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, ...updatedDevice, label: editValue } : d));
      setEditingId(null);
    } catch (error) {
      log.error('Failed to update device', { error });
    }
  };

  const handleDelete = async (device: Device) => {
    try {
      setDeleteError(null);
      await deleteDevice(device.id);
      setDevices(prev => prev.filter(d => d.id !== device.id));
      setDeleteConfirmId(null);
    } catch (error) {
      log.error('Failed to delete device', { error });
      setDeleteError(extractErrorMessage(error, 'Failed to delete device'));
    }
  };

  // Get wallet count for a device
  const getWalletCount = (device: Device): number => {
    return device.walletCount ?? device.wallets?.length ?? 0;
  };

  // Count owned and shared devices
  const ownedCount = devices.filter(d => d.isOwner === true).length;
  const sharedCount = devices.filter(d => d.isOwner === false).length;

  // Derive wallet options from device data (no extra API call)
  const walletOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; type: string; count: number }>();
    for (const device of devices) {
      for (const wd of device.wallets ?? []) {
        const existing = map.get(wd.wallet.id);
        if (existing) existing.count++;
        else map.set(wd.wallet.id, { id: wd.wallet.id, name: wd.wallet.name, type: wd.wallet.type, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [devices]);

  const unassignedCount = useMemo(
    () => devices.filter(d => (d.walletCount ?? d.wallets?.length ?? 0) === 0).length,
    [devices]
  );

  // Guard against stale wallet filter (e.g. wallet was deleted)
  const effectiveWalletFilter = useMemo(() => {
    if (walletFilter === 'all' || walletFilter === 'unassigned') return walletFilter;
    return walletOptions.some(w => w.id === walletFilter) ? walletFilter : 'all';
  }, [walletFilter, walletOptions]);

  // Filter and sort devices based on current settings
  const sortedDevices = useMemo(() => {
    if (!devices.length) return devices;

    // Apply ownership filter
    let filtered = devices;
    if (ownershipFilter === 'owned') {
      filtered = devices.filter(d => d.isOwner === true);
    } else if (ownershipFilter === 'shared') {
      filtered = devices.filter(d => d.isOwner === false);
    }

    // Apply wallet filter
    if (effectiveWalletFilter === 'unassigned') {
      filtered = filtered.filter(d => (d.walletCount ?? d.wallets?.length ?? 0) === 0);
    } else if (effectiveWalletFilter !== 'all') {
      filtered = filtered.filter(d =>
        d.wallets?.some(wd => wd.wallet.id === effectiveWalletFilter)
      );
    }

    return [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'label':
          comparison = a.label.localeCompare(b.label);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'fingerprint':
          comparison = a.fingerprint.localeCompare(b.fingerprint);
          break;
        case 'wallets':
          comparison = (a.walletCount ?? a.wallets?.length ?? 0) - (b.walletCount ?? b.wallets?.length ?? 0);
          break;
        default:
          comparison = 0;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [devices, sortBy, sortOrder, ownershipFilter, effectiveWalletFilter]);

  // Compute exclusive device IDs (devices that belong to ONLY the selected wallet)
  const exclusiveDeviceIds = useMemo(() => {
    if (effectiveWalletFilter === 'all' || effectiveWalletFilter === 'unassigned') return new Set<string>();
    return new Set(
      devices
        .filter(d => {
          const wallets = d.wallets ?? [];
          return wallets.length === 1 && wallets[0].wallet.id === effectiveWalletFilter;
        })
        .map(d => d.id)
    );
  }, [devices, effectiveWalletFilter]);

  // Group devices by Type (uses filtered data so filters apply to grouped view)
  const groupedDevices = useMemo(() => sortedDevices.reduce((acc, device) => {
    const type = device.type as HardwareDevice;
    if (!acc[type]) acc[type] = [];
    acc[type].push(device);
    return acc;
  }, {} as Record<HardwareDevice, Device[]>), [sortedDevices]);

  // Get display name for device type (looks up model name from slug)
  const getDeviceDisplayName = (type: string): string => {
    const model = deviceModels.find(m => m.slug === type);
    return model ? model.name : type || 'Unknown Device';
  };

  // Create devices for ConfigurableTable (type alias for clarity)
  const devicesWithWallets: DeviceWithWallets[] = sortedDevices;

  // Create cell renderers with current state
  const cellRenderers = useMemo(
    () => createDeviceCellRenderers(
      { editingId, editValue, editType, setEditingId, setEditValue, setEditType },
      { deleteConfirmId, deleteError, setDeleteConfirmId, setDeleteError },
      { handleEdit, handleSave, handleDelete },
      { getDeviceDisplayName, deviceModels },
      { walletFilter: effectiveWalletFilter, exclusiveDeviceIds }
    ),
    [editingId, editValue, editType, deleteConfirmId, deleteError, deviceModels, effectiveWalletFilter, exclusiveDeviceIds]
  );

  if (loading) return <div className="p-8 text-center text-sanctuary-400">Loading devices...</div>;

  // Empty state
  if (devices.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6 animate-fade-in pb-8">

      {/* Header & Controls */}
      <DeviceListHeader
        deviceCount={devices.length}
        ownedCount={ownedCount}
        sharedCount={sharedCount}
        viewMode={viewMode}
        setViewMode={setViewMode}
        ownershipFilter={ownershipFilter}
        setOwnershipFilter={setOwnershipFilter}
        walletFilter={effectiveWalletFilter}
        setWalletFilter={setWalletFilter}
        walletOptions={walletOptions}
        unassignedCount={unassignedCount}
        columnOrder={columnOrder}
        visibleColumns={visibleColumns}
        onColumnOrderChange={handleColumnOrderChange}
        onColumnVisibilityChange={handleColumnVisibilityChange}
        onColumnReset={handleColumnReset}
      />

      {/* Wallet filter summary banner */}
      {effectiveWalletFilter !== 'all' && effectiveWalletFilter !== 'unassigned' && (
        <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20 text-sm">
          <span className="text-primary-800 dark:text-primary-700">
            Showing {sortedDevices.length} device{sortedDevices.length !== 1 ? 's' : ''} linked to this wallet.
            {exclusiveDeviceIds.size > 0 && (
              <> <strong>{exclusiveDeviceIds.size}</strong> {exclusiveDeviceIds.size === 1 ? 'is' : 'are'} exclusive to this wallet.</>
            )}
          </span>
          <button
            onClick={() => setWalletFilter('all')}
            className="text-xs text-primary-600 dark:text-primary-600 hover:underline ml-4 flex-shrink-0"
          >
            Clear filter
          </button>
        </div>
      )}
      {effectiveWalletFilter === 'unassigned' && (
        <div className="flex items-center justify-between px-4 py-2 rounded-lg bg-sanctuary-50 dark:bg-sanctuary-800 border border-sanctuary-200 dark:border-sanctuary-700 text-sm">
          <span className="text-sanctuary-600 dark:text-sanctuary-400">
            Showing {sortedDevices.length} unassigned device{sortedDevices.length !== 1 ? 's' : ''} (not linked to any wallet).
          </span>
          <button
            onClick={() => setWalletFilter('all')}
            className="text-xs text-sanctuary-500 hover:underline ml-4 flex-shrink-0"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Table View */}
      {viewMode === 'list' && (
        <ConfigurableTable<DeviceWithWallets>
          columns={DEVICE_COLUMNS}
          columnOrder={columnOrder}
          visibleColumns={visibleColumns}
          data={devicesWithWallets}
          keyExtractor={(device) => device.id}
          cellRenderers={cellRenderers}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={(field) => setSortBy(field as SortField)}
          onRowClick={(device) => navigate(`/devices/${device.id}`)}
          emptyMessage="No devices found"
        />
      )}

      {/* Grouped View */}
      {viewMode === 'grouped' && (
        <DeviceGroupedView
          groupedDevices={groupedDevices}
          editState={{ editingId, editValue, editType, setEditingId, setEditValue, setEditType }}
          deleteState={{ deleteConfirmId, deleteError, setDeleteConfirmId, setDeleteError }}
          deviceModels={deviceModels}
          getDeviceDisplayName={getDeviceDisplayName}
          getWalletCount={getWalletCount}
          handleEdit={handleEdit}
          handleSave={handleSave}
          handleDelete={handleDelete}
          walletFilter={effectiveWalletFilter}
          exclusiveDeviceIds={exclusiveDeviceIds}
        />
      )}
    </div>
  );
};
