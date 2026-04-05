import React, { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, LayoutGrid, List as ListIcon, Wallet as WalletIcon, Upload, ArrowUpDown } from 'lucide-react';
import { Button } from '../ui/Button';
import { useCurrency } from '../../contexts/CurrencyContext';
import { useUser } from '../../contexts/UserContext';
import { useWallets, useInvalidateAllWallets, usePendingTransactions, useWalletSparklines } from '../../hooks/queries/useWallets';
import { NetworkTabs, TabNetwork } from '../NetworkTabs';
import { NetworkSyncActions } from '../NetworkSyncActions';
import { ConfigurableTable } from '../ui/ConfigurableTable';
import { ColumnConfigButton } from '../ui/ColumnConfigButton';
import {
  WALLET_COLUMNS,
  DEFAULT_WALLET_COLUMN_ORDER,
  DEFAULT_WALLET_VISIBLE_COLUMNS,
  mergeWalletColumnOrder,
} from '../columns/walletColumns';
import { createWalletCellRenderers, WalletWithPending } from '../cells/WalletCells';
import { BalanceChart } from './BalanceChart';
import { WalletGridView } from './WalletGridView';

type ViewMode = 'grid' | 'table';
type SortField = 'name' | 'type' | 'devices' | 'network' | 'balance';
type SortOrder = 'asc' | 'desc';

export const WalletList: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { format, formatFiat, showFiat } = useCurrency();
  const { user, updatePreferences } = useUser();
  const invalidateAllWallets = useInvalidateAllWallets();

  // Network tab state - persist in URL
  const networkFromUrl = searchParams.get('network') as TabNetwork | null;
  const [selectedNetwork, setSelectedNetwork] = useState<TabNetwork>(
    networkFromUrl && ['mainnet', 'testnet', 'signet'].includes(networkFromUrl) ? networkFromUrl : 'mainnet'
  );

  // Update URL when network changes
  const handleNetworkChange = (network: TabNetwork) => {
    setSelectedNetwork(network);
    if (network === 'mainnet') {
      searchParams.delete('network');
    } else {
      searchParams.set('network', network);
    }
    setSearchParams(searchParams, { replace: true });
  };

  // Get view mode from user preferences, fallback to 'grid'
  const viewMode = (user?.preferences?.viewSettings?.wallets?.layout as ViewMode) || 'grid';

  const setViewMode = (mode: ViewMode) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: { ...user?.preferences?.viewSettings?.wallets, layout: mode }
      }
    });
  };

  // Get sort settings from user preferences
  const sortBy = (user?.preferences?.viewSettings?.wallets?.sortBy as SortField) || 'name';
  const sortOrder = (user?.preferences?.viewSettings?.wallets?.sortOrder as SortOrder) || 'asc';

  const setSortBy = (field: SortField) => {
    // If clicking the same field, toggle order; otherwise set new field with asc
    const newOrder = field === sortBy ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: { ...user?.preferences?.viewSettings?.wallets, sortBy: field, sortOrder: newOrder }
      }
    });
  };

  // Get column configuration from user preferences
  const columnOrder = useMemo(
    () => mergeWalletColumnOrder(user?.preferences?.viewSettings?.wallets?.columnOrder),
    [user?.preferences?.viewSettings?.wallets?.columnOrder]
  );
  const visibleColumns = user?.preferences?.viewSettings?.wallets?.visibleColumns || DEFAULT_WALLET_VISIBLE_COLUMNS;

  const handleColumnOrderChange = (newOrder: string[]) => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: { ...user?.preferences?.viewSettings?.wallets, columnOrder: newOrder }
      }
    });
  };

  const handleColumnVisibilityChange = (columnId: string, visible: boolean) => {
    const newVisible = visible
      ? [...visibleColumns, columnId]
      : visibleColumns.filter(id => id !== columnId);
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: { ...user?.preferences?.viewSettings?.wallets, visibleColumns: newVisible }
      }
    });
  };

  const handleColumnReset = () => {
    updatePreferences({
      viewSettings: {
        ...user?.preferences?.viewSettings,
        wallets: {
          ...user?.preferences?.viewSettings?.wallets,
          columnOrder: DEFAULT_WALLET_COLUMN_ORDER,
          visibleColumns: DEFAULT_WALLET_VISIBLE_COLUMNS
        }
      }
    });
  };

  // Use React Query for wallet data with automatic caching and refetching
  const { data: wallets = [], isLoading: loading } = useWallets();

  // Filter wallets by selected network
  const filteredWallets = useMemo(() =>
    wallets.filter(w => w.network === selectedNetwork),
    [wallets, selectedNetwork]
  );

  // Count wallets per network for tabs
  const walletCounts = useMemo(() => ({
    mainnet: wallets.filter(w => w.network === 'mainnet').length,
    testnet: wallets.filter(w => w.network === 'testnet').length,
    signet: wallets.filter(w => w.network === 'signet').length,
  }), [wallets]);

  // Sort wallets based on current sort settings
  const sortedWallets = useMemo(() => {
    if (!filteredWallets.length) return filteredWallets;

    return [...filteredWallets].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'devices':
          comparison = (a.deviceCount ?? 0) - (b.deviceCount ?? 0);
          break;
        case 'network':
          comparison = (a.network ?? '').localeCompare(b.network ?? '');
          break;
        case 'balance':
          comparison = a.balance - b.balance;
          break;
        default:
          comparison = 0;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredWallets, sortBy, sortOrder]);

  const totalBalance = filteredWallets.reduce((acc, w) => acc + w.balance, 0);
  const walletIds = filteredWallets.map(w => w.id);

  // Fetch pending transactions for all filtered wallets
  const { data: pendingTransactions } = usePendingTransactions(walletIds);

  // Fetch per-wallet sparkline data (real 1W balance history)
  const sparklineData = useWalletSparklines(filteredWallets);

  // Calculate net pending balance per wallet (incoming - outgoing)
  const pendingByWallet = useMemo(() => {
    const result: Record<string, { net: number; count: number; hasIncoming: boolean; hasOutgoing: boolean }> = {};

    for (const tx of pendingTransactions) {
      if (!result[tx.walletId]) {
        result[tx.walletId] = { net: 0, count: 0, hasIncoming: false, hasOutgoing: false };
      }
      // Amount is already signed (negative for sent, positive for received)
      result[tx.walletId].net += tx.amount;
      result[tx.walletId].count++;
      if (tx.type === 'received') {
        result[tx.walletId].hasIncoming = true;
      } else {
        result[tx.walletId].hasOutgoing = true;
      }
    }

    return result;
  }, [pendingTransactions]);

  // Create wallets with pending data for ConfigurableTable
  const walletsWithPending: WalletWithPending[] = useMemo(() => {
    return sortedWallets.map(wallet => ({
      ...wallet,
      pendingData: pendingByWallet[wallet.id],
    }));
  }, [sortedWallets, pendingByWallet]);

  // Create cell renderers with currency formatting
  const cellRenderers = useMemo(
    () => createWalletCellRenderers({ format, formatFiat, showFiat }),
    [format, formatFiat, showFiat]
  );

  // Loading state
  if (loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading wallets...</div>;
  }

  // Empty state - show clean "create your first wallet" UI
  if (wallets.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in pb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Wallet Overview</h2>
            <p className="text-sanctuary-500">Manage your wallets and spending accounts</p>
          </div>
        </div>

        <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full surface-secondary mb-4">
            <WalletIcon className="w-8 h-8 text-sanctuary-400" />
          </div>
          <h3 className="text-xl font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-2">No Wallets Yet</h3>
          <p className="text-sanctuary-500 mb-6 max-w-md mx-auto">
            Create your first wallet to start managing your Bitcoin. Connect your hardware devices and build single-sig or multi-sig wallets with full self-custody.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => navigate('/wallets/create')}>
              <Plus className="w-4 h-4 mr-2" />
              Create Wallet
            </Button>
            <Button variant="secondary" onClick={() => navigate('/wallets/import')}>
              <Upload className="w-4 h-4 mr-2" />
              Import Wallet
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-8">

      {/* Network Tabs */}
      <div className="flex items-center justify-between">
        <NetworkTabs
          selectedNetwork={selectedNetwork}
          onNetworkChange={handleNetworkChange}
          walletCounts={walletCounts}
        />
      </div>

      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">
            {selectedNetwork.charAt(0).toUpperCase() + selectedNetwork.slice(1)} Wallets
          </h2>
          <p className="text-sanctuary-500">Manage your {selectedNetwork} wallets and spending accounts</p>
        </div>
        <div className="flex items-center space-x-2">
            {/* Sort dropdown - shown in grid view */}
            {viewMode === 'grid' && (
              <div className="relative">
                <select
                  value={`${sortBy}-${sortOrder}`}
                  onChange={(e) => {
                    const [field, order] = e.target.value.split('-') as [SortField, SortOrder];
                    updatePreferences({
                      viewSettings: {
                        ...user?.preferences?.viewSettings,
                        wallets: { ...user?.preferences?.viewSettings?.wallets, sortBy: field, sortOrder: order }
                      }
                    });
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
            )}
            <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
                <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                >
                    <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                    onClick={() => setViewMode('table')}
                    className={`p-2 rounded-md transition-colors ${viewMode === 'table' ? 'surface-secondary text-sanctuary-900 dark:text-sanctuary-100' : 'text-sanctuary-400 hover:text-sanctuary-600'}`}
                >
                    <ListIcon className="w-4 h-4" />
                </button>
                {/* Column Config - only in table view */}
                {viewMode === 'table' && (
                  <ColumnConfigButton
                    columns={WALLET_COLUMNS}
                    columnOrder={columnOrder}
                    visibleColumns={visibleColumns}
                    onOrderChange={handleColumnOrderChange}
                    onVisibilityChange={handleColumnVisibilityChange}
                    onReset={handleColumnReset}
                    defaultOrder={DEFAULT_WALLET_COLUMN_ORDER}
                    defaultVisible={DEFAULT_WALLET_VISIBLE_COLUMNS}
                  />
                )}
            </div>
            {/* Compact Sync Actions */}
            <div className="flex surface-elevated p-1 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
              <NetworkSyncActions
                network={selectedNetwork}
                walletCount={filteredWallets.length}
                compact={true}
                onSyncStarted={() => invalidateAllWallets()}
              />
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/wallets/import')}>
                <Upload className="w-4 h-4 mr-1.5" />
                Import
            </Button>
            <Button size="sm" onClick={() => navigate('/wallets/create')}>
                <Plus className="w-4 h-4 mr-1.5" />
                Create
            </Button>
        </div>
      </div>

      {/* Stats & Trends Card */}
      <BalanceChart
        totalBalance={totalBalance}
        walletCount={filteredWallets.length}
        walletIds={walletIds}
        selectedNetwork={selectedNetwork}
      />

      {/* Grid View */}
      {viewMode === 'grid' && (
        <WalletGridView
          wallets={sortedWallets}
          pendingByWallet={pendingByWallet}
          sparklineData={sparklineData}
        />
      )}

      {/* Table View */}
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
          onSort={(field) => setSortBy(field as SortField)}
          onRowClick={(wallet) => navigate(`/wallets/${wallet.id}`)}
          emptyMessage="No wallets found"
        />
      )}

      </div>
  );
};
