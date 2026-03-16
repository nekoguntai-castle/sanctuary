/**
 * Tests for NetworkConnectionCard component
 */

import { fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NetworkConnectionCard } from '../../components/NetworkConnectionCard';
import * as adminApi from '../../src/api/admin';

// Mock API
vi.mock('../../src/api/admin', () => ({
  addElectrumServer: vi.fn(),
  updateElectrumServer: vi.fn(),
  deleteElectrumServer: vi.fn(),
  reorderElectrumServers: vi.fn(),
}));

describe('NetworkConnectionCard', () => {
  const mockConfig = {
    type: 'electrum' as const,
    mainnetMode: 'pool' as const,
    mainnetSingletonHost: 'electrum.blockstream.info',
    mainnetSingletonPort: 50002,
    mainnetSingletonSsl: true,
    mainnetPoolMin: 1,
    mainnetPoolMax: 5,
    mainnetPoolLoadBalancing: 'round_robin' as const,
    testnetEnabled: true,
    testnetMode: 'singleton' as const,
    testnetSingletonHost: 'electrum.blockstream.info',
    testnetSingletonPort: 60002,
    testnetSingletonSsl: true,
    signetEnabled: true,
    signetMode: 'singleton' as const,
    signetSingletonHost: 'electrum.mutinynet.com',
    signetSingletonPort: 50002,
    signetSingletonSsl: true,
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
      isHealthy: true,
      lastHealthCheck: new Date().toISOString(),
      healthCheckFails: 0,
    },
    {
      id: 'server-2',
      label: 'BlueWallet',
      host: 'electrum1.bluewallet.io',
      port: 50001,
      useSsl: false,
      network: 'mainnet',
      enabled: true,
      priority: 1,
      isHealthy: false,
      lastHealthCheck: new Date().toISOString(),
      healthCheckFails: 2,
    },
  ];

  const mockPoolStats = {
    servers: [
      {
        serverId: 'server-1',
        weight: 1.0,
        consecutiveFailures: 0,
        healthHistory: [
          { success: true, timestamp: new Date().toISOString() },
          { success: true, timestamp: new Date().toISOString() },
        ],
      },
      {
        serverId: 'server-2',
        weight: 0.5,
        consecutiveFailures: 2,
        healthHistory: [
          { success: false, timestamp: new Date().toISOString() },
          { success: true, timestamp: new Date().toISOString() },
        ],
      },
    ],
  };

  const defaultProps = {
    network: 'mainnet' as const,
    config: mockConfig as any,
    servers: mockServers as any,
    poolStats: mockPoolStats as any,
    onConfigChange: vi.fn(),
    onServersChange: vi.fn(),
    onTestConnection: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(adminApi.addElectrumServer).mockResolvedValue({
      id: 'new-server',
      label: 'New Server',
      host: 'new.example.com',
      port: 50002,
      useSsl: true,
      network: 'mainnet',
      enabled: true,
      priority: 2,
    } as any);

    vi.mocked(adminApi.updateElectrumServer).mockResolvedValue({} as any);
    vi.mocked(adminApi.deleteElectrumServer).mockResolvedValue({
      success: true,
      message: 'Deleted',
    });
    vi.mocked(adminApi.reorderElectrumServers).mockResolvedValue(mockServers as any);

    defaultProps.onTestConnection.mockResolvedValue({
      success: true,
      message: 'Connected successfully',
    });
  });

  describe('connection mode selector', () => {
    it('renders mode selector buttons', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      expect(screen.getByText('Connection Mode')).toBeInTheDocument();
      expect(screen.getByText('Singleton')).toBeInTheDocument();
      expect(screen.getByText('Pool')).toBeInTheDocument();
    });

    it('highlights current mode', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      // Pool should be highlighted for mainnet (active tab uses white bg with shadow)
      const poolButton = screen.getByText('Pool').closest('button');
      expect(poolButton?.className).toContain('bg-white');
      expect(poolButton?.className).toContain('shadow-sm');
    });

    it('changes mode when clicking button', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      await user.click(screen.getByText('Singleton'));

      expect(defaultProps.onConfigChange).toHaveBeenCalledWith({
        mainnetMode: 'singleton',
      });
    });
  });

  describe('singleton mode', () => {
    it('shows singleton config when mode is singleton', () => {
      render(
        <NetworkConnectionCard
          {...defaultProps}
          config={{ ...mockConfig, mainnetMode: 'singleton' }}
        />
      );

      expect(screen.getByText('Host')).toBeInTheDocument();
      expect(screen.getByText('Port')).toBeInTheDocument();
      expect(screen.getByText('Protocol')).toBeInTheDocument();
    });

    it('shows test connection button', () => {
      render(
        <NetworkConnectionCard
          {...defaultProps}
          config={{ ...mockConfig, mainnetMode: 'singleton' }}
        />
      );

      expect(screen.getByText('Test Connection')).toBeInTheDocument();
    });

    it('tests connection when clicking button', async () => {
      const user = userEvent.setup();
      render(
        <NetworkConnectionCard
          {...defaultProps}
          config={{ ...mockConfig, mainnetMode: 'singleton' }}
        />
      );

      await user.click(screen.getByText('Test Connection'));

      expect(defaultProps.onTestConnection).toHaveBeenCalledWith(
        'electrum.blockstream.info',
        50002,
        true
      );
    });

    it('shows success message after successful test', async () => {
      const user = userEvent.setup();
      render(
        <NetworkConnectionCard
          {...defaultProps}
          config={{ ...mockConfig, mainnetMode: 'singleton' }}
        />
      );

      await user.click(screen.getByText('Test Connection'));

      await waitFor(() => {
        expect(screen.getByText('Connected successfully')).toBeInTheDocument();
      });
    });

    it('shows preset buttons', () => {
      render(
        <NetworkConnectionCard
          {...defaultProps}
          config={{ ...mockConfig, mainnetMode: 'singleton' }}
        />
      );

      expect(screen.getByText('Quick Presets')).toBeInTheDocument();
      expect(screen.getByText('Blockstream (SSL)')).toBeInTheDocument();
    });

    it('applies preset when clicked', async () => {
      const user = userEvent.setup();
      render(
        <NetworkConnectionCard
          {...defaultProps}
          config={{ ...mockConfig, mainnetMode: 'singleton' }}
        />
      );

      await user.click(screen.getByText('Blockstream (TCP)'));

      expect(defaultProps.onConfigChange).toHaveBeenCalledWith({
        mainnetSingletonHost: 'electrum.blockstream.info',
      });
    });

    it('toggles SSL/TCP', async () => {
      const user = userEvent.setup();
      render(
        <NetworkConnectionCard
          {...defaultProps}
          config={{ ...mockConfig, mainnetMode: 'singleton' }}
        />
      );

      await user.click(screen.getByText('TCP'));

      expect(defaultProps.onConfigChange).toHaveBeenCalledWith({
        mainnetSingletonSsl: false,
      });
    });
  });

  describe('pool mode', () => {
    it('shows server list', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      expect(screen.getByText('Pool Servers (2)')).toBeInTheDocument();
      expect(screen.getByText('Blockstream')).toBeInTheDocument();
      expect(screen.getByText('BlueWallet')).toBeInTheDocument();
    });

    it('shows server host:port', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      expect(screen.getByText('electrum.blockstream.info:50002')).toBeInTheDocument();
      expect(screen.getByText('electrum1.bluewallet.io:50001')).toBeInTheDocument();
    });

    it('shows SSL/TCP badge', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      const sslBadges = screen.getAllByText('SSL');
      const tcpBadges = screen.getAllByText('TCP');

      expect(sslBadges.length).toBeGreaterThan(0);
      expect(tcpBadges.length).toBeGreaterThan(0);
    });

    it('shows health history blocks', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      // Health blocks should be present
      const healthBlocks = document.querySelectorAll('[class*="bg-emerald"], [class*="bg-rose"]');
      expect(healthBlocks.length).toBeGreaterThan(0);
    });

    it('shows add server button', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      expect(screen.getByText('Add Server')).toBeInTheDocument();
    });

    it('opens add server form', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      await user.click(screen.getByText('Add Server'));

      await waitFor(() => {
        expect(screen.getByText('Add New Server')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('My Server')).toBeInTheDocument();
      });
    });

    it('adds new server', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      await user.click(screen.getByText('Add Server'));

      fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Test Server' } });
      fireEvent.change(screen.getByPlaceholderText('electrum.example.com'), { target: { value: 'test.example.com' } });

      const formTitle = screen.getByText('Add New Server');
      const formContainer = formTitle.closest('div')?.parentElement;
      expect(formContainer).not.toBeNull();
      const submitButton = within(formContainer as HTMLElement)
        .getAllByRole('button')
        .find(button => /Add Server|Adding/i.test(button.textContent || ''));
      expect(submitButton).toBeDefined();
      if (submitButton && !submitButton.hasAttribute('disabled')) {
        await user.click(submitButton);
      }

      await waitFor(() => {
        expect(adminApi.addElectrumServer).toHaveBeenCalledWith(
          expect.objectContaining({
            label: 'Test Server',
            host: 'test.example.com',
            network: 'mainnet',
          })
        );
      });
    });

    it('deletes server', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      const deleteButtons = screen.getAllByTitle('Delete server');
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(adminApi.deleteElectrumServer).toHaveBeenCalledWith('server-1');
      });
    });

    it('toggles server enabled state', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      const toggleButtons = screen.getAllByTitle(/Disable server|Enable server/);
      await user.click(toggleButtons[0]);

      await waitFor(() => {
        expect(adminApi.updateElectrumServer).toHaveBeenCalledWith('server-1', { enabled: false });
      });
    });

    it('moves server up in priority', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      const moveUpButtons = screen.getAllByTitle('Move up (higher priority)');
      // Second server's move up button
      await user.click(moveUpButtons[1]);

      await waitFor(() => {
        expect(adminApi.reorderElectrumServers).toHaveBeenCalled();
      });
    });

    it('tests individual server', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      const testButtons = screen.getAllByTitle('Test connection');
      await user.click(testButtons[0]);

      expect(defaultProps.onTestConnection).toHaveBeenCalledWith(
        'electrum.blockstream.info',
        50002,
        true
      );
    });

    it('edits server', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      const editButtons = screen.getAllByTitle('Edit server');
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Edit Server')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Blockstream')).toBeInTheDocument();
      });
    });
  });

  describe('advanced settings', () => {
    it('shows advanced settings toggle', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      expect(screen.getByText('Advanced Settings')).toBeInTheDocument();
    });

    it('expands advanced settings when clicked', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      await user.click(screen.getByText('Advanced Settings'));

      await waitFor(() => {
        expect(screen.getByText('Min Connections')).toBeInTheDocument();
        expect(screen.getByText('Max Connections')).toBeInTheDocument();
        expect(screen.getByText('Strategy')).toBeInTheDocument();
      });
    });

    it('updates pool min connections', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      await user.click(screen.getByText('Advanced Settings'));

      const minInput = screen.getByDisplayValue('1');
      // Select all text first, then type to replace
      await user.tripleClick(minInput);
      await user.keyboard('2');

      expect(defaultProps.onConfigChange).toHaveBeenCalledWith({
        mainnetPoolMin: 2,
      });
    });

    it('updates load balancing strategy', async () => {
      const user = userEvent.setup();
      render(<NetworkConnectionCard {...defaultProps} />);

      await user.click(screen.getByText('Advanced Settings'));

      const select = screen.getByDisplayValue('Round Robin');
      await user.selectOptions(select, 'least_connections');

      expect(defaultProps.onConfigChange).toHaveBeenCalledWith({
        mainnetPoolLoadBalancing: 'least_connections',
      });
    });
  });

  describe('empty pool state', () => {
    it('shows empty state when no servers', () => {
      render(
        <NetworkConnectionCard
          {...defaultProps}
          servers={[]}
        />
      );

      expect(screen.getByText('No servers configured')).toBeInTheDocument();
    });

    it('shows preset quick-add buttons in empty state', () => {
      render(
        <NetworkConnectionCard
          {...defaultProps}
          servers={[]}
        />
      );

      expect(screen.getByText('+ Blockstream (SSL)')).toBeInTheDocument();
    });
  });

  describe('different networks', () => {
    it('shows testnet presets for testnet network', () => {
      render(
        <NetworkConnectionCard
          {...defaultProps}
          network="testnet"
          config={{ ...mockConfig, testnetMode: 'singleton' }}
          servers={[]}
        />
      );

      expect(screen.getByText('Blockstream Testnet')).toBeInTheDocument();
    });

    it('shows signet presets for signet network', () => {
      render(
        <NetworkConnectionCard
          {...defaultProps}
          network="signet"
          config={{ ...mockConfig, signetMode: 'singleton' }}
          servers={[]}
        />
      );

      expect(screen.getByText('Mutinynet Signet')).toBeInTheDocument();
    });
  });

  describe('pool stats display', () => {
    it('shows weight for degraded servers', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      // Server 2 has 50% weight
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('shows consecutive failures', () => {
      render(<NetworkConnectionCard {...defaultProps} />);

      // Server 2 has 2 consecutive failures
      expect(screen.getByText('2 fails')).toBeInTheDocument();
    });
  });
});
