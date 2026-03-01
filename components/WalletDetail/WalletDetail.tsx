import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Wallet, WalletType } from '../../types';
import * as walletsApi from '../../src/api/wallets';
import * as transactionsApi from '../../src/api/transactions';
import * as labelsApi from '../../src/api/labels';
import { useBitcoinStatus } from '../../hooks/queries/useBitcoin';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { TransactionExportModal } from '../TransactionExportModal';
import { TransferOwnershipModal } from '../TransferOwnershipModal';
import { useAIStatus } from '../../hooks/useAIStatus';
import { Button } from '../ui/Button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useUser } from '../../contexts/UserContext';
import { useWalletLogs } from '../../hooks/useWebSocket';
import { useAppNotifications } from '../../contexts/AppNotificationContext';
import { createLogger } from '../../utils/logger';
import { logError } from '../../utils/errorHandler';
import { LogTab } from './LogTab';
import { WalletHeader } from './WalletHeader';
import { DeleteModal, ReceiveModal, ExportModal, AddressQRModal, DeviceSharePromptModal } from './modals';
import { TabBar } from './TabBar';
import {
  TransactionsTab,
  UTXOTab,
  AddressesTab,
  DraftsTab,
  StatsTab,
  AccessTab,
  SettingsTab,
} from './tabs';

// Custom hooks extracted from this component
import { useWalletData } from './hooks/useWalletData';
import { useWalletSync } from './hooks/useWalletSync';
import { useWalletSharing } from './hooks/useWalletSharing';
import { useAITransactionFilter } from './hooks/useAITransactionFilter';
import { useWalletWebSocket } from './hooks/useWalletWebSocket';

import type { TabType } from './types';

const log = createLogger('WalletDetail');


export const WalletDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const { handleError } = useErrorHandler();
  const { addNotification: addAppNotification, removeNotificationsByType } = useAppNotifications();
  const highlightTxId = (location.state as any)?.highlightTxId;
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
    users, groups,
    walletShareInfo, setWalletShareInfo,
    fetchData,
  } = useWalletData({ id, user });

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

  // AI transaction filtering
  const {
    aiQueryFilter, setAiQueryFilter,
    filteredTransactions,
    aiAggregationResult,
  } = useAITransactionFilter({ transactions });

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

  // ---------------------------------------------------------------------------
  // Local UI state (not extracted - stays in component)
  // ---------------------------------------------------------------------------

  // Check for activeTab in navigation state (e.g., from notification panel)
  const initialTab = (location.state as any)?.activeTab || 'tx';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [addressSubTab, setAddressSubTab] = useState<'receive' | 'change'>('receive');
  const [accessSubTab, setAccessSubTab] = useState<'ownership' | 'sharing' | 'transfers'>('ownership');
  const [settingsSubTab, setSettingsSubTab] = useState<'general' | 'devices' | 'notifications' | 'advanced'>('general');
  const [showDangerZone, setShowDangerZone] = useState(false);

  // Update activeTab if navigation state changes
  useEffect(() => {
    const stateTab = (location.state as any)?.activeTab;
    if (stateTab && stateTab !== activeTab) {
      setActiveTab(stateTab);
    }
  }, [location.state]);

  // Export Modal State
  const [showExport, setShowExport] = useState(false);

  // Transaction Export Modal State
  const [showTransactionExport, setShowTransactionExport] = useState(false);

  // Delete Modal State
  const [showDelete, setShowDelete] = useState(false);

  // Transfer Ownership Modal State
  const [showTransferModal, setShowTransferModal] = useState(false);

  // Selection State for UTXOs
  const [selectedUtxos, setSelectedUtxos] = useState<Set<string>>(new Set());

  // Wallet Name Editing State
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState('');

  // Address QR Modal State
  const [qrModalAddress, setQrModalAddress] = useState<string | null>(null);

  // Address Label Editing State
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [availableLabels, setAvailableLabels] = useState<import('../../types').Label[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [savingAddressLabels, setSavingAddressLabels] = useState(false);

  // Receive Modal State
  const [showReceive, setShowReceive] = useState(false);

  // Wallet logs hook - only enabled when Log tab is active
  const { logs, isPaused, isLoading: logsLoading, clearLogs, togglePause } = useWalletLogs(id, {
    enabled: activeTab === 'log',
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

  // Reset UTXO selection when wallet changes
  useEffect(() => {
    setSelectedUtxos(new Set());
  }, [id]);

  // Load UTXO stats when stats tab is first opened
  useEffect(() => {
    if (!id || activeTab !== 'stats') return;
    if (utxoStats.length > 0 || loadingUtxoStats) return;
    loadUtxosForStats(id);
  }, [activeTab, id, utxoStats.length, loadingUtxoStats]);

  // ---------------------------------------------------------------------------
  // Local handlers (not extracted - depend on local UI state)
  // ---------------------------------------------------------------------------

  const handleLoadMoreAddressPage = async () => {
    if (!id || loadingAddresses || !hasMoreAddresses) return;
    await loadAddresses(id, ADDRESS_PAGE_SIZE, addressOffset, false);
  };

  const handleGenerateMoreAddresses = async () => {
    if (!id) return;
    try {
      // Generate more addresses on the backend
      await transactionsApi.generateAddresses(id, 10);
      await loadAddressSummary(id);
      // Reload first page to include newly generated addresses
      await loadAddresses(id, ADDRESS_PAGE_SIZE, 0, true);
    } catch (err) {
      logError(log, err, 'Failed to generate more addresses');
      handleError(err, 'Failed to Generate Addresses');
    }
  };

  // Address label editing functions
  const handleEditAddressLabels = async (addr: import('../../types').Address) => {
    if (!addr.id || !id) return;
    setEditingAddressId(addr.id);
    setSelectedLabelIds(addr.labels?.map(l => l.id) || []);
    try {
      const labels = await labelsApi.getLabels(id);
      setAvailableLabels(labels);
    } catch (err) {
      logError(log, err, 'Failed to load labels');
      handleError(err, 'Failed to Load Labels');
    }
  };

  const handleSaveAddressLabels = async () => {
    if (!editingAddressId) return;
    try {
      setSavingAddressLabels(true);
      await labelsApi.setAddressLabels(editingAddressId, selectedLabelIds);
      // Update the address's labels locally
      const updatedLabels = availableLabels.filter(l => selectedLabelIds.includes(l.id));
      setAddresses(current =>
        current.map(addr =>
          addr.id === editingAddressId ? { ...addr, labels: updatedLabels } : addr
        )
      );
      setEditingAddressId(null);
    } catch (err) {
      logError(log, err, 'Failed to save address labels');
      handleError(err, 'Failed to Save Labels');
    } finally {
      setSavingAddressLabels(false);
    }
  };

  const handleToggleAddressLabel = (labelId: string) => {
    setSelectedLabelIds(prev =>
      prev.includes(labelId)
        ? prev.filter(id => id !== labelId)
        : [...prev, labelId]
    );
  };

  // Refresh data callback for when labels are changed
  const handleLabelsChange = () => {
    if (id) {
      fetchData(true);
    }
  };

  const handleToggleFreeze = async (txid: string, vout: number) => {
    // Find the UTXO to toggle
    const utxo = utxos.find(u => u.txid === txid && u.vout === vout);
    if (!utxo || !utxo.id) {
      log.error('UTXO not found or missing ID');
      return;
    }

    const newFrozenState = !utxo.frozen;

    // Optimistic update
    setUTXOs(current =>
      current.map(u =>
        (u.txid === txid && u.vout === vout) ? { ...u, frozen: newFrozenState } : u
      )
    );
    setUtxoStats(current =>
      current.map(u =>
        (u.txid === txid && u.vout === vout) ? { ...u, frozen: newFrozenState } : u
      )
    );

    try {
      await transactionsApi.freezeUTXO(utxo.id, newFrozenState);
    } catch (err) {
      logError(log, err, 'Failed to freeze UTXO');
      handleError(err, 'Failed to Freeze UTXO');
      // Revert optimistic update on error
      setUTXOs(current =>
        current.map(u =>
          (u.txid === txid && u.vout === vout) ? { ...u, frozen: !newFrozenState } : u
        )
      );
      setUtxoStats(current =>
        current.map(u =>
          (u.txid === txid && u.vout === vout) ? { ...u, frozen: !newFrozenState } : u
        )
      );
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedUtxos);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedUtxos(next);
  };

  const handleSendSelected = () => {
    navigate(`/wallets/${id}/send`, { state: { preSelected: Array.from(selectedUtxos) } });
  };

  const handleUpdateWallet = async (updatedData: Partial<Wallet>) => {
    if (!wallet || !id) return;

    try {
      // Optimistic update
      const updatedWallet = { ...wallet, ...updatedData };
      setWallet(updatedWallet);

      // Update via API (only name and descriptor are updateable)
      await walletsApi.updateWallet(id, {
        name: updatedData.name,
        descriptor: updatedData.descriptor,
      });
    } catch (err) {
      log.error('Failed to update wallet', { error: err });
      // Revert optimistic update on error
      setWallet(wallet);
      handleError(err, 'Update Failed');
    }
  };

  // Drafts change handler with app notifications
  const handleDraftsChange = useCallback((count: number) => {
    setDraftsCount(count);
    if (count > 0) {
      addAppNotification({
        type: 'pending_drafts',
        scope: 'wallet',
        scopeId: id!,
        severity: 'warning',
        title: `${count} pending draft${count > 1 ? 's' : ''}`,
        message: 'Resume or broadcast your draft transactions',
        count: count,
        actionUrl: `/wallets/${id}`,
        actionLabel: 'View Drafts',
        dismissible: true,
        persistent: false,
      });
    } else {
      removeNotificationsByType('pending_drafts', id!);
    }
  }, [id, setDraftsCount, addAppNotification, removeNotificationsByType]);


  if (loading) return <div className="p-8 text-center animate-pulse">Loading wallet...</div>;

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg p-6 max-w-md mx-auto">
          <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-rose-900 dark:text-rose-100 mb-2">Failed to Load Wallet</h3>
          <p className="text-rose-700 dark:text-rose-300 mb-4">{error}</p>
          <Button onClick={() => { setError(null); fetchData(); }} variant="primary">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!wallet) return <div className="p-8 text-center animate-pulse">Loading wallet...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <WalletHeader
        wallet={wallet}
        syncing={syncing}
        syncRetryInfo={syncRetryInfo}
        onReceive={() => setShowReceive(true)}
        onSend={() => navigate(`/wallets/${id}/send`)}
        onSync={handleSync}
        onFullResync={handleFullResync}
        onExport={() => setShowExport(true)}
      />

      {/* Tabs */}
      <TabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        userRole={wallet.userRole || 'viewer'}
        draftsCount={draftsCount}
      />

      {/* Content Area */}
      <div className="min-h-[400px]">
        {activeTab === 'tx' && (
          <TransactionsTab
            walletId={wallet.id}
            transactions={transactions}
            filteredTransactions={filteredTransactions}
            walletAddressStrings={walletAddressStrings}
            highlightTxId={highlightTxId}
            aiQueryFilter={aiQueryFilter}
            onAiQueryChange={setAiQueryFilter}
            aiAggregationResult={aiAggregationResult}
            aiEnabled={aiEnabled}
            transactionStats={transactionStats}
            hasMoreTx={hasMoreTx}
            loadingMoreTx={loadingMoreTx}
            onLoadMore={loadMoreTransactions}
            onLabelsChange={handleLabelsChange}
            onShowTransactionExport={() => setShowTransactionExport(true)}
            canEdit={wallet.canEdit !== false}
            confirmationThreshold={bitcoinStatus?.confirmationThreshold}
            deepConfirmationThreshold={bitcoinStatus?.deepConfirmationThreshold}
            walletBalance={wallet.balance}
          />
        )}

        {activeTab === 'utxo' && (
          <UTXOTab
            utxos={utxos}
            utxoTotalCount={utxoSummary?.count}
            onToggleFreeze={handleToggleFreeze}
            userRole={wallet.userRole || 'viewer'}
            selectedUtxos={selectedUtxos}
            onToggleSelect={handleToggleSelect}
            onSendSelected={handleSendSelected}
            privacyData={privacyData}
            privacySummary={privacySummary}
            showPrivacy={showPrivacy}
            network={wallet.network || 'mainnet'}
            hasMoreUtxos={hasMoreUtxos}
            onLoadMore={loadMoreUtxos}
            loadingMoreUtxos={loadingMoreUtxos}
          />
        )}

        {activeTab === 'addresses' && (
          <AddressesTab
            addresses={addresses}
            addressSummary={addressSummary}
            addressSubTab={addressSubTab}
            onAddressSubTabChange={setAddressSubTab}
            descriptor={wallet.descriptor || null}
            network={wallet.network || 'mainnet'}
            loadingAddresses={loadingAddresses}
            hasMoreAddresses={hasMoreAddresses}
            onLoadMoreAddresses={handleLoadMoreAddressPage}
            onGenerateMoreAddresses={handleGenerateMoreAddresses}
            editingAddressId={editingAddressId}
            availableLabels={availableLabels}
            selectedLabelIds={selectedLabelIds}
            onEditAddressLabels={handleEditAddressLabels}
            onSaveAddressLabels={handleSaveAddressLabels}
            onToggleAddressLabel={handleToggleAddressLabel}
            savingAddressLabels={savingAddressLabels}
            onCancelEditLabels={() => setEditingAddressId(null)}
            onShowQrModal={setQrModalAddress}
            explorerUrl={explorerUrl}
          />
        )}

        {activeTab === 'drafts' && (
          <DraftsTab
            walletId={id!}
            walletType={wallet.type === WalletType.MULTI_SIG ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG}
            quorum={wallet.quorum}
            totalSigners={wallet.totalSigners}
            userRole={wallet.userRole || 'viewer'}
            addresses={addresses}
            walletName={wallet.name}
            onDraftsChange={handleDraftsChange}
          />
        )}

        {activeTab === 'stats' && (
          <StatsTab
            utxos={utxoStats.length > 0 ? utxoStats : utxos}
            balance={wallet.balance}
            transactions={transactions}
          />
        )}

        {activeTab === 'log' && (
          <LogTab
            logs={logs}
            isPaused={isPaused}
            isLoading={logsLoading}
            syncing={syncing}
            onTogglePause={togglePause}
            onClearLogs={clearLogs}
            onSync={handleSync}
            onFullResync={handleFullResync}
          />
        )}

        {activeTab === 'access' && (
          <AccessTab
            accessSubTab={accessSubTab}
            onAccessSubTabChange={setAccessSubTab}
            walletShareInfo={walletShareInfo}
            userRole={wallet.userRole || 'viewer'}
            user={user}
            onShowTransferModal={() => setShowTransferModal(true)}
            selectedGroupToAdd={selectedGroupToAdd}
            onSelectedGroupToAddChange={setSelectedGroupToAdd}
            groups={groups}
            sharingLoading={sharingLoading}
            onAddGroup={addGroup}
            onUpdateGroupRole={updateGroupRole}
            onRemoveGroup={removeGroup}
            userSearchQuery={userSearchQuery}
            onSearchUsers={handleSearchUsers}
            searchingUsers={searchingUsers}
            userSearchResults={userSearchResults}
            onShareWithUser={handleShareWithUser}
            onRemoveUserAccess={handleRemoveUserAccess}
            walletId={id!}
            onTransferComplete={handleTransferComplete}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settingsSubTab={settingsSubTab}
            onSettingsSubTabChange={setSettingsSubTab}
            wallet={wallet}
            devices={devices}
            isEditingName={isEditingName}
            editedName={editedName}
            onSetIsEditingName={setIsEditingName}
            onSetEditedName={setEditedName}
            onUpdateWallet={handleUpdateWallet}
            onLabelsChange={handleLabelsChange}
            syncing={syncing}
            onSync={handleSync}
            onFullResync={handleFullResync}
            repairing={repairing}
            onRepairWallet={handleRepairWallet}
            showDangerZone={showDangerZone}
            onSetShowDangerZone={setShowDangerZone}
            onShowDelete={() => setShowDelete(true)}
            onShowExport={() => setShowExport(true)}
            explorerUrl={explorerUrl}
          />
        )}
      </div>

      {/* Export Modal */}
      {showExport && wallet && id && (
        <ExportModal
          walletId={id}
          walletName={wallet.name}
          walletType={wallet.type}
          scriptType={wallet.scriptType}
          descriptor={wallet.descriptor}
          quorum={wallet.quorum}
          totalSigners={wallet.totalSigners}
          devices={devices}
          onClose={() => setShowExport(false)}
          onError={handleError}
        />
      )}

      {/* Transaction Export Modal */}
      {showTransactionExport && wallet && (
        <TransactionExportModal
          walletId={wallet.id}
          walletName={wallet.name}
          onClose={() => setShowTransactionExport(false)}
        />
      )}

      {/* Receive Modal */}
      {showReceive && wallet && (
        <ReceiveModal
          walletId={wallet.id}
          addresses={addresses}
          network={wallet.network || 'mainnet'}
          onClose={() => setShowReceive(false)}
          onNavigateToSettings={() => { setShowReceive(false); setActiveTab('settings'); }}
        />
      )}

      {/* Address QR Code Modal */}
      {qrModalAddress && (
        <AddressQRModal
          address={qrModalAddress}
          onClose={() => setQrModalAddress(null)}
        />
      )}

      {/* Device Share Prompt Modal */}
      <DeviceSharePromptModal
        deviceSharePrompt={deviceSharePrompt}
        sharingLoading={sharingLoading}
        onDismiss={dismissDeviceSharePrompt}
        onShareDevices={handleShareDevicesWithUser}
      />

      {/* Delete Confirmation Modal */}
      {showDelete && wallet && (
        <DeleteModal
          walletName={wallet.name}
          onConfirm={async () => {
            if (id) {
              try {
                await walletsApi.deleteWallet(id);
                navigate('/wallets');
              } catch (err) {
                log.error('Failed to delete wallet', { error: err });
                handleError(err, 'Delete Failed');
              }
            }
          }}
          onClose={() => setShowDelete(false)}
        />
      )}

      {/* Transfer Ownership Modal */}
      {showTransferModal && wallet && (
        <TransferOwnershipModal
          resourceType="wallet"
          resourceId={wallet.id}
          resourceName={wallet.name}
          onClose={() => setShowTransferModal(false)}
          onTransferInitiated={() => {
            setShowTransferModal(false);
            handleTransferComplete();
          }}
        />
      )}
    </div>
  );
};
