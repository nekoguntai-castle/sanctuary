/**
 * DeviceList Component
 *
 * Main orchestrator for device listing with list and grouped views.
 * Manages state, data loading, and delegates rendering to subcomponents.
 */

import React from 'react';
import { EmptyState } from './EmptyState';
import { DeviceListContent } from './DeviceListContent';
import { useDeviceListDerivedData } from './useDeviceListDerivedData';
import { useDeviceListPreferences } from './useDeviceListPreferences';
import { useDeviceListRecords } from './useDeviceListRecords';

export const DeviceList: React.FC = () => {
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
  const derived = useDeviceListDerivedData({
    devices: records.devices,
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

  // Empty state
  if (records.devices.length === 0) {
    return <EmptyState />;
  }

  return (
    <DeviceListContent
      devices={records.devices}
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
    />
  );
};
