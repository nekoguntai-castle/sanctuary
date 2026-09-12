import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletDetailController } from '../../../src/components/WalletDetail/useWalletDetailController';

// Pins the Stats-tab defect: the controller's load-once effect must key off
// an "attempted" marker (utxoStatsLoadedFor), not `utxoStats.length`, or a
// loadingUtxoStats false->true->false cycle on an empty/failed wallet
// re-fires loadUtxosForStats on every render forever.
const controllerState = vi.hoisted(() => ({
  visibleActiveTab: 'stats' as string,
  routeId: 'wallet-1' as string | undefined,
  user: { id: 'user-1', isAdmin: false } as { id: string; isAdmin: boolean } | null,
  utxoStats: [] as unknown[],
  loadingUtxoStats: false,
  utxoStatsLoadedFor: null as string | null,
  loadUtxosForStats: vi.fn(),
  fetchData: vi.fn(),
  refreshData: vi.fn().mockResolvedValue(true),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: controllerState.routeId }),
    useNavigate: () => vi.fn(),
    useLocation: () => ({ state: null }),
  };
});

vi.mock('../../../src/contexts/AppNotificationContext', () => ({
  useAppNotifications: () => ({
    addNotification: vi.fn(),
    removeNotificationsByType: vi.fn(),
  }),
}));

vi.mock('../../../src/contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: 'mainnet',
    isMainnet: true,
    setSelectedNetwork: vi.fn(),
  }),
}));

vi.mock('../../../src/contexts/UserContext', () => ({
  useUser: () => ({ user: controllerState.user }),
}));

vi.mock('../../../src/hooks/queries/useBitcoin', () => ({
  useBitcoinStatus: () => ({
    data: { confirmationThreshold: 1, deepConfirmationThreshold: 6, network: 'mainnet' },
    isPlaceholderData: false,
  }),
}));

vi.mock('../../../src/hooks/queries/useWalletLabels', () => ({
  useWalletLabels: () => ({ data: [] }),
}));

vi.mock('../../../src/hooks/useAIStatus', () => ({
  useAIStatus: () => ({ enabled: false }),
}));

vi.mock('../../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}));

vi.mock('../../../src/hooks/websocket', () => ({
  useWalletLogs: () => ({
    logs: [],
    isPaused: false,
    isLoading: false,
    clearLogs: vi.fn(),
    togglePause: vi.fn(),
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletData', () => ({
  useWalletData: () => ({
    wallet: {
      id: controllerState.routeId,
      name: 'Wallet',
      network: 'mainnet',
      userRole: 'owner',
    },
    setWallet: vi.fn(),
    devices: [],
    loading: false,
    error: null,
    setError: vi.fn(),
    transactions: [],
    setTransactions: vi.fn(),
    transactionStats: null,
    hasMoreTx: false,
    loadingMoreTx: false,
    loadMoreTransactions: vi.fn(),
    utxos: [],
    setUTXOs: vi.fn(),
    utxoSummary: null,
    hasMoreUtxos: false,
    loadingMoreUtxos: false,
    loadMoreUtxos: vi.fn(),
    utxoStats: controllerState.utxoStats,
    setUtxoStats: vi.fn(),
    loadingUtxoStats: controllerState.loadingUtxoStats,
    utxoStatsLoadedFor: controllerState.utxoStatsLoadedFor,
    loadUtxosForStats: controllerState.loadUtxosForStats,
    privacyData: null,
    privacySummary: null,
    showPrivacy: false,
    addresses: [],
    setAddresses: vi.fn(),
    walletAddressStrings: [],
    addressSummary: null,
    hasMoreAddresses: false,
    loadingAddresses: false,
    loadAddresses: vi.fn(),
    loadAddressSummary: vi.fn(),
    addressOffset: 0,
    ADDRESS_PAGE_SIZE: 20,
    draftsCount: 0,
    setDraftsCount: vi.fn(),
    explorerUrl: null,
    groups: [],
    walletShareInfo: null,
    setWalletShareInfo: vi.fn(),
    fetchData: controllerState.fetchData,
    refreshData: controllerState.refreshData,
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletSync', () => ({
  useWalletSync: () => ({
    syncing: false,
    setSyncing: vi.fn(),
    syncRetryInfo: null,
    setSyncRetryInfo: vi.fn(),
    handleSync: vi.fn(),
    handleFullResync: vi.fn(),
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useTransactionFilters', () => ({
  useTransactionFilters: () => ({
    filters: {},
    setTypeFilter: vi.fn(),
    setConfirmationFilter: vi.fn(),
    setDatePreset: vi.fn(),
    setCustomDateRange: vi.fn(),
    setLabelFilter: vi.fn(),
    clearAllFilters: vi.fn(),
    hasActiveFilters: false,
    filteredTransactions: [],
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useAITransactionFilter', () => ({
  useAITransactionFilter: () => ({
    aiQueryFilter: null,
    setAiQueryFilter: vi.fn(),
    filteredTransactions: [],
    aiAggregationResult: null,
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletSharing', () => ({
  useWalletSharing: () => ({
    userSearchQuery: '',
    userSearchResults: [],
    searchingUsers: false,
    handleSearchUsers: vi.fn(),
    selectedGroupToAdd: '',
    setSelectedGroupToAdd: vi.fn(),
    addGroup: vi.fn(),
    updateGroupRole: vi.fn(),
    removeGroup: vi.fn(),
    sharingLoading: false,
    handleShareWithUser: vi.fn(),
    handleRemoveUserAccess: vi.fn(),
    deviceSharePrompt: null,
    handleShareDevicesWithUser: vi.fn(),
    dismissDeviceSharePrompt: vi.fn(),
    handleTransferComplete: vi.fn(),
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useAddressLabels', () => ({
  useAddressLabels: () => ({
    editingAddressId: null,
    availableLabels: [],
    selectedLabelIds: [],
    savingAddressLabels: false,
    handleEditAddressLabels: vi.fn(),
    handleSaveAddressLabels: vi.fn(),
    handleToggleAddressLabel: vi.fn(),
    handleCancelEditLabels: vi.fn(),
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useUtxoActions', () => ({
  useUtxoActions: () => ({
    selectedUtxos: new Set(),
    pendingFreezeIds: new Set(),
    handleToggleFreeze: vi.fn(),
    handleToggleSelect: vi.fn(),
    handleSendSelected: vi.fn(),
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletMutations', () => ({
  useWalletMutations: () => ({
    isEditingName: false,
    setIsEditingName: vi.fn(),
    editedName: '',
    setEditedName: vi.fn(),
    handleUpdateWallet: vi.fn(),
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletDetailTabs', () => ({
  useWalletDetailTabs: () => ({
    setActiveTab: vi.fn(),
    visibleActiveTab: controllerState.visibleActiveTab,
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletAgentLinks', () => ({
  useWalletAgentLinks: () => [],
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletWebSocket', () => ({
  useWalletWebSocket: vi.fn(),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletDetailAddressActions', () => ({
  useWalletDetailAddressActions: () => ({
    handleLoadMoreAddressPage: vi.fn(),
    handleGenerateMoreAddresses: vi.fn(),
    handleFetchUnusedAddresses: vi.fn(),
  }),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletDraftNotifications', () => ({
  useWalletDraftNotifications: () => vi.fn(),
}));

vi.mock('../../../src/components/WalletDetail/hooks/useWalletDetailModalState', () => ({
  useWalletDetailModalState: () => ({}),
}));

describe('useWalletDetailController stats-tab UTXO load-once effect', () => {
  beforeEach(() => {
    controllerState.visibleActiveTab = 'stats';
    controllerState.routeId = 'wallet-1';
    controllerState.user = { id: 'user-1', isAdmin: false };
    controllerState.utxoStats = [];
    controllerState.loadingUtxoStats = false;
    controllerState.utxoStatsLoadedFor = null;
    controllerState.loadUtxosForStats.mockClear();
    controllerState.fetchData.mockClear();
  });

  it('loads UTXO stats exactly once across a loadingUtxoStats false->true->false cycle on an empty wallet', async () => {
    const { rerender } = renderHook(() => useWalletDetailController());

    await waitFor(() => expect(controllerState.loadUtxosForStats).toHaveBeenCalledTimes(1));
    expect(controllerState.loadUtxosForStats).toHaveBeenCalledWith('wallet-1');

    // Load starts: guard must not re-fire while in flight.
    controllerState.loadingUtxoStats = true;
    rerender();
    expect(controllerState.loadUtxosForStats).toHaveBeenCalledTimes(1);

    // Load finishes: the wallet had no UTXOs, so utxoStats stays [] — this is
    // exactly the transition that looped forever under the old
    // `utxoStats.length > 0` guard.
    controllerState.loadingUtxoStats = false;
    controllerState.utxoStatsLoadedFor = 'wallet-1';
    rerender();
    expect(controllerState.loadUtxosForStats).toHaveBeenCalledTimes(1);

    // A no-op rerender (e.g. an unrelated state change) must not re-fire it either.
    rerender();
    expect(controllerState.loadUtxosForStats).toHaveBeenCalledTimes(1);
  });

  it('does not load stats when the Stats tab is not visible', async () => {
    controllerState.visibleActiveTab = 'tx';
    renderHook(() => useWalletDetailController());

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(controllerState.loadUtxosForStats).not.toHaveBeenCalled();
  });

  it('re-arms the load for a newly selected wallet after the previous one was attempted', async () => {
    const { rerender } = renderHook(() => useWalletDetailController());
    await waitFor(() => expect(controllerState.loadUtxosForStats).toHaveBeenCalledTimes(1));

    controllerState.loadingUtxoStats = false;
    controllerState.utxoStatsLoadedFor = 'wallet-1';
    rerender();
    expect(controllerState.loadUtxosForStats).toHaveBeenCalledTimes(1);

    // Switching wallets resets utxoStatsLoadedFor (useWalletData does this in
    // its route-keyed useLayoutEffect); the new wallet must be re-armed.
    controllerState.routeId = 'wallet-2';
    controllerState.utxoStatsLoadedFor = null;
    rerender();

    await waitFor(() => expect(controllerState.loadUtxosForStats).toHaveBeenCalledTimes(2));
    expect(controllerState.loadUtxosForStats).toHaveBeenLastCalledWith('wallet-2');
  });
});
