/**
 * Tests for WalletList component
 */

import { act,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { WalletList } from '../../src/components/WalletList';
import * as CurrencyContext from '../../src/contexts/CurrencyContext';
import * as UserContext from '../../src/contexts/UserContext';
import * as useWalletsHook from '../../src/hooks/queries/useWallets';

// Mock navigate
const mockNavigate = vi.fn();
const activeNetworkMock = vi.hoisted(() => ({
  selectedNetwork: 'mainnet' as 'mainnet' | 'testnet3' | 'testnet4' | 'signet',
  setSelectedNetwork: vi.fn(),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock contexts
vi.mock('../../src/contexts/CurrencyContext', () => ({
  useCurrency: vi.fn(),
}));

vi.mock('../../src/contexts/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('../../src/contexts/ActiveNetworkContext', () => ({
  useActiveNetwork: () => ({
    selectedNetwork: activeNetworkMock.selectedNetwork,
    isMainnet: activeNetworkMock.selectedNetwork === 'mainnet',
    setSelectedNetwork: activeNetworkMock.setSelectedNetwork,
  }),
}));

// Mock hooks
vi.mock('../../src/hooks/queries/useWallets', () => ({
  useWallets: vi.fn(),
  useBalanceHistory: vi.fn(),
  useInvalidateAllWallets: vi.fn(),
  usePendingTransactions: vi.fn(),
  useWalletSparklines: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/hooks/useDelayedRender', () => ({
  useDelayedRender: () => true,
}));

// Mock recharts to avoid rendering issues
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="chart-container">{children}</div>,
  AreaChart: () => <div data-testid="area-chart">Chart</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

// Mock child components
vi.mock('../../src/components/NetworkTabs', () => ({
  NetworkTabs: ({ selectedNetwork, onNetworkChange }: any) => (
    <div data-testid="network-tabs">
      <button data-testid="mainnet-tab" onClick={() => onNetworkChange('mainnet')}>Mainnet</button>
      <button data-testid="testnet-tab" onClick={() => onNetworkChange('testnet3')}>Testnet3</button>
      <span data-testid="selected-network">{selectedNetwork}</span>
    </div>
  ),
}));

vi.mock('../../src/components/NetworkSyncActions', () => ({
  NetworkSyncActions: () => <div data-testid="sync-actions">Sync Actions</div>,
}));

vi.mock('../../src/components/ui/ConfigurableTable', () => ({
  ConfigurableTable: ({ data }: any) => (
    <div data-testid="configurable-table">
      {data.map((item: any) => (
        <div key={item.id} data-testid={`table-row-${item.id}`}>{item.name}</div>
      ))}
    </div>
  ),
}));

vi.mock('../../src/components/Amount', () => ({
  Amount: ({ sats }: { sats: number }) => <span data-testid="amount">{sats} sats</span>,
}));

describe('WalletList', () => {
  afterEach(() => vi.useRealTimers());
  const mockWallets = [
    {
      id: 'wallet-1',
      name: 'Main Wallet',
      type: 'single_sig',
      balance: 100000,
      network: 'mainnet',
      scriptType: 'native_segwit',
      deviceCount: 1,
      isShared: false,
      syncInProgress: false,
      lastSyncStatus: 'success',
    },
    {
      id: 'wallet-2',
      name: 'Savings Vault',
      type: 'multi_sig',
      balance: 500000,
      network: 'mainnet',
      scriptType: 'native_segwit',
      deviceCount: 3,
      quorum: 2,
      totalSigners: 3,
      isShared: true,
      syncInProgress: false,
      lastSyncStatus: 'success',
    },
    {
      id: 'wallet-3',
      name: 'Test Wallet',
      type: 'single_sig',
      balance: 50000,
      network: 'testnet3',
      scriptType: 'native_segwit',
      deviceCount: 1,
      isShared: false,
      syncInProgress: true,
      lastSyncStatus: null,
    },
  ];

  const mockChartData = [
    { name: 'Jan', value: 100000 },
    { name: 'Feb', value: 150000 },
    { name: 'Mar', value: 200000 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    activeNetworkMock.selectedNetwork = 'mainnet';

    vi.mocked(CurrencyContext.useCurrency).mockReturnValue({
      format: (sats: number) => `${sats} sats`,
      formatFiat: (sats: number) => `$${(sats / 100000).toFixed(2)}`,
      showFiat: true,
      unit: 'sats',
    } as any);

    vi.mocked(UserContext.useUser).mockReturnValue({
      user: { id: 'user-1', preferences: {} },
      updatePreferences: vi.fn(),
    } as any);

    vi.mocked(useWalletsHook.useWallets).mockReturnValue({
      data: mockWallets,
      isLoading: false,
      error: null,
    } as any);

    vi.mocked(useWalletsHook.useBalanceHistory).mockReturnValue({
      data: mockChartData,
      isLoading: false,
    } as any);

    vi.mocked(useWalletsHook.useInvalidateAllWallets).mockReturnValue(vi.fn());

    vi.mocked(useWalletsHook.usePendingTransactions).mockReturnValue({
      data: [],
    } as any);
  });

  const renderWalletList = () => {
    return render(
      <MemoryRouter>
        <WalletList />
      </MemoryRouter>
    );
  };

  describe('loading state', () => {
    it('shows loading message when loading', () => {
      vi.mocked(useWalletsHook.useWallets).mockReturnValue({
        data: [],
        isLoading: true,
        error: null,
      } as any);

      renderWalletList();

      expect(screen.getByText(/Loading wallets/)).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty state when no wallets', () => {
      vi.mocked(useWalletsHook.useWallets).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      renderWalletList();

      expect(screen.getByText('No Wallets Yet')).toBeInTheDocument();
      expect(screen.getByText('Create Wallet')).toBeInTheDocument();
      expect(screen.getByText('Import Wallet')).toBeInTheDocument();
    });

    it('navigates to create wallet from empty state', async () => {
      vi.mocked(useWalletsHook.useWallets).mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as any);

      const user = userEvent.setup();
      renderWalletList();

      await user.click(screen.getByText('Create Wallet'));

      expect(mockNavigate).toHaveBeenCalledWith('/wallets/create');
    });
  });

  describe('wallet list rendering', () => {
    it('updates grid sync status when a lease expires without network activity', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-08-27T04:30:00.000Z');
      vi.setSystemTime(now);
      vi.mocked(useWalletsHook.useWallets).mockReturnValue({
        data: [{
          ...mockWallets[0],
          syncInProgress: true,
          lastSyncStatus: null,
          requestedIncrementalSyncGeneration: 1,
          claimedIncrementalSyncGeneration: 1,
          processedIncrementalSyncGeneration: 0,
          syncExecutionOwner: 'worker',
          incrementalSyncClaimedAt: new Date(now.getTime() - 1_000).toISOString(),
          incrementalSyncLeaseExpiresAt: new Date(now.getTime() + 1_000).toISOString(),
        }],
        isLoading: false,
        error: null,
      } as any);

      renderWalletList();
      expect(screen.getByTitle('Syncing')).toBeInTheDocument();

      await act(async () => vi.advanceTimersByTime(1_001));

      expect(screen.getByRole('button', { name: 'Sync status: Attention' })).toBeInTheDocument();
    });

    it('renders wallet cards', async () => {
      renderWalletList();

      await waitFor(() => {
        expect(screen.getByText('Main Wallet')).toBeInTheDocument();
        expect(screen.getByText('Savings Vault')).toBeInTheDocument();
      });
    });

    it('shows wallet type badges', async () => {
      renderWalletList();

      await waitFor(() => {
        expect(screen.getByText('Single Sig')).toBeInTheDocument();
        expect(screen.getByText('Multisig')).toBeInTheDocument();
      });
    });

    it('shows shared badge for shared wallets', async () => {
      renderWalletList();

      await waitFor(() => {
        expect(screen.getByText('Shared')).toBeInTheDocument();
      });
    });

    it('shows quorum info for multisig wallets', async () => {
      renderWalletList();

      await waitFor(() => {
        expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
      });
    });

    it('navigates to wallet detail when clicking card', async () => {
      const user = userEvent.setup();
      renderWalletList();

      await waitFor(() => {
        expect(screen.getByText('Main Wallet')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Main Wallet'));

      expect(mockNavigate).toHaveBeenCalledWith('/wallets/wallet-1');
    });
  });

  describe('active network', () => {
    it('does not render page-level network tabs', () => {
      renderWalletList();

      expect(screen.queryByTestId('network-tabs')).not.toBeInTheDocument();
    });

    it('filters wallets by network', async () => {
      renderWalletList();

      // Initially shows mainnet wallets
      await waitFor(() => {
        expect(screen.getByText('Main Wallet')).toBeInTheDocument();
        expect(screen.getByText('Savings Vault')).toBeInTheDocument();
      });

      // Test wallet (testnet) should not be visible
      expect(screen.queryByText('Test Wallet')).not.toBeInTheDocument();
    });
  });

  describe('view mode', () => {
    it('shows grid view by default', () => {
      renderWalletList();

      // Grid should be visible, not table
      expect(screen.queryByTestId('configurable-table')).not.toBeInTheDocument();
    });

    it('switches to table view', async () => {
      vi.mocked(UserContext.useUser).mockReturnValue({
        user: { id: 'user-1', preferences: { viewSettings: { wallets: { layout: 'table' } } } },
        updatePreferences: vi.fn(),
      } as any);

      renderWalletList();

      expect(screen.getByTestId('configurable-table')).toBeInTheDocument();
    });
  });

  describe('balance display', () => {
    it('shows total balance', () => {
      renderWalletList();

      expect(screen.getByText('Total Balance')).toBeInTheDocument();
    });

    it('shows wallet count', () => {
      renderWalletList();

      // 2 mainnet wallets
      expect(screen.getByText(/2 mainnet wallet/)).toBeInTheDocument();
    });
  });

  describe('timeframe selector', () => {
    it('shows timeframe buttons', () => {
      renderWalletList();

      expect(screen.getByText('1D')).toBeInTheDocument();
      expect(screen.getByText('1W')).toBeInTheDocument();
      expect(screen.getByText('1M')).toBeInTheDocument();
      expect(screen.getByText('1Y')).toBeInTheDocument();
      expect(screen.getByText('ALL')).toBeInTheDocument();
    });

    it('changes timeframe when clicked', async () => {
      const user = userEvent.setup();
      renderWalletList();

      await user.click(screen.getByText('1W'));

      // useBalanceHistory should be called with new timeframe
      expect(useWalletsHook.useBalanceHistory).toHaveBeenCalled();
    });
  });

  describe('create/import buttons', () => {
    it('shows create and import buttons', () => {
      renderWalletList();

      expect(screen.getByText('Create')).toBeInTheDocument();
      expect(screen.getByText('Import')).toBeInTheDocument();
    });

    it('navigates to create wallet', async () => {
      const user = userEvent.setup();
      renderWalletList();

      await user.click(screen.getByText('Create'));

      expect(mockNavigate).toHaveBeenCalledWith('/wallets/create');
    });

    it('navigates to import wallet', async () => {
      const user = userEvent.setup();
      renderWalletList();

      await user.click(screen.getByText('Import'));

      expect(mockNavigate).toHaveBeenCalledWith('/wallets/import');
    });
  });

  describe('sync status', () => {
    it('shows sync in progress indicator', async () => {
      // Testnet wallet has sync in progress
      activeNetworkMock.selectedNetwork = 'testnet3';
      renderWalletList();

      await waitFor(() => {
        // Should show syncing icon (animate-spin)
        const syncIcon = document.querySelector('.animate-spin');
        expect(syncIcon).toBeInTheDocument();
      });
    });
  });

  describe('pending transactions', () => {
    it('shows pending transaction indicators', async () => {
      vi.mocked(useWalletsHook.usePendingTransactions).mockReturnValue({
        data: [
          { walletId: 'wallet-1', type: 'received', amount: 10000 },
        ],
      } as any);

      renderWalletList();

      await waitFor(() => {
        // Should show incoming indicator
        expect(document.querySelector('[title="Pending received"]')).toBeInTheDocument();
      });
    });

    it('shows outgoing pending indicator', async () => {
      vi.mocked(useWalletsHook.usePendingTransactions).mockReturnValue({
        data: [
          { walletId: 'wallet-1', type: 'sent', amount: -5000 },
        ],
      } as any);

      renderWalletList();

      await waitFor(() => {
        expect(document.querySelector('[title="Pending sent"]')).toBeInTheDocument();
      });
    });
  });

  describe('sorting', () => {
    it('shows sort dropdown in grid view', () => {
      renderWalletList();

      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('changes sort when selecting option', async () => {
      const updatePreferences = vi.fn();
      vi.mocked(UserContext.useUser).mockReturnValue({
        user: { id: 'user-1', preferences: {} },
        updatePreferences,
      } as any);

      const user = userEvent.setup();
      renderWalletList();

      const select = screen.getByRole('combobox');
      await user.selectOptions(select, 'balance-desc');

      expect(updatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          viewSettings: expect.objectContaining({
            wallets: expect.objectContaining({
              sortBy: 'balance',
              sortOrder: 'desc',
            }),
          }),
        })
      );
    });
  });
});
