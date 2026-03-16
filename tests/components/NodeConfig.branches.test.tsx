import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NodeConfig } from '../../components/NodeConfig';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';

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
  NetworkConnectionCard: ({ network }: { network: string }) => (
    <div data-testid={`network-card-${network}`}>{network}</div>
  ),
}));

describe('NodeConfig branch coverage', () => {
  const baseConfig = {
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
    testnetEnabled: false,
    testnetMode: 'singleton',
    testnetSingletonHost: 'electrum.blockstream.info',
    testnetSingletonPort: 60002,
    testnetSingletonSsl: true,
    testnetPoolMin: 1,
    testnetPoolMax: 3,
    testnetPoolLoadBalancing: 'round_robin',
    signetEnabled: false,
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getNodeConfig).mockResolvedValue(baseConfig as any);
    vi.mocked(adminApi.getElectrumServers).mockResolvedValue([] as any);
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValue({
      available: true,
      exists: true,
      running: true,
      status: 'running',
    } as any);
    vi.mocked(adminApi.startTorContainer).mockResolvedValue({ success: true, message: 'started' } as any);
    vi.mocked(adminApi.stopTorContainer).mockResolvedValue({ success: true, message: 'stopped' } as any);
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ pool: null } as any);
  });

  it('shows fallback external-services summary when explorer and fee URL are absent', async () => {
    vi.mocked(adminApi.getNodeConfig).mockResolvedValue({
      ...baseConfig,
      explorerUrl: '',
      feeEstimatorUrl: '',
      proxyEnabled: false,
    } as any);

    render(<NodeConfig />);

    await waitFor(() => {
      expect(screen.getByText('mempool.space • Electrum')).toBeInTheDocument();
    });
  });

  it('applies bundled tor preset via Use button and hides custom proxy controls', async () => {
    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Proxy / Tor'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Use' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    await waitFor(() => {
      expect(screen.queryByText('Use custom proxy...')).not.toBeInTheDocument();
    });
  });

  it('applies tor and tor-browser custom proxy presets', async () => {
    // Start with proxy enabled but NOT using bundled Tor, so custom proxy section shows.
    // proxyEnabled + proxyHost != 'tor' causes showCustomProxy = true on load.
    vi.mocked(adminApi.getNodeConfig).mockResolvedValue({
      ...baseConfig,
      proxyEnabled: true,
      proxyHost: '127.0.0.1',
      proxyPort: 1234,
    } as any);

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
    });

    // Expand the Proxy / Tor section
    fireEvent.click(screen.getByText('Proxy / Tor'));
    // showCustomProxy is true on load, so preset buttons should be visible
    await waitFor(() => {
      expect(screen.getByText('Tor Daemon (9050)')).toBeInTheDocument();
    });

    // Click Tor Daemon preset - exercises handleProxyPreset('tor')
    fireEvent.click(screen.getByText('Tor Daemon (9050)'));

    // Click Tor Browser preset - exercises handleProxyPreset('tor-browser')
    fireEvent.click(screen.getByText('Tor Browser (9150)'));

    expect(screen.getByText('Node Configuration')).toBeInTheDocument();
  });

  it('surfaces start-tor failure message branch', async () => {
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValue({
      available: true,
      exists: true,
      running: false,
      status: 'exited',
    } as any);
    vi.mocked(adminApi.startTorContainer).mockResolvedValue({
      success: false,
      message: 'Tor start failed',
    } as any);

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Proxy / Tor'));

    const toggles = document.querySelectorAll('button.rounded-full');
    const torToggle = toggles[toggles.length - 1] as HTMLButtonElement;
    fireEvent.click(torToggle);

    await waitFor(() => {
      expect(screen.getByText('Tor start failed')).toBeInTheDocument();
    });
  });

  it('surfaces stop-tor failure message branch', async () => {
    vi.mocked(adminApi.stopTorContainer).mockResolvedValue({
      success: false,
      message: 'Tor stop failed',
    } as any);

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Proxy / Tor'));

    const toggles = document.querySelectorAll('button.rounded-full');
    const torToggle = toggles[toggles.length - 1] as HTMLButtonElement;
    fireEvent.click(torToggle);

    await waitFor(() => {
      expect(screen.getByText('Tor stop failed')).toBeInTheDocument();
    });
  });

  it('disables proxy when stopping bundled tor successfully', async () => {
    vi.mocked(adminApi.getNodeConfig).mockResolvedValue({
      ...baseConfig,
      proxyHost: 'tor',
      proxyPort: 9050,
      proxyEnabled: true,
    } as any);

    render(<NodeConfig />);
    await waitFor(() => {
      expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Proxy / Tor'));

    const toggles = document.querySelectorAll('button.rounded-full');
    const torToggle = toggles[toggles.length - 1] as HTMLButtonElement;
    fireEvent.click(torToggle);

    await waitFor(() => {
      expect(adminApi.stopTorContainer).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });
  });
});
