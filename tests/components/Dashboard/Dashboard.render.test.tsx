import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { Dashboard } from '../../../components/Dashboard/Dashboard';

const mocks = vi.hoisted(() => ({
  dashboardData: {} as any,
  handleNetworkChange: vi.fn(),
  setUpdateDismissed: vi.fn(),
  setTimeframe: vi.fn(),
  refreshMempoolData: vi.fn(),
}));

vi.mock('../../../components/Dashboard/hooks/useDashboardData', () => ({
  useDashboardData: () => mocks.dashboardData,
}));

vi.mock('../../../components/NetworkTabs', () => ({
  NetworkTabs: (props: any) => (
    <button data-testid="network-tabs" onClick={() => props.onNetworkChange('testnet')}>
      {props.selectedNetwork}:{props.walletCounts.mainnet}
    </button>
  ),
}));

vi.mock('../../../components/Dashboard/MempoolSection', () => ({
  MempoolSection: (props: any) => (
    <div data-testid="mempool-section">
      {props.selectedNetwork}:{props.wsState}
    </div>
  ),
}));

vi.mock('../../../components/Dashboard/PriceChart', () => ({
  AnimatedPrice: ({ value, symbol }: { value: number | null; symbol: string }) => (
    <div data-testid="animated-price">
      {value === null ? `${symbol}-----` : `${symbol}${value}`}
    </div>
  ),
  PriceChart: (props: any) => (
    <button data-testid="price-chart" onClick={() => props.setTimeframe('1M')}>
      {props.timeframe}:{props.totalBalance}
    </button>
  ),
}));

vi.mock('../../../components/Dashboard/WalletSummary', () => ({
  WalletSummary: (props: any) => (
    <div data-testid="wallet-summary">
      {props.selectedNetwork}:{props.totalBalance}
    </div>
  ),
}));

vi.mock('../../../components/Dashboard/RecentTransactions', () => ({
  RecentTransactions: (props: any) => (
    <div data-testid="recent-transactions">
      {props.recentTx.length}:{props.wallets.length}:{props.confirmationThreshold}:{props.deepConfirmationThreshold}
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  TrendingUp: () => <span data-testid="trending-up" />,
  TrendingDown: () => <span data-testid="trending-down" />,
  Zap: () => <span data-testid="zap-icon" />,
  CheckCircle2: () => <span data-testid="connected-icon" />,
  XCircle: () => <span data-testid="error-icon" />,
  Bitcoin: () => <span data-testid="bitcoin-icon" />,
  Download: () => <span data-testid="download-icon" />,
  X: () => <span data-testid="dismiss-icon" />,
  Loader2: (props: any) => <span data-testid="loader-icon" className={props.className} />,
}));

const makeDashboardState = (overrides: Partial<any> = {}) => ({
  btcPrice: 100000,
  priceChange24h: 2.34,
  currencySymbol: '$',
  lastPriceUpdate: new Date('2026-02-15T12:00:00.000Z'),
  priceChangePositive: true,
  navigate: vi.fn(),
  selectedNetwork: 'mainnet',
  handleNetworkChange: mocks.handleNetworkChange,
  versionInfo: {
    updateAvailable: true,
    latestVersion: '2.0.0',
    currentVersion: '1.9.0',
    releaseUrl: 'https://example.com/release',
    releaseName: 'Aurora',
  },
  updateDismissed: false,
  setUpdateDismissed: mocks.setUpdateDismissed,
  chartReady: true,
  timeframe: '1W',
  setTimeframe: mocks.setTimeframe,
  chartData: [{ name: 'Now', sats: 1000 }],
  wsConnected: true,
  wsState: 'connected',
  wallets: [{ id: 'w1' }],
  filteredWallets: [{ id: 'w1' }],
  walletCounts: { mainnet: 1, testnet: 0, signet: 0 },
  recentTx: [{ id: 'tx1' }],
  pendingTxs: [{ id: 'ptx1' }],
  fees: { fast: 12, medium: 8, slow: 3 },
  formatFeeRate: (rate?: number) => (rate === undefined ? '---' : rate.toString()),
  nodeStatus: 'connected',
  bitcoinStatus: {
    connected: true,
    blockHeight: 900000,
    explorerUrl: 'https://mempool.space',
    confirmationThreshold: 2,
    deepConfirmationThreshold: 6,
    pool: {
      enabled: true,
      stats: {
        activeConnections: 2,
        totalConnections: 3,
        servers: [
          {
            serverId: 'server-1',
            label: 'Primary',
            connectionCount: 2,
            healthyConnections: 2,
            isHealthy: true,
            lastHealthCheck: '2026-02-15T12:00:00.000Z',
          },
        ],
      },
    },
  },
  mempoolBlocks: [{ id: 'b1' }],
  queuedBlocksSummary: null,
  lastMempoolUpdate: new Date('2026-02-15T12:00:00.000Z'),
  mempoolRefreshing: false,
  totalBalance: 123456789,
  loading: false,
  isMainnet: true,
  refreshMempoolData: mocks.refreshMempoolData,
  ...overrides,
});

describe('Dashboard render branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dashboardData = makeDashboardState();
  });

  it('renders loading spinner state', () => {
    mocks.dashboardData = makeDashboardState({ loading: true });
    render(<Dashboard />);

    expect(document.querySelector('.animate-sanctuary-pulse')).toBeInTheDocument();
    expect(screen.queryByTestId('network-tabs')).not.toBeInTheDocument();
  });

  it('renders update banner and mainnet connected details, and handles user actions', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    expect(screen.getByText('Update Available: v2.0.0')).toBeInTheDocument();
    expect(screen.getByText(/You're running v1.9.0/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Release' })).toHaveAttribute(
      'href',
      'https://example.com/release'
    );

    expect(screen.getByText('+2.34%')).toBeInTheDocument();
    expect(screen.getByTestId('trending-up')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('900,000')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('(2 conns)')).toBeInTheDocument();

    expect(screen.getByText('12 sat/vB')).toBeInTheDocument();
    expect(screen.getByText('8 sat/vB')).toBeInTheDocument();
    expect(screen.getByText('3 sat/vB')).toBeInTheDocument();

    await user.click(screen.getByTestId('network-tabs'));
    expect(mocks.handleNetworkChange).toHaveBeenCalledWith('testnet');

    await user.click(screen.getByTestId('price-chart'));
    expect(mocks.setTimeframe).toHaveBeenCalledWith('1M');

    await user.click(screen.getByTitle('Dismiss'));
    expect(mocks.setUpdateDismissed).toHaveBeenCalledWith(true);
  });

  it('renders mainnet host mode and error/checking/unknown status variants', () => {
    const { rerender } = render(<Dashboard />);

    mocks.dashboardData = makeDashboardState({
      priceChange24h: -1.11,
      priceChangePositive: false,
      versionInfo: {
        updateAvailable: true,
        latestVersion: '2.0.0',
        currentVersion: '1.9.0',
        releaseUrl: 'https://example.com/release',
        releaseName: '',
      },
      bitcoinStatus: {
        connected: true,
        host: 'electrum.example',
        useSsl: true,
        pool: { enabled: false },
      },
      nodeStatus: 'connected',
    });
    rerender(<Dashboard />);
    expect(screen.getByText('-1.11%')).toBeInTheDocument();
    expect(screen.getByTestId('trending-down')).toBeInTheDocument();
    expect(screen.getByText('Host:')).toBeInTheDocument();
    expect(screen.getByText('electrum.example')).toBeInTheDocument();
    expect(screen.getByText('🔒')).toBeInTheDocument();

    mocks.dashboardData = makeDashboardState({
      nodeStatus: 'error',
      bitcoinStatus: {
        connected: false,
        error: 'Server offline',
      },
    });
    rerender(<Dashboard />);
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Server offline')).toBeInTheDocument();

    mocks.dashboardData = makeDashboardState({
      nodeStatus: 'checking',
      bitcoinStatus: { connected: false },
    });
    rerender(<Dashboard />);
    expect(screen.getByText('Checking...')).toBeInTheDocument();

    mocks.dashboardData = makeDashboardState({
      nodeStatus: 'unknown',
      bitcoinStatus: undefined,
    });
    rerender(<Dashboard />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('renders non-mainnet price and node placeholders with null price change', () => {
    mocks.dashboardData = makeDashboardState({
      isMainnet: false,
      selectedNetwork: 'testnet',
      priceChange24h: null,
      versionInfo: null,
      bitcoinStatus: undefined,
      nodeStatus: 'unknown',
    });
    render(<Dashboard />);

    expect(screen.getByText('tBTC')).toBeInTheDocument();
    expect(screen.getByText('Testnet coins have no market value')).toBeInTheDocument();
    expect(screen.getByText('Testnet node not configured')).toBeInTheDocument();
    expect(screen.getByText('Configure in Settings → Node Configuration')).toBeInTheDocument();
    expect(screen.queryByText('Update Available: v2.0.0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trending-up')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trending-down')).not.toBeInTheDocument();
  });

  it('renders mainnet null price change placeholder and pool initializing state', () => {
    mocks.dashboardData = makeDashboardState({
      isMainnet: true,
      selectedNetwork: 'mainnet',
      priceChange24h: null,
      bitcoinStatus: {
        connected: true,
        blockHeight: 900000,
        pool: {
          enabled: true,
          stats: undefined,
        },
      },
      nodeStatus: 'connected',
    });
    render(<Dashboard />);

    expect(screen.getByText('---')).toBeInTheDocument();
    expect(screen.queryByTestId('trending-up')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trending-down')).not.toBeInTheDocument();
    expect(screen.getByText('initializing...')).toBeInTheDocument();
  });

  it('renders server health edge states and singular/plural connection labels', () => {
    mocks.dashboardData = makeDashboardState({
      bitcoinStatus: {
        connected: true,
        blockHeight: 900000,
        pool: {
          enabled: true,
          stats: {
            activeConnections: 1,
            totalConnections: 3,
            servers: [
              {
                serverId: 'srv-null-check',
                label: 'Unchecked',
                connectionCount: 1,
                healthyConnections: 0,
                isHealthy: false,
                lastHealthCheck: null,
              },
              {
                serverId: 'srv-unhealthy',
                label: 'Unhealthy',
                connectionCount: 2,
                healthyConnections: 0,
                isHealthy: false,
                lastHealthCheck: '2026-02-15T12:00:00.000Z',
              },
            ],
          },
        },
      },
    });
    render(<Dashboard />);

    expect(screen.getByText('Unchecked')).toBeInTheDocument();
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
    expect(screen.getByText('(1 conn)')).toBeInTheDocument();
    expect(screen.getByText('(2 conns)')).toBeInTheDocument();
  });

  it('renders fee estimation with undefined rates (no estSats tooltip)', () => {
    mocks.dashboardData = makeDashboardState({
      fees: undefined,
      formatFeeRate: (rate?: number) => (rate === undefined ? '---' : rate.toString()),
    });
    render(<Dashboard />);

    const feeLabels = screen.getAllByText('--- sat/vB');
    expect(feeLabels).toHaveLength(3);
  });

  it('renders signet placeholder copy and symbol', () => {
    mocks.dashboardData = makeDashboardState({
      isMainnet: false,
      selectedNetwork: 'signet',
      versionInfo: null,
      bitcoinStatus: undefined,
      nodeStatus: 'unknown',
    });
    render(<Dashboard />);

    expect(screen.getByText('sBTC')).toBeInTheDocument();
    expect(screen.getByText('Signet coins have no market value')).toBeInTheDocument();
    expect(screen.getByText('Signet node not configured')).toBeInTheDocument();
  });
});
