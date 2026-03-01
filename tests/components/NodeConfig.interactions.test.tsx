import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeConfig } from '../../components/NodeConfig';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';

const mockNetworkCardTestArgs = vi.hoisted(() => ({
  calls: [] as Array<{ host: string; port: number; ssl: boolean }>,
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/api/admin', () => ({
  getNodeConfig: vi.fn(),
  updateNodeConfig: vi.fn(),
  getElectrumServers: vi.fn(),
  testElectrumConnection: vi.fn(),
  testProxy: vi.fn(),
  getTorContainerStatus: vi.fn(),
  startTorContainer: vi.fn(),
  stopTorContainer: vi.fn(),
}));

vi.mock('../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../components/NetworkConnectionCard', () => ({
  NetworkConnectionCard: ({ network, servers, onServersChange, onTestConnection }: any) => {
    const [testResult, setTestResult] = React.useState('');
    return (
      <div data-testid={`network-card-${network}`}>
        <span data-testid={`server-count-${network}`}>{servers.length}</span>
        <button
          onClick={() => {
            const next = [
              ...servers,
              {
                id: `new-${network}`,
                label: 'Added',
                host: 'added.example',
                port: 50001,
                useSsl: false,
                network,
                enabled: true,
                priority: 99,
              },
            ];
            onServersChange(next);
          }}
        >
          {`servers-add-${network}`}
        </button>
        <button
          onClick={async () => {
            mockNetworkCardTestArgs.calls.push({ host: 'example.com', port: 50002, ssl: true });
            const result = await onTestConnection('example.com', 50002, true);
            setTestResult(result.message);
          }}
        >
          {`test-conn-${network}`}
        </button>
        <span>{testResult}</span>
      </div>
    );
  },
}));

describe('NodeConfig interaction branches', () => {
  const flushState = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const baseNodeConfig = {
    type: 'electrum',
    explorerUrl: 'https://mempool.space',
    feeEstimatorUrl: 'https://mempool.space',
    mempoolEstimator: 'mempool_space' as const,
    mainnetMode: 'pool',
    mainnetSingletonHost: 'electrum.blockstream.info',
    mainnetSingletonPort: 50002,
    mainnetSingletonSsl: true,
    mainnetPoolMin: 1,
    mainnetPoolMax: 5,
    mainnetPoolLoadBalancing: 'round_robin',
    testnetEnabled: true,
    testnetMode: 'singleton',
    testnetSingletonHost: 'electrum.blockstream.info',
    testnetSingletonPort: 60002,
    testnetSingletonSsl: true,
    testnetPoolMin: 1,
    testnetPoolMax: 3,
    testnetPoolLoadBalancing: 'round_robin',
    signetEnabled: true,
    signetMode: 'singleton',
    signetSingletonHost: 'electrum.mutinynet.com',
    signetSingletonPort: 50002,
    signetSingletonSsl: true,
    signetPoolMin: 1,
    signetPoolMax: 3,
    signetPoolLoadBalancing: 'round_robin',
    proxyEnabled: true,
    proxyHost: '127.0.0.1',
    proxyPort: 9050,
    proxyUsername: undefined,
    proxyPassword: undefined,
  };

  const baseServers = [
    {
      id: 'main-1',
      label: 'Main 1',
      host: 'main.one',
      port: 50002,
      useSsl: true,
      network: 'mainnet',
      enabled: true,
      priority: 0,
    },
    {
      id: 'test-1',
      label: 'Test 1',
      host: 'test.one',
      port: 60002,
      useSsl: true,
      network: 'testnet',
      enabled: true,
      priority: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockNetworkCardTestArgs.calls = [];

    vi.mocked(adminApi.getNodeConfig).mockResolvedValue(baseNodeConfig as any);
    vi.mocked(adminApi.getElectrumServers).mockResolvedValue(baseServers as any);
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValue({
      available: true,
      exists: true,
      running: false,
      status: 'exited',
    } as any);
    vi.mocked(adminApi.testElectrumConnection).mockResolvedValue({
      success: true,
      message: 'Electrum OK',
    } as any);
    vi.mocked(adminApi.testProxy).mockResolvedValue({
      success: true,
      message: 'Proxy connected',
    } as any);
    vi.mocked(adminApi.startTorContainer).mockResolvedValue({ success: true, message: 'Tor started' } as any);
    vi.mocked(adminApi.stopTorContainer).mockResolvedValue({ success: true, message: 'Tor stopped' } as any);
    vi.mocked(adminApi.updateNodeConfig).mockResolvedValue(undefined as any);
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      pool: {
        stats: {
          activeConnections: 1,
          totalConnections: 2,
          healthyConnections: 1,
          unhealthyConnections: 1,
          servers: [],
        },
      },
    } as any);
  });

  it('drives network card callbacks for connection test and server updates', async () => {
    const user = userEvent.setup();
    render(<NodeConfig />);

    await waitFor(() => {
      expect(screen.getByText('Network Connections')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Network Connections'));

    expect(screen.getByTestId('network-card-mainnet')).toBeInTheDocument();
    expect(screen.getByTestId('server-count-mainnet')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'test-conn-mainnet' }));
    await waitFor(() => {
      expect(adminApi.testElectrumConnection).toHaveBeenCalledWith({
        host: 'example.com',
        port: 50002,
        useSsl: true,
      });
    });
    expect(screen.getByText('Electrum OK')).toBeInTheDocument();
    expect(mockNetworkCardTestArgs.calls.length).toBe(1);

    await user.click(screen.getByRole('button', { name: 'servers-add-mainnet' }));
    expect(screen.getByTestId('server-count-mainnet')).toHaveTextContent('2');
    expect(screen.getByText(/Mainnet \(2\)/)).toBeInTheDocument();

    vi.mocked(adminApi.testElectrumConnection).mockRejectedValueOnce(new Error('no route'));
    await user.click(screen.getByRole('button', { name: 'test-conn-mainnet' }));
    await waitFor(() => {
      expect(screen.getByText('no route')).toBeInTheDocument();
    });
  });

  it('handles proxy verify success and explicit failure path', async () => {
    const user = userEvent.setup();
    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Proxy / Tor'));

    const verifyButton = screen.getByRole('button', { name: 'Verify Connection' });
    await user.click(verifyButton);
    await waitFor(() => {
      expect(screen.getByText('Proxy connected')).toBeInTheDocument();
    });
    expect(adminApi.testProxy).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 9050,
      username: undefined,
      password: undefined,
    });

    vi.mocked(adminApi.testProxy).mockResolvedValueOnce({
      success: false,
      message: 'SOCKS rejected',
    } as any);
    await user.click(verifyButton);
    await waitFor(() => {
      expect(screen.getByText('SOCKS rejected')).toBeInTheDocument();
    });
  });

  it('supports keyboard expansion and proxy preset toggles', async () => {
    const user = userEvent.setup();
    render(<NodeConfig />);

    await waitFor(() => {
      expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
    });

    const proxyHeader = screen.getByRole('button', { name: /proxy \/ tor/i });
    fireEvent.keyDown(proxyHeader, { key: 'Enter' });
    expect(screen.getByText(/Hide custom proxy settings/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tor Browser (9150)' }));
    expect(screen.getByDisplayValue('9150')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tor Daemon (9050)' }));
    expect(screen.getByDisplayValue('9050')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Hide custom proxy settings/i }));
    expect(screen.getByText('Use custom proxy...')).toBeInTheDocument();
  });

  it('handles Tor container start flow and status refresh', async () => {
    const user = userEvent.setup();
    render(<NodeConfig />);

    await waitFor(() => {
      expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Proxy / Tor'));

    const toggles = document.querySelectorAll('button.rounded-full');
    const torToggle = toggles[toggles.length - 1] as HTMLButtonElement;
    expect(torToggle).toBeTruthy();
    await user.click(torToggle);

    await waitFor(() => {
      expect(adminApi.startTorContainer).toHaveBeenCalled();
    });
    expect(screen.getByText(/Bootstrapping Tor network/i)).toBeInTheDocument();
  });

  it('handles Tor stop flow and disables bundled proxy usage', async () => {
    const user = userEvent.setup();

    vi.mocked(adminApi.getNodeConfig).mockResolvedValue({
      ...baseNodeConfig,
      proxyHost: 'tor',
      proxyPort: 9050,
    } as any);
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValue({
      available: true,
      exists: true,
      running: true,
      status: 'running',
    } as any);

    render(<NodeConfig />);

    await waitFor(() => {
      expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Proxy / Tor'));

    const toggles = document.querySelectorAll('button.rounded-full');
    const torToggle = toggles[toggles.length - 1] as HTMLButtonElement;
    await user.click(torToggle);

    await waitFor(() => {
      expect(adminApi.stopTorContainer).toHaveBeenCalled();
    });
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});
