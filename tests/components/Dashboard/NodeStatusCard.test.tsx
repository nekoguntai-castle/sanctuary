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

  describe('StatusIndicator', () => {
    it('shows neutral indicator for non-mainnet', () => {
      const { container } = render(
        <NodeStatusCard
          isMainnet={false}
          selectedNetwork="testnet"
          nodeStatus="connected"
          bitcoinStatus={undefined}
        />,
      );

      const indicator = container.querySelector('.bg-sanctuary-400.rounded-full');
      expect(indicator).toBeInTheDocument();
    });

    it('shows error indicator for error status', () => {
      const { container } = render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="error"
          bitcoinStatus={{ connected: false, error: 'Connection refused' }}
        />,
      );

      const indicator = container.querySelector('.bg-rose-500.rounded-full');
      expect(indicator).toBeInTheDocument();
    });

    it('shows checking indicator for checking status', () => {
      const { container } = render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="checking"
          bitcoinStatus={undefined}
        />,
      );

      const indicator = container.querySelector('.animate-checking-glow');
      expect(indicator).toBeInTheDocument();
    });

    it('shows default indicator for unknown status', () => {
      const { container } = render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="unknown"
          bitcoinStatus={undefined}
        />,
      );

      const indicators = container.querySelectorAll('.bg-sanctuary-400.rounded-full');
      expect(indicators.length).toBeGreaterThan(0);
    });
  });

  describe('StatusLabel', () => {
    it('shows Error label with icon for error status', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="error"
          bitcoinStatus={{ connected: false }}
        />,
      );

      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('shows Checking... label for checking status', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="checking"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('Checking...')).toBeInTheDocument();
    });

    it('shows Unknown label for unknown status', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="unknown"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });

  describe('PoolDisplay', () => {
    const baseServer = {
      host: 'a.com',
      port: 50001,
      healthyConnections: 0,
      totalRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0,
      backoffLevel: 0,
      cooldownUntil: null,
      weight: 1,
      healthHistory: [] as never[],
    };

    it('shows host with SSL indicator when pool is disabled but host is set', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="connected"
          bitcoinStatus={{
            connected: true,
            blockHeight: 800000,
            host: 'electrum.example.com',
            useSsl: true,
            pool: { enabled: false, minConnections: 1, maxConnections: 3, stats: null },
          }}
        />,
      );

      expect(screen.getByText('Host:')).toBeInTheDocument();
      expect(screen.getByText(/electrum\.example\.com/)).toBeInTheDocument();
    });

    it('shows host without SSL indicator when useSsl is false', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="connected"
          bitcoinStatus={{
            connected: true,
            blockHeight: 800000,
            host: 'electrum.example.com',
            useSsl: false,
            pool: { enabled: false, minConnections: 1, maxConnections: 3, stats: null },
          }}
        />,
      );

      expect(screen.getByText('Host:')).toBeInTheDocument();
    });

    it('shows pool stats when pool is enabled with stats', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="connected"
          bitcoinStatus={{
            connected: true,
            blockHeight: 800000,
            pool: {
              enabled: true,
              minConnections: 1,
              maxConnections: 5,
              stats: {
                activeConnections: 3,
                totalConnections: 5,
                idleConnections: 2,
                waitingRequests: 0,
                totalAcquisitions: 100,
                averageAcquisitionTimeMs: 5,
                healthCheckFailures: 0,
                serverCount: 2,
                servers: [
                  { ...baseServer, serverId: 's1', label: 'server1', connectionCount: 2, healthyConnections: 2, totalRequests: 100, isHealthy: true, lastHealthCheck: '2026-01-01' },
                  { ...baseServer, serverId: 's2', label: 'server2', host: 'b.com', connectionCount: 1, healthyConnections: 1, totalRequests: 50, failedRequests: 5, isHealthy: false, lastHealthCheck: '2026-01-01' },
                ],
              },
            },
          }}
        />,
      );

      expect(screen.getByText('Pool:')).toBeInTheDocument();
      expect(screen.getByText(/3\/5/)).toBeInTheDocument();
      expect(screen.getByText('server1')).toBeInTheDocument();
      expect(screen.getByText('server2')).toBeInTheDocument();
      expect(screen.getByText(/2 conns/)).toBeInTheDocument();
      expect(screen.getByText(/1 conn\b/)).toBeInTheDocument();
    });

    it('shows initializing when pool is enabled but stats is null', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="connected"
          bitcoinStatus={{
            connected: true,
            blockHeight: 800000,
            pool: {
              enabled: true,
              minConnections: 1,
              maxConnections: 3,
              stats: null,
            },
          }}
        />,
      );

      expect(screen.getByText('initializing...')).toBeInTheDocument();
    });

    it('shows server with no health check as neutral indicator', () => {
      const { container } = render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="connected"
          bitcoinStatus={{
            connected: true,
            blockHeight: 800000,
            pool: {
              enabled: true,
              minConnections: 1,
              maxConnections: 3,
              stats: {
                activeConnections: 1,
                totalConnections: 1,
                idleConnections: 0,
                waitingRequests: 0,
                totalAcquisitions: 0,
                averageAcquisitionTimeMs: 0,
                healthCheckFailures: 0,
                serverCount: 1,
                servers: [
                  { ...baseServer, serverId: 's1', label: 'unchecked', connectionCount: 0, isHealthy: false, lastHealthCheck: null },
                ],
              },
            },
          }}
        />,
      );

      expect(screen.getByText('unchecked')).toBeInTheDocument();
      // The unchecked server should use bg-sanctuary-400 (neutral) not bg-success-500 or bg-warning-500
      const serverDots = container.querySelectorAll('.w-1\\.5.h-1\\.5.rounded-full');
      expect(serverDots.length).toBe(1);
    });
  });

  describe('MainnetContent', () => {
    it('shows block height when connected with bitcoinStatus', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="connected"
          bitcoinStatus={{
            connected: true,
            blockHeight: 900000,
            host: 'electrum.example.com',
            pool: { enabled: false, minConnections: 1, maxConnections: 1, stats: null },
          }}
        />,
      );

      expect(screen.getByText('Height:')).toBeInTheDocument();
      expect(screen.getByText('900,000')).toBeInTheDocument();
    });

    it('shows error message when node status is error with error string', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="error"
          bitcoinStatus={{ connected: false, error: 'Connection timeout' }}
        />,
      );

      expect(screen.getByText('Connection timeout')).toBeInTheDocument();
    });

    it('does not show error message when no error string', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="error"
          bitcoinStatus={{ connected: false }}
        />,
      );

      expect(screen.queryByText('Connection timeout')).not.toBeInTheDocument();
    });
  });

  describe('TestnetContent', () => {
    it('shows testnet node not configured message', () => {
      render(
        <NodeStatusCard
          isMainnet={false}
          selectedNetwork="testnet"
          nodeStatus="unknown"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('Testnet node not configured')).toBeInTheDocument();
      expect(screen.getByText('Configure in Settings \u2192 Node Configuration')).toBeInTheDocument();
    });

    it('shows signet node not configured message', () => {
      render(
        <NodeStatusCard
          isMainnet={false}
          selectedNetwork="signet"
          nodeStatus="unknown"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('Signet node not configured')).toBeInTheDocument();
    });
  });

  describe('network badge', () => {
    it('shows MAINNET badge for mainnet', () => {
      render(
        <NodeStatusCard
          isMainnet={true}
          selectedNetwork="mainnet"
          nodeStatus="checking"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('MAINNET')).toBeInTheDocument();
    });

    it('shows TESTNET badge for testnet', () => {
      render(
        <NodeStatusCard
          isMainnet={false}
          selectedNetwork="testnet"
          nodeStatus="unknown"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('TESTNET')).toBeInTheDocument();
    });

    it('shows SIGNET badge for signet', () => {
      render(
        <NodeStatusCard
          isMainnet={false}
          selectedNetwork="signet"
          nodeStatus="unknown"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('SIGNET')).toBeInTheDocument();
    });
  });
});
