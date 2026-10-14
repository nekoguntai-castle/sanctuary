import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveNetwork } from '../../contexts/ActiveNetworkContext';
import { useCurrency } from '../../contexts/CurrencyContext';
import { useInvalidateAllWallets } from '../../hooks/queries/useWallets';
import { useWalletSyncLifecycleClock } from '../../hooks/useWalletSyncLifecycleClock';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { createWalletCellRenderers } from '../cells/WalletCells';
import { WalletListContent } from './WalletListContent';
import { WalletListEmptyState } from './WalletListEmptyState';
import { useWalletListData } from './useWalletListData';
import { useWalletListPreferences } from './useWalletListPreferences';

function WalletListLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="p-8 text-center space-y-4">
      <ErrorAlert message="Failed to load wallets." className="inline-block" />
      <div>
        <Button variant="secondary" onClick={onRetry}>Retry</Button>
      </div>
    </div>
  );
}

export const WalletList: React.FC = () => {
  const navigate = useNavigate();
  const { selectedNetwork } = useActiveNetwork();
  const { format, formatFiat, showFiat } = useCurrency();
  const invalidateAllWallets = useInvalidateAllWallets();
  const preferences = useWalletListPreferences();
  const walletData = useWalletListData({
    selectedNetwork,
    sortBy: preferences.sortBy,
    sortOrder: preferences.sortOrder,
    timeframe: preferences.timeframe,
  });
  const syncNow = useWalletSyncLifecycleClock(walletData.filteredWallets, selectedNetwork);
  const cellRenderers = useMemo(
    () => createWalletCellRenderers({ format, formatFiat, showFiat }, syncNow),
    [format, formatFiat, showFiat, syncNow]
  );

  if (walletData.loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading wallets...</div>;
  }

  if (walletData.loadFailed) {
    return <WalletListLoadError onRetry={() => { void walletData.refetch(); }} />;
  }

  if (walletData.wallets.length === 0) {
    return (
      <WalletListEmptyState
        onCreate={() => navigate('/wallets/create')}
        onImport={() => navigate('/wallets/import')}
      />
    );
  }

  return (
    <WalletListContent
      selectedNetwork={selectedNetwork}
      filteredWallets={walletData.filteredWallets}
      sortedWallets={walletData.sortedWallets}
      totalBalance={walletData.totalBalance}
      walletIds={walletData.walletIds}
      pendingByWallet={walletData.pendingByWallet}
      walletsWithPending={walletData.walletsWithPending}
      sparklineData={walletData.sparklineData}
      timeframe={preferences.timeframe}
      setTimeframe={preferences.setTimeframe}
      viewMode={preferences.viewMode}
      setViewMode={preferences.setViewMode}
      sortBy={preferences.sortBy}
      sortOrder={preferences.sortOrder}
      setSortBy={preferences.setSortBy}
      setSort={preferences.setSort}
      columnOrder={preferences.columnOrder}
      visibleColumns={preferences.visibleColumns}
      onColumnOrderChange={preferences.handleColumnOrderChange}
      onColumnVisibilityChange={preferences.handleColumnVisibilityChange}
      onColumnReset={preferences.handleColumnReset}
      onSyncStarted={() => invalidateAllWallets()}
      onCreate={() => navigate('/wallets/create')}
      onImport={() => navigate('/wallets/import')}
      cellRenderers={cellRenderers}
      syncNow={syncNow}
    />
  );
};
