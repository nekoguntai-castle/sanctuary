import { ArrowUpDown, LayoutGrid, List as ListIcon, Plus, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { ColumnConfigButton } from '../ui/ColumnConfigButton';
import { NetworkSyncActions } from '../NetworkSyncActions';
import {
  DEFAULT_WALLET_COLUMN_ORDER,
  DEFAULT_WALLET_VISIBLE_COLUMNS,
  WALLET_COLUMNS,
} from '../columns/walletColumns';
import type { TabNetwork } from '../NetworkTabs';
import { formatNetworkTitle } from './walletListData';
import type { WalletSortField, WalletSortOrder, WalletViewMode } from './types';

export function WalletListHeader({
  selectedNetwork,
  viewMode,
  sortBy,
  sortOrder,
  setViewMode,
  setSort,
  filteredWalletCount,
  columnOrder,
  visibleColumns,
  onColumnOrderChange,
  onColumnVisibilityChange,
  onColumnReset,
  onSyncStarted,
  onCreate,
  onImport,
}: {
  selectedNetwork: TabNetwork;
  viewMode: WalletViewMode;
  sortBy: WalletSortField;
  sortOrder: WalletSortOrder;
  setViewMode: (mode: WalletViewMode) => void;
  setSort: (field: WalletSortField, order: WalletSortOrder) => void;
  filteredWalletCount: number;
  columnOrder: string[];
  visibleColumns: string[];
  onColumnOrderChange: (newOrder: string[]) => void;
  onColumnVisibilityChange: (columnId: string, visible: boolean) => void;
  onColumnReset: () => void;
  onSyncStarted: () => void;
  onCreate: () => void;
  onImport: () => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">
          {formatNetworkTitle(selectedNetwork)} Wallets
        </h2>
        <p className="text-sanctuary-500">Manage your {selectedNetwork} wallets and spending accounts</p>
      </div>
      <div className="flex items-center space-x-2">
        <GridSortControl
          viewMode={viewMode}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onChange={setSort}
        />
        <WalletViewControls
          viewMode={viewMode}
          setViewMode={setViewMode}
          columnOrder={columnOrder}
          visibleColumns={visibleColumns}
          onColumnOrderChange={onColumnOrderChange}
          onColumnVisibilityChange={onColumnVisibilityChange}
          onColumnReset={onColumnReset}
        />
        <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
          <NetworkSyncActions
            network={selectedNetwork}
            walletCount={filteredWalletCount}
            compact={true}
            onSyncStarted={onSyncStarted}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={onImport}>
          <Upload className="w-4 h-4 mr-1.5" />
          Import
        </Button>
        <Button size="sm" onClick={onCreate}>
          <Plus className="w-4 h-4 mr-1.5" />
          Create
        </Button>
      </div>
    </div>
  );
}

function GridSortControl({
  viewMode,
  sortBy,
  sortOrder,
  onChange,
}: {
  viewMode: WalletViewMode;
  sortBy: WalletSortField;
  sortOrder: WalletSortOrder;
  onChange: (field: WalletSortField, order: WalletSortOrder) => void;
}) {
  if (viewMode !== 'grid') return null;

  return (
    <div className="relative">
      <select
        value={`${sortBy}-${sortOrder}`}
        onChange={(event) => {
          const [field, order] = event.target.value.split('-') as [WalletSortField, WalletSortOrder];
          onChange(field, order);
        }}
        className="appearance-none surface-elevated border border-sanctuary-200 dark:border-sanctuary-800 rounded-lg px-3 py-2 pr-8 text-sm text-sanctuary-700 dark:text-sanctuary-300 cursor-pointer hover:border-sanctuary-300 dark:hover:border-sanctuary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <option value="name-asc">Name (A-Z)</option>
        <option value="name-desc">Name (Z-A)</option>
        <option value="balance-desc">Balance (High-Low)</option>
        <option value="balance-asc">Balance (Low-High)</option>
        <option value="type-asc">Type (A-Z)</option>
        <option value="type-desc">Type (Z-A)</option>
        <option value="devices-desc">Devices (Most)</option>
        <option value="devices-asc">Devices (Least)</option>
        <option value="network-asc">Network (A-Z)</option>
      </select>
      <ArrowUpDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-sanctuary-400 pointer-events-none" />
    </div>
  );
}

function WalletViewControls({
  viewMode,
  setViewMode,
  columnOrder,
  visibleColumns,
  onColumnOrderChange,
  onColumnVisibilityChange,
  onColumnReset,
}: {
  viewMode: WalletViewMode;
  setViewMode: (mode: WalletViewMode) => void;
  columnOrder: string[];
  visibleColumns: string[];
  onColumnOrderChange: (newOrder: string[]) => void;
  onColumnVisibilityChange: (columnId: string, visible: boolean) => void;
  onColumnReset: () => void;
}) {
  return (
    <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
      <button
        onClick={() => setViewMode('grid')}
        className={viewModeButtonClass(viewMode === 'grid')}
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
      <button
        onClick={() => setViewMode('table')}
        className={viewModeButtonClass(viewMode === 'table')}
      >
        <ListIcon className="w-4 h-4" />
      </button>
      {viewMode === 'table' && (
        <ColumnConfigButton
          columns={WALLET_COLUMNS}
          columnOrder={columnOrder}
          visibleColumns={visibleColumns}
          onOrderChange={onColumnOrderChange}
          onVisibilityChange={onColumnVisibilityChange}
          onReset={onColumnReset}
          defaultOrder={DEFAULT_WALLET_COLUMN_ORDER}
          defaultVisible={DEFAULT_WALLET_VISIBLE_COLUMNS}
        />
      )}
    </div>
  );
}

function viewModeButtonClass(active: boolean): string {
  return `p-2 rounded-md transition-colors ${active ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`;
}
