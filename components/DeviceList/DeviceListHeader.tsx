/**
 * DeviceList Header
 *
 * Contains title, ownership filter, view mode toggle, column config, and add button.
 */

import React from 'react';
import { Plus, LayoutGrid, List as ListIcon, Users, User } from 'lucide-react';
import { Button } from '../ui/Button';
import { useNavigate } from 'react-router-dom';
import { ColumnConfigButton } from '../ui/ColumnConfigButton';
import {
  DEVICE_COLUMNS,
  DEFAULT_DEVICE_COLUMN_ORDER,
  DEFAULT_DEVICE_VISIBLE_COLUMNS,
} from '../columns/deviceColumns';
import type { ViewMode, OwnershipFilter } from './types';

interface DeviceListHeaderProps {
  deviceCount: number;
  ownedCount: number;
  sharedCount: number;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  ownershipFilter: OwnershipFilter;
  setOwnershipFilter: (filter: OwnershipFilter) => void;
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
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Hardware Devices</h2>
        <p className="text-sanctuary-500">Manage your signers and keys</p>
      </div>
      <div className="flex items-center space-x-3">
          {/* Ownership Filter */}
          {sharedCount > 0 && (
            <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
              <button
                onClick={() => setOwnershipFilter('all')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${ownershipFilter === 'all' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                title="Show all devices"
              >
                All ({deviceCount})
              </button>
              <button
                onClick={() => setOwnershipFilter('owned')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1 ${ownershipFilter === 'owned' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                title="Show owned devices only"
              >
                <User className="w-3 h-3" />
                Owned ({ownedCount})
              </button>
              <button
                onClick={() => setOwnershipFilter('shared')}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1 ${ownershipFilter === 'shared' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                title="Show shared devices only"
              >
                <Users className="w-3 h-3" />
                Shared ({sharedCount})
              </button>
            </div>
          )}
          {/* View Mode Toggle */}
          <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
              <button
                  onClick={() => setViewMode('list')}
                  className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                  title="List View"
              >
                  <ListIcon className="w-4 h-4" />
              </button>
              <button
                  onClick={() => setViewMode('grouped')}
                  className={`p-2 rounded-md transition-colors ${viewMode === 'grouped' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                  title="Grouped View"
              >
                  <LayoutGrid className="w-4 h-4" />
              </button>
              {/* Column Config - only in list view */}
              {viewMode === 'list' && (
                <ColumnConfigButton
                  columns={DEVICE_COLUMNS}
                  columnOrder={columnOrder}
                  visibleColumns={visibleColumns}
                  onOrderChange={onColumnOrderChange}
                  onVisibilityChange={onColumnVisibilityChange}
                  onReset={onColumnReset}
                  defaultOrder={DEFAULT_DEVICE_COLUMN_ORDER}
                  defaultVisible={DEFAULT_DEVICE_VISIBLE_COLUMNS}
                />
              )}
          </div>
          <Button onClick={() => navigate('/devices/connect')}>
              <Plus className="w-4 h-4 mr-2" />
              Connect New Device
          </Button>
      </div>
    </div>
  );
};
