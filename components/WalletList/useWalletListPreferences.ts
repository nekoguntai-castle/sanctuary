import { useMemo } from 'react';
import { useUser } from '../../contexts/UserContext';
import {
  DEFAULT_WALLET_COLUMN_ORDER,
  DEFAULT_WALLET_VISIBLE_COLUMNS,
  mergeWalletColumnOrder,
} from '../columns/walletColumns';
import type { WalletSortField, WalletSortOrder, WalletViewMode } from './types';

export function useWalletListPreferences() {
  const { user, updatePreferences } = useUser();
  const walletSettings = user?.preferences?.viewSettings?.wallets;

  const updateWalletSettings = (patch: Record<string, unknown>) => {
    updatePreferences({
      viewSettings: {
        ...(user?.preferences?.viewSettings ?? {}),
        wallets: { ...(walletSettings ?? {}), ...patch }
      }
    });
  };

  const viewMode = (walletSettings?.layout as WalletViewMode) || 'grid';
  const sortBy = (walletSettings?.sortBy as WalletSortField) || 'name';
  const sortOrder = (walletSettings?.sortOrder as WalletSortOrder) || 'asc';
  const columnOrder = useMemo(
    () => mergeWalletColumnOrder(walletSettings?.columnOrder),
    [walletSettings?.columnOrder]
  );
  const visibleColumns = walletSettings?.visibleColumns || DEFAULT_WALLET_VISIBLE_COLUMNS;

  const setViewMode = (mode: WalletViewMode) => {
    updateWalletSettings({ layout: mode });
  };

  const setSortBy = (field: WalletSortField) => {
    const newOrder = field === sortBy ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
    updateWalletSettings({ sortBy: field, sortOrder: newOrder });
  };

  const setSort = (field: WalletSortField, order: WalletSortOrder) => {
    updateWalletSettings({ sortBy: field, sortOrder: order });
  };

  const handleColumnOrderChange = (newOrder: string[]) => {
    updateWalletSettings({ columnOrder: newOrder });
  };

  const handleColumnVisibilityChange = (columnId: string, visible: boolean) => {
    const newVisible = visible
      ? [...visibleColumns, columnId]
      : visibleColumns.filter(id => id !== columnId);
    updateWalletSettings({ visibleColumns: newVisible });
  };

  const handleColumnReset = () => {
    updateWalletSettings({
      columnOrder: DEFAULT_WALLET_COLUMN_ORDER,
      visibleColumns: DEFAULT_WALLET_VISIBLE_COLUMNS
    });
  };

  return {
    viewMode,
    setViewMode,
    sortBy,
    sortOrder,
    setSortBy,
    setSort,
    columnOrder,
    visibleColumns,
    handleColumnOrderChange,
    handleColumnVisibilityChange,
    handleColumnReset,
  };
}
