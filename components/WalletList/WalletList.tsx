import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrency } from '../../contexts/CurrencyContext';
import { useInvalidateAllWallets } from '../../hooks/queries/useWallets';
import { createWalletCellRenderers } from '../cells/WalletCells';
import { WalletListContent } from './WalletListContent';
import { WalletListEmptyState } from './WalletListEmptyState';
import { useWalletListData } from './useWalletListData';
import { useWalletListPreferences } from './useWalletListPreferences';
import { useWalletNetworkParam } from './useWalletNetworkParam';

export const WalletList: React.FC = () => {
  const navigate = useNavigate();
  const { format, formatFiat, showFiat } = useCurrency();
  const invalidateAllWallets = useInvalidateAllWallets();
  const preferences = useWalletListPreferences();
  const { selectedNetwork, handleNetworkChange } = useWalletNetworkParam();
  const walletData = useWalletListData({
    selectedNetwork,
    sortBy: preferences.sortBy,
    sortOrder: preferences.sortOrder,
  });
  const cellRenderers = useMemo(
    () => createWalletCellRenderers({ format, formatFiat, showFiat }),
    [format, formatFiat, showFiat]
  );

  if (walletData.loading) {
    return <div className="p-8 text-center text-sanctuary-400">Loading wallets...</div>;
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
      onNetworkChange={handleNetworkChange}
      walletCounts={walletData.walletCounts}
      filteredWallets={walletData.filteredWallets}
      sortedWallets={walletData.sortedWallets}
      totalBalance={walletData.totalBalance}
      walletIds={walletData.walletIds}
      pendingByWallet={walletData.pendingByWallet}
      walletsWithPending={walletData.walletsWithPending}
      sparklineData={walletData.sparklineData}
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
    />
  );
};
