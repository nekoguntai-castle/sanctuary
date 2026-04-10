/**
 * DeviceList Header
 *
 * Contains title, ownership filter, wallet filter, view mode toggle, column config, and add button.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Plus, LayoutGrid, List as ListIcon, Users, User, Wallet, ChevronDown } from 'lucide-react';
import { Button } from '../ui/Button';
import { useNavigate } from 'react-router-dom';
import { ColumnConfigButton } from '../ui/ColumnConfigButton';
import { getWalletIcon } from '../ui/CustomIcons';
import {
  DEVICE_COLUMNS,
  DEFAULT_DEVICE_COLUMN_ORDER,
  DEFAULT_DEVICE_VISIBLE_COLUMNS,
} from '../columns/deviceColumns';
import type { ViewMode, OwnershipFilter, WalletFilter } from './types';

interface WalletOption {
  id: string;
  name: string;
  type: string;
  count: number;
}

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
  walletOptions: WalletOption[];
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
  const [walletDropdownOpen, setWalletDropdownOpen] = useState(false);
  const walletDropdownRef = useRef<HTMLDivElement>(null);

  // Close wallet dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (walletDropdownRef.current && !walletDropdownRef.current.contains(event.target as Node)) {
        setWalletDropdownOpen(false);
      }
    };

    if (walletDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [walletDropdownOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWalletDropdownOpen(false);
      }
    };

    if (walletDropdownOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [walletDropdownOpen]);

  // Derive selected wallet label
  const selectedWalletLabel = walletFilter === 'all'
    ? 'All Wallets'
    : walletFilter === 'unassigned'
    ? 'Unassigned'
    : walletOptions.find(w => w.id === walletFilter)?.name ?? 'All Wallets';

  const isWalletFilterActive = walletFilter !== 'all';
  const showWalletFilter = walletOptions.length > 0 || unassignedCount > 0;

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Hardware Devices</h2>
        <p className="text-sanctuary-500">Manage your signers and keys</p>
        <p className="text-[11px] text-sanctuary-400 mt-0.5">Devices must be removed from all wallets before they can be deleted.</p>
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

          {/* Wallet Filter Dropdown */}
          {showWalletFilter && (
            <div className="relative" ref={walletDropdownRef}>
              <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                <button
                  onClick={() => setWalletDropdownOpen(!walletDropdownOpen)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1 ${isWalletFilterActive ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                  title="Filter by wallet"
                >
                  <Wallet className="w-3 h-3" />
                  {selectedWalletLabel}
                  <ChevronDown className={`w-3 h-3 transition-transform ${walletDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {walletDropdownOpen && (
                <div className="absolute right-0 mt-2 w-64 surface-elevated rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg z-50 py-1">
                  {/* All Wallets */}
                  <button
                    onClick={() => { setWalletFilter('all'); setWalletDropdownOpen(false); }}
                    className={`w-full px-3 py-2 text-xs text-left flex items-center justify-between transition-colors ${walletFilter === 'all' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-600 dark:text-sanctuary-400 hover:surface-secondary'}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Wallet className="w-3 h-3" />
                      All Wallets
                    </span>
                    <span className="text-sanctuary-400 text-[10px]">{deviceCount}</span>
                  </button>

                  {/* Unassigned */}
                  {unassignedCount > 0 && (
                    <button
                      onClick={() => { setWalletFilter('unassigned'); setWalletDropdownOpen(false); }}
                      className={`w-full px-3 py-2 text-xs text-left flex items-center justify-between transition-colors ${walletFilter === 'unassigned' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-600 dark:text-sanctuary-400 hover:surface-secondary'}`}
                    >
                      <span className="flex items-center gap-1.5 text-sanctuary-500">
                        Unassigned
                      </span>
                      <span className="text-sanctuary-400 text-[10px]">{unassignedCount}</span>
                    </button>
                  )}

                  {/* Divider */}
                  {walletOptions.length > 0 && (
                    <div className="border-t border-sanctuary-100 dark:border-sanctuary-800 my-1" />
                  )}

                  {/* Wallet list */}
                  <div className="max-h-48 overflow-y-auto">
                    {walletOptions.map(wallet => (
                      <button
                        key={wallet.id}
                        onClick={() => { setWalletFilter(wallet.id); setWalletDropdownOpen(false); }}
                        className={`w-full px-3 py-2 text-xs text-left flex items-center justify-between transition-colors ${walletFilter === wallet.id ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-600 dark:text-sanctuary-400 hover:surface-secondary'}`}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          {getWalletIcon(wallet.type, 'w-3 h-3 flex-shrink-0')}
                          <span className="truncate">{wallet.name}</span>
                        </span>
                        <span className="text-sanctuary-400 text-[10px] ml-2 flex-shrink-0">{wallet.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
