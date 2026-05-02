import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { MempoolSection } from '../../../components/Dashboard/MempoolSection';

const mockRefresh = vi.fn();
const mockConfigureNode = vi.fn();

vi.mock('../../../components/BlockVisualizer', () => ({
  BlockVisualizer: ({ blocks }: { blocks: unknown[] }) => (
    <div data-testid="block-visualizer">blocks:{blocks.length}</div>
  ),
}));

vi.mock('lucide-react', () => ({
  Bitcoin: () => <span data-testid="bitcoin-icon" />,
  RefreshCw: ({ className }: { className?: string }) => <span data-testid="refresh-icon" className={className} />,
  Wifi: () => <span data-testid="wifi-icon" />,
  WifiOff: () => <span data-testid="wifi-off-icon" />,
}));

describe('MempoolSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseProps = {
    selectedNetwork: 'mainnet' as const,
    isMainnet: true,
    mempoolBlocks: [{ id: 1 } as any, { id: 2 } as any],
    queuedBlocksSummary: null,
    pendingTxs: [],
    explorerUrl: 'https://mempool.space',
    refreshMempoolData: mockRefresh,
    mempoolRefreshing: false,
    lastMempoolUpdate: new Date('2026-01-01T12:34:56Z'),
    wsConnected: true,
    wsState: 'connected',
    nodeStatus: 'connected' as const,
    bitcoinStatus: { connected: true, host: 'mainnet.example.com' },
    onConfigureNode: mockConfigureNode,
  };

  it('renders mainnet live state and refreshes data', async () => {
    const user = userEvent.setup();
    render(<MempoolSection {...baseProps} />);

    expect(screen.getByText('Bitcoin Network Status')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByTestId('block-visualizer')).toBeInTheDocument();

    await user.click(screen.getByTitle('Refresh mempool data'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('renders connecting and offline websocket states', () => {
    const { rerender } = render(
      <MempoolSection {...baseProps} wsConnected={false} wsState="connecting" />
    );
    expect(screen.getByText('Connecting')).toBeInTheDocument();

    rerender(<MempoolSection {...baseProps} wsConnected={false} wsState="disconnected" />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('shows spinning refresh icon while mempool data is refreshing', () => {
    render(
      <MempoolSection
        {...baseProps}
        mempoolRefreshing={true}
      />
    );

    expect(screen.getByTestId('refresh-icon').className).toContain('animate-spin');
  });

  it('renders connected non-mainnet block visualization without a false configuration prompt', async () => {
    const user = userEvent.setup();
    render(
      <MempoolSection
        {...baseProps}
        selectedNetwork="testnet"
        isMainnet={false}
        bitcoinStatus={{ connected: true, host: 'testnet.example.com' }}
      />
    );

    expect(screen.getByTestId('block-visualizer')).toBeInTheDocument();
    expect(screen.getByText('TESTNET')).toBeInTheDocument();
    expect(screen.queryByText(/mainnet-only/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open node config/i })).not.toBeInTheDocument();

    await user.click(screen.getByTitle('Refresh mempool data'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('renders signet-specific attention state and configuration action', async () => {
    const user = userEvent.setup();
    render(
      <MempoolSection
        {...baseProps}
        selectedNetwork="signet"
        isMainnet={false}
        nodeStatus="error"
        bitcoinStatus={{ connected: false, error: 'Signet sync is off' }}
      />
    );

    expect(screen.getByText('Signet Node Needs Attention')).toBeInTheDocument();
    expect(screen.getByText('Signet sync is off')).toBeInTheDocument();
    expect(screen.getByText('SIGNET')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open node config/i }));
    expect(mockConfigureNode).toHaveBeenCalled();
  });

  it('renders the testnet checking state with testnet-specific treatment', async () => {
    const user = userEvent.setup();
    render(
      <MempoolSection
        {...baseProps}
        selectedNetwork="testnet"
        isMainnet={false}
        nodeStatus="checking"
        bitcoinStatus={undefined}
      />
    );

    expect(screen.getByText('Checking Testnet Node')).toBeInTheDocument();
    expect(screen.getByText(/review testnet Electrum settings/i)).toBeInTheDocument();
    expect(screen.getByText('TESTNET')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open node config/i }));
    expect(mockConfigureNode).toHaveBeenCalled();
  });
});
