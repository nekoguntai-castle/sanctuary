/**
 * Tests for components/NodeConfig.tsx
 *
 * Tests the node configuration UI including external services,
 * network connections, and proxy/Tor settings.
 */

import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NodeConfig } from '../../components/NodeConfig';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import { DEFAULT_NODE_MEMPOOL_ESTIMATOR } from '@sanctuary/shared/constants/nodeConfig';

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the APIs
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

// Mock NetworkConnectionCard since it's complex
vi.mock('../../components/NetworkConnectionCard', () => ({
  NetworkConnectionCard: ({ network }: { network: string }) => (
    <div data-testid={`network-card-${network}`}>Network Card: {network}</div>
  ),
}));

describe('NodeConfig', () => {
  const mockNodeConfig = {
    type: 'electrum',
    explorerUrl: 'https://mempool.space',
    feeEstimatorUrl: 'https://mempool.space',
    mempoolEstimator: DEFAULT_NODE_MEMPOOL_ESTIMATOR,
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
    proxyEnabled: false,
  };

  const mockServers = [
    {
      id: 'server-1',
      label: 'Blockstream',
      host: 'electrum.blockstream.info',
      port: 50002,
      useSsl: true,
      network: 'mainnet',
      enabled: true,
      priority: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getNodeConfig).mockResolvedValue(mockNodeConfig as any);
    vi.mocked(adminApi.getElectrumServers).mockResolvedValue(mockServers as any);
    vi.mocked(adminApi.getTorContainerStatus).mockResolvedValue({
      available: true,
      exists: true,
      running: false,
      status: 'exited',
    } as any);
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ pool: null } as any);
  });

  describe('loading state', () => {
    it('shows loading message while fetching', () => {
      vi.mocked(adminApi.getNodeConfig).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<NodeConfig />);

      expect(screen.getByText('Loading node configuration...')).toBeInTheDocument();
    });
  });

  describe('rendering', () => {
    it('renders page header', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Node Configuration')).toBeInTheDocument();
      });

      expect(screen.getByText('Configure network settings for the Bitcoin backend')).toBeInTheDocument();
    });

    it('renders Save All Settings button', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save All Settings' })).toBeInTheDocument();
      });
    });

    it('renders External Services section', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('External Services')).toBeInTheDocument();
      });
    });

    it('renders Network Connections section', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Network Connections')).toBeInTheDocument();
      });
    });

    it('renders Proxy / Tor section', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
      });
    });
  });

  describe('section expansion', () => {
    it('expands External Services section when clicked', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('External Services')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('External Services'));

      expect(screen.getByText('Block Explorer')).toBeInTheDocument();
      expect(screen.getByText('Fee Estimation')).toBeInTheDocument();
    });

    it('expands Network Connections section when clicked', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Network Connections')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Network Connections'));

      // Should show network tabs
      expect(screen.getByTestId('network-card-mainnet')).toBeInTheDocument();
    });

    it('only expands one section at a time', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('External Services')).toBeInTheDocument();
      });

      // Expand External Services
      fireEvent.click(screen.getByText('External Services'));
      expect(screen.getByText('Block Explorer')).toBeInTheDocument();

      // Expand Network Connections - should collapse External Services
      fireEvent.click(screen.getByText('Network Connections'));
      expect(screen.queryByText('Block Explorer')).not.toBeInTheDocument();
    });
  });

  describe('external services', () => {
    it('shows block explorer URL input', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('External Services')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('External Services'));

      // Wait for the expanded content
      await waitFor(() => {
        expect(screen.getByText('Block Explorer')).toBeInTheDocument();
      });

      // There are two inputs with same placeholder (Block Explorer and Fee Estimator URL)
      // Use getAllByPlaceholderText and get the first one (Block Explorer)
      const inputs = screen.getAllByPlaceholderText('https://mempool.space') as HTMLInputElement[];
      expect(inputs[0].value).toBe('https://mempool.space');
    });

    it('shows preset buttons for block explorer', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('External Services')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('External Services'));

      expect(screen.getByText('mempool.space')).toBeInTheDocument();
      expect(screen.getByText('blockstream.info')).toBeInTheDocument();
    });

    it('shows fee estimation options', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('External Services')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('External Services'));

      expect(screen.getByText('Mempool API')).toBeInTheDocument();
      expect(screen.getByText('Electrum Server')).toBeInTheDocument();
    });

    it('shows block confirmation algorithm dropdown', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('External Services')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('External Services'));

      expect(screen.getByText('Block Confirmation Algorithm')).toBeInTheDocument();
    });
  });

  describe('network tabs', () => {
    it('shows mainnet/testnet3/testnet4/signet tabs', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Network Connections')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Network Connections'));

      // Find the network tabs in the tab bar
      await waitFor(() => {
        expect(screen.getByTestId('network-card-mainnet')).toBeInTheDocument();
      });

      // Network tabs should be visible as tab buttons
      const tabs = document.querySelectorAll('.border-b button');
      expect(tabs.length).toBe(4); // mainnet, testnet3, testnet4, signet
    });

    it('switches network tabs when clicked', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Network Connections')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Network Connections'));

      await waitFor(() => {
        expect(screen.getByTestId('network-card-mainnet')).toBeInTheDocument();
      });

      // Click testnet3 tab (find by text within the tab bar)
      const testnetButtons = screen.getAllByText(/testnet3/i);
      // The tab button should be in the tab bar area
      testnetButtons.forEach(btn => {
        if (btn.tagName === 'BUTTON' || btn.closest('button')) {
          fireEvent.click(btn.closest('button') || btn);
        }
      });

      await waitFor(() => {
        expect(screen.getByTestId('network-card-testnet3')).toBeInTheDocument();
      });
    });
  });

  describe('proxy settings', () => {
    it('shows proxy toggle', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
      });

      // The toggle is visible in the collapsed header
      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('enables proxy when toggle clicked', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
      });

      // Find and click the toggle switch
      const toggles = document.querySelectorAll('.rounded-full.transition-colors');
      const proxyToggle = toggles[0]; // First toggle is the proxy toggle

      if (proxyToggle) {
        fireEvent.click(proxyToggle);
      }

      // Now expand the section to see proxy options
      fireEvent.click(screen.getByText('Proxy / Tor'));
    });

    it('shows Bundled Tor option when available', async () => {
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

      // Enable proxy and expand section
      const toggles = document.querySelectorAll('.rounded-full.transition-colors');
      const proxyToggle = toggles[0];
      if (proxyToggle) {
        fireEvent.click(proxyToggle);
      }

      fireEvent.click(screen.getByText('Proxy / Tor'));

      await waitFor(() => {
        expect(screen.getByText('Bundled Tor')).toBeInTheDocument();
      });
    });

    it('shows custom proxy link when bundled Tor not in use', async () => {
      vi.mocked(adminApi.getNodeConfig).mockResolvedValue({
        ...mockNodeConfig,
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
      } as any);

      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Proxy / Tor'));

      // Should show custom proxy settings since not using bundled Tor
      await waitFor(() => {
        expect(screen.getByText(/custom proxy/i)).toBeInTheDocument();
      });
    });
  });

  describe('saving configuration', () => {
    it('calls updateNodeConfig when Save clicked', async () => {
      vi.mocked(adminApi.updateNodeConfig).mockResolvedValue(mockNodeConfig as any);

      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save All Settings' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save All Settings' }));

      await waitFor(() => {
        expect(adminApi.updateNodeConfig).toHaveBeenCalled();
      });
    });

    it('shows success message after save', async () => {
      vi.mocked(adminApi.updateNodeConfig).mockResolvedValue(mockNodeConfig as any);

      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save All Settings' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save All Settings' }));

      await waitFor(() => {
        expect(screen.getByText('Node configuration saved successfully')).toBeInTheDocument();
      });
    });

    it('shows error message on save failure', async () => {
      vi.mocked(adminApi.updateNodeConfig).mockRejectedValue(new Error('Save failed'));

      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Save All Settings' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save All Settings' }));

      await waitFor(() => {
        expect(screen.getByText('Failed to save node configuration')).toBeInTheDocument();
      });
    });
  });

  describe('proxy testing', () => {
    it('shows Verify Connection button when proxy is enabled', async () => {
      vi.mocked(adminApi.getNodeConfig).mockResolvedValue({
        ...mockNodeConfig,
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
      } as any);

      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Proxy / Tor'));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Verify Connection' })).toBeInTheDocument();
      });
    });

    it('calls testProxy API when Verify clicked', async () => {
      vi.mocked(adminApi.getNodeConfig).mockResolvedValue({
        ...mockNodeConfig,
        proxyEnabled: true,
        proxyHost: '127.0.0.1',
        proxyPort: 9050,
      } as any);
      vi.mocked(adminApi.testProxy).mockResolvedValue({ success: true, message: 'Connected' });

      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Proxy / Tor')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Proxy / Tor'));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Verify Connection' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Verify Connection' }));

      await waitFor(() => {
        expect(adminApi.testProxy).toHaveBeenCalled();
      });
    });
  });

  describe('error handling', () => {
    it('shows default config on API error', async () => {
      vi.mocked(adminApi.getNodeConfig).mockRejectedValue(new Error('API Error'));
      vi.mocked(adminApi.getElectrumServers).mockRejectedValue(new Error('API Error'));
      vi.mocked(adminApi.getTorContainerStatus).mockRejectedValue(new Error('API Error'));

      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Node Configuration')).toBeInTheDocument();
      });

      // Should still render with default config
      expect(screen.getByText('External Services')).toBeInTheDocument();
    });
  });

  describe('summary display', () => {
    it('shows external services summary', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText(/mempool\.space/)).toBeInTheDocument();
      });
    });

    it('shows networks summary with server count', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText(/Mainnet \(1\)/)).toBeInTheDocument();
      });
    });

    it('shows proxy summary as Disabled when off', async () => {
      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Disabled')).toBeInTheDocument();
      });
    });

    it('shows proxy summary as Bundled Tor when using tor', async () => {
      vi.mocked(adminApi.getNodeConfig).mockResolvedValue({
        ...mockNodeConfig,
        proxyEnabled: true,
        proxyHost: 'tor',
        proxyPort: 9050,
      } as any);

      render(<NodeConfig />);

      await waitFor(() => {
        expect(screen.getByText('Bundled Tor')).toBeInTheDocument();
      });
    });
  });
});
