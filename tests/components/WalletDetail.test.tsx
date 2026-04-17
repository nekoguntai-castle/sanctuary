/**
 * Tests for WalletDetail component
 */

import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter,Route,Routes } from 'react-router-dom';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { WalletDetail } from '../../components/WalletDetail';
import * as AppNotificationContext from '../../contexts/AppNotificationContext';
import * as CurrencyContext from '../../contexts/CurrencyContext';
import * as NotificationContext from '../../contexts/NotificationContext';
import * as UserContext from '../../contexts/UserContext';
import * as useBitcoinHooks from '../../hooks/queries/useBitcoin';
import * as useAIStatusHook from '../../hooks/useAIStatus';
import * as useWebSocketHooks from '../../hooks/websocket';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as devicesApi from '../../src/api/devices';
import * as draftsApi from '../../src/api/drafts';
import * as transactionsApi from '../../src/api/transactions';
import * as walletsApi from '../../src/api/wallets';

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock all context hooks
vi.mock('../../contexts/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
}));

vi.mock('../../contexts/NotificationContext', () => ({
  useNotifications: vi.fn(),
}));

vi.mock('../../contexts/AppNotificationContext', () => ({
  useAppNotifications: vi.fn(),
}));

vi.mock('../../hooks/queries/useBitcoin', () => ({
  useBitcoinStatus: vi.fn(),
}));

vi.mock('../../hooks/websocket', () => ({
  useWalletEvents: vi.fn(),
  useWalletLogs: vi.fn(),
}));

vi.mock('../../hooks/useAIStatus', () => ({
  useAIStatus: vi.fn(),
}));

vi.mock('../../hooks/queries/useWalletLabels', () => ({
  useWalletLabels: () => ({ data: [], isLoading: false }),
}));

vi.mock('../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
    showSuccess: vi.fn(),
  }),
}));

vi.mock('../../hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copy: vi.fn(),
    isCopied: () => false,
  }),
}));

// Mock API modules
vi.mock('../../src/api/wallets', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getWallet: vi.fn(),
    getWalletTelegramSettings: vi.fn(),
    updateWalletTelegramSettings: vi.fn(),
    getExportFormats: vi.fn(),
    getWalletShareInfo: vi.fn(),
    updateWallet: vi.fn(),
    deleteWallet: vi.fn(),
    repairWallet: vi.fn(),
    shareWalletWithUser: vi.fn(),
    shareWalletWithGroup: vi.fn(),
    removeUserFromWallet: vi.fn(),
    exportWallet: vi.fn(),
    exportWalletFormat: vi.fn(),
    exportLabelsBip: vi.fn(),
  };
});

vi.mock('../../src/api/transactions', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    getTransactions: vi.fn(),
    getUTXOs: vi.fn(),
    getAddresses: vi.fn(),
    generateAddresses: vi.fn(),
    getTransactionStats: vi.fn(),
    getWalletPrivacy: vi.fn(),
    freezeUTXO: vi.fn(),
  };
});

vi.mock('../../src/api/bitcoin', () => ({
  getWalletAddresses: vi.fn(),
  lookupAddresses: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock('../../src/api/sync', () => ({
  syncWallet: vi.fn(),
  resyncWallet: vi.fn(),
}));

vi.mock('../../src/api/devices', () => ({
  getDevices: vi.fn(),
  shareDeviceWithUser: vi.fn(),
}));

vi.mock('../../src/api/drafts', () => ({
  getDrafts: vi.fn(),
}));

vi.mock('../../src/api/admin', () => ({
  getWalletAgents: vi.fn(),
}));

// Mock child components
vi.mock('../../components/TransactionList', () => ({
  TransactionList: () => <div data-testid="transaction-list">Transactions</div>,
}));

vi.mock('../../components/UTXOList', () => ({
  UTXOList: () => <div data-testid="utxo-list">UTXOs</div>,
}));

vi.mock('../../components/WalletStats', () => ({
  WalletStats: () => <div data-testid="wallet-stats">Stats</div>,
}));

vi.mock('../../components/DraftList', () => ({
  DraftList: () => <div data-testid="draft-list">Drafts</div>,
}));

vi.mock('../../components/LabelManager', () => ({
  LabelManager: () => <div data-testid="label-manager">Labels</div>,
}));

vi.mock('../../components/PayjoinSection', () => ({
  PayjoinSection: () => <div data-testid="payjoin-section">Payjoin</div>,
}));

vi.mock('../../components/AIQueryInput', () => ({
  AIQueryInput: () => <div data-testid="ai-query">AI Query</div>,
}));

vi.mock('../../components/Amount', () => ({
  Amount: ({ value }: { value: number }) => <span data-testid="amount">{value}</span>,
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <div data-testid="qr-code">QR</div>,
}));

describe('WalletDetail', () => {
  const mockWallet = {
    id: 'wallet-1',
    name: 'Test Wallet',
    type: 'single_sig' as const,
    scriptType: 'native_segwit' as const,
    balance: 1000000,
    network: 'mainnet',
    userRole: 'owner' as const,
    canEdit: true,
    quorum: 1,
    totalSigners: 1,
    ownerId: 'user-1',
    createdAt: '2024-01-01',
  };

  const mockTransactions = [
    { txid: 'tx1', amount: 50000, type: 'received', confirmations: 6, timestamp: Date.now() },
    { txid: 'tx2', amount: -25000, type: 'sent', confirmations: 3, timestamp: Date.now() },
  ];

  const mockUtxos = [
    { txid: 'abc123', vout: 0, address: 'bc1q...', amount: 50000, confirmations: 10 },
  ];

  const mockAddresses = [
    { id: 'addr-1', address: 'bc1qtest...', index: 0, derivationPath: 'm/84h/0h/0h/0/0', used: false, balance: 0 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default context mocks
    vi.mocked(UserContext.useUser).mockReturnValue({
      user: { id: 'user-1', username: 'testuser', role: 'user', isAdmin: false },
      isLoading: false,
    } as any);

    vi.mocked(CurrencyContext.useCurrency).mockReturnValue({
      format: (sats: number) => `${sats} sats`,
      formatFiat: () => '$50.00',
      unit: 'sats',
    } as any);

    vi.mocked(NotificationContext.useNotifications).mockReturnValue({
      addNotification: vi.fn(),
    } as any);

    vi.mocked(AppNotificationContext.useAppNotifications).mockReturnValue({
      addNotification: vi.fn(),
      removeNotificationsByType: vi.fn(),
    } as any);

    vi.mocked(useBitcoinHooks.useBitcoinStatus).mockReturnValue({
      data: { blockHeight: 800000 },
    } as any);

    vi.mocked(useWebSocketHooks.useWalletEvents).mockReturnValue(undefined);
    vi.mocked(useWebSocketHooks.useWalletLogs).mockReturnValue({
      logs: [],
      isPaused: false,
      isLoading: false,
      clearLogs: vi.fn(),
      togglePause: vi.fn(),
    } as any);

    vi.mocked(useAIStatusHook.useAIStatus).mockReturnValue({
      enabled: false,
    } as any);

    // Setup API mocks
    vi.mocked(walletsApi.getWallet).mockResolvedValue(mockWallet as any);
    vi.mocked(walletsApi.getWalletTelegramSettings).mockResolvedValue({
      enabled: false,
      notifyReceived: true,
      notifySent: true,
      notifyConsolidation: true,
      notifyDraft: true,
    });
    vi.mocked(walletsApi.getExportFormats).mockResolvedValue({ formats: [] });
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({ sharedWith: [] } as any);

    vi.mocked(transactionsApi.getTransactions).mockResolvedValue(mockTransactions as any);
    vi.mocked(transactionsApi.getUTXOs).mockResolvedValue({
      utxos: mockUtxos,
      count: mockUtxos.length,
      totalBalance: 50000,
    } as any);
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue(mockAddresses as any);
    vi.mocked(transactionsApi.generateAddresses).mockResolvedValue({ addresses: mockAddresses } as any);
    vi.mocked(transactionsApi.getTransactionStats).mockResolvedValue({
      totalCount: 2,
      receivedCount: 1,
      sentCount: 1,
      consolidationCount: 0,
      totalReceived: 100000,
      totalSent: 50000,
      totalFees: 1000,
      walletBalance: 1000000,
    } as any);
    vi.mocked(transactionsApi.getWalletPrivacy).mockResolvedValue({
      utxos: [],
      summary: null,
    } as any);
    vi.mocked(transactionsApi.freezeUTXO).mockResolvedValue({} as any);

    // Mock bitcoin API
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      explorerUrl: 'https://mempool.space',
    } as any);

    // Mock devices API
    vi.mocked(devicesApi.getDevices).mockResolvedValue([
      { id: 'device-1', type: 'ledger', label: 'My Ledger', fingerprint: 'ABC123' },
    ] as any);

    // Mock drafts API
    vi.mocked(draftsApi.getDrafts).mockResolvedValue([]);

    // Mock admin API
    vi.mocked(adminApi.getWalletAgents).mockResolvedValue([]);
  });

  const renderWalletDetail = (walletId = 'wallet-1', state?: Record<string, unknown>) => {
    return render(
      <MemoryRouter initialEntries={[{ pathname: `/wallets/${walletId}`, state }]}>
        <Routes>
          <Route path="/wallets/:id" element={<WalletDetail />} />
        </Routes>
      </MemoryRouter>
    );
  };

  describe('Loading state', () => {
    it('shows loading placeholder while fetching wallet', async () => {
      let resolveWallet!: (wallet: any) => void;
      vi.mocked(walletsApi.getWallet).mockImplementation(
        () => new Promise<any>((resolve) => {
          resolveWallet = resolve;
        })
      );

      renderWalletDetail();

      expect(await screen.findByText('Loading wallet...')).toBeInTheDocument();
      resolveWallet(mockWallet);
      await waitFor(() => expect(screen.getByText('Test Wallet')).toBeInTheDocument());
    });
  });

  describe('Wallet header', () => {
    it('displays wallet name', async () => {
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByText('Test Wallet')).toBeInTheDocument();
      });
    });

    it('displays wallet balance', async () => {
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByTestId('amount')).toBeInTheDocument();
      });
    });

    it('renders Send and Receive buttons', async () => {
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByText('Send')).toBeInTheDocument();
        expect(screen.getByText('Receive')).toBeInTheDocument();
      });
    });

    it('does not fetch admin agent links for non-admin users', async () => {
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByText('Test Wallet')).toBeInTheDocument();
      });
      expect(adminApi.getWalletAgents).not.toHaveBeenCalled();
      expect(screen.queryByText('Agent Operational Wallet')).not.toBeInTheDocument();
    });

    it('fetches server-filtered agent links and renders admin wallet badges', async () => {
      vi.mocked(UserContext.useUser).mockReturnValue({
        user: { id: 'admin-1', username: 'admin', role: 'admin', isAdmin: true },
        isLoading: false,
      } as any);
      vi.mocked(adminApi.getWalletAgents).mockResolvedValue([{
        id: 'agent-1',
        userId: 'user-1',
        name: 'Treasury Agent',
        status: 'active',
        fundingWalletId: 'funding-wallet',
        operationalWalletId: 'wallet-1',
        signerDeviceId: 'device-1',
        maxFundingAmountSats: null,
        maxOperationalBalanceSats: null,
        dailyFundingLimitSats: null,
        weeklyFundingLimitSats: null,
        cooldownMinutes: null,
        requireHumanApproval: true,
        notifyOnOperationalSpend: true,
        pauseOnUnexpectedSpend: false,
        lastFundingDraftAt: null,
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
        revokedAt: null,
        fundingWallet: { id: 'funding-wallet', name: 'Funding Wallet', type: 'multi_sig', network: 'mainnet' },
        operationalWallet: { id: 'wallet-1', name: 'Test Wallet', type: 'single_sig', network: 'mainnet' },
      } as any]);

      renderWalletDetail();

      expect(await screen.findByText('Agent Operational Wallet')).toBeInTheDocument();
      expect(adminApi.getWalletAgents).toHaveBeenCalledWith({ walletId: 'wallet-1' });
    });
  });

  describe('Tab navigation', () => {
    it('renders all tab buttons', async () => {
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^transactions$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^utxos$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^addresses$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^drafts$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^stats$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^access$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^settings$/i })).toBeInTheDocument();
      });
    });

    it('shows Transactions tab by default', async () => {
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByTestId('transaction-list')).toBeInTheDocument();
      });
    });

    it('switches to UTXOs tab when clicked', async () => {
      const user = userEvent.setup();
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByText('UTXOs')).toBeInTheDocument();
      });

      await user.click(screen.getByText('UTXOs'));

      await waitFor(() => {
        expect(screen.getByTestId('utxo-list')).toBeInTheDocument();
      });
    });

    it('switches to Stats tab when clicked', async () => {
      const user = userEvent.setup();
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stats/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /stats/i }));

      await waitFor(() => {
        expect(screen.getByTestId('wallet-stats')).toBeInTheDocument();
      });
    });

    it('switches to Drafts tab when clicked', async () => {
      const user = userEvent.setup();
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /drafts/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /drafts/i }));

      await waitFor(() => {
        expect(screen.getByTestId('draft-list')).toBeInTheDocument();
      });
    });

    it('falls back to transactions when router state requests a hidden tab', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        userRole: 'viewer',
      } as any);

      renderWalletDetail('wallet-1', { activeTab: 'access' });

      await waitFor(() => {
        expect(screen.getByTestId('transaction-list')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: /^access$/i })).not.toBeInTheDocument();
    });
  });

  describe('Receive modal', () => {
    it('opens receive modal when clicking Receive button', async () => {
      const user = userEvent.setup();
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByText('Receive')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Receive'));

      await waitFor(() => {
        expect(screen.getByText('Receive Bitcoin')).toBeInTheDocument();
      });
    });
  });

  describe('Error handling', () => {
    it('shows error message when wallet fetch fails', async () => {
      vi.mocked(walletsApi.getWallet).mockRejectedValue(new Error('Wallet not found'));

      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByText('Failed to Load Wallet')).toBeInTheDocument();
      });
    });
  });

  describe('Wallet actions', () => {
    it('renders sync button', async () => {
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByTitle('Sync wallet')).toBeInTheDocument();
      });
    });

    it('renders export button', async () => {
      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByTitle('Export wallet')).toBeInTheDocument();
      });
    });
  });

  describe('Multi-sig wallet', () => {
    it('displays quorum info for multisig wallets', async () => {
      vi.mocked(walletsApi.getWallet).mockResolvedValue({
        ...mockWallet,
        type: 'multi_sig',
        quorum: 2,
        totalSigners: 3,
        userRole: 'owner',
      } as any);

      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByText('2/3 Multisig')).toBeInTheDocument();
      });
    });
  });

  describe('AI Query', () => {
    it('shows AI query input when AI is enabled', async () => {
      vi.mocked(useAIStatusHook.useAIStatus).mockReturnValue({
        enabled: true,
      } as any);

      renderWalletDetail();

      await waitFor(() => {
        expect(screen.getByTestId('ai-query')).toBeInTheDocument();
      });
    });

    it('hides AI query input when AI is disabled', async () => {
      vi.mocked(useAIStatusHook.useAIStatus).mockReturnValue({
        enabled: false,
      } as any);

      renderWalletDetail();

      await waitFor(() => {
        expect(screen.queryByTestId('ai-query')).not.toBeInTheDocument();
      });
    });
  });

  describe('Drafts state', () => {
    it('loads drafts data and keeps drafts tab available', async () => {
      vi.mocked(draftsApi.getDrafts).mockResolvedValue([
        { id: 'draft-1', walletId: 'wallet-1' },
      ] as any);
      renderWalletDetail();

      await waitFor(() => {
        expect(draftsApi.getDrafts).toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /^drafts$/i })).toBeInTheDocument();
      });
    });
  });
});

// WalletTelegramSettings and generateMultisigConfigText
// These are internal sub-components/utilities of WalletDetail
// They could be extracted and tested separately if needed
// For now, they are tested implicitly through WalletDetail integration
