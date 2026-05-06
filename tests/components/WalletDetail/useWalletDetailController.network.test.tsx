import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletDetailController } from '../../../components/WalletDetail/useWalletDetailController';

const controllerState = vi.hoisted(() => ({
  activeNetwork: 'mainnet' as 'mainnet' | 'testnet3' | 'testnet4' | 'signet',
  walletNetwork: 'signet' as string | undefined,
  setSelectedNetwork: vi.fn(),
  bitcoinStatusNetworks: [] as Array<string | undefined>,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: 'wallet-1' }),
    useNavigate: () => vi.fn(),
    useLocation: () => ({ state: null }),
  };
});

vi.mock('../../../contexts/AppNotificationContext', () => ({
  useAppNotifications: () => ({
    addNotification: vi.fn(),
    removeNotificationsByType: vi.fn(),
  }),
}));

vi.mock('../../../contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: controllerState.activeNetwork,
    isMainnet: controllerState.activeNetwork === 'mainnet',
    setSelectedNetwork: controllerState.setSelectedNetwork,
  }),
}));

vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({ user: { id: 'user-1', isAdmin: false } }),
}));

vi.mock('../../../hooks/queries/useBitcoin', () => ({
  useBitcoinStatus: (network?: string) => {
    controllerState.bitcoinStatusNetworks.push(network);
    return { data: { confirmationThreshold: 1, deepConfirmationThreshold: 6 } };
  },
}));

vi.mock('../../../hooks/queries/useWalletLabels', () => ({
  useWalletLabels: () => ({ data: [] }),
}));

vi.mock('../../../hooks/useAIStatus', () => ({
  useAIStatus: () => ({ enabled: false }),
}));

vi.mock('../../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}));

vi.mock('../../../hooks/websocket', () => ({
  useWalletLogs: () => ({
    logs: [],
    isPaused: false,
    isLoading: false,
    clearLogs: vi.fn(),
    togglePause: vi.fn(),
  }),
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletData', () => ({
  useWalletData: () => ({
    wallet: {
      id: 'wallet-1',
      name: 'Wallet',
      network: controllerState.walletNetwork,
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
    utxoStats: [],
    setUtxoStats: vi.fn(),
    loadingUtxoStats: false,
    loadUtxosForStats: vi.fn(),
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
    fetchData: vi.fn(),
  }),
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletSync', () => ({
  useWalletSync: () => ({
    syncing: false,
    setSyncing: vi.fn(),
    repairing: false,
    syncRetryInfo: null,
    setSyncRetryInfo: vi.fn(),
    handleSync: vi.fn(),
    handleFullResync: vi.fn(),
    handleRepairWallet: vi.fn(),
  }),
}));

vi.mock('../../../components/WalletDetail/hooks/useTransactionFilters', () => ({
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

vi.mock('../../../components/WalletDetail/hooks/useAITransactionFilter', () => ({
  useAITransactionFilter: () => ({
    aiQueryFilter: null,
    setAiQueryFilter: vi.fn(),
    filteredTransactions: [],
    aiAggregationResult: null,
  }),
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletSharing', () => ({
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

vi.mock('../../../components/WalletDetail/hooks/useAddressLabels', () => ({
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

vi.mock('../../../components/WalletDetail/hooks/useUtxoActions', () => ({
  useUtxoActions: () => ({
    selectedUtxos: new Set(),
    handleToggleFreeze: vi.fn(),
    handleToggleSelect: vi.fn(),
    handleSendSelected: vi.fn(),
  }),
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletMutations', () => ({
  useWalletMutations: () => ({
    isEditingName: false,
    setIsEditingName: vi.fn(),
    editedName: '',
    setEditedName: vi.fn(),
    handleUpdateWallet: vi.fn(),
  }),
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletDetailTabs', () => ({
  useWalletDetailTabs: () => ({
    setActiveTab: vi.fn(),
    visibleActiveTab: 'tx',
  }),
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletAgentLinks', () => ({
  useWalletAgentLinks: () => [],
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletWebSocket', () => ({
  useWalletWebSocket: vi.fn(),
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletDetailAddressActions', () => ({
  useWalletDetailAddressActions: () => ({
    handleLoadMoreAddressPage: vi.fn(),
    handleGenerateMoreAddresses: vi.fn(),
    handleFetchUnusedAddresses: vi.fn(),
  }),
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletDraftNotifications', () => ({
  useWalletDraftNotifications: () => vi.fn(),
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletDetailModalState', () => ({
  useWalletDetailModalState: () => ({}),
}));

describe('useWalletDetailController network preference alignment', () => {
  beforeEach(() => {
    controllerState.activeNetwork = 'mainnet';
    controllerState.walletNetwork = 'signet';
    controllerState.setSelectedNetwork.mockClear();
    controllerState.bitcoinStatusNetworks = [];
  });

  it('updates the active network preference to match the loaded wallet', async () => {
    renderHook(() => useWalletDetailController());

    await waitFor(() => {
      expect(controllerState.setSelectedNetwork).toHaveBeenCalledWith('signet');
    });
  });

  it('does not force the active network back after the wallet has been aligned once', async () => {
    controllerState.walletNetwork = 'testnet4';

    const { rerender } = renderHook(() => useWalletDetailController());

    await waitFor(() => {
      expect(controllerState.setSelectedNetwork).toHaveBeenCalledWith('testnet4');
    });

    controllerState.setSelectedNetwork.mockClear();
    controllerState.activeNetwork = 'mainnet';
    rerender();

    expect(controllerState.setSelectedNetwork).not.toHaveBeenCalled();
  });

  it('uses the current active network for wallet-detail Bitcoin status', () => {
    controllerState.activeNetwork = 'testnet3';
    controllerState.walletNetwork = 'testnet3';

    renderHook(() => useWalletDetailController());

    expect(controllerState.bitcoinStatusNetworks).toContain('testnet3');
    expect(controllerState.setSelectedNetwork).not.toHaveBeenCalled();
  });
});
