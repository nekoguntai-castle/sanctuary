import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, LayoutGrid, List as ListIcon, User, Users, Wallet } from 'lucide-react';
import { ColumnConfigButton } from '../ui/ColumnConfigButton';
import { getWalletIcon } from '../ui/CustomIcons';
import {
  DEVICE_COLUMNS,
  DEFAULT_DEVICE_COLUMN_ORDER,
  DEFAULT_DEVICE_VISIBLE_COLUMNS,
} from '../columns/deviceColumns';
import type { DeviceWalletOption } from './deviceListData';
import type { OwnershipFilter, ViewMode, WalletFilter } from './types';

const FILTER_BUTTON_BASE = 'px-3 py-1.5 text-xs rounded-md transition-colors';
const ICON_FILTER_BUTTON_BASE = `${FILTER_BUTTON_BASE} flex items-center gap-1`;
const ACTIVE_FILTER_CLASS = 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100';
const INACTIVE_FILTER_CLASS = 'text-sanctuary-400 hover:text-sanctuary-600';

export function OwnershipFilterControl({
  deviceCount,
  ownedCount,
  sharedCount,
  ownershipFilter,
  onChange,
}: {
  deviceCount: number;
  ownedCount: number;
  sharedCount: number;
  ownershipFilter: OwnershipFilter;
  onChange: (filter: OwnershipFilter) => void;
}) {
  if (sharedCount <= 0) return null;

  return (
    <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
      <button
        onClick={() => onChange('all')}
        className={ownershipButtonClass(ownershipFilter === 'all')}
        title="Show all devices"
      >
        All ({deviceCount})
      </button>
      <button
        onClick={() => onChange('owned')}
        className={ownershipButtonClass(ownershipFilter === 'owned', true)}
        title="Show owned devices only"
      >
        <User className="w-3 h-3" />
        Owned ({ownedCount})
      </button>
      <button
        onClick={() => onChange('shared')}
        className={ownershipButtonClass(ownershipFilter === 'shared', true)}
        title="Show shared devices only"
      >
        <Users className="w-3 h-3" />
        Shared ({sharedCount})
      </button>
    </div>
  );
}

export function WalletFilterDropdown({
  deviceCount,
  walletFilter,
  walletOptions,
  unassignedCount,
  onChange,
}: {
  deviceCount: number;
  walletFilter: WalletFilter;
  walletOptions: DeviceWalletOption[];
  unassignedCount: number;
  onChange: (filter: WalletFilter) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useDismissibleDropdown(isOpen, setIsOpen);
  const showWalletFilter = walletOptions.length > 0 || unassignedCount > 0;
  const selectedLabel = getSelectedWalletLabel(walletFilter, walletOptions);

  if (!showWalletFilter) return null;

  const selectWalletFilter = (filter: WalletFilter) => {
    onChange(filter);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
        <button
          onClick={() => setIsOpen(current => !current)}
          className={walletTriggerClass(walletFilter !== 'all')}
          title="Filter by wallet"
        >
          <Wallet className="w-3 h-3" />
          {selectedLabel}
          <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <WalletFilterMenu
          deviceCount={deviceCount}
          walletFilter={walletFilter}
          walletOptions={walletOptions}
          unassignedCount={unassignedCount}
          onSelect={selectWalletFilter}
        />
      )}
    </div>
  );
}

export function ViewModeControls({
  viewMode,
  onChange,
  columnOrder,
  visibleColumns,
  onColumnOrderChange,
  onColumnVisibilityChange,
  onColumnReset,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
  columnOrder: string[];
  visibleColumns: string[];
  onColumnOrderChange: (newOrder: string[]) => void;
  onColumnVisibilityChange: (columnId: string, visible: boolean) => void;
  onColumnReset: () => void;
}) {
  return (
    <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
      <button
        onClick={() => onChange('list')}
        className={viewModeButtonClass(viewMode === 'list')}
        title="List View"
      >
        <ListIcon className="w-4 h-4" />
      </button>
      <button
        onClick={() => onChange('grouped')}
        className={viewModeButtonClass(viewMode === 'grouped')}
        title="Grouped View"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
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
  );
}

function WalletFilterMenu({
  deviceCount,
  walletFilter,
  walletOptions,
  unassignedCount,
  onSelect,
}: {
  deviceCount: number;
  walletFilter: WalletFilter;
  walletOptions: DeviceWalletOption[];
  unassignedCount: number;
  onSelect: (filter: WalletFilter) => void;
}) {
  return (
    <div className="absolute right-0 mt-2 w-64 surface-elevated rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg z-50 py-1">
      <WalletFilterMenuItem
        active={walletFilter === 'all'}
        count={deviceCount}
        onClick={() => onSelect('all')}
      >
        <span className="flex items-center gap-1.5">
          <Wallet className="w-3 h-3" />
          All Wallets
        </span>
      </WalletFilterMenuItem>

      {unassignedCount > 0 && (
        <WalletFilterMenuItem
          active={walletFilter === 'unassigned'}
          count={unassignedCount}
          onClick={() => onSelect('unassigned')}
        >
          <span className="flex items-center gap-1.5 text-sanctuary-500">Unassigned</span>
        </WalletFilterMenuItem>
      )}

      {walletOptions.length > 0 && (
        <div className="border-t border-sanctuary-100 dark:border-sanctuary-800 my-1" />
      )}

      <div className="max-h-48 overflow-y-auto">
        {walletOptions.map(wallet => (
          <WalletOptionMenuItem
            key={wallet.id}
            wallet={wallet}
            active={walletFilter === wallet.id}
            onClick={() => onSelect(wallet.id)}
          />
        ))}
      </div>
    </div>
  );
}

function WalletFilterMenuItem({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 text-xs text-left flex items-center justify-between transition-colors ${walletMenuItemClass(active)}`}
    >
      {children}
      <span className="text-sanctuary-400 text-[10px]">{count}</span>
    </button>
  );
}

function WalletOptionMenuItem({
  wallet,
  active,
  onClick,
}: {
  wallet: DeviceWalletOption;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 text-xs text-left flex items-center justify-between transition-colors ${walletMenuItemClass(active)}`}
    >
      <span className="flex items-center gap-1.5 truncate">
        {getWalletIcon(wallet.type, 'w-3 h-3 flex-shrink-0')}
        <span className="truncate">{wallet.name}</span>
      </span>
      <span className="text-sanctuary-400 text-[10px] ml-2 flex-shrink-0">{wallet.count}</span>
    </button>
  );
}

function useDismissibleDropdown(isOpen: boolean, setIsOpen: (isOpen: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, setIsOpen]);

  return ref;
}

function getSelectedWalletLabel(walletFilter: WalletFilter, walletOptions: DeviceWalletOption[]): string {
  if (walletFilter === 'all') return 'All Wallets';
  if (walletFilter === 'unassigned') return 'Unassigned';
  return walletOptions.find(wallet => wallet.id === walletFilter)?.name ?? 'All Wallets';
}

function ownershipButtonClass(active: boolean, withIcon = false): string {
  return `${withIcon ? ICON_FILTER_BUTTON_BASE : FILTER_BUTTON_BASE} ${active ? ACTIVE_FILTER_CLASS : INACTIVE_FILTER_CLASS}`;
}

function walletTriggerClass(active: boolean): string {
  return `${ICON_FILTER_BUTTON_BASE} ${active ? ACTIVE_FILTER_CLASS : INACTIVE_FILTER_CLASS}`;
}

function viewModeButtonClass(active: boolean): string {
  return `p-2 rounded-md transition-colors ${active ? ACTIVE_FILTER_CLASS : INACTIVE_FILTER_CLASS}`;
}

function walletMenuItemClass(active: boolean): string {
  return active
    ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100'
    : 'text-sanctuary-600 dark:text-sanctuary-400 hover:surface-secondary';
}
