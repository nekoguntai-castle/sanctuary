import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeStatusCard } from '../../../components/Dashboard/NodeStatusCard';

vi.mock('lucide-react', () => ({
  Zap: () => <span data-testid="zap-icon" />,
  CheckCircle2: () => <span data-testid="connected-icon" />,
  XCircle: () => <span data-testid="error-icon" />,
}));

describe('NodeStatusCard', () => {
  it('renders nothing in PoolDisplay when pool is disabled and host is empty', () => {
    const { container } = render(
      <NodeStatusCard
        isMainnet={true}
        selectedNetwork="mainnet"
        nodeStatus="connected"
        bitcoinStatus={{
          connected: true,
          blockHeight: 900000,
          host: '',
          pool: { enabled: false, minConnections: 1, maxConnections: 3, stats: null },
        }}
      />,
    );

    // Pool disabled + no host -> PoolDisplay returns null, so no Host/Pool row
    expect(screen.queryByText('Host:')).not.toBeInTheDocument();
    expect(screen.queryByText('Pool:')).not.toBeInTheDocument();

    // The card itself still renders with the connected status
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="connected-icon"]')).toBeInTheDocument();
  });
});
