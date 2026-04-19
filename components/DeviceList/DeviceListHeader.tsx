/**
 * DeviceList Header
 *
 * Contains title, ownership filter, wallet filter, view mode toggle, column config, and add button.
 */

import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { useNavigate } from 'react-router-dom';
import type { ViewMode, OwnershipFilter, WalletFilter } from './types';
import type { DeviceWalletOption } from './deviceListData';
import { OwnershipFilterControl, ViewModeControls, WalletFilterDropdown } from './DeviceListHeaderControls';

interface DeviceListHeaderProps {
  deviceCount: number;
  ownedCount: number;
  sharedCount: number;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  ownershipFilter: OwnershipFilter;
  setOwnershipFilter: (filter: OwnershipFilter) => void;
  walletFilter: WalletFilter;
  setWalletFilter: (filter: WalletFilter) => void;
  walletOptions: DeviceWalletOption[];
  unassignedCount: number;
  columnOrder: string[];
  visibleColumns: string[];
  onColumnOrderChange: (newOrder: string[]) => void;
  onColumnVisibilityChange: (columnId: string, visible: boolean) => void;
  onColumnReset: () => void;
}

export const DeviceListHeader: React.FC<DeviceListHeaderProps> = ({
  deviceCount,
  ownedCount,
  sharedCount,
  viewMode,
  setViewMode,
  ownershipFilter,
  setOwnershipFilter,
  walletFilter,
  setWalletFilter,
  walletOptions,
  unassignedCount,
  columnOrder,
  visibleColumns,
  onColumnOrderChange,
  onColumnVisibilityChange,
  onColumnReset,
}) => {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Hardware Devices</h2>
        <p className="text-sanctuary-500">Manage your signers and keys</p>
        <p className="text-[11px] text-sanctuary-400 mt-0.5">Devices must be removed from all wallets before they can be deleted.</p>
      </div>
      <div className="flex items-center space-x-3">
          <OwnershipFilterControl
            deviceCount={deviceCount}
            ownedCount={ownedCount}
            sharedCount={sharedCount}
            ownershipFilter={ownershipFilter}
            onChange={setOwnershipFilter}
          />
          <WalletFilterDropdown
            deviceCount={deviceCount}
            walletFilter={walletFilter}
            walletOptions={walletOptions}
            unassignedCount={unassignedCount}
            onChange={setWalletFilter}
          />
          <ViewModeControls
            viewMode={viewMode}
            onChange={setViewMode}
            columnOrder={columnOrder}
            visibleColumns={visibleColumns}
            onColumnOrderChange={onColumnOrderChange}
            onColumnVisibilityChange={onColumnVisibilityChange}
            onColumnReset={onColumnReset}
          />
          <Button onClick={() => navigate('/devices/connect')}>
              <Plus className="w-4 h-4 mr-2" />
              Connect New Device
          </Button>
      </div>
    </div>
  );
};
