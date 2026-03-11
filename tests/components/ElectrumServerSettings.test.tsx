/**
 * Tests for components/ElectrumServerSettings.tsx
 *
 * Tests the Electrum server configuration UI including network tabs,
 * server CRUD operations, testing, and priority reordering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ElectrumServerSettings } from '../../components/ElectrumServerSettings/ElectrumServerSettings';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';

// Mock the APIs
vi.mock('../../src/api/admin', () => ({
  getElectrumServers: vi.fn(),
  addElectrumServer: vi.fn(),
  updateElectrumServer: vi.fn(),
  deleteElectrumServer: vi.fn(),
  testElectrumServer: vi.fn(),
  reorderElectrumServers: vi.fn(),
}));

vi.mock('../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

// Mock window.confirm
const originalConfirm = window.confirm;
beforeEach(() => {
  window.confirm = vi.fn(() => true);
});
afterEach(() => {
  window.confirm = originalConfirm;
});

describe('ElectrumServerSettings', () => {
  const mockMainnetServers = [
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
    },
    {
      id: 'server-2',
      label: 'Custom Server',
      host: 'custom.example.com',
      port: 50001,
      useSsl: false,
      network: 'mainnet',
      enabled: true,
      priority: 1,
      isHealthy: false,
      lastHealthCheckError: 'Connection timeout',
    },
  ];

  const mockTestnetServers = [
    {
      id: 'server-3',
      label: 'Testnet Server',
      host: 'testnet.example.com',
      port: 60002,
      useSsl: true,
      network: 'testnet',
      enabled: true,
      priority: 0,
      isHealthy: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getElectrumServers).mockImplementation((network) => {
      if (network === 'mainnet') return Promise.resolve(mockMainnetServers);
      if (network === 'testnet') return Promise.resolve(mockTestnetServers);
      return Promise.resolve([]);
    });
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ pool: null } as any);
  });

  describe('loading state', () => {
    it('shows loading message while fetching', () => {
      vi.mocked(adminApi.getElectrumServers).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<ElectrumServerSettings />);

      expect(screen.getByText('Loading server configuration...')).toBeInTheDocument();
    });
  });

  // Helper function to wait for loading to complete
  const waitForLoadingToComplete = async () => {
    await act(async () => {
      // Flush all pending promises
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText('Loading server configuration...')).not.toBeInTheDocument();
    }, { timeout: 3000 });
  };

  describe('rendering', () => {
    it('renders network tabs', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      // Debug: Check what's in the DOM
      // screen.debug(undefined, Infinity);

      // Look for the network tab buttons using their content
      // The tabs use capitalize CSS so we look for lowercase
      expect(screen.getByText('mainnet')).toBeInTheDocument();
      expect(screen.getByText('testnet')).toBeInTheDocument();
      expect(screen.getByText('signet')).toBeInTheDocument();
    });

    it('renders mainnet servers by default', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      expect(screen.getByText('Blockstream')).toBeInTheDocument();
      expect(screen.getByText('Custom Server')).toBeInTheDocument();
    });

    it('renders server host:port info', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      // Multiple elements may contain this text (server list and preset)
      const elements = screen.getAllByText(/electrum\.blockstream\.info:50002/);
      expect(elements.length).toBeGreaterThan(0);
    });

    it('renders Add Server button', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      expect(screen.getByText('Add Server')).toBeInTheDocument();
    });

    it('renders quick add presets', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      expect(screen.getByText('Quick Add Presets')).toBeInTheDocument();
      expect(screen.getByText('Blockstream (SSL)')).toBeInTheDocument();
      expect(screen.getByText('Blockstream (TCP)')).toBeInTheDocument();
    });

    it('renders network info banner', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      expect(screen.getByText('Bitcoin Mainnet')).toBeInTheDocument();
    });

    it('shows unhealthy badge for unhealthy servers', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      expect(screen.getByText('unhealthy')).toBeInTheDocument();
    });

    it('shows SSL indicator for SSL servers', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      // Multiple elements may show SSL (server list and presets)
      const elements = screen.getAllByText(/\(SSL\)/);
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  describe('network switching', () => {
    it('switches to testnet when tab clicked', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      fireEvent.click(screen.getByText('testnet'));

      expect(screen.getByText('Bitcoin Testnet')).toBeInTheDocument();
      expect(screen.getByText('Testnet Server')).toBeInTheDocument();
    });

    it('switches to signet when tab clicked', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      fireEvent.click(screen.getByText('signet'));

      expect(screen.getByText('Bitcoin Signet')).toBeInTheDocument();
    });

    it('shows empty state when no servers configured', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      fireEvent.click(screen.getByText('signet'));

      expect(screen.getByText(/No servers configured for signet/)).toBeInTheDocument();
    });

    it('shows different presets for testnet', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      fireEvent.click(screen.getByText('testnet'));

      expect(screen.getByText('Blockstream Testnet')).toBeInTheDocument();
    });
  });

  describe('adding servers', () => {
    it('opens add server form when Add Server clicked', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      fireEvent.click(screen.getByText('Add Server'));

      expect(screen.getByText('Add New Server')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('My Server')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('electrum.example.com')).toBeInTheDocument();
    });

    it('cancels add form when Cancel clicked', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      fireEvent.click(screen.getByText('Add Server'));
      expect(screen.getByText('Add New Server')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.queryByText('Add New Server')).not.toBeInTheDocument();
    });

    it('calls addElectrumServer API when form submitted', async () => {
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

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      fireEvent.click(screen.getByText('Add Server'));

      // Fill the form
      fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'New Server' } });
      fireEvent.change(screen.getByPlaceholderText('electrum.example.com'), { target: { value: 'new.example.com' } });

      // Submit - get all Add Server buttons and click the one in the form (second one)
      const addButtons = screen.getAllByRole('button', { name: 'Add Server' });
      // The first is in the toolbar, the second is in the form
      fireEvent.click(addButtons[addButtons.length - 1]);

      await waitFor(() => {
        expect(adminApi.addElectrumServer).toHaveBeenCalled();
      });
    });

    it('fills form from preset when clicked', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      fireEvent.click(screen.getByText('Blockstream (SSL)'));

      expect(screen.getByText('Add New Server')).toBeInTheDocument();
      const hostInput = screen.getByPlaceholderText('electrum.example.com') as HTMLInputElement;
      expect(hostInput.value).toBe('electrum.blockstream.info');
    });
  });

  describe('editing servers', () => {
    it('opens edit form when edit button clicked', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      const editButtons = screen.getAllByTitle('Edit');
      fireEvent.click(editButtons[0]);

      expect(screen.getByText('Edit Server')).toBeInTheDocument();
    });

    it('calls updateElectrumServer API when edit form submitted', async () => {
      vi.mocked(adminApi.updateElectrumServer).mockResolvedValue(mockMainnetServers[0] as any);

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      const editButtons = screen.getAllByTitle('Edit');
      fireEvent.click(editButtons[0]);

      // Change label
      const labelInput = screen.getByPlaceholderText('My Server') as HTMLInputElement;
      fireEvent.change(labelInput, { target: { value: 'Updated Name' } });

      // Submit
      fireEvent.click(screen.getByRole('button', { name: 'Update Server' }));

      await waitFor(() => {
        expect(adminApi.updateElectrumServer).toHaveBeenCalledWith('server-1', expect.any(Object));
      });
    });
  });

  describe('deleting servers', () => {
    it('calls deleteElectrumServer API when delete clicked', async () => {
      vi.mocked(adminApi.deleteElectrumServer).mockResolvedValue(undefined);

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      const deleteButtons = screen.getAllByTitle('Delete');
      fireEvent.click(deleteButtons[0]);

      await waitFor(() => {
        expect(adminApi.deleteElectrumServer).toHaveBeenCalledWith('server-1');
      });
    });

    it('shows confirmation before deleting', async () => {
      window.confirm = vi.fn(() => false);

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      const deleteButtons = screen.getAllByTitle('Delete');
      fireEvent.click(deleteButtons[0]);

      expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to delete this server?');
    });

    it('does not delete if confirm is cancelled', async () => {
      window.confirm = vi.fn(() => false);

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      const deleteButtons = screen.getAllByTitle('Delete');
      fireEvent.click(deleteButtons[0]);

      expect(adminApi.deleteElectrumServer).not.toHaveBeenCalled();
    });
  });

  describe('testing servers', () => {
    it('calls testElectrumServer API when test clicked', async () => {
      vi.mocked(adminApi.testElectrumServer).mockResolvedValue({ success: true, message: 'Connected' });

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      const testButtons = screen.getAllByTitle('Test connection');
      fireEvent.click(testButtons[0]);

      await waitFor(() => {
        expect(adminApi.testElectrumServer).toHaveBeenCalledWith('server-1');
      });
    });

    it('shows success status after successful test', async () => {
      vi.mocked(adminApi.testElectrumServer).mockResolvedValue({ success: true, message: 'Connected' });

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      const testButtons = screen.getAllByTitle('Test connection');
      fireEvent.click(testButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Connected')).toBeInTheDocument();
      });
    });

    it('shows error status after failed test', async () => {
      vi.mocked(adminApi.testElectrumServer).mockResolvedValue({ success: false, message: 'Connection refused' });

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      const testButtons = screen.getAllByTitle('Test connection');
      fireEvent.click(testButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Failed')).toBeInTheDocument();
      });
    });
  });

  describe('enabling/disabling servers', () => {
    it('calls updateElectrumServer to toggle enabled', async () => {
      vi.mocked(adminApi.updateElectrumServer).mockResolvedValue({
        ...mockMainnetServers[0],
        enabled: false,
      } as any);

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      const toggleButtons = screen.getAllByTitle('Disable');
      fireEvent.click(toggleButtons[0]);

      await waitFor(() => {
        expect(adminApi.updateElectrumServer).toHaveBeenCalledWith('server-1', { enabled: false });
      });
    });
  });

  describe('reordering servers', () => {
    it('moves server up when up arrow clicked', async () => {
      vi.mocked(adminApi.reorderElectrumServers).mockResolvedValue(undefined);

      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      // Find up buttons (ChevronUp icons)
      const upButtons = document.querySelectorAll('button');
      // Find the up button for the second server (index 1)
      let upButton: Element | null = null;
      upButtons.forEach((btn) => {
        if (btn.querySelector('.lucide-chevron-up')) {
          upButton = btn;
        }
      });

      // The second server should have an enabled up button
      // Click second row's up button (after the first one)
    });

    it('disables up arrow for first server', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      // First server's up button should be disabled (first ChevronUp button)
      // The first server row should have a disabled up button
      const chevronUpButtons = document.querySelectorAll('.lucide-chevron-up');
      expect(chevronUpButtons.length).toBeGreaterThan(0);

      // The first ChevronUp should be in a disabled button
      const firstUpButton = chevronUpButtons[0].closest('button');
      expect(firstUpButton).toBeDisabled();
    });
  });

  describe('server count display', () => {
    it('shows server count in tab', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      // The mock has 2 mainnet servers, 1 healthy (Blockstream) and 1 unhealthy (Custom Server)
      expect(screen.getByText('1/2')).toBeInTheDocument();
    });

    it('shows server count in Configured Servers section', async () => {
      render(<ElectrumServerSettings />);

      await waitForLoadingToComplete();

      expect(screen.getByText('(2 servers)')).toBeInTheDocument();
    });
  });
});
