import type React from 'react';
import { WalletType } from '../../types';
import { TabBar } from './TabBar';
import type { WalletDetailController } from './useWalletDetailController';
import { WalletDetailModals } from './WalletDetailModals';
import { WalletDetailTabContent } from './WalletDetailTabContent';
import { WalletHeader } from './WalletHeader';

type LoadedWallet = NonNullable<WalletDetailController['wallet']>;
type TabContentProps = React.ComponentProps<typeof WalletDetailTabContent>;

interface LoadedWalletDetailArgs {
  controller: WalletDetailController;
  wallet: LoadedWallet;
}

interface WalletDetailLoadedViewProps {
  controller: WalletDetailController;
  wallet: LoadedWallet;
}

export const WalletDetailLoadedView: React.FC<WalletDetailLoadedViewProps> = ({
  controller,
  wallet,
}) => (
  <div className="space-y-6 animate-fade-in">
    <WalletHeader
      wallet={wallet}
      agentLinks={controller.walletAgentLinks}
      syncing={controller.syncing}
      syncRetryInfo={controller.syncRetryInfo}
      onReceive={controller.modalState.openReceive}
      onSend={() => controller.navigate(`/wallets/${controller.id}/send`)}
      onSync={controller.handleSync}
      onFullResync={controller.handleFullResync}
      onExport={controller.modalState.openExport}
    />

    <TabBar
      activeTab={controller.visibleActiveTab}
      onTabChange={controller.setActiveTab}
      userRole={controller.walletUserRole}
      draftsCount={controller.draftsCount}
    />

    <WalletDetailTabContent {...buildTabContentProps({ controller, wallet })} />
    <WalletDetailModals {...buildModalProps({ controller, wallet })} />
  </div>
);

function buildTabContentProps(args: LoadedWalletDetailArgs): TabContentProps {
  return {
    visibleActiveTab: args.controller.visibleActiveTab,
    transactionsTabProps: buildTransactionsTabProps(args),
    utxoTabProps: buildUtxoTabProps(args),
    addressesTabProps: buildAddressesTabProps(args),
    draftsTabProps: buildDraftsTabProps(args),
    statsTabProps: buildStatsTabProps(args),
    logTabProps: buildLogTabProps(args),
    accessTabProps: buildAccessTabProps(args),
    settingsTabProps: buildSettingsTabProps(args),
  };
}

function buildTransactionsTabProps({
  controller,
  wallet,
}: LoadedWalletDetailArgs): TabContentProps['transactionsTabProps'] {
  return {
    walletId: wallet.id,
    transactions: controller.transactions,
    filteredTransactions: controller.filteredTransactions,
    walletAddressStrings: controller.walletAddressStrings,
    highlightTxId: controller.highlightTxId,
    aiQueryFilter: controller.aiQueryFilter,
    onAiQueryChange: controller.setAiQueryFilter,
    aiAggregationResult: controller.aiAggregationResult,
    aiEnabled: controller.aiEnabled,
    transactionStats: controller.transactionStats,
    hasMoreTx: controller.hasMoreTx,
    loadingMoreTx: controller.loadingMoreTx,
    onLoadMore: controller.loadMoreTransactions,
    onLabelsChange: controller.handleLabelsChange,
    onShowTransactionExport: controller.modalState.openTransactionExport,
    canEdit: wallet.canEdit !== false,
    confirmationThreshold: controller.bitcoinStatus?.confirmationThreshold,
    deepConfirmationThreshold: controller.bitcoinStatus?.deepConfirmationThreshold,
    walletBalance: wallet.balance,
    filters: controller.txFilters,
    onTypeFilterChange: controller.setTypeFilter,
    onConfirmationFilterChange: controller.setConfirmationFilter,
    onDatePresetChange: controller.setDatePreset,
    onCustomDateRangeChange: controller.setCustomDateRange,
    onLabelFilterChange: controller.setLabelFilter,
    onClearAllFilters: controller.clearAllFilters,
    hasActiveFilters: controller.hasActiveFilters,
  };
}

function buildUtxoTabProps({
  controller,
  wallet,
}: LoadedWalletDetailArgs): TabContentProps['utxoTabProps'] {
  return {
    utxos: controller.utxos,
    utxoTotalCount: controller.utxoSummary?.count,
    onToggleFreeze: controller.handleToggleFreeze,
    userRole: controller.walletUserRole,
    selectedUtxos: controller.selectedUtxos,
    onToggleSelect: controller.handleToggleSelect,
    onSendSelected: controller.handleSendSelected,
    privacyData: controller.privacyData,
    privacySummary: controller.privacySummary,
    showPrivacy: controller.showPrivacy,
    network: wallet.network || 'mainnet',
    hasMoreUtxos: controller.hasMoreUtxos,
    onLoadMore: controller.loadMoreUtxos,
    loadingMoreUtxos: controller.loadingMoreUtxos,
  };
}

function buildAddressesTabProps({
  controller,
  wallet,
}: LoadedWalletDetailArgs): TabContentProps['addressesTabProps'] {
  return {
    addresses: controller.addresses,
    addressSummary: controller.addressSummary,
    addressSubTab: controller.addressSubTab,
    onAddressSubTabChange: controller.setAddressSubTab,
    descriptor: wallet.descriptor || null,
    network: wallet.network || 'mainnet',
    loadingAddresses: controller.loadingAddresses,
    hasMoreAddresses: controller.hasMoreAddresses,
    onLoadMoreAddresses: controller.handleLoadMoreAddressPage,
    onGenerateMoreAddresses: controller.handleGenerateMoreAddresses,
    editingAddressId: controller.editingAddressId,
    availableLabels: controller.availableLabels,
    selectedLabelIds: controller.selectedLabelIds,
    onEditAddressLabels: controller.handleEditAddressLabels,
    onSaveAddressLabels: controller.handleSaveAddressLabels,
    onToggleAddressLabel: controller.handleToggleAddressLabel,
    savingAddressLabels: controller.savingAddressLabels,
    onCancelEditLabels: controller.handleCancelEditLabels,
    onShowQrModal: controller.modalState.setQrModalAddress,
    explorerUrl: controller.explorerUrl,
  };
}

function buildDraftsTabProps({
  controller,
  wallet,
}: LoadedWalletDetailArgs): TabContentProps['draftsTabProps'] {
  return {
    walletId: controller.id!,
    walletType: wallet.type === WalletType.MULTI_SIG ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG,
    quorum: wallet.quorum,
    totalSigners: wallet.totalSigners,
    userRole: controller.walletUserRole,
    addresses: controller.addresses,
    walletName: wallet.name,
    onDraftsChange: controller.handleDraftsChange,
  };
}

function buildStatsTabProps({
  controller,
  wallet,
}: LoadedWalletDetailArgs): TabContentProps['statsTabProps'] {
  return {
    utxos: controller.utxoStats.length > 0 ? controller.utxoStats : controller.utxos,
    balance: wallet.balance,
    transactions: controller.transactions,
  };
}

function buildLogTabProps({
  controller,
}: LoadedWalletDetailArgs): TabContentProps['logTabProps'] {
  return {
    logs: controller.logs,
    isPaused: controller.isPaused,
    isLoading: controller.logsLoading,
    syncing: controller.syncing,
    onTogglePause: controller.togglePause,
    onClearLogs: controller.clearLogs,
    onSync: controller.handleSync,
    onFullResync: controller.handleFullResync,
  };
}

function buildAccessTabProps({
  controller,
}: LoadedWalletDetailArgs): TabContentProps['accessTabProps'] {
  return {
    accessSubTab: controller.accessSubTab,
    onAccessSubTabChange: controller.setAccessSubTab,
    walletShareInfo: controller.walletShareInfo,
    userRole: controller.walletUserRole,
    user: controller.user,
    onShowTransferModal: controller.modalState.openTransferModal,
    selectedGroupToAdd: controller.selectedGroupToAdd,
    onSelectedGroupToAddChange: controller.setSelectedGroupToAdd,
    groups: controller.groups,
    sharingLoading: controller.sharingLoading,
    onAddGroup: controller.addGroup,
    onUpdateGroupRole: controller.updateGroupRole,
    onRemoveGroup: controller.removeGroup,
    userSearchQuery: controller.userSearchQuery,
    onSearchUsers: controller.handleSearchUsers,
    searchingUsers: controller.searchingUsers,
    userSearchResults: controller.userSearchResults,
    onShareWithUser: controller.handleShareWithUser,
    onRemoveUserAccess: controller.handleRemoveUserAccess,
    walletId: controller.id!,
    onTransferComplete: controller.handleTransferComplete,
  };
}

function buildSettingsTabProps({
  controller,
  wallet,
}: LoadedWalletDetailArgs): TabContentProps['settingsTabProps'] {
  return {
    settingsSubTab: controller.settingsSubTab,
    onSettingsSubTabChange: controller.setSettingsSubTab,
    wallet,
    devices: controller.devices,
    isEditingName: controller.isEditingName,
    editedName: controller.editedName,
    onSetIsEditingName: controller.setIsEditingName,
    onSetEditedName: controller.setEditedName,
    onUpdateWallet: controller.handleUpdateWallet,
    onLabelsChange: controller.handleLabelsChange,
    syncing: controller.syncing,
    onSync: controller.handleSync,
    onFullResync: controller.handleFullResync,
    repairing: controller.repairing,
    onRepairWallet: controller.handleRepairWallet,
    showDangerZone: controller.showDangerZone,
    onSetShowDangerZone: controller.setShowDangerZone,
    onShowDelete: controller.modalState.openDelete,
    onShowExport: controller.modalState.openExport,
  };
}

function buildModalProps({
  controller,
  wallet,
}: LoadedWalletDetailArgs): React.ComponentProps<typeof WalletDetailModals> {
  return {
    walletId: controller.id,
    walletName: wallet.name,
    walletType: wallet.type,
    walletScriptType: wallet.scriptType,
    walletDescriptor: wallet.descriptor,
    walletQuorum: wallet.quorum,
    walletTotalSigners: wallet.totalSigners,
    devices: controller.devices,
    addresses: controller.addresses,
    showExport: controller.modalState.showExport,
    onCloseExport: controller.modalState.closeExport,
    onError: controller.handleError,
    showTransactionExport: controller.modalState.showTransactionExport,
    onCloseTransactionExport: controller.modalState.closeTransactionExport,
    showReceive: controller.modalState.showReceive,
    onCloseReceive: controller.modalState.closeReceive,
    onNavigateToSettings: controller.modalState.handleNavigateReceiveToSettings,
    onFetchUnusedAddresses: controller.handleFetchUnusedAddresses,
    qrModalAddress: controller.modalState.qrModalAddress,
    onCloseQrModal: controller.modalState.closeQrModal,
    deviceSharePrompt: controller.deviceSharePrompt,
    sharingLoading: controller.sharingLoading,
    onDismissDeviceSharePrompt: controller.dismissDeviceSharePrompt,
    onShareDevicesWithUser: controller.handleShareDevicesWithUser,
    showDelete: controller.modalState.showDelete,
    onCloseDelete: controller.modalState.closeDelete,
    onConfirmDelete: controller.modalState.handleConfirmDelete,
    showTransferModal: controller.modalState.showTransferModal,
    onCloseTransferModal: controller.modalState.closeTransferModal,
    onTransferInitiated: controller.modalState.handleTransferInitiated,
  };
}
