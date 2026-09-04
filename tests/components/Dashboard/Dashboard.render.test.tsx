import { cleanup,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { Dashboard } from '../../../src/components/Dashboard/Dashboard';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const mocks = vi.hoisted(() => ({
  dashboardData: {} as any,
  handleNetworkChange: vi.fn(),
  setUpdateDismissed: vi.fn(),
  setTimeframe: vi.fn(),
  refreshMempoolData: vi.fn(),
}));

vi.mock('../../../src/components/Dashboard/hooks/useDashboardData', () => ({
  useDashboardData: () => mocks.dashboardData,
}));

vi.mock('../../../src/components/NetworkTabs', () => ({
  NetworkTabs: (props: any) => (
    <button data-testid="network-tabs" onClick={() => props.onNetworkChange('testnet')}>
      {props.selectedNetwork}:{props.walletCounts.mainnet}
    </button>
  ),
}));

// NodeStatusCard's own status/copy/disclosure behavior is covered exhaustively
// in NodeStatusCard.test.tsx against the `query` contract; here we only need
// to prove Dashboard wires the right `selectedNetwork`/`query` through.
vi.mock('../../../src/components/Dashboard/NodeStatusCard', () => ({
  NodeStatusCard: (props: any) => (
    <div data-testid="node-status-card">
      {props.selectedNetwork}:{props.query?.data?.connected ? 'connected' : 'not-connected'}:
      {props.query?.data?.host ?? ''}:{props.query?.data?.error ?? ''}:
      {props.query?.data?.blockHeight ?? ''}
    </div>
  ),
}));

vi.mock('../../../src/components/Dashboard/MempoolSection', () => ({
  MempoolSection: (props: any) => (
    <div data-testid="mempool-section">
      {props.selectedNetwork}:{props.wsState}:{props.nodeStatus}
      <button data-testid="open-node-config" onClick={props.onConfigureNode}>
        Open Node Config
      </button>
    </div>
  ),
}));

vi.mock('../../../src/components/Dashboard/PriceChart', () => ({
  AnimatedPrice: ({ value, symbol }: { value: number | null; symbol: string }) => (
    <div data-testid="animated-price">
      {value === null ? `${symbol}-----` : `${symbol}${value}`}
    </div>
  ),
  // The card reads the period but no longer sets it — the selector moved to
  // the page header, which is left unmocked so the wiring is exercised.
  PriceChart: (props: any) => (
    <div data-testid="price-chart">
      {props.timeframe}:{props.totalBalance}
    </div>
  ),
}));

vi.mock('../../../src/components/Dashboard/WalletSummary', () => ({
  WalletSummary: (props: any) => (
    <div data-testid="wallet-summary">
      {props.selectedNetwork}:{props.totalBalance}
    </div>
  ),
}));

vi.mock('../../../src/components/Dashboard/RecentTransactions', () => ({
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
  // Disclosure chevrons: collapsible sections, the wallets row cap, and the
  // node card's server list.
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
  ChevronUp: () => <span data-testid="chevron-up-icon" />,
  ChevronLeft: () => <span data-testid="chevron-left-icon" />,
  ChevronRight: () => <span data-testid="chevron-right-icon" />,
  Activity: () => <span data-testid="activity-icon" />,
  ArrowDownLeft: () => <span data-testid="arrow-in-icon" />,
  ArrowUpRight: () => <span data-testid="arrow-out-icon" />,
  Wallet: () => <span data-testid="wallet-icon" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Check: () => <span data-testid="check-icon" />,
  AlertTriangle: () => <span data-testid="alert-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  Minus: () => <span data-testid="minus-icon" />,
  Wifi: () => <span data-testid="wifi-icon" />,
  WifiOff: () => <span data-testid="wifi-off-icon" />,
}));

// Derives the `nodeStatusQuery` the mocked NodeStatusCard reads from the
// legacy `nodeStatus`/`bitcoinStatus`/`selectedNetwork` fields most scenarios
// in this file already set, so existing overrides keep working without every
// call site building the query contract by hand. A scenario needing more
// control can still override `nodeStatusQuery` directly.
function deriveNodeStatusQuery(state: Record<string, unknown>) {
  const network = (state.selectedNetwork as string) ?? 'mainnet';
  return {
    network,
    data: state.bitcoinStatus ? { network, ...(state.bitcoinStatus as object) } : undefined,
    isPlaceholderData: false,
    isLoading: state.nodeStatus === 'checking',
    error: null,
    dataUpdatedAt: state.bitcoinStatus ? Date.now() : 0,
    isLastKnown: false,
  };
}

const makeDashboardStateBase = (overrides: Partial<any> = {}) => ({
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

const makeDashboardState = (overrides: Partial<any> = {}) => {
  const state = makeDashboardStateBase(overrides);
  return {
    ...state,
    nodeStatusQuery: (overrides as Record<string, unknown>).nodeStatusQuery ?? deriveNodeStatusQuery(state),
  };
};

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
    expect(screen.getByTestId('node-status-card')).toHaveTextContent(/^mainnet:connected/);

    // The unit is stated once on the card header rather than per tier.
    expect(screen.getByText('sat/vB')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    expect(screen.queryByTestId('network-tabs')).not.toBeInTheDocument();
    expect(mocks.handleNetworkChange).not.toHaveBeenCalled();

    // The period selector now sits in the page header, above both the balance
    // chart and the activity summary it scopes.
    await user.click(screen.getByRole('button', { name: '1M' }));
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
    // The Host:/Height: label column is gone; the host stands on its own.
    expect(screen.getByTestId('node-status-card')).toHaveTextContent('electrum.example');

    mocks.dashboardData = makeDashboardState({
      nodeStatus: 'error',
      bitcoinStatus: {
        connected: false,
        error: 'Server offline',
      },
    });
    rerender(<Dashboard />);
    expect(screen.getByTestId('node-status-card')).toHaveTextContent('Server offline');

    mocks.dashboardData = makeDashboardState({
      nodeStatus: 'checking',
      bitcoinStatus: { connected: false },
    });
    rerender(<Dashboard />);
    expect(screen.getByTestId('node-status-card')).toHaveTextContent('not-connected');

    mocks.dashboardData = makeDashboardState({
      nodeStatus: 'unknown',
      bitcoinStatus: undefined,
    });
    rerender(<Dashboard />);
    expect(screen.getByTestId('node-status-card')).toHaveTextContent('not-connected');
  });

  it('renders non-mainnet price and unavailable node status with null price change', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    mocks.dashboardData = makeDashboardState({
      isMainnet: false,
      selectedNetwork: 'testnet3',
      priceChange24h: null,
      versionInfo: null,
      bitcoinStatus: undefined,
      nodeStatus: 'unknown',
      navigate,
    });
    render(<Dashboard />);

    // Testnet coins have no price, so the card is omitted rather than rendering
    // a placeholder explaining its own emptiness.
    expect(screen.queryByText('Bitcoin Price')).not.toBeInTheDocument();
    expect(screen.getByTestId('node-status-card')).toHaveTextContent(/^testnet3:not-connected/);
    expect(screen.queryByText('Update Available: v2.0.0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trending-up')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trending-down')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('open-node-config'));
    expect(navigate).toHaveBeenCalledWith('/admin/node-config');
  });

  it('renders mainnet null price change placeholder', () => {
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
  });

  // Per-server health-state rendering (Unchecked/Unhealthy, singular/plural
  // connection counts, role/availability text) now lives in NodeStatusCard's
  // own presenter model and is covered exhaustively in
  // nodeStatusCardModel.test.ts and NodeStatusCard.test.tsx against the
  // `query` contract; NodeStatusCard is mocked in this file so Dashboard-level
  // tests only assert wiring.

  it('renders fee estimation with undefined rates (no estSats tooltip)', () => {
    mocks.dashboardData = makeDashboardState({
      fees: undefined,
      formatFeeRate: (rate?: number) => (rate === undefined ? '---' : rate.toString()),
    });
    render(<Dashboard />);

    const feeLabels = screen.getAllByText('---');
    expect(feeLabels).toHaveLength(3);
  });

  it('renders welcome state when no wallets exist', () => {
    mocks.dashboardData = makeDashboardState({
      filteredWallets: [],
    });
    render(<Dashboard />);
    expect(screen.getByText('Welcome to Sanctuary')).toBeInTheDocument();
    expect(screen.getByText('Create Your First Wallet')).toBeInTheDocument();
  });

  // An empty wallet list means "you have none" only when we actually asked and
  // were told so. If the request failed, `apiWallets ?? EMPTY_WALLETS` produces
  // the same empty array, and a funded user was shown the new-user onboarding
  // screen — which in a self-custody wallet reads as "your wallets are gone".
  it('does not claim the user has no wallets when the wallet request failed', () => {
    mocks.dashboardData = makeDashboardState({
      filteredWallets: [],
      walletsUnavailable: true,
    });
    render(<Dashboard />);

    expect(screen.queryByText('Welcome to Sanctuary')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Your First Wallet')).not.toBeInTheDocument();
    expect(screen.getByTestId('wallets-unavailable')).toBeInTheDocument();
    // No wallet ids means the activity query is disabled, so the card below
    // would assert "No transactions found" beneath the honest one.
    expect(screen.queryByTestId('recent-transactions')).not.toBeInTheDocument();
  });

  it('still welcomes a genuinely new user when the request succeeded', () => {
    mocks.dashboardData = makeDashboardState({
      filteredWallets: [],
      walletsUnavailable: false,
    });
    render(<Dashboard />);

    expect(screen.getByText('Welcome to Sanctuary')).toBeInTheDocument();
    expect(screen.queryByTestId('wallets-unavailable')).not.toBeInTheDocument();
  });

  // The empty-network boundary. Upcoming work changes when the Wallets card
  // appears, so pin the one case that must not move: with no wallets there is
  // no Wallets card at all, and activity still renders below the welcome copy.
  // An empty Wallets card here would be a regression, not a layout choice.
  it('renders no wallets card and keeps activity when the network has no wallets', () => {
    mocks.dashboardData = makeDashboardState({
      filteredWallets: [],
    });
    render(<Dashboard />);

    expect(screen.queryByTestId('wallet-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('recent-transactions')).toBeInTheDocument();
  });

  // The Wallets card earns its place only once there is a comparison to make.
  // With one wallet it would restate the Total Balance card directly above it.
  it('omits the wallets card for a single active-network wallet', () => {
    mocks.dashboardData = makeDashboardState({
      filteredWallets: [{ id: 'w1' }],
    });
    render(<Dashboard />);

    expect(screen.queryByTestId('wallet-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('recent-transactions')).toBeInTheDocument();
  });

  it('renders the wallets card from two active-network wallets', () => {
    mocks.dashboardData = makeDashboardState({
      filteredWallets: [{ id: 'w1' }, { id: 'w2' }],
    });
    render(<Dashboard />);

    expect(screen.getByTestId('wallet-summary')).toBeInTheDocument();
    expect(screen.getByTestId('recent-transactions')).toBeInTheDocument();
  });

  // Counted from the active network's wallets, not every wallet the user owns —
  // two wallets split across networks must not summon the card.
  it('counts only active-network wallets toward the two-wallet threshold', () => {
    mocks.dashboardData = makeDashboardState({
      wallets: [{ id: 'w1' }, { id: 'w2-other-network' }],
      filteredWallets: [{ id: 'w1' }],
    });
    render(<Dashboard />);

    expect(screen.queryByTestId('wallet-summary')).not.toBeInTheDocument();
  });

  // The stacked layout replaced a two-column grid; the row wrapper is gone, not
  // merely collapsed to one column.
  it('renders wallets and activity as stacked siblings, not a shared row', () => {
    mocks.dashboardData = makeDashboardState({
      filteredWallets: [{ id: 'w1' }, { id: 'w2' }],
    });
    render(<Dashboard />);

    expect(screen.queryByTestId('dashboard-primary-row')).not.toBeInTheDocument();
  });

  // Hover lift promises a click target. These card shells have none — the
  // actionable things are the controls and rows inside them.
  //
  // Covers the telemetry row specifically; WalletSummary and RecentTransactions
  // are mocked in this file, so their shells are asserted in their own tests.
  it('does not advertise clickability on card shells that do not act', () => {
    mocks.dashboardData = makeDashboardState({
      filteredWallets: [{ id: 'w1' }, { id: 'w2' }],
    });
    const { container } = render(<Dashboard />);

    expect(container.querySelectorAll('.card-interactive')).toHaveLength(0);
  });

  // Dropping Bitcoin Price must not leave a hole where its column was: the
  // telemetry row reflows to two columns so Fee Estimation and Node Status
  // share the width evenly.
  it('reflows telemetry to two columns when Bitcoin Price is omitted', () => {
    mocks.dashboardData = makeDashboardState({ isMainnet: true });
    const { container: mainnet } = render(<Dashboard />);
    expect(mainnet.querySelector('.stagger-enter')?.className).toContain('lg:grid-cols-3');
    expect(screen.getByText('Bitcoin Price')).toBeInTheDocument();

    cleanup();

    mocks.dashboardData = makeDashboardState({ isMainnet: false, selectedNetwork: 'signet' });
    const { container: signet } = render(<Dashboard />);
    const telemetry = signet.querySelector('.stagger-enter');
    expect(telemetry?.className).toContain('lg:grid-cols-2');
    expect(telemetry?.className).not.toContain('lg:grid-cols-3');
    expect(screen.queryByText('Bitcoin Price')).not.toBeInTheDocument();
  });

  it('renders signet error copy and symbol', () => {
    mocks.dashboardData = makeDashboardState({
      isMainnet: false,
      selectedNetwork: 'signet',
      versionInfo: null,
      bitcoinStatus: { connected: false, error: 'Signet sync is off' },
      nodeStatus: 'error',
    });
    render(<Dashboard />);

    expect(screen.queryByText('Bitcoin Price')).not.toBeInTheDocument();
    expect(screen.getByTestId('node-status-card')).toHaveTextContent('Signet sync is off');
  });

  it('renders configured testnet3 node details from selected-network status', () => {
    mocks.dashboardData = makeDashboardState({
      isMainnet: false,
      selectedNetwork: 'testnet3',
      versionInfo: null,
      bitcoinStatus: {
        connected: true,
        blockHeight: 4500000,
        host: 'testnet.example.com',
        useSsl: true,
        pool: { enabled: false, minConnections: 1, maxConnections: 1, stats: null },
      },
      nodeStatus: 'connected',
    });
    render(<Dashboard />);

    expect(screen.queryByText('Bitcoin Price')).not.toBeInTheDocument();
    expect(screen.getByTestId('node-status-card')).toHaveTextContent(/^testnet3:connected/);
    expect(screen.getByTestId('node-status-card')).toHaveTextContent('testnet.example.com');
    expect(screen.getByTestId('node-status-card')).toHaveTextContent('4500000');
  });
});
