import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { WalletType } from '../../types';
import { useBitcoinStatus } from '../../hooks/queries/useBitcoin';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { useAIStatus } from '../../hooks/useAIStatus';
import { useUser } from '../../contexts/UserContext';
import { useWalletLogs } from '../../hooks/websocket';
import { useAppNotifications } from '../../contexts/AppNotificationContext';
import { WalletHeader } from './WalletHeader';
import { TabBar } from './TabBar';
import { WalletDetailTabContent } from './WalletDetailTabContent';
import { WalletDetailModals } from './WalletDetailModals';
import { LoadingState, ErrorState } from './WalletDetailStates';

// Custom hooks extracted from this component
import { useWalletData } from './hooks/useWalletData';
import { useWalletSync } from './hooks/useWalletSync';
import { useWalletSharing } from './hooks/useWalletSharing';
import { useAITransactionFilter } from './hooks/useAITransactionFilter';
import { useTransactionFilters } from './hooks/useTransactionFilters';
import { useWalletWebSocket } from './hooks/useWalletWebSocket';
import { useAddressLabels } from './hooks/useAddressLabels';
import { useUtxoActions } from './hooks/useUtxoActions';
import { useWalletDetailAddressActions } from './hooks/useWalletDetailAddressActions';
import { useWalletAgentLinks } from './hooks/useWalletAgentLinks';
import { useWalletDetailModalState } from './hooks/useWalletDetailModalState';
import { useWalletDetailTabs } from './hooks/useWalletDetailTabs';
import { useWalletDraftNotifications } from './hooks/useWalletDraftNotifications';
import { useWalletLabels } from '../../hooks/queries/useWalletLabels';
import { useWalletMutations } from './hooks/useWalletMutations';

import type { SettingsSubTab } from './types';


export const WalletDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const { handleError } = useErrorHandler();
  const { addNotification: addAppNotification, removeNotificationsByType } = useAppNotifications();
  const highlightTxId = (location.state as { highlightTxId?: string } | null)?.highlightTxId;
  const { data: bitcoinStatus } = useBitcoinStatus();
  const { enabled: aiEnabled } = useAIStatus();

  // ---------------------------------------------------------------------------
  // Custom hooks
  // ---------------------------------------------------------------------------

  // Data fetching, pagination, and background data state
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

  // Sync, resync, and repair
  const {
    syncing, setSyncing,
    repairing,
    syncRetryInfo, setSyncRetryInfo,
    handleSync, handleFullResync, handleRepairWallet,
  } = useWalletSync({
    walletId: id,
    onDataRefresh: () => fetchData(true),
  });

  // Manual transaction filters (type, date, confirmations, label)
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

  // AI transaction filtering (applied after manual filters)
  const {
    aiQueryFilter, setAiQueryFilter,
    filteredTransactions,
    aiAggregationResult,
  } = useAITransactionFilter({ transactions: manuallyFiltered });

  // Sharing, group management, and device share prompt
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

  // Wallet labels (shared cache for all label consumers on this page)
  const { data: walletLabels = [] } = useWalletLabels(id);

  // Address label editing
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

  // UTXO freeze/select/send actions
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

  // Wallet name editing and update
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

  // ---------------------------------------------------------------------------
  // Local UI state (not extracted - stays in component)
  // ---------------------------------------------------------------------------

  const { setActiveTab, visibleActiveTab } = useWalletDetailTabs({
    locationState: location.state,
    hasWallet: Boolean(wallet),
    walletUserRole,
  });
  const [addressSubTab, setAddressSubTab] = useState<'receive' | 'change'>('receive');
  const [accessSubTab, setAccessSubTab] = useState<'ownership' | 'sharing' | 'transfers'>('ownership');
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('general');
  const [showDangerZone, setShowDangerZone] = useState(false);
  const walletAgentLinks = useWalletAgentLinks(id, user?.isAdmin);

  // Wallet logs hook - only enabled when Log tab is active
  const { logs, isPaused, isLoading: logsLoading, clearLogs, togglePause } = useWalletLogs(id, {
    enabled: visibleActiveTab === 'log',
    maxEntries: 500,
  });

  // WebSocket integration for real-time updates
  useWalletWebSocket({
    walletId: id,
    wallet,
    setWallet,
    setTransactions,
    setSyncing,
    setSyncRetryInfo,
    fetchData,
  });

  // Load UTXO stats when stats tab is first opened
  useEffect(() => {
    if (!id || visibleActiveTab !== 'stats') return;
    if (utxoStats.length > 0 || loadingUtxoStats) return;
    loadUtxosForStats(id);
  }, [visibleActiveTab, id, utxoStats.length, loadingUtxoStats]);

  // ---------------------------------------------------------------------------
  // Local handlers (not extracted - depend on local UI state)
  // ---------------------------------------------------------------------------

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

  // Refresh data callback for when labels are changed
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


  if (loading) return <LoadingState />;

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={() => { setError(null); fetchData(); }}
      />
    );
  }

  if (!wallet) return <LoadingState />;

  return (
    <div className="space-y-6 animate-fade-in">
      <WalletHeader
        wallet={wallet}
        agentLinks={walletAgentLinks}
        syncing={syncing}
        syncRetryInfo={syncRetryInfo}
        onReceive={modalState.openReceive}
        onSend={() => navigate(`/wallets/${id}/send`)}
        onSync={handleSync}
        onFullResync={handleFullResync}
        onExport={modalState.openExport}
      />

      {/* Tabs */}
      <TabBar
        activeTab={visibleActiveTab}
        onTabChange={setActiveTab}
        userRole={walletUserRole}
        draftsCount={draftsCount}
      />

      <WalletDetailTabContent
        visibleActiveTab={visibleActiveTab}
        transactionsTabProps={{
          walletId: wallet.id,
          transactions,
          filteredTransactions,
          walletAddressStrings,
          highlightTxId,
          aiQueryFilter,
          onAiQueryChange: setAiQueryFilter,
          aiAggregationResult,
          aiEnabled,
          transactionStats,
          hasMoreTx,
          loadingMoreTx,
          onLoadMore: loadMoreTransactions,
          onLabelsChange: handleLabelsChange,
          onShowTransactionExport: modalState.openTransactionExport,
          canEdit: wallet.canEdit !== false,
          confirmationThreshold: bitcoinStatus?.confirmationThreshold,
          deepConfirmationThreshold: bitcoinStatus?.deepConfirmationThreshold,
          walletBalance: wallet.balance,
          filters: txFilters,
          onTypeFilterChange: setTypeFilter,
          onConfirmationFilterChange: setConfirmationFilter,
          onDatePresetChange: setDatePreset,
          onCustomDateRangeChange: setCustomDateRange,
          onLabelFilterChange: setLabelFilter,
          onClearAllFilters: clearAllFilters,
          hasActiveFilters,
        }}
        utxoTabProps={{
          utxos,
          utxoTotalCount: utxoSummary?.count,
          onToggleFreeze: handleToggleFreeze,
          userRole: walletUserRole,
          selectedUtxos,
          onToggleSelect: handleToggleSelect,
          onSendSelected: handleSendSelected,
          privacyData,
          privacySummary,
          showPrivacy,
          network: wallet.network || 'mainnet',
          hasMoreUtxos,
          onLoadMore: loadMoreUtxos,
          loadingMoreUtxos,
        }}
        addressesTabProps={{
          addresses,
          addressSummary,
          addressSubTab,
          onAddressSubTabChange: setAddressSubTab,
          descriptor: wallet.descriptor || null,
          network: wallet.network || 'mainnet',
          loadingAddresses,
          hasMoreAddresses,
          onLoadMoreAddresses: handleLoadMoreAddressPage,
          onGenerateMoreAddresses: handleGenerateMoreAddresses,
          editingAddressId,
          availableLabels,
          selectedLabelIds,
          onEditAddressLabels: handleEditAddressLabels,
          onSaveAddressLabels: handleSaveAddressLabels,
          onToggleAddressLabel: handleToggleAddressLabel,
          savingAddressLabels,
          onCancelEditLabels: handleCancelEditLabels,
          onShowQrModal: modalState.setQrModalAddress,
          explorerUrl,
        }}
        draftsTabProps={{
          walletId: id!,
          walletType: wallet.type === WalletType.MULTI_SIG ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG,
          quorum: wallet.quorum,
          totalSigners: wallet.totalSigners,
          userRole: walletUserRole,
          addresses,
          walletName: wallet.name,
          onDraftsChange: handleDraftsChange,
        }}
        statsTabProps={{
          utxos: utxoStats.length > 0 ? utxoStats : utxos,
          balance: wallet.balance,
          transactions,
        }}
        logTabProps={{
          logs,
          isPaused,
          isLoading: logsLoading,
          syncing,
          onTogglePause: togglePause,
          onClearLogs: clearLogs,
          onSync: handleSync,
          onFullResync: handleFullResync,
        }}
        accessTabProps={{
          accessSubTab,
          onAccessSubTabChange: setAccessSubTab,
          walletShareInfo,
          userRole: walletUserRole,
          user,
          onShowTransferModal: modalState.openTransferModal,
          selectedGroupToAdd,
          onSelectedGroupToAddChange: setSelectedGroupToAdd,
          groups,
          sharingLoading,
          onAddGroup: addGroup,
          onUpdateGroupRole: updateGroupRole,
          onRemoveGroup: removeGroup,
          userSearchQuery,
          onSearchUsers: handleSearchUsers,
          searchingUsers,
          userSearchResults,
          onShareWithUser: handleShareWithUser,
          onRemoveUserAccess: handleRemoveUserAccess,
          walletId: id!,
          onTransferComplete: handleTransferComplete,
        }}
        settingsTabProps={{
          settingsSubTab,
          onSettingsSubTabChange: setSettingsSubTab,
          wallet,
          devices,
          isEditingName,
          editedName,
          onSetIsEditingName: setIsEditingName,
          onSetEditedName: setEditedName,
          onUpdateWallet: handleUpdateWallet,
          onLabelsChange: handleLabelsChange,
          syncing,
          onSync: handleSync,
          onFullResync: handleFullResync,
          repairing,
          onRepairWallet: handleRepairWallet,
          showDangerZone,
          onSetShowDangerZone: setShowDangerZone,
          onShowDelete: modalState.openDelete,
          onShowExport: modalState.openExport,
        }}
      />

      <WalletDetailModals
        walletId={id}
        walletName={wallet.name}
        walletType={wallet.type}
        walletScriptType={wallet.scriptType}
        walletDescriptor={wallet.descriptor}
        walletQuorum={wallet.quorum}
        walletTotalSigners={wallet.totalSigners}
        devices={devices}
        addresses={addresses}

        showExport={modalState.showExport}
        onCloseExport={modalState.closeExport}
        onError={handleError}

        showTransactionExport={modalState.showTransactionExport}
        onCloseTransactionExport={modalState.closeTransactionExport}

        showReceive={modalState.showReceive}
        onCloseReceive={modalState.closeReceive}
        onNavigateToSettings={modalState.handleNavigateReceiveToSettings}
        onFetchUnusedAddresses={handleFetchUnusedAddresses}

        qrModalAddress={modalState.qrModalAddress}
        onCloseQrModal={modalState.closeQrModal}

        deviceSharePrompt={deviceSharePrompt}
        sharingLoading={sharingLoading}
        onDismissDeviceSharePrompt={dismissDeviceSharePrompt}
        onShareDevicesWithUser={handleShareDevicesWithUser}

        showDelete={modalState.showDelete}
        onCloseDelete={modalState.closeDelete}
        onConfirmDelete={modalState.handleConfirmDelete}

        showTransferModal={modalState.showTransferModal}
        onCloseTransferModal={modalState.closeTransferModal}
        onTransferInitiated={modalState.handleTransferInitiated}
      />
    </div>
  );
};
