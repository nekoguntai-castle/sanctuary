import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NodeStatusCard } from '../../../src/components/Dashboard/NodeStatusCard';

vi.mock('lucide-react', () => ({
  Zap: () => <span data-testid="zap-icon" />,
  CheckCircle2: () => <span data-testid="connected-icon" />,
  XCircle: () => <span data-testid="error-icon" />,
  // ShowMoreToggle draws the server-list disclosure chevron.
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
  ChevronUp: () => <span data-testid="chevron-up-icon" />,
}));

describe('NodeStatusCard', () => {
  it('renders nothing in PoolDisplay when pool is disabled and host is empty', () => {
    const { container } = render(
      <NodeStatusCard
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
    it('shows connected indicator for configured non-mainnet status', () => {
      const { container } = render(
        <NodeStatusCard
          selectedNetwork="testnet3"
          nodeStatus="connected"
          bitcoinStatus={undefined}
        />,
      );

      const indicator = container.querySelector('.animate-connected-glow');
      expect(indicator).toBeInTheDocument();
    });

    it('shows error indicator for error status', () => {
      const { container } = render(
        <NodeStatusCard
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

      expect(screen.getByText('electrum.example.com')).toBeInTheDocument();
      expect(screen.getByText('🔒')).toBeInTheDocument();
    });

    it('shows host without SSL indicator when useSsl is false', () => {
      render(
        <NodeStatusCard
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

      expect(screen.getByText('electrum.example.com')).toBeInTheDocument();
      expect(screen.queryByText('🔒')).not.toBeInTheDocument();
    });

    it('shows pool stats when pool is enabled with stats', async () => {
      render(
        <NodeStatusCard
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

      expect(screen.getByText('pool')).toBeInTheDocument();
      expect(screen.getByText(/3\/5/)).toBeInTheDocument();
      // The per-server breakdown is a drill-down now: expanded by default it
      // made this the tallest card in the row for detail most readers are not
      // asking for.
      expect(screen.queryByText('server1')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /2 servers/ }));

      expect(screen.getByText('server1')).toBeInTheDocument();
      expect(screen.getByText('server2')).toBeInTheDocument();
      expect(screen.getByText(/2 conns/)).toBeInTheDocument();
      expect(screen.getByText(/1 conn\b/)).toBeInTheDocument();
    });

    it('shows initializing when pool is enabled but stats is null', () => {
      render(
        <NodeStatusCard
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

      expect(screen.getByText('pool')).toBeInTheDocument();
      expect(screen.getByText(/initializing/)).toBeInTheDocument();
    });

    it('shows server with no health check as neutral indicator', async () => {
      const { container } = render(
        <NodeStatusCard
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

      await userEvent.click(screen.getByRole('button', { name: /1 server/ }));

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

      // The label column is gone; each figure keeps a word in front of it.
      expect(screen.getByText('height')).toBeInTheDocument();
      expect(screen.getByText('900,000')).toBeInTheDocument();
    });

    it('shows error message when node status is error with error string', () => {
      render(
        <NodeStatusCard
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
          selectedNetwork="mainnet"
          nodeStatus="error"
          bitcoinStatus={{ connected: false }}
        />,
      );

      expect(screen.queryByText('Connection timeout')).not.toBeInTheDocument();
    });
  });

  describe('NetworkUnavailableContent', () => {
    it('shows unavailable testnet3 status without claiming it is unconfigured', () => {
      render(
        <NodeStatusCard
          selectedNetwork="testnet3"
          nodeStatus="unknown"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('Testnet3 node status is unavailable')).toBeInTheDocument();
      expect(screen.queryByText('Testnet3 node not configured')).not.toBeInTheDocument();
      expect(screen.getByText('Open Admin \u2192 Node Config to review Testnet3 settings.')).toBeInTheDocument();
    });

    it('shows signet error message from the network status API', () => {
      render(
        <NodeStatusCard
          selectedNetwork="signet"
          nodeStatus="error"
          bitcoinStatus={{ connected: false, error: 'Signet sync is off' }}
        />,
      );

      expect(screen.getByText('Signet sync is off')).toBeInTheDocument();
    });

    it('shows checking copy while a non-mainnet status request is in flight', () => {
      render(
        <NodeStatusCard
          selectedNetwork="testnet3"
          nodeStatus="checking"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('Checking configured Electrum server...')).toBeInTheDocument();
    });

    it('shows configured testnet3 Electrum host when connected', () => {
      render(
        <NodeStatusCard
          selectedNetwork="testnet3"
          nodeStatus="connected"
          bitcoinStatus={{
            connected: true,
            blockHeight: 4500000,
            host: 'testnet.example.com',
            useSsl: true,
            pool: { enabled: false, minConnections: 1, maxConnections: 1, stats: null },
          }}
        />,
      );

      expect(screen.getByText('Connected')).toBeInTheDocument();
      expect(screen.getByText('4,500,000')).toBeInTheDocument();
      expect(screen.getByText('testnet.example.com')).toBeInTheDocument();
      expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
    });
  });

  describe('network badge', () => {
    it('shows MAINNET badge for mainnet', () => {
      render(
        <NodeStatusCard
          selectedNetwork="mainnet"
          nodeStatus="checking"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('MAINNET')).toBeInTheDocument();
    });

    it('shows TESTNET3 badge for testnet3', () => {
      render(
        <NodeStatusCard
          selectedNetwork="testnet3"
          nodeStatus="unknown"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('TESTNET3')).toBeInTheDocument();
    });

    it('shows SIGNET badge for signet', () => {
      render(
        <NodeStatusCard
          selectedNetwork="signet"
          nodeStatus="unknown"
          bitcoinStatus={undefined}
        />,
      );

      expect(screen.getByText('SIGNET')).toBeInTheDocument();
    });
  });
});
