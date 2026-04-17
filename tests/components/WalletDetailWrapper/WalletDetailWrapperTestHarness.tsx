import { beforeEach, vi } from 'vitest';

import { WalletDetail } from '../../../components/WalletDetail';
import { WalletType } from '../../../types';

const walletDetailMocks = vi.hoisted(() => ({
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
  getAddresses: vi.fn(),
  generateAddresses: vi.fn(),
  freezeUTXO: vi.fn(),
  setAddressLabels: vi.fn(),
  updateWallet: vi.fn(),
  deleteWallet: vi.fn(),
  getWalletAgents: vi.fn(),
  user: { id: 'user-1', username: 'owner', isAdmin: false } as any,
}));

export const mocks = walletDetailMocks;
export const WalletDetailComponent = WalletDetail;

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: walletDetailMocks.routeId }),
    useNavigate: () => walletDetailMocks.navigate,
    useLocation: () => ({ state: walletDetailMocks.locationState }),
  };
});

vi.mock('../../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: walletDetailMocks.handleError,
    showSuccess: vi.fn(),
  }),
}));

vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({
    user: walletDetailMocks.user,
  }),
}));

vi.mock('../../../contexts/AppNotificationContext', () => ({
  useAppNotifications: () => ({
    addNotification: walletDetailMocks.addAppNotification,
    removeNotificationsByType: walletDetailMocks.removeNotificationsByType,
  }),
}));

vi.mock('../../../hooks/queries/useBitcoin', () => ({
  useBitcoinStatus: () => ({
    data: {
      confirmationThreshold: 2,
      deepConfirmationThreshold: 6,
      explorerUrl: 'https://mempool.space',
    },
  }),
}));

vi.mock('../../../hooks/useAIStatus', () => ({
  useAIStatus: () => ({
    enabled: true,
  }),
}));

vi.mock('../../../hooks/queries/useWalletLabels', () => ({
  useWalletLabels: () => ({
    data: [
      { id: 'label-1', name: 'Known Label', walletId: 'wallet-1', color: '#000', createdAt: '', updatedAt: '' },
      { id: 'label-2', name: 'Second Label', walletId: 'wallet-1', color: '#111', createdAt: '', updatedAt: '' },
    ],
    isLoading: false,
  }),
}));

vi.mock('../../../hooks/websocket', () => ({
  useWalletLogs: () => walletDetailMocks.walletLogsState,
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletData', () => ({
  useWalletData: () => walletDetailMocks.walletDataState,
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletSync', () => ({
  useWalletSync: (args: any) => {
    walletDetailMocks.walletSyncHookArgs = args;
    return walletDetailMocks.walletSyncState;
  },
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletSharing', () => ({
  useWalletSharing: (args: any) => {
    walletDetailMocks.walletSharingHookArgs = args;
    return walletDetailMocks.walletSharingState;
  },
}));

vi.mock('../../../components/WalletDetail/hooks/useAITransactionFilter', () => ({
  useAITransactionFilter: () => walletDetailMocks.aiFilterState,
}));

vi.mock('../../../components/WalletDetail/hooks/useWalletWebSocket', () => ({
  useWalletWebSocket: (...args: any[]) => walletDetailMocks.walletWebSocketState(...args),
}));

vi.mock('../../../components/WalletDetail/WalletHeader', () => ({
  WalletHeader: (props: any) => (
    <div data-testid="wallet-header">
      <span data-testid="wallet-agent-links">{props.agentLinks?.map((link: any) => `${link.role}:${link.linkedWalletName}`).join('|') || 'none'}</span>
      <button onClick={props.onReceive}>header-receive</button>
      <button onClick={props.onSend}>header-send</button>
      <button onClick={props.onSync}>header-sync</button>
      <button onClick={props.onFullResync}>header-resync</button>
      <button onClick={props.onExport}>header-export</button>
    </div>
  ),
}));

vi.mock('../../../components/WalletDetail/LogTab', () => ({
  LogTab: (props: any) => (
    <div data-testid="log-tab">
      <button onClick={props.onTogglePause}>log-pause</button>
      <button onClick={props.onClearLogs}>log-clear</button>
      <button onClick={props.onSync}>log-sync</button>
      <button onClick={props.onFullResync}>log-resync</button>
    </div>
  ),
}));

vi.mock('../../../components/WalletDetail/tabs', () => ({
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
      <span data-testid="utxo-role">{props.userRole}</span>
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

vi.mock('../../../components/WalletDetail/modals', () => ({
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

vi.mock('../../../components/TransactionExportModal', () => ({
  TransactionExportModal: (props: any) => (
    <div data-testid="tx-export-modal">
      <button onClick={props.onClose}>tx-export-close</button>
    </div>
  ),
}));

vi.mock('../../../components/TransferOwnershipModal', () => ({
  TransferOwnershipModal: (props: any) => (
    <div data-testid="transfer-modal">
      <button onClick={props.onTransferInitiated}>transfer-confirm</button>
      <button onClick={props.onClose}>transfer-close</button>
    </div>
  ),
}));

vi.mock('../../../src/api/wallets', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    updateWallet: walletDetailMocks.updateWallet,
    deleteWallet: walletDetailMocks.deleteWallet,
  };
});

vi.mock('../../../src/api/admin', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getWalletAgents: walletDetailMocks.getWalletAgents,
  };
});

vi.mock('../../../src/api/transactions', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getAddresses: walletDetailMocks.getAddresses,
    generateAddresses: walletDetailMocks.generateAddresses,
    freezeUTXO: walletDetailMocks.freezeUTXO,
  };
});

vi.mock('../../../src/api/labels', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getLabels: vi.fn(),
    setAddressLabels: walletDetailMocks.setAddressLabels,
  };
});

export function createWalletData(overrides: Partial<any> = {}) {
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

export function createSyncState(overrides: Partial<any> = {}) {
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

export function createSharingState(overrides: Partial<any> = {}) {
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

export const setupWalletDetailWrapperHarness = () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.routeId = 'wallet-1';
    mocks.locationState = {};
    mocks.user = { id: 'user-1', username: 'owner', isAdmin: false };

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

    mocks.getAddresses.mockResolvedValue([]);
    mocks.generateAddresses.mockResolvedValue({} as any);
    mocks.freezeUTXO.mockResolvedValue({} as any);
    mocks.setAddressLabels.mockResolvedValue({} as any);
    mocks.updateWallet.mockResolvedValue({} as any);
    mocks.deleteWallet.mockResolvedValue({} as any);
    mocks.getWalletAgents.mockResolvedValue([]);
  });
};
