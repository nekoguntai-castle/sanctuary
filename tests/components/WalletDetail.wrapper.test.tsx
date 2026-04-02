import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { WalletDetail } from '../../components/WalletDetail';
import * as labelsApi from '../../src/api/labels';
import * as transactionsApi from '../../src/api/transactions';
import * as walletsApi from '../../src/api/wallets';
import { WalletType } from '../../types';

const mocks = vi.hoisted(() => ({
  routeId: 'wallet-1' as string | undefined,
  locationState: {} as any,
  navigate: vi.fn(),
  handleError: vi.fn(),
  addAppNotification: vi.fn(),
  removeNotificationsByType: vi.fn(),
  walletDataState: {} as any,
  walletSyncState: {} as any,
  walletSharingState: {} as any,
  aiFilterState: {} as any,
  walletLogsState: {} as any,
  walletWebSocketState: vi.fn(),
  walletSyncHookArgs: undefined as any,
  walletSharingHookArgs: undefined as any,
  loadAddresses: vi.fn(),
  loadAddressSummary: vi.fn(),
  loadUtxosForStats: vi.fn(),
  fetchData: vi.fn(),
  setError: vi.fn(),
  setWallet: vi.fn(),
  setTransactions: vi.fn(),
  setUTXOs: vi.fn(),
  setUtxoStats: vi.fn(),
  setAddresses: vi.fn(),
  setDraftsCount: vi.fn(),
  syncHandler: vi.fn(),
  fullResyncHandler: vi.fn(),
  repairHandler: vi.fn(),
  setSyncing: vi.fn(),
  setSyncRetryInfo: vi.fn(),
  transferComplete: vi.fn(),
  dismissSharePrompt: vi.fn(),
  shareDevices: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: mocks.routeId }),
    useNavigate: () => mocks.navigate,
    useLocation: () => ({ state: mocks.locationState }),
  };
});

vi.mock('../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: mocks.handleError,
    showSuccess: vi.fn(),
  }),
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: { id: 'user-1', username: 'owner' },
  }),
}));

vi.mock('../../contexts/AppNotificationContext', () => ({
  useAppNotifications: () => ({
    addNotification: mocks.addAppNotification,
    removeNotificationsByType: mocks.removeNotificationsByType,
  }),
}));

vi.mock('../../hooks/queries/useBitcoin', () => ({
  useBitcoinStatus: () => ({
    data: {
      confirmationThreshold: 2,
      deepConfirmationThreshold: 6,
      explorerUrl: 'https://mempool.space',
    },
  }),
}));

vi.mock('../../hooks/useAIStatus', () => ({
  useAIStatus: () => ({
    enabled: true,
  }),
}));

vi.mock('../../hooks/websocket', () => ({
  useWalletLogs: () => mocks.walletLogsState,
}));

vi.mock('../../components/WalletDetail/hooks/useWalletData', () => ({
  useWalletData: () => mocks.walletDataState,
}));

vi.mock('../../components/WalletDetail/hooks/useWalletSync', () => ({
  useWalletSync: (args: any) => {
    mocks.walletSyncHookArgs = args;
    return mocks.walletSyncState;
  },
}));

vi.mock('../../components/WalletDetail/hooks/useWalletSharing', () => ({
  useWalletSharing: (args: any) => {
    mocks.walletSharingHookArgs = args;
    return mocks.walletSharingState;
  },
}));

vi.mock('../../components/WalletDetail/hooks/useAITransactionFilter', () => ({
  useAITransactionFilter: () => mocks.aiFilterState,
}));

vi.mock('../../components/WalletDetail/hooks/useWalletWebSocket', () => ({
  useWalletWebSocket: (...args: any[]) => mocks.walletWebSocketState(...args),
}));

vi.mock('../../components/WalletDetail/WalletHeader', () => ({
  WalletHeader: (props: any) => (
    <div data-testid="wallet-header">
      <button onClick={props.onReceive}>header-receive</button>
      <button onClick={props.onSend}>header-send</button>
      <button onClick={props.onSync}>header-sync</button>
      <button onClick={props.onFullResync}>header-resync</button>
      <button onClick={props.onExport}>header-export</button>
    </div>
  ),
}));

vi.mock('../../components/WalletDetail/LogTab', () => ({
  LogTab: (props: any) => (
    <div data-testid="log-tab">
      <button onClick={props.onTogglePause}>log-pause</button>
      <button onClick={props.onClearLogs}>log-clear</button>
      <button onClick={props.onSync}>log-sync</button>
      <button onClick={props.onFullResync}>log-resync</button>
    </div>
  ),
}));

vi.mock('../../components/WalletDetail/tabs', () => ({
  TransactionsTab: (props: any) => (
    <div data-testid="transactions-tab">
      <span>{props.highlightTxId || 'no-highlight'}</span>
      <button onClick={props.onLabelsChange}>tx-labels-change</button>
      <button onClick={props.onShowTransactionExport}>tx-export</button>
      <button onClick={props.onLoadMore}>tx-load-more</button>
    </div>
  ),
  UTXOTab: (props: any) => (
    <div data-testid="utxo-tab">
      <span data-testid="utxo-network">{props.network}</span>
      <button onClick={() => props.onToggleFreeze('tx-1', 0)}>utxo-freeze</button>
      <button onClick={() => props.onToggleFreeze('missing', 1)}>utxo-freeze-missing</button>
      <button onClick={() => props.onToggleSelect('utxo-1')}>utxo-select</button>
      <button onClick={props.onSendSelected}>utxo-send-selected</button>
      <button onClick={props.onLoadMore}>utxo-load-more</button>
    </div>
  ),
  AddressesTab: (props: any) => (
    <div data-testid="addresses-tab">
      <span data-testid="addr-descriptor">{String(props.descriptor)}</span>
      <span data-testid="addr-network">{props.network}</span>
      <button onClick={props.onLoadMoreAddresses}>addr-load-more</button>
      <button onClick={props.onGenerateMoreAddresses}>addr-generate</button>
      <button
        onClick={() =>
          props.onEditAddressLabels({
            id: 'addr-1',
            labels: [{ id: 'label-1', name: 'Known Label' }],
          })
        }
      >
        addr-edit-labels
      </button>
      <button onClick={() => props.onToggleAddressLabel('label-2')}>addr-toggle-label</button>
      <button onClick={props.onSaveAddressLabels}>addr-save-labels</button>
      <button onClick={props.onCancelEditLabels}>addr-cancel-labels</button>
      <button onClick={() => props.onShowQrModal('bc1q-test-qr')}>addr-show-qr</button>
    </div>
  ),
  DraftsTab: (props: any) => (
    <div data-testid="drafts-tab">
      <span data-testid="drafts-role">{props.userRole}</span>
      <span data-testid="drafts-type">{props.walletType}</span>
      <button onClick={() => props.onDraftsChange(2)}>drafts-add</button>
      <button onClick={() => props.onDraftsChange(1)}>drafts-single</button>
      <button onClick={() => props.onDraftsChange(0)}>drafts-clear</button>
    </div>
  ),
  StatsTab: (props: any) => (
    <div data-testid="stats-tab">
      <span data-testid="stats-utxo-id">{props.utxos?.[0]?.id || 'none'}</span>
    </div>
  ),
  AccessTab: (props: any) => (
    <div data-testid="access-tab">
      <span data-testid="access-role">{props.userRole}</span>
      <button onClick={props.onShowTransferModal}>access-transfer</button>
    </div>
  ),
  SettingsTab: (props: any) => (
    <div data-testid="settings-tab">
      <button onClick={() => props.onUpdateWallet({ name: 'Renamed Wallet', descriptor: 'desc-new' })}>
        settings-update
      </button>
      <button onClick={props.onRepairWallet}>settings-repair</button>
      <button onClick={props.onShowDelete}>settings-delete</button>
      <button onClick={props.onShowExport}>settings-export</button>
    </div>
  ),
}));

vi.mock('../../components/WalletDetail/modals', () => ({
  DeleteModal: (props: any) => (
    <div data-testid="delete-modal">
      <button onClick={props.onConfirm}>delete-confirm</button>
      <button onClick={props.onClose}>delete-close</button>
    </div>
  ),
  ReceiveModal: (props: any) => (
    <div data-testid="receive-modal">
      <span data-testid="receive-network">{props.network}</span>
      <button onClick={props.onClose}>receive-close</button>
      <button onClick={props.onNavigateToSettings}>receive-settings</button>
      <button onClick={() => props.onFetchUnusedAddresses?.(props.walletId)}>receive-fetch-unused</button>
    </div>
  ),
  ExportModal: (props: any) => (
    <div data-testid="export-modal">
      <button onClick={props.onClose}>export-close</button>
    </div>
  ),
  AddressQRModal: (props: any) => (
    <div data-testid="qr-modal">
      <span>{props.address}</span>
      <button onClick={props.onClose}>qr-close</button>
    </div>
  ),
  DeviceSharePromptModal: (props: any) =>
    props.deviceSharePrompt?.show ? (
      <div data-testid="device-share-modal">
        <button onClick={props.onShareDevices}>device-share-confirm</button>
        <button onClick={props.onDismiss}>device-share-dismiss</button>
      </div>
    ) : null,
}));

vi.mock('../../components/TransactionExportModal', () => ({
  TransactionExportModal: (props: any) => (
    <div data-testid="tx-export-modal">
      <button onClick={props.onClose}>tx-export-close</button>
    </div>
  ),
}));

vi.mock('../../components/TransferOwnershipModal', () => ({
  TransferOwnershipModal: (props: any) => (
    <div data-testid="transfer-modal">
      <button onClick={props.onTransferInitiated}>transfer-confirm</button>
      <button onClick={props.onClose}>transfer-close</button>
    </div>
  ),
}));

vi.mock('../../src/api/wallets', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    updateWallet: vi.fn(),
    deleteWallet: vi.fn(),
  };
});

vi.mock('../../src/api/transactions', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getAddresses: vi.fn().mockResolvedValue([]),
    generateAddresses: vi.fn(),
    freezeUTXO: vi.fn(),
  };
});

vi.mock('../../src/api/labels', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getLabels: vi.fn(),
    setAddressLabels: vi.fn(),
  };
});

function createWalletData(overrides: Partial<any> = {}) {
  return {
    wallet: {
      id: 'wallet-1',
      name: 'Test Wallet',
      type: WalletType.SINGLE_SIG,
      scriptType: 'native_segwit',
      descriptor: 'desc-original',
      quorum: null,
      totalSigners: null,
      balance: 500000,
      network: 'mainnet',
      userRole: 'owner',
      canEdit: true,
    },
    setWallet: mocks.setWallet,
    devices: [{ id: 'device-1' }],
    loading: false,
    error: null,
    setError: mocks.setError,
    transactions: [{ id: 'tx-a', txid: 'tx-a', amount: 1000, confirmations: 1 }],
    setTransactions: mocks.setTransactions,
    transactionStats: null,
    hasMoreTx: false,
    loadingMoreTx: false,
    loadMoreTransactions: vi.fn(),
    utxos: [{ id: 'utxo-1', txid: 'tx-1', vout: 0, frozen: false, amount: 1000 }],
    setUTXOs: mocks.setUTXOs,
    utxoSummary: { count: 1, totalBalance: 1000 },
    hasMoreUtxos: false,
    loadingMoreUtxos: false,
    loadMoreUtxos: vi.fn(),
    utxoStats: [],
    setUtxoStats: mocks.setUtxoStats,
    loadingUtxoStats: false,
    loadUtxosForStats: mocks.loadUtxosForStats,
    privacyData: [],
    privacySummary: null,
    showPrivacy: true,
    addresses: [
      {
        id: 'addr-1',
        address: 'bc1qtest',
        labels: [{ id: 'label-1', name: 'Known Label' }],
      },
    ],
    setAddresses: mocks.setAddresses,
    walletAddressStrings: ['bc1qtest'],
    addressSummary: { totalAddresses: 50 },
    hasMoreAddresses: true,
    loadingAddresses: false,
    loadAddresses: mocks.loadAddresses,
    loadAddressSummary: mocks.loadAddressSummary,
    addressOffset: 25,
    ADDRESS_PAGE_SIZE: 25,
    draftsCount: 0,
    setDraftsCount: mocks.setDraftsCount,
    explorerUrl: 'https://mempool.space',
    users: [],
    groups: [],
    walletShareInfo: { users: [], group: null },
    setWalletShareInfo: vi.fn(),
    fetchData: mocks.fetchData,
    ...overrides,
  };
}

function createSyncState(overrides: Partial<any> = {}) {
  return {
    syncing: false,
    setSyncing: mocks.setSyncing,
    repairing: false,
    syncRetryInfo: null,
    setSyncRetryInfo: mocks.setSyncRetryInfo,
    handleSync: mocks.syncHandler,
    handleFullResync: mocks.fullResyncHandler,
    handleRepairWallet: mocks.repairHandler,
    ...overrides,
  };
}

function createSharingState(overrides: Partial<any> = {}) {
  return {
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
    deviceSharePrompt: {
      show: false,
      targetUserId: '',
      targetUsername: '',
      devices: [],
    },
    handleShareDevicesWithUser: mocks.shareDevices,
    dismissDeviceSharePrompt: mocks.dismissSharePrompt,
    handleTransferComplete: mocks.transferComplete,
    ...overrides,
  };
}

describe('WalletDetail wrapper behaviors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routeId = 'wallet-1';
    mocks.locationState = {};

    mocks.loadAddresses = vi.fn().mockResolvedValue(undefined);
    mocks.loadAddressSummary = vi.fn().mockResolvedValue(undefined);
    mocks.loadUtxosForStats = vi.fn();
    mocks.fetchData = vi.fn().mockResolvedValue(undefined);

    mocks.setError = vi.fn();
    mocks.setWallet = vi.fn();
    mocks.setTransactions = vi.fn();
    mocks.setUTXOs = vi.fn();
    mocks.setUtxoStats = vi.fn();
    mocks.setAddresses = vi.fn();
    mocks.setDraftsCount = vi.fn();

    mocks.syncHandler = vi.fn();
    mocks.fullResyncHandler = vi.fn();
    mocks.repairHandler = vi.fn();
    mocks.setSyncing = vi.fn();
    mocks.setSyncRetryInfo = vi.fn();

    mocks.transferComplete = vi.fn();
    mocks.dismissSharePrompt = vi.fn();
    mocks.shareDevices = vi.fn();

    mocks.walletDataState = createWalletData();
    mocks.walletSyncState = createSyncState();
    mocks.walletSharingState = createSharingState();
    mocks.walletSyncHookArgs = undefined;
    mocks.walletSharingHookArgs = undefined;
    mocks.aiFilterState = {
      aiQueryFilter: null,
      setAiQueryFilter: vi.fn(),
      filteredTransactions: [{ id: 'tx-a', txid: 'tx-a', amount: 1000, confirmations: 1 }],
      aiAggregationResult: null,
    };
    mocks.walletLogsState = {
      logs: [],
      isPaused: false,
      isLoading: false,
      clearLogs: vi.fn(),
      togglePause: vi.fn(),
    };

    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([]);
    vi.mocked(transactionsApi.generateAddresses).mockResolvedValue({} as any);
    vi.mocked(transactionsApi.freezeUTXO).mockResolvedValue({} as any);
    vi.mocked(labelsApi.getLabels).mockResolvedValue([
      { id: 'label-1', name: 'Known Label' },
      { id: 'label-2', name: 'Second Label' },
    ] as any);
    vi.mocked(labelsApi.setAddressLabels).mockResolvedValue({} as any);
    vi.mocked(walletsApi.updateWallet).mockResolvedValue({} as any);
    vi.mocked(walletsApi.deleteWallet).mockResolvedValue({} as any);
  });

  it('shows loading, error, and no-wallet fallback states', async () => {
    const user = userEvent.setup();

    mocks.walletDataState = createWalletData({ loading: true, wallet: null });
    const { rerender } = render(<WalletDetail />);
    expect(screen.getByText('Loading wallet...')).toBeInTheDocument();

    mocks.walletDataState = createWalletData({ loading: false, error: 'boom', wallet: null });
    rerender(<WalletDetail />);
    expect(screen.getByText('Failed to Load Wallet')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(mocks.setError).toHaveBeenCalledWith(null);
    expect(mocks.fetchData).toHaveBeenCalled();

    mocks.walletDataState = createWalletData({ loading: false, error: null, wallet: null });
    rerender(<WalletDetail />);
    expect(screen.getByText('Loading wallet...')).toBeInTheDocument();
  });

  it('applies location-driven active tab changes and stats data bootstrap', async () => {
    mocks.locationState = { activeTab: 'stats' };
    mocks.walletDataState = createWalletData({
      utxoStats: [],
      loadingUtxoStats: false,
    });
    const { rerender } = render(<WalletDetail />);

    expect(screen.getByTestId('stats-tab')).toBeInTheDocument();
    expect(mocks.loadUtxosForStats).toHaveBeenCalledWith('wallet-1');

    mocks.locationState = { activeTab: 'addresses' };
    rerender(<WalletDetail />);

    await waitFor(() => {
      expect(screen.getByTestId('addresses-tab')).toBeInTheDocument();
    });
  });

  it('handles header actions, tab interactions, modals, and successful API paths', async () => {
    const user = userEvent.setup();

    mocks.locationState = { highlightTxId: 'tx-highlight' };
    mocks.walletSharingState = createSharingState({
      deviceSharePrompt: {
        show: true,
        targetUserId: 'user-2',
        targetUsername: 'bob',
        devices: [{ id: 'device-1' }],
      },
    });

    render(<WalletDetail />);

    await user.click(screen.getByRole('button', { name: 'header-send' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1/send');

    await user.click(screen.getByRole('button', { name: 'header-sync' }));
    expect(mocks.syncHandler).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'header-resync' }));
    expect(mocks.fullResyncHandler).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'header-receive' }));
    expect(screen.getByTestId('receive-modal')).toBeInTheDocument();

    // Exercise onFetchUnusedAddresses callback (covers WalletDetail.tsx lines 512-517)
    await user.click(screen.getByRole('button', { name: 'receive-fetch-unused' }));
    await waitFor(() => {
      expect(transactionsApi.getAddresses).toHaveBeenCalledWith('wallet-1', { used: false, limit: 10 });
    });

    await user.click(screen.getByRole('button', { name: 'receive-settings' }));
    expect(screen.getByTestId('settings-tab')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'header-export' }));
    expect(screen.getByTestId('export-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'export-close' }));
    expect(screen.queryByTestId('export-modal')).not.toBeInTheDocument();

    expect(screen.getByTestId('device-share-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'device-share-confirm' }));
    expect(mocks.shareDevices).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'device-share-dismiss' }));
    expect(mocks.dismissSharePrompt).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /addresses/i }));
    expect(screen.getByTestId('addresses-tab')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'addr-load-more' }));
    expect(mocks.loadAddresses).toHaveBeenCalledWith('wallet-1', 25, 25, false);

    await user.click(screen.getByRole('button', { name: 'addr-generate' }));
    await waitFor(() => {
      expect(transactionsApi.generateAddresses).toHaveBeenCalledWith('wallet-1', 10);
    });
    expect(mocks.loadAddressSummary).toHaveBeenCalledWith('wallet-1');
    expect(mocks.loadAddresses).toHaveBeenCalledWith('wallet-1', 25, 0, true);

    await user.click(screen.getByRole('button', { name: 'addr-edit-labels' }));
    expect(labelsApi.getLabels).toHaveBeenCalledWith('wallet-1');

    await user.click(screen.getByRole('button', { name: 'addr-toggle-label' }));
    await user.click(screen.getByRole('button', { name: 'addr-save-labels' }));
    await waitFor(() => {
      expect(labelsApi.setAddressLabels).toHaveBeenCalledWith(
        'addr-1',
        expect.arrayContaining(['label-1', 'label-2'])
      );
    });

    await user.click(screen.getByRole('button', { name: 'addr-show-qr' }));
    expect(screen.getByTestId('qr-modal')).toHaveTextContent('bc1q-test-qr');
    await user.click(screen.getByRole('button', { name: 'qr-close' }));
    expect(screen.queryByTestId('qr-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /utxos/i }));
    await user.click(screen.getByRole('button', { name: 'utxo-select' }));
    await user.click(screen.getByRole('button', { name: 'utxo-send-selected' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1/send', {
      state: { preSelected: ['utxo-1'] },
    });

    await user.click(screen.getByRole('button', { name: 'utxo-freeze' }));
    await waitFor(() => {
      expect(transactionsApi.freezeUTXO).toHaveBeenCalledWith('utxo-1', true);
    });

    await user.click(screen.getByRole('button', { name: /drafts/i }));
    await user.click(screen.getByRole('button', { name: 'drafts-add' }));
    expect(mocks.addAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pending_drafts' })
    );
    await user.click(screen.getByRole('button', { name: 'drafts-clear' }));
    expect(mocks.removeNotificationsByType).toHaveBeenCalledWith('pending_drafts', 'wallet-1');

    await user.click(screen.getByRole('button', { name: /transactions/i }));
    expect(screen.getByText('tx-highlight')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'tx-export' }));
    expect(screen.getByTestId('tx-export-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'tx-export-close' }));
    expect(screen.queryByTestId('tx-export-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /access/i }));
    await user.click(screen.getByRole('button', { name: 'access-transfer' }));
    expect(screen.getByTestId('transfer-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'transfer-close' }));
    expect(screen.queryByTestId('transfer-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'access-transfer' }));
    expect(screen.getByTestId('transfer-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'transfer-confirm' }));
    expect(mocks.transferComplete).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.click(screen.getByRole('button', { name: 'settings-update' }));
    expect(walletsApi.updateWallet).toHaveBeenCalledWith('wallet-1', {
      name: 'Renamed Wallet',
      descriptor: 'desc-new',
    });

    await user.click(screen.getByRole('button', { name: 'settings-repair' }));
    expect(mocks.repairHandler).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'settings-export' }));
    expect(screen.getByTestId('export-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'export-close' }));
    expect(screen.queryByTestId('export-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'settings-delete' }));
    expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'delete-close' }));
    expect(screen.queryByTestId('delete-modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'settings-delete' }));
    expect(screen.getByTestId('delete-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'delete-confirm' }));
    await waitFor(() => {
      expect(walletsApi.deleteWallet).toHaveBeenCalledWith('wallet-1');
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets');
  });

  it('handles failures and guarded no-op branches', async () => {
    const user = userEvent.setup();
    vi.mocked(transactionsApi.freezeUTXO).mockRejectedValueOnce(new Error('freeze failed'));
    vi.mocked(transactionsApi.generateAddresses).mockRejectedValueOnce(new Error('generate failed'));
    vi.mocked(walletsApi.updateWallet).mockRejectedValueOnce(new Error('update failed'));
    vi.mocked(walletsApi.deleteWallet).mockRejectedValueOnce(new Error('delete failed'));

    mocks.walletDataState = createWalletData({
      hasMoreAddresses: false,
    });

    render(<WalletDetail />);

    await user.click(screen.getByRole('button', { name: /addresses/i }));
    await user.click(screen.getByRole('button', { name: 'addr-load-more' }));
    expect(mocks.loadAddresses).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'addr-generate' }));
    await waitFor(() => {
      expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Generate Addresses');
    });

    await user.click(screen.getByRole('button', { name: /utxos/i }));
    await user.click(screen.getByRole('button', { name: 'utxo-freeze-missing' }));
    expect(transactionsApi.freezeUTXO).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'utxo-freeze' }));
    await waitFor(() => {
      expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Freeze UTXO');
    });

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.click(screen.getByRole('button', { name: 'settings-update' }));
    await waitFor(() => {
      expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Update Failed');
    });

    await user.click(screen.getByRole('button', { name: 'settings-delete' }));
    await user.click(screen.getByRole('button', { name: 'delete-confirm' }));
    await waitFor(() => {
      expect(mocks.handleError).toHaveBeenCalledWith(expect.any(Error), 'Delete Failed');
    });
  });

  it('skips id-gated actions when wallet id is absent', async () => {
    const user = userEvent.setup();
    mocks.routeId = undefined;

    render(<WalletDetail />);

    await user.click(screen.getByRole('button', { name: /addresses/i }));
    await user.click(screen.getByRole('button', { name: 'addr-generate' }));
    expect(transactionsApi.generateAddresses).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /settings/i }));
    await user.click(screen.getByRole('button', { name: 'settings-update' }));
    expect(walletsApi.updateWallet).not.toHaveBeenCalled();
  });

  it('covers remaining WalletDetail fallback and guard branches', async () => {
    const user = userEvent.setup();
    const walletWithFallbacks = {
      ...createWalletData().wallet,
      type: WalletType.MULTI_SIG,
      network: undefined,
      descriptor: undefined,
      userRole: undefined,
    };

    mocks.locationState = { activeTab: 'stats' };
    mocks.walletDataState = createWalletData({
      wallet: walletWithFallbacks,
      utxoStats: [],
      loadingUtxoStats: true,
    });

    const { rerender } = render(<WalletDetail />);
    expect(screen.getByTestId('stats-tab')).toBeInTheDocument();
    expect(mocks.loadUtxosForStats).not.toHaveBeenCalled();

    mocks.walletDataState = createWalletData({
      wallet: walletWithFallbacks,
      utxoStats: [{ id: 'stats-utxo', txid: 'stats-tx', vout: 1, amount: 2000 }],
      loadingUtxoStats: false,
    });
    rerender(<WalletDetail />);
    expect(screen.getByTestId('stats-utxo-id')).toHaveTextContent('stats-utxo');

    mocks.locationState = { activeTab: 'addresses' };
    rerender(<WalletDetail />);
    expect(screen.getByTestId('addr-descriptor')).toHaveTextContent('null');
    expect(screen.getByTestId('addr-network')).toHaveTextContent('mainnet');

    await user.click(screen.getByRole('button', { name: /transactions/i }));
    await user.click(screen.getByRole('button', { name: 'tx-labels-change' }));
    expect(mocks.fetchData).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'header-receive' }));
    expect(screen.getByTestId('receive-modal')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'receive-close' }));

    await user.click(screen.getByRole('button', { name: /utxos/i }));
    expect(screen.getByTestId('utxo-network')).toHaveTextContent('mainnet');

    mocks.locationState = { activeTab: 'drafts' };
    rerender(<WalletDetail />);
    expect(screen.getByTestId('drafts-role')).toHaveTextContent('viewer');
    expect(screen.getByTestId('drafts-type')).toHaveTextContent(WalletType.MULTI_SIG);
    await user.click(screen.getByRole('button', { name: 'drafts-single' }));
    expect(mocks.addAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: '1 pending draft' })
    );

    mocks.locationState = { activeTab: 'access' };
    rerender(<WalletDetail />);
    expect(screen.getByTestId('access-role')).toHaveTextContent('viewer');

    mocks.locationState = { activeTab: 'log' };
    rerender(<WalletDetail />);
    expect(screen.getByTestId('log-tab')).toBeInTheDocument();

    mocks.fetchData.mockClear();
    mocks.routeId = undefined;
    mocks.locationState = { activeTab: 'tx' };
    rerender(<WalletDetail />);
    await user.click(screen.getByRole('button', { name: 'tx-labels-change' }));
    expect(mocks.fetchData).not.toHaveBeenCalled();

    mocks.locationState = { activeTab: 'settings' };
    rerender(<WalletDetail />);
    await user.click(screen.getByRole('button', { name: 'settings-delete' }));
    await user.click(screen.getByRole('button', { name: 'delete-confirm' }));
    expect(walletsApi.deleteWallet).not.toHaveBeenCalled();
  });

  it('runs hook onDataRefresh callbacks wired into sync and sharing hooks', async () => {
    render(<WalletDetail />);

    expect(mocks.walletSyncHookArgs?.onDataRefresh).toEqual(expect.any(Function));
    expect(mocks.walletSharingHookArgs?.onDataRefresh).toEqual(expect.any(Function));

    mocks.fetchData.mockClear();

    await mocks.walletSyncHookArgs.onDataRefresh();
    expect(mocks.fetchData).toHaveBeenCalledWith(true);

    mocks.fetchData.mockClear();

    await mocks.walletSharingHookArgs.onDataRefresh();
    expect(mocks.fetchData).toHaveBeenCalledWith(true);
  });
});
