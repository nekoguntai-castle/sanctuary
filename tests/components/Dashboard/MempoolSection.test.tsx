import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MempoolSection } from '../../../components/Dashboard/MempoolSection';

const mockNavigate = vi.fn();
const mockRefresh = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

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

  it('renders non-mainnet configuration prompt and navigates to node settings', async () => {
    const user = userEvent.setup();
    render(
      <MempoolSection
        {...baseProps}
        selectedNetwork="testnet"
        isMainnet={false}
      />
    );

    expect(screen.getByText('Testnet Node Not Configured')).toBeInTheDocument();
    expect(screen.queryByTestId('block-visualizer')).not.toBeInTheDocument();
    expect(screen.getByText('TESTNET')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /configure node/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/node');
  });
});
