/**
 * Tests for AuditLogs component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuditLogs } from '../../components/AuditLogs';
import * as adminApi from '../../src/api/admin';

// Mock API
vi.mock('../../src/api/admin', () => ({
  getAuditLogs: vi.fn(),
  getAuditLogStats: vi.fn(),
}));

describe('AuditLogs', () => {
  const mockLogs = [
    {
      id: 'log-1',
      createdAt: new Date().toISOString(),
      userId: 'user-1',
      username: 'admin',
      action: 'auth.login',
      category: 'auth',
      success: true,
      ipAddress: '192.168.1.1',
      details: { method: 'password' },
    },
    {
      id: 'log-2',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      userId: 'user-2',
      username: 'testuser',
      action: 'wallet.create',
      category: 'wallet',
      success: true,
      ipAddress: '192.168.1.2',
      details: { walletName: 'My Wallet' },
    },
    {
      id: 'log-3',
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      userId: 'user-1',
      username: 'admin',
      action: 'admin.update_settings',
      category: 'admin',
      success: false,
      ipAddress: '192.168.1.1',
      errorMsg: 'Permission denied',
    },
  ];

  const mockStats = {
    totalEvents: 150,
    failedEvents: 12,
    byCategory: {
      auth: 50,
      wallet: 40,
      device: 30,
      admin: 20,
      system: 10,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminApi.getAuditLogs).mockResolvedValue({
      logs: mockLogs,
      total: mockLogs.length,
    } as any);
    vi.mocked(adminApi.getAuditLogStats).mockResolvedValue(mockStats as any);
  });

  describe('rendering', () => {
    it('renders header', async () => {
      render(<AuditLogs />);

      expect(screen.getByText('Audit Logs')).toBeInTheDocument();
      expect(screen.getByText(/Security and activity logs/)).toBeInTheDocument();

      await waitFor(() => {
        expect(adminApi.getAuditLogs).toHaveBeenCalled();
      });
    });

    it('shows loading state initially', () => {
      vi.mocked(adminApi.getAuditLogs).mockImplementation(() => new Promise(() => {}));
      vi.mocked(adminApi.getAuditLogStats).mockImplementation(() => new Promise(() => {}));

      render(<AuditLogs />);

      // Refresh button should show loading animation
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('displays audit logs after loading', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getAllByText('admin').length).toBeGreaterThan(0);
      });

      expect(screen.getByText('testuser')).toBeInTheDocument();
    });
  });

  describe('stats display', () => {
    it('shows total events', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('150')).toBeInTheDocument();
        expect(screen.getByText('Total Events (30d)')).toBeInTheDocument();
      });
    });

    it('shows failed events count', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('Failed Events')).toBeInTheDocument();
      });
    });

    it('shows events by category', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Events by Category')).toBeInTheDocument();
        // Category badges appear in stats
        expect(screen.getAllByText('auth').length).toBeGreaterThan(0);
      });
    });
  });

  describe('filters', () => {
    it('renders filter button', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Filters')).toBeInTheDocument();
      });
    });

    it('shows filter panel when clicking Filters', async () => {
      const user = userEvent.setup();
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Filters')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Filters'));

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Filter by username...')).toBeInTheDocument();
        // Category label shows twice - once in header, once in filter
        expect(screen.getAllByText('Category').length).toBeGreaterThan(0);
      });
    });

    it('filters by username', async () => {
      const user = userEvent.setup();
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Filters')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Filters'));

      const usernameInput = screen.getByPlaceholderText('Filter by username...');
      await user.type(usernameInput, 'admin');

      // Click apply filters
      await user.click(screen.getByText('Apply Filters'));

      await waitFor(() => {
        expect(adminApi.getAuditLogs).toHaveBeenCalledWith(
          expect.objectContaining({ username: 'admin' })
        );
      });
    });

    it('applies category/action/status filters without username', async () => {
      const user = userEvent.setup();
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Filters')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Filters'));

      const categorySelect = screen.getByDisplayValue('All categories');
      await user.selectOptions(categorySelect, 'wallet');

      const actionInput = screen.getByPlaceholderText('Filter by action...');
      await user.type(actionInput, 'wallet.create');

      const statusSelect = screen.getByDisplayValue('All');
      await user.selectOptions(statusSelect, 'true');

      await user.click(screen.getByText('Apply Filters'));

      await waitFor(() => {
        expect(adminApi.getAuditLogs).toHaveBeenLastCalledWith(
          expect.objectContaining({
            category: 'wallet',
            action: 'wallet.create',
            success: true,
            limit: 25,
            offset: 0,
          })
        );
      });

      const latestQuery = vi.mocked(adminApi.getAuditLogs).mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(latestQuery).not.toHaveProperty('username');
    });

    it('clears filters', async () => {
      const user = userEvent.setup();
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Filters')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Filters'));

      const usernameInput = screen.getByPlaceholderText('Filter by username...');
      await user.type(usernameInput, 'admin');
      await user.click(screen.getByText('Apply Filters'));

      await user.click(screen.getByText('Clear'));

      await waitFor(() => {
        expect(adminApi.getAuditLogs).toHaveBeenLastCalledWith(
          expect.objectContaining({ limit: 25, offset: 0 })
        );
      });
    });

    it('shows filter count badge when filters active', async () => {
      const user = userEvent.setup();
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Filters')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Filters'));

      const usernameInput = screen.getByPlaceholderText('Filter by username...');
      await user.type(usernameInput, 'admin');
      await user.click(screen.getByText('Apply Filters'));

      await waitFor(() => {
        // Filter count badge should show
        const badges = screen.getAllByText('1');
        expect(badges.length).toBeGreaterThan(0);
      });
    });
  });

  describe('refresh', () => {
    it('renders refresh button', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Refresh')).toBeInTheDocument();
      });
    });

    it('refreshes data when clicking refresh', async () => {
      const user = userEvent.setup();
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Refresh')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Refresh'));

      expect(adminApi.getAuditLogs).toHaveBeenCalledTimes(2);
      expect(adminApi.getAuditLogStats).toHaveBeenCalledTimes(2);
    });
  });

  describe('pagination', () => {
    it('shows pagination controls when multiple pages', async () => {
      vi.mocked(adminApi.getAuditLogs).mockResolvedValue({
        logs: mockLogs,
        total: 100,
      } as any);

      render(<AuditLogs />);

      await waitFor(() => {
        // Should show page navigation text
        expect(screen.getByText(/Page 1 of/)).toBeInTheDocument();
      });
    });

    it('does not show pagination with few items', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getAllByText('admin').length).toBeGreaterThan(0);
      });

      expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument();
    });
  });

  describe('log details', () => {
    it('shows success/failure indicators', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        // Should show success/failed text in the logs
        expect(screen.getAllByText('Success').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
      });
    });

    it('shows relative time for recent logs', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        // First log should show "just now" since it's current timestamp
        expect(screen.getByText('just now')).toBeInTheDocument();
      });
    });

    it('displays category badges', async () => {
      render(<AuditLogs />);

      await waitFor(() => {
        // Categories should be displayed
        expect(screen.getAllByText('auth').length).toBeGreaterThan(0);
      });
    });
  });

  describe('error handling', () => {
    it('shows error message when API fails', async () => {
      vi.mocked(adminApi.getAuditLogs).mockRejectedValue(new Error('Network error'));

      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('continues showing stats even if logs fail', async () => {
      vi.mocked(adminApi.getAuditLogs).mockRejectedValue(new Error('Network error'));
      vi.mocked(adminApi.getAuditLogStats).mockResolvedValue(mockStats as any);

      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getByText('150')).toBeInTheDocument();
      });
    });
  });

  describe('log detail modal', () => {
    it('opens detail modal when clicking log row', async () => {
      const user = userEvent.setup();
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getAllByText('admin').length).toBeGreaterThan(0);
      });

      const firstLogRow = screen.getAllByRole('row')[1];
      await user.click(firstLogRow);

      await waitFor(() => {
        expect(screen.getByText('Audit Log Details')).toBeInTheDocument();
      });
    });

    it('closes detail modal when clicking close button', async () => {
      const user = userEvent.setup();
      render(<AuditLogs />);

      await waitFor(() => {
        expect(screen.getAllByText('admin').length).toBeGreaterThan(0);
      });

      const firstLogRow = screen.getAllByRole('row')[1];
      await user.click(firstLogRow);

      await waitFor(() => {
        expect(screen.getByText('Audit Log Details')).toBeInTheDocument();
      });

      const modalHeader = screen.getByText('Audit Log Details').closest('.sticky');
      const closeButton = modalHeader?.querySelector('button');
      expect(closeButton).not.toBeNull();
      await user.click(closeButton as HTMLButtonElement);

      await waitFor(() => {
        expect(screen.queryByText('Audit Log Details')).not.toBeInTheDocument();
      });
    });
  });
});
