import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAppNotifications } from '../../contexts/AppNotificationContext';
import { useUser } from '../../contexts/UserContext';
import { useBitcoinStatus } from '../../hooks/queries/useBitcoin';
import { useWalletLabels } from '../../hooks/queries/useWalletLabels';
import { useAIStatus } from '../../hooks/useAIStatus';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { useWalletLogs } from '../../hooks/websocket';
import { useAddressLabels } from './hooks/useAddressLabels';
import { useAITransactionFilter } from './hooks/useAITransactionFilter';
import { useTransactionFilters } from './hooks/useTransactionFilters';
import { useUtxoActions } from './hooks/useUtxoActions';
import { useWalletAgentLinks } from './hooks/useWalletAgentLinks';
import { useWalletData } from './hooks/useWalletData';
import { useWalletDetailAddressActions } from './hooks/useWalletDetailAddressActions';
import { useWalletDetailModalState } from './hooks/useWalletDetailModalState';
import { useWalletDetailTabs } from './hooks/useWalletDetailTabs';
import { useWalletDraftNotifications } from './hooks/useWalletDraftNotifications';
import { useWalletMutations } from './hooks/useWalletMutations';
import { useWalletSharing } from './hooks/useWalletSharing';
import { useWalletSync } from './hooks/useWalletSync';
import { useWalletWebSocket } from './hooks/useWalletWebSocket';
import type { AccessSubTab, AddressSubTab, SettingsSubTab } from './types';

export const useWalletDetailController = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const { handleError } = useErrorHandler();
  const { addNotification: addAppNotification, removeNotificationsByType } = useAppNotifications();
  const highlightTxId = (location.state as { highlightTxId?: string } | null)?.highlightTxId;
  const { data: bitcoinStatus } = useBitcoinStatus();
  const { enabled: aiEnabled } = useAIStatus();

  const {
    wallet, setWallet,
    devices,
    loading, error, setError,
    transactions, setTransactions,
    transactionStats,
    hasMoreTx, loadingMoreTx, loadMoreTransactions,
    utxos, setUTXOs,
    utxoSummary,
    hasMoreUtxos, loadingMoreUtxos, loadMoreUtxos,
    utxoStats, setUtxoStats, loadingUtxoStats, loadUtxosForStats,
    privacyData, privacySummary, showPrivacy,
    addresses, setAddresses, walletAddressStrings,
    addressSummary, hasMoreAddresses, loadingAddresses,
    loadAddresses, loadAddressSummary, addressOffset, ADDRESS_PAGE_SIZE,
    draftsCount, setDraftsCount,
    explorerUrl,
    groups,
    walletShareInfo, setWalletShareInfo,
    fetchData,
  } = useWalletData({ id, user });
  const walletUserRole = wallet?.userRole || 'viewer';

  const {
    syncing, setSyncing,
    repairing,
    syncRetryInfo, setSyncRetryInfo,
    handleSync, handleFullResync, handleRepairWallet,
  } = useWalletSync({
    walletId: id,
    onDataRefresh: () => fetchData(true),
  });

  const {
    filters: txFilters,
    setTypeFilter, setConfirmationFilter, setDatePreset,
    setCustomDateRange, setLabelFilter, clearAllFilters,
    hasActiveFilters,
    filteredTransactions: manuallyFiltered,
  } = useTransactionFilters({
    transactions,
    walletAddresses: walletAddressStrings,
    confirmationThreshold: bitcoinStatus?.confirmationThreshold,
    deepConfirmationThreshold: bitcoinStatus?.deepConfirmationThreshold,
  });

  const {
    aiQueryFilter, setAiQueryFilter,
    filteredTransactions,
    aiAggregationResult,
  } = useAITransactionFilter({ transactions: manuallyFiltered });

  const {
    userSearchQuery, userSearchResults, searchingUsers, handleSearchUsers,
    selectedGroupToAdd, setSelectedGroupToAdd,
    addGroup, updateGroupRole, removeGroup,
    sharingLoading, handleShareWithUser, handleRemoveUserAccess,
    deviceSharePrompt, handleShareDevicesWithUser, dismissDeviceSharePrompt,
    handleTransferComplete,
  } = useWalletSharing({
    walletId: id,
    wallet,
    devices,
    walletShareInfo,
    groups,
    onDataRefresh: () => fetchData(true),
    setWalletShareInfo,
    setWallet,
  });

  const { data: walletLabels = [] } = useWalletLabels(id);

  const {
    editingAddressId,
    availableLabels,
    selectedLabelIds,
    savingAddressLabels,
    handleEditAddressLabels,
    handleSaveAddressLabels,
    handleToggleAddressLabel,
    handleCancelEditLabels,
  } = useAddressLabels({
    walletId: id,
    walletLabels,
    setAddresses,
    handleError,
  });

  const {
    selectedUtxos,
    handleToggleFreeze,
    handleToggleSelect,
    handleSendSelected,
  } = useUtxoActions({
    walletId: id,
    utxos,
    setUTXOs,
    setUtxoStats,
    handleError,
    navigate,
  });

  const {
    isEditingName,
    setIsEditingName,
    editedName,
    setEditedName,
    handleUpdateWallet,
  } = useWalletMutations({
    wallet,
    walletId: id,
    setWallet,
    handleError,
  });

  const { setActiveTab, visibleActiveTab } = useWalletDetailTabs({
    locationState: location.state,
    hasWallet: Boolean(wallet),
    walletUserRole,
  });
  const [addressSubTab, setAddressSubTab] = useState<AddressSubTab>('receive');
  const [accessSubTab, setAccessSubTab] = useState<AccessSubTab>('ownership');
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('general');
  const [showDangerZone, setShowDangerZone] = useState(false);
  const walletAgentLinks = useWalletAgentLinks(id, user?.isAdmin);

  const { logs, isPaused, isLoading: logsLoading, clearLogs, togglePause } = useWalletLogs(id, {
    enabled: visibleActiveTab === 'log',
    maxEntries: 500,
  });

  useWalletWebSocket({
    walletId: id,
    wallet,
    setWallet,
    setTransactions,
    setSyncing,
    setSyncRetryInfo,
    fetchData,
  });

  useEffect(() => {
    if (!id || visibleActiveTab !== 'stats') return;
    if (utxoStats.length > 0 || loadingUtxoStats) return;
    loadUtxosForStats(id);
  }, [visibleActiveTab, id, utxoStats.length, loadingUtxoStats]);

  const {
    handleLoadMoreAddressPage,
    handleGenerateMoreAddresses,
    handleFetchUnusedAddresses,
  } = useWalletDetailAddressActions({
    walletId: id,
    loadingAddresses,
    hasMoreAddresses,
    loadAddresses,
    loadAddressSummary,
    addressOffset,
    addressPageSize: ADDRESS_PAGE_SIZE,
    handleError,
  });

  const handleLabelsChange = () => {
    if (id) {
      fetchData(true);
    }
  };

  const handleDraftsChange = useWalletDraftNotifications({
    walletId: id,
    setDraftsCount,
    addAppNotification,
    removeNotificationsByType,
  });

  const modalState = useWalletDetailModalState({
    walletId: id,
    navigate,
    handleError,
    handleTransferComplete,
    setActiveTab,
  });

  return {
    id,
    navigate,
    user,
    highlightTxId,
    bitcoinStatus,
    aiEnabled,
    wallet,
    devices,
    loading,
    error,
    setError,
    transactions,
    transactionStats,
    hasMoreTx,
    loadingMoreTx,
    loadMoreTransactions,
    utxos,
    utxoSummary,
    hasMoreUtxos,
    loadingMoreUtxos,
    loadMoreUtxos,
    utxoStats,
    privacyData,
    privacySummary,
    showPrivacy,
    addresses,
    walletAddressStrings,
    addressSummary,
    loadingAddresses,
    hasMoreAddresses,
    draftsCount,
    explorerUrl,
    walletShareInfo,
    groups,
    fetchData,
    walletUserRole,
    syncing,
    repairing,
    syncRetryInfo,
    handleSync,
    handleFullResync,
    handleRepairWallet,
    txFilters,
    setTypeFilter,
    setConfirmationFilter,
    setDatePreset,
    setCustomDateRange,
    setLabelFilter,
    clearAllFilters,
    hasActiveFilters,
    aiQueryFilter,
    setAiQueryFilter,
    filteredTransactions,
    aiAggregationResult,
    userSearchQuery,
    userSearchResults,
    searchingUsers,
    handleSearchUsers,
    selectedGroupToAdd,
    setSelectedGroupToAdd,
    addGroup,
    updateGroupRole,
    removeGroup,
    sharingLoading,
    handleShareWithUser,
    handleRemoveUserAccess,
    deviceSharePrompt,
    handleShareDevicesWithUser,
    dismissDeviceSharePrompt,
    handleTransferComplete,
    editingAddressId,
    availableLabels,
    selectedLabelIds,
    savingAddressLabels,
    handleEditAddressLabels,
    handleSaveAddressLabels,
    handleToggleAddressLabel,
    handleCancelEditLabels,
    selectedUtxos,
    handleToggleFreeze,
    handleToggleSelect,
    handleSendSelected,
    isEditingName,
    setIsEditingName,
    editedName,
    setEditedName,
    handleUpdateWallet,
    setActiveTab,
    visibleActiveTab,
    addressSubTab,
    setAddressSubTab,
    accessSubTab,
    setAccessSubTab,
    settingsSubTab,
    setSettingsSubTab,
    showDangerZone,
    setShowDangerZone,
    walletAgentLinks,
    logs,
    isPaused,
    logsLoading,
    clearLogs,
    togglePause,
    handleLoadMoreAddressPage,
    handleGenerateMoreAddresses,
    handleFetchUnusedAddresses,
    handleLabelsChange,
    handleDraftsChange,
    modalState,
    handleError,
  };
};

export type WalletDetailController = ReturnType<typeof useWalletDetailController>;
