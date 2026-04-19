import type React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Wallet } from '../../src/api/wallets';
import { ConfigurableTable } from '../ui/ConfigurableTable';
import type { CellRendererProps } from '../ui/ConfigurableTable';
import { WALLET_COLUMNS } from '../columns/walletColumns';
import type { WalletWithPending } from '../cells/WalletCells';
import type { TabNetwork } from '../NetworkTabs';
import { NetworkTabs } from '../NetworkTabs';
import { BalanceChart } from './BalanceChart';
import { WalletGridView } from './WalletGridView';
import { WalletListHeader } from './WalletListHeader';
import type { PendingData, WalletCountsByNetwork, WalletSortField, WalletSortOrder, WalletViewMode } from './types';

export function WalletListContent({
  selectedNetwork,
  onNetworkChange,
  walletCounts,
  filteredWallets,
  sortedWallets,
  totalBalance,
  walletIds,
  pendingByWallet,
  walletsWithPending,
  sparklineData,
  viewMode,
  setViewMode,
  sortBy,
  sortOrder,
  setSortBy,
  setSort,
  columnOrder,
  visibleColumns,
  onColumnOrderChange,
  onColumnVisibilityChange,
  onColumnReset,
  onSyncStarted,
  onCreate,
  onImport,
  cellRenderers,
}: {
  selectedNetwork: TabNetwork;
  onNetworkChange: (network: TabNetwork) => void;
  walletCounts: WalletCountsByNetwork;
  filteredWallets: Wallet[];
  sortedWallets: Wallet[];
  totalBalance: number;
  walletIds: string[];
  pendingByWallet: Record<string, PendingData>;
  walletsWithPending: WalletWithPending[];
  sparklineData: Record<string, number[]>;
  viewMode: WalletViewMode;
  setViewMode: (mode: WalletViewMode) => void;
  sortBy: WalletSortField;
  sortOrder: WalletSortOrder;
  setSortBy: (field: WalletSortField) => void;
  setSort: (field: WalletSortField, order: WalletSortOrder) => void;
  columnOrder: string[];
  visibleColumns: string[];
  onColumnOrderChange: (newOrder: string[]) => void;
  onColumnVisibilityChange: (columnId: string, visible: boolean) => void;
  onColumnReset: () => void;
  onSyncStarted: () => void;
  onCreate: () => void;
  onImport: () => void;
  cellRenderers: Record<string, React.FC<CellRendererProps<WalletWithPending>>>;
}) {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 animate-fade-in pb-8">
      <div className="flex items-center justify-between">
        <NetworkTabs
          selectedNetwork={selectedNetwork}
          onNetworkChange={onNetworkChange}
          walletCounts={walletCounts}
        />
      </div>

      <WalletListHeader
        selectedNetwork={selectedNetwork}
        viewMode={viewMode}
        sortBy={sortBy}
        sortOrder={sortOrder}
        setViewMode={setViewMode}
        setSort={setSort}
        filteredWalletCount={filteredWallets.length}
        columnOrder={columnOrder}
        visibleColumns={visibleColumns}
        onColumnOrderChange={onColumnOrderChange}
        onColumnVisibilityChange={onColumnVisibilityChange}
        onColumnReset={onColumnReset}
        onSyncStarted={onSyncStarted}
        onCreate={onCreate}
        onImport={onImport}
      />

      <BalanceChart
        totalBalance={totalBalance}
        walletCount={filteredWallets.length}
        walletIds={walletIds}
        selectedNetwork={selectedNetwork}
      />

      {viewMode === 'grid' && (
        <WalletGridView
          wallets={sortedWallets}
          pendingByWallet={pendingByWallet}
          sparklineData={sparklineData}
        />
      )}

      {viewMode === 'table' && (
        <ConfigurableTable<WalletWithPending>
          columns={WALLET_COLUMNS}
          columnOrder={columnOrder}
          visibleColumns={visibleColumns}
          data={walletsWithPending}
          keyExtractor={(wallet) => wallet.id}
          cellRenderers={cellRenderers}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={(field) => setSortBy(field as WalletSortField)}
          onRowClick={(wallet) => navigate(`/wallets/${wallet.id}`)}
          emptyMessage="No wallets found"
        />
      )}
    </div>
  );
}
