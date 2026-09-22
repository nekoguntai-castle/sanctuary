import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletDetailController } from '../../../src/components/WalletDetail/useWalletDetailController';
import { queryClient } from '../../../src/providers/QueryProvider';
import { walletKeys } from '../../../src/hooks/queries/useWallets';

const controllerState = vi.hoisted(() => ({
  activeNetwork: 'mainnet' as 'mainnet' | 'testnet3' | 'testnet4' | 'signet',
  walletNetwork: 'signet' as string | undefined,
  setSelectedNetwork: vi.fn(),
  bitcoinStatusNetworks: [] as Array<string | undefined>,
  lastFilterThresholds: {} as { confirmationThreshold?: number; deepConfirmationThreshold?: number },
  bitcoinStatusData: { confirmationThreshold: 1, deepConfirmationThreshold: 6, network: 'mainnet' } as
    | { confirmationThreshold: number; deepConfirmationThreshold: number; network?: string }
    | undefined,
  statusIsPlaceholderData: false,
  aiOwnershipKeys: [] as string[],
  routeId: 'wallet-1' as string | undefined,
  user: { id: 'user-1', isAdmin: false } as { id: string; isAdmin: boolean } | null,
  fetchData: vi.fn(),
  refreshData: vi.fn().mockResolvedValue(true),
  navigate: vi.fn(),
  refreshAfterTransfer: vi.fn().mockResolvedValue({ status: 'committed' }),
  refreshAfterConfirmedTransfer: vi.fn().mockResolvedValue({ status: 'committed' }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: controllerState.routeId }),
    useNavigate: () => controllerState.navigate,
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
    selectedNetwork: controllerState.activeNetwork,
    isMainnet: controllerState.activeNetwork === 'mainnet',
    setSelectedNetwork: controllerState.setSelectedNetwork,
  }),
}));

vi.mock('../../../src/contexts/UserContext', () => ({
  useUser: () => ({ user: controllerState.user }),
}));

vi.mock('../../../src/hooks/queries/useBitcoin', () => ({
  useBitcoinStatus: (network?: string) => {
    controllerState.bitcoinStatusNetworks.push(network);
    return {
      data: controllerState.bitcoinStatusData,
      isPlaceholderData: controllerState.statusIsPlaceholderData,
    };
  },
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
    refreshWalletShareInfo: vi.fn().mockResolvedValue({ status: 'superseded' }),
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
  useTransactionFilters: (args: { confirmationThreshold?: number; deepConfirmationThreshold?: number }) => {
    controllerState.lastFilterThresholds = {
      confirmationThreshold: args?.confirmationThreshold,
      deepConfirmationThreshold: args?.deepConfirmationThreshold,
    };
    return ({
    filters: {},
    setTypeFilter: vi.fn(),
    setConfirmationFilter: vi.fn(),
    setDatePreset: vi.fn(),
    setCustomDateRange: vi.fn(),
    setLabelFilter: vi.fn(),
    clearAllFilters: vi.fn(),
    hasActiveFilters: false,
    filteredTransactions: [],
    });
  },
}));

vi.mock('../../../src/components/WalletDetail/hooks/useAITransactionFilter', () => ({
  useAITransactionFilter: ({ ownershipKey }: { ownershipKey: string }) => {
    controllerState.aiOwnershipKeys.push(ownershipKey);
    return {
      aiQueryFilter: null,
      setAiQueryFilter: vi.fn(),
      filteredTransactions: [],
      aiAggregationResult: null,
    };
  },
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
    handleTransferComplete: controllerState.refreshAfterTransfer,
    handleConfirmedTransferComplete: controllerState.refreshAfterConfirmedTransfer,
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
    pendingFreezeIds: new Set(['pending-controller-utxo']),
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
    visibleActiveTab: 'tx',
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

describe('useWalletDetailController network preference alignment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
    controllerState.activeNetwork = 'mainnet';
    controllerState.walletNetwork = 'signet';
    controllerState.setSelectedNetwork.mockClear();
    controllerState.bitcoinStatusNetworks = [];
    controllerState.aiOwnershipKeys = [];
    controllerState.routeId = 'wallet-1';
    controllerState.user = { id: 'user-1', isAdmin: false };
    controllerState.fetchData.mockClear();
    controllerState.navigate.mockClear();
    controllerState.refreshAfterTransfer.mockReset().mockResolvedValue({ status: 'committed' });
    controllerState.refreshAfterConfirmedTransfer.mockReset().mockResolvedValue({ status: 'committed' });
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

  it('passes route, user, and selected network ownership to the AI filter', () => {
    const view = renderHook(() => useWalletDetailController());
    expect(controllerState.aiOwnershipKeys.at(-1)).toBe('wallet-1:user-1:mainnet');

    controllerState.routeId = 'wallet-2';
    controllerState.user = { id: 'user-2', isAdmin: false };
    controllerState.activeNetwork = 'testnet4';
    view.rerender();

    expect(controllerState.aiOwnershipKeys.at(-1)).toBe('wallet-2:user-2:testnet4');
    expect(view.result.current.ownershipKey).toBe('wallet-2:user-2:testnet4');
  });

  it('exposes pending freeze IDs from the UTXO actions controller', () => {
    const { result } = renderHook(() => useWalletDetailController());

    expect(result.current.pendingFreezeIds).toEqual(new Set(['pending-controller-utxo']));
  });

  it('preserves ordinary completion and missing-route outcomes', async () => {
    controllerState.walletNetwork = 'mainnet';
    const current = renderHook(() => useWalletDetailController());
    await expect(current.result.current.handleTransferComplete()).resolves.toEqual({
      status: 'committed',
    });
    expect(controllerState.navigate).not.toHaveBeenCalled();

    controllerState.routeId = undefined;
    current.rerender();
    await expect(current.result.current.handleTransferComplete()).resolves.toEqual({
      status: 'superseded',
    });
    expect(controllerState.refreshAfterConfirmedTransfer).toHaveBeenCalledTimes(1);
  });

  it('evicts inaccessible wallet data before replace navigation', async () => {
    controllerState.walletNetwork = 'mainnet';
    controllerState.refreshAfterConfirmedTransfer.mockResolvedValue({ status: 'access-removed' });
    queryClient.setQueryData(walletKeys.lists(), [{ id: 'wallet-1' }, { id: 'wallet-2' }]);
    queryClient.setQueryData(walletKeys.detail('wallet-1'), { id: 'wallet-1' });
    const { result } = renderHook(() => useWalletDetailController());

    await act(async () => {
      await expect(result.current.handleTransferComplete()).resolves.toEqual({
        status: 'access-removed',
      });
    });

    expect(queryClient.getQueryData(walletKeys.lists())).toEqual([{ id: 'wallet-2' }]);
    expect(queryClient.getQueryData(walletKeys.detail('wallet-1'))).toBeUndefined();
    expect(controllerState.navigate).toHaveBeenCalledWith('/wallets', { replace: true });
  });

  it('does not let an A-B-A route cycle navigate after delayed cache reconciliation', async () => {
    controllerState.walletNetwork = 'mainnet';
    controllerState.refreshAfterConfirmedTransfer.mockResolvedValue({ status: 'access-removed' });
    queryClient.setQueryData(walletKeys.lists(), [{ id: 'wallet-1' }]);
    let finishInvalidation!: () => void;
    const invalidation = new Promise<void>(resolve => {
      finishInvalidation = resolve;
    });
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(invalidation);
    const view = renderHook(() => useWalletDetailController());

    let completion!: ReturnType<typeof view.result.current.handleTransferComplete>;
    act(() => {
      completion = view.result.current.handleTransferComplete();
    });
    await waitFor(() => expect(queryClient.getQueryData(walletKeys.lists())).toEqual([]));
    controllerState.routeId = 'wallet-2';
    view.rerender();
    controllerState.routeId = 'wallet-1';
    view.rerender();
    await act(async () => {
      finishInvalidation();
      await invalidation;
    });

    await expect(completion).resolves.toEqual({ status: 'superseded' });
    expect(controllerState.navigate).not.toHaveBeenCalled();
  });

  it('builds an anonymous empty-route owner and guards route-bound label refreshes', () => {
    controllerState.routeId = undefined;
    controllerState.user = null;
    const { result } = renderHook(() => useWalletDetailController());

    result.current.handleLabelsChange();
    expect(controllerState.fetchData).not.toHaveBeenCalled();

    controllerState.routeId = 'wallet-1';
    const current = renderHook(() => useWalletDetailController());
    current.result.current.handleLabelsChange();
    expect(controllerState.fetchData).toHaveBeenCalledWith(true);
  });
  describe('cross-network status gating', () => {
    /**
     * keepPreviousData can return the previous network's status while the new
     * one loads. Confirmation thresholds differ per network, so using them
     * would judge transactions confirmed against another chain's rules.
     */
    beforeEach(() => {
      controllerState.bitcoinStatusData = {
        confirmationThreshold: 1,
        deepConfirmationThreshold: 6,
        network: 'mainnet',
      };
      controllerState.statusIsPlaceholderData = false;
    });

    it('does not adopt confirmation thresholds from another network', () => {
      controllerState.bitcoinStatusData = {
        confirmationThreshold: 99,
        deepConfirmationThreshold: 99,
        network: 'testnet4',
      };

      renderHook(() => useWalletDetailController());

      expect(controllerState.lastFilterThresholds).toEqual({
        confirmationThreshold: undefined,
        deepConfirmationThreshold: undefined,
      });
    });

    it('does not adopt thresholds still flagged as placeholder data', () => {
      controllerState.statusIsPlaceholderData = true;

      renderHook(() => useWalletDetailController());

      expect(controllerState.lastFilterThresholds).toEqual({
        confirmationThreshold: undefined,
        deepConfirmationThreshold: undefined,
      });
    });

    it('uses the thresholds once the status identity matches', () => {
      renderHook(() => useWalletDetailController());

      expect(controllerState.lastFilterThresholds).toEqual({
        confirmationThreshold: 1,
        deepConfirmationThreshold: 6,
      });
    });

    it('tolerates an absent status payload', () => {
      controllerState.bitcoinStatusData = undefined;

      renderHook(() => useWalletDetailController());

      expect(controllerState.lastFilterThresholds).toEqual({
        confirmationThreshold: undefined,
        deepConfirmationThreshold: undefined,
      });
    });
  });

});
