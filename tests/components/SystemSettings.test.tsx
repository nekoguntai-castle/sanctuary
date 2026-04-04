/**
 * Tests for SystemSettings component
 */

import { render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { SystemSettings } from '../../components/SystemSettings';
import * as adminApi from '../../src/api/admin';

// Mock API
vi.mock('../../src/api/admin', () => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
  getWebSocketStats: vi.fn(),
  downloadSupportPackage: vi.fn(),
}));

describe('SystemSettings', () => {
  const mockSettings = {
    registrationEnabled: true,
  };

  const mockWebSocketStats = {
    connections: {
      current: 5,
      max: 100,
      uniqueUsers: 3,
      maxPerUser: 10,
    },
    subscriptions: {
      total: 15,
      channels: 8,
      channelList: ['blocks', 'fees', 'wallet:abc123:utxos', 'wallet:def456:transactions'],
    },
    rateLimits: {
      maxMessagesPerSecond: 50,
      gracePeriodMs: 5000,
      gracePeriodMessageLimit: 100,
      maxSubscriptionsPerConnection: 20,
    },
    recentRateLimitEvents: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue(mockSettings as any);
    vi.mocked(adminApi.updateSystemSettings).mockResolvedValue(mockSettings as any);
    vi.mocked(adminApi.getWebSocketStats).mockResolvedValue(mockWebSocketStats as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderSystemSettings = async () => {
    render(<SystemSettings />);
    await waitFor(() => {
      expect(adminApi.getSystemSettings).toHaveBeenCalled();
    });
  };

  const openWebSocketTab = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByText('WebSocket'));
    await waitFor(() => {
      expect(adminApi.getWebSocketStats).toHaveBeenCalled();
    });
  };

  describe('rendering', () => {
    it('renders page header', async () => {
      await renderSystemSettings();

      expect(screen.getByText('System Settings')).toBeInTheDocument();
      expect(screen.getByText(/Configure system-wide settings/)).toBeInTheDocument();

      await waitFor(() => {
        expect(adminApi.getSystemSettings).toHaveBeenCalled();
      });
    });

    it('renders tab navigation', async () => {
      await renderSystemSettings();

      expect(screen.getByRole('button', { name: 'Access Control' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'WebSocket' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Support' })).toBeInTheDocument();

      await waitFor(() => {
        expect(adminApi.getSystemSettings).toHaveBeenCalled();
      });
    });

    it('shows access control tab by default', async () => {
      await renderSystemSettings();

      await waitFor(() => {
        expect(screen.getByText('Public Registration')).toBeInTheDocument();
      });
    });
  });

  describe('access control tab', () => {
    it('shows loading state initially', async () => {
      vi.mocked(adminApi.getSystemSettings).mockImplementation(() => new Promise(() => {}));
      vi.mocked(adminApi.getWebSocketStats).mockImplementation(() => new Promise(() => {}));

      render(<SystemSettings />);

      expect(screen.getByText(/Loading access control/)).toBeInTheDocument();
    });

    it('displays registration status when enabled', async () => {
      await renderSystemSettings();

      await waitFor(() => {
        expect(screen.getByText(/Public registration is enabled/)).toBeInTheDocument();
      });
    });

    it('displays registration status when disabled', async () => {
      vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
        registrationEnabled: false,
      } as any);

      await renderSystemSettings();

      await waitFor(() => {
        expect(screen.getByText(/Public registration is disabled/)).toBeInTheDocument();
      });
    });

    it('shows info about user management', async () => {
      await renderSystemSettings();

      await waitFor(() => {
        expect(screen.getByText(/About User Management/)).toBeInTheDocument();
        expect(screen.getByText(/Users & Groups/)).toBeInTheDocument();
      });
    });

    it('toggles registration setting', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await waitFor(() => {
        expect(screen.getByText('Public Registration')).toBeInTheDocument();
      });

      // Find and click toggle button
      const toggleContainer = screen.getByText('Public Registration').closest('div')?.parentElement;
      const toggleButton = toggleContainer?.querySelector('button[class*="rounded-full"]');

      if (toggleButton) {
        await user.click(toggleButton);

        await waitFor(() => {
          expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({
            registrationEnabled: false,
          });
        });
      }
    });

    it('shows success message after saving', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await waitFor(() => {
        expect(screen.getByText('Public Registration')).toBeInTheDocument();
      });

      const toggleContainer = screen.getByText('Public Registration').closest('div')?.parentElement;
      const toggleButton = toggleContainer?.querySelector('button[class*="rounded-full"]');

      if (toggleButton) {
        await user.click(toggleButton);

        await waitFor(() => {
          expect(screen.getByText(/Settings saved successfully/)).toBeInTheDocument();
        });
      }
    });

    it('shows error message when save fails', async () => {
      vi.mocked(adminApi.updateSystemSettings).mockRejectedValue(new Error('Permission denied'));

      const user = userEvent.setup();
      await renderSystemSettings();

      await waitFor(() => {
        expect(screen.getByText('Public Registration')).toBeInTheDocument();
      });

      const toggleContainer = screen.getByText('Public Registration').closest('div')?.parentElement;
      const toggleButton = toggleContainer?.querySelector('button[class*="rounded-full"]');

      if (toggleButton) {
        await user.click(toggleButton);

        await waitFor(() => {
          expect(screen.getByText(/Failed to update settings/)).toBeInTheDocument();
        });
      }
    });
  });

  describe('websocket tab', () => {
    it('switches to websocket tab when clicked', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        expect(screen.getByText('WebSocket Status')).toBeInTheDocument();
      });
    });

    it('shows connection stats', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        expect(screen.getByText('Connections')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
        expect(screen.getByText('/ 100')).toBeInTheDocument();
      });
    });

    it('shows subscription stats', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        expect(screen.getByText('Subscriptions')).toBeInTheDocument();
        expect(screen.getByText('15')).toBeInTheDocument();
        expect(screen.getByText(/8 active channels/)).toBeInTheDocument();
      });
    });

    it('shows unique users count', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        expect(screen.getByText('Unique Users Connected')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
      });
    });

    it('shows rate limit configuration', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        expect(screen.getByText('Rate Limit Configuration')).toBeInTheDocument();
        expect(screen.getByText('Messages/sec')).toBeInTheDocument();
        expect(screen.getByText('50')).toBeInTheDocument();
        expect(screen.getByText('Max per user')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument();
      });
    });

    it('shows active channels expandable section', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        expect(screen.getByText(/Active Channels/)).toBeInTheDocument();
      });
    });

    it('shows rate limit events section', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        expect(screen.getByText('Rate Limit Events')).toBeInTheDocument();
      });
    });

    it('shows rate limit events when present', async () => {
      const statsWithEvents = {
        ...mockWebSocketStats,
        recentRateLimitEvents: [
          {
            timestamp: new Date().toISOString(),
            reason: 'per_second_exceeded',
            userId: 'user-123',
            details: 'Exceeded 50 messages per second',
          },
        ],
      };

      vi.mocked(adminApi.getWebSocketStats).mockResolvedValue(statsWithEvents as any);

      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        // Badge showing count
        expect(screen.getByText('1')).toBeInTheDocument();
      });
    });

    it('shows loading state for websocket tab', async () => {
      vi.mocked(adminApi.getWebSocketStats).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(mockWebSocketStats as any), 100))
      );

      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      // Should show loading skeleton
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('shows error when websocket stats fail to load', async () => {
      vi.mocked(adminApi.getWebSocketStats).mockRejectedValue(new Error('Network error'));

      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('has refresh button', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        // Find refresh button by its SVG icon class
        const refreshIcon = document.querySelector('[class*="RefreshCw"], svg');
        expect(refreshIcon).toBeInTheDocument();
      });
    });
  });

  describe('connection progress bar', () => {
    it('shows green progress when connections low', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        // 5/100 = 5% should be green (success)
        const progressBar = document.querySelector('[class*="bg-success"]');
        expect(progressBar).toBeInTheDocument();
      });
    });

    it('shows warning progress when connections moderate', async () => {
      vi.mocked(adminApi.getWebSocketStats).mockResolvedValue({
        ...mockWebSocketStats,
        connections: { ...mockWebSocketStats.connections, current: 60 },
      } as any);

      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        // 60/100 = 60% should be warning
        const progressBar = document.querySelector('[class*="bg-warning"]');
        expect(progressBar).toBeInTheDocument();
      });
    });

    it('shows red progress when connections high', async () => {
      vi.mocked(adminApi.getWebSocketStats).mockResolvedValue({
        ...mockWebSocketStats,
        connections: { ...mockWebSocketStats.connections, current: 85 },
      } as any);

      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        // 85/100 = 85% should be rose
        const progressBar = document.querySelector('[class*="bg-rose"]');
        expect(progressBar).toBeInTheDocument();
      });
    });
  });

  describe('channel grouping', () => {
    it('groups wallet channels by wallet ID', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        // Should show wallet count
        expect(screen.getByText(/Wallets \(2\)/)).toBeInTheDocument();
      });
    });

    it('shows global channels separately', async () => {
      const user = userEvent.setup();
      await renderSystemSettings();

      await openWebSocketTab(user);

      await waitFor(() => {
        expect(screen.getByText('Global')).toBeInTheDocument();
      });
    });
  });
});
