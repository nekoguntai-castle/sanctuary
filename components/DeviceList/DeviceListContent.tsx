import type React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Device, HardwareDeviceModel } from '../../types';
import { ConfigurableTable } from '../ui/ConfigurableTable';
import type { CellRendererProps } from '../ui/ConfigurableTable';
import { DEVICE_COLUMNS } from '../columns/deviceColumns';
import type { DeviceWithWallets } from '../cells/DeviceCells';
import type {
  DeviceGroupedDeleteState,
  DeviceGroupedEditState,
  OwnershipFilter,
  SortField,
  SortOrder,
  ViewMode,
  WalletFilter,
} from './types';
import { DeviceGroupedView } from './DeviceGroupedView';
import { DeviceListHeader } from './DeviceListHeader';
import { WalletFilterBanner } from './WalletFilterBanner';
import type { DeviceWalletOption } from './deviceListData';

export function DeviceListContent({
  devices,
  sortedDevices,
  groupedDevices,
  deviceModels,
  ownedCount,
  sharedCount,
  viewMode,
  setViewMode,
  sortBy,
  sortOrder,
  setSortBy,
  ownershipFilter,
  setOwnershipFilter,
  effectiveWalletFilter,
  setWalletFilter,
  walletOptions,
  unassignedCount,
  columnOrder,
  visibleColumns,
  onColumnOrderChange,
  onColumnVisibilityChange,
  onColumnReset,
  exclusiveDeviceIds,
  editState,
  deleteState,
  getDeviceDisplayName,
  getWalletCount,
  handleEdit,
  handleSave,
  handleDelete,
  cellRenderers,
}: {
  devices: Device[];
  sortedDevices: Device[];
  groupedDevices: Record<string, Device[]>;
  deviceModels: HardwareDeviceModel[];
  ownedCount: number;
  sharedCount: number;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  sortBy: SortField;
  sortOrder: SortOrder;
  setSortBy: (field: SortField) => void;
  ownershipFilter: OwnershipFilter;
  setOwnershipFilter: (filter: OwnershipFilter) => void;
  effectiveWalletFilter: WalletFilter;
  setWalletFilter: (filter: WalletFilter) => void;
  walletOptions: DeviceWalletOption[];
  unassignedCount: number;
  columnOrder: string[];
  visibleColumns: string[];
  onColumnOrderChange: (newOrder: string[]) => void;
  onColumnVisibilityChange: (columnId: string, visible: boolean) => void;
  onColumnReset: () => void;
  exclusiveDeviceIds: Set<string>;
  editState: DeviceGroupedEditState;
  deleteState: DeviceGroupedDeleteState;
  getDeviceDisplayName: (type: string) => string;
  getWalletCount: (device: Device) => number;
  handleEdit: (device: Device) => void;
  handleSave: (device: Device) => Promise<void>;
  handleDelete: (device: Device) => Promise<void>;
  cellRenderers: Record<string, React.FC<CellRendererProps<DeviceWithWallets>>>;
}) {
  const navigate = useNavigate();
  const devicesWithWallets: DeviceWithWallets[] = sortedDevices;

  return (
    <div className="space-y-6 animate-fade-in pb-8">
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
        onColumnOrderChange={onColumnOrderChange}
        onColumnVisibilityChange={onColumnVisibilityChange}
        onColumnReset={onColumnReset}
      />

      <WalletFilterBanner
        effectiveWalletFilter={effectiveWalletFilter}
        sortedDeviceCount={sortedDevices.length}
        exclusiveDeviceCount={exclusiveDeviceIds.size}
        onClear={() => setWalletFilter('all')}
      />

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

      {viewMode === 'grouped' && (
        <DeviceGroupedView
          groupedDevices={groupedDevices}
          editState={editState}
          deleteState={deleteState}
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
}
