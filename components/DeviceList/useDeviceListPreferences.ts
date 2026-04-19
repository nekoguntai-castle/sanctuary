import { useMemo } from 'react';
import { useUser } from '../../contexts/UserContext';
import {
  DEFAULT_DEVICE_COLUMN_ORDER,
  DEFAULT_DEVICE_VISIBLE_COLUMNS,
  mergeDeviceColumnOrder,
} from '../columns/deviceColumns';
import type { OwnershipFilter, SortField, SortOrder, ViewMode, WalletFilter } from './types';

export function useDeviceListPreferences() {
  const { user, updatePreferences } = useUser();
  const deviceSettings = user?.preferences?.viewSettings?.devices;

  const updateDeviceSettings = (patch: Record<string, unknown>) => {
    updatePreferences({
      viewSettings: {
        ...(user?.preferences?.viewSettings ?? {}),
        devices: { ...(deviceSettings ?? {}), ...patch }
      }
    });
  };

  const viewMode = (deviceSettings?.layout as ViewMode) || 'list';
  const sortBy = (deviceSettings?.sortBy as SortField) || 'label';
  const sortOrder = (deviceSettings?.sortOrder as SortOrder) || 'asc';
  const ownershipFilter = (deviceSettings?.ownershipFilter as OwnershipFilter) || 'all';
  const walletFilter = (deviceSettings?.walletFilter as WalletFilter) || 'all';
  const columnOrder = useMemo(
    () => mergeDeviceColumnOrder(deviceSettings?.columnOrder),
    [deviceSettings?.columnOrder]
  );
  const visibleColumns = deviceSettings?.visibleColumns || DEFAULT_DEVICE_VISIBLE_COLUMNS;

  const setViewMode = (mode: ViewMode) => {
    updateDeviceSettings({ layout: mode });
  };

  const setSortBy = (field: SortField) => {
    const newOrder = field === sortBy ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
    updateDeviceSettings({ sortBy: field, sortOrder: newOrder });
  };

  const setOwnershipFilter = (filter: OwnershipFilter) => {
    updateDeviceSettings({ ownershipFilter: filter });
  };

  const setWalletFilter = (filter: WalletFilter) => {
    updateDeviceSettings({ walletFilter: filter });
  };

  const handleColumnOrderChange = (newOrder: string[]) => {
    updateDeviceSettings({ columnOrder: newOrder });
  };

  const handleColumnVisibilityChange = (columnId: string, visible: boolean) => {
    const newVisible = visible
      ? [...visibleColumns, columnId]
      : visibleColumns.filter(id => id !== columnId);
    updateDeviceSettings({ visibleColumns: newVisible });
  };

  const handleColumnReset = () => {
    updateDeviceSettings({
      columnOrder: DEFAULT_DEVICE_COLUMN_ORDER,
      visibleColumns: DEFAULT_DEVICE_VISIBLE_COLUMNS
    });
  };

  return {
    user,
    viewMode,
    setViewMode,
    sortBy,
    sortOrder,
    setSortBy,
    ownershipFilter,
    setOwnershipFilter,
    walletFilter,
    setWalletFilter,
    columnOrder,
    visibleColumns,
    handleColumnOrderChange,
    handleColumnVisibilityChange,
    handleColumnReset,
  };
}
