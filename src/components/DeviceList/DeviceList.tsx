/**
 * DeviceList Component
 *
 * Main orchestrator for device listing with list and grouped views.
 * Manages state, data loading, and delegates rendering to subcomponents.
 */

import React, { useMemo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useActiveNetwork } from '../../contexts/ActiveNetworkContext';
import { filterDevicesByNetwork } from '../../utils/networkScopedDevices';
import { Button } from '../ui/Button';
import { EmptyState } from './EmptyState';
import { DeviceListContent } from './DeviceListContent';
import { useDeviceListDerivedData } from './useDeviceListDerivedData';
import { useDeviceListPreferences } from './useDeviceListPreferences';
import { useDeviceListRecords } from './useDeviceListRecords';

const DeviceListLoadError: React.FC<{ error: string; onRetry: () => void }> = ({ error, onRetry }) => (
  <div className="p-8 text-center">
    <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg p-6 max-w-md mx-auto">
      <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
      <h3 className="text-lg font-medium text-rose-900 dark:text-rose-100 mb-2">Failed to Load Devices</h3>
      <p className="text-rose-700 dark:text-rose-300 mb-4">{error}</p>
      <Button onClick={onRetry} variant="primary">
        <RefreshCw className="w-4 h-4 mr-2" />
        Retry
      </Button>
    </div>
  </div>
);

export const DeviceList: React.FC = () => {
  const { selectedNetwork } = useActiveNetwork();
  const {
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
  } = useDeviceListPreferences();

  const records = useDeviceListRecords(user);
  const activeDevices = useMemo(
    () => filterDevicesByNetwork(records.devices, selectedNetwork),
    [records.devices, selectedNetwork]
  );
  const derived = useDeviceListDerivedData({
    devices: activeDevices,
    deviceModels: records.deviceModels,
    sortBy,
    sortOrder,
    ownershipFilter,
    walletFilter,
    editState: records.editState,
    deleteState: records.deleteState,
    handleEdit: records.handleEdit,
    handleSave: records.handleSave,
    handleDelete: records.handleDelete,
  });

  if (records.loading) return <div className="p-8 text-center text-sanctuary-400">Loading devices...</div>;

  // Load failure - show an error state instead of masquerading as "no devices"
  if (records.error && records.devices.length === 0) {
    return <DeviceListLoadError error={records.error} onRetry={records.reload} />;
  }

  // Empty state
  if (records.devices.length === 0) {
    return <EmptyState />;
  }

  return (
    <DeviceListContent
      devices={activeDevices}
      sortedDevices={derived.sortedDevices}
      groupedDevices={derived.groupedDevices}
      deviceModels={records.deviceModels}
      ownedCount={derived.ownedCount}
      sharedCount={derived.sharedCount}
      viewMode={viewMode}
      setViewMode={setViewMode}
      sortBy={sortBy}
      sortOrder={sortOrder}
      setSortBy={setSortBy}
      ownershipFilter={ownershipFilter}
      setOwnershipFilter={setOwnershipFilter}
      effectiveWalletFilter={derived.effectiveWalletFilter}
      setWalletFilter={setWalletFilter}
      walletOptions={derived.walletOptions}
      unassignedCount={derived.unassignedCount}
      columnOrder={columnOrder}
      visibleColumns={visibleColumns}
      onColumnOrderChange={handleColumnOrderChange}
      onColumnVisibilityChange={handleColumnVisibilityChange}
      onColumnReset={handleColumnReset}
      exclusiveDeviceIds={derived.exclusiveDeviceIds}
      editState={records.editState}
      deleteState={records.deleteState}
      getDeviceDisplayName={derived.getDeviceDisplayName}
      getWalletCount={derived.getWalletCount}
      handleEdit={records.handleEdit}
      handleSave={records.handleSave}
      handleDelete={records.handleDelete}
      cellRenderers={derived.cellRenderers}
      selectedNetwork={selectedNetwork}
    />
  );
};
