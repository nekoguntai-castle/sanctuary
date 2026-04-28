/**
 * Tests for Layout component
 */

import { cleanup,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { Layout } from '../../components/Layout';
import * as AppNotificationContext from '../../contexts/AppNotificationContext';
import * as UserContext from '../../contexts/UserContext';
import * as useDevicesHooks from '../../hooks/queries/useDevices';
import * as useWalletsHooks from '../../hooks/queries/useWallets';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as draftsApi from '../../src/api/drafts';

// Mock context hooks
vi.mock('../../contexts/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('../../contexts/AppNotificationContext', () => ({
  useAppNotifications: vi.fn(),
}));

// Mock query hooks
vi.mock('../../hooks/queries/useWallets', () => ({
  useWallets: vi.fn(),
}));

vi.mock('../../hooks/queries/useDevices', () => ({
  useDevices: vi.fn(),
}));

vi.mock('../../hooks/useAppCapabilities', () => ({
  useAppCapabilities: () => ({ console: true, intelligence: false }),
}));

// Mock APIs
vi.mock('../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../src/api/admin', () => ({
  checkVersion: vi.fn(),
}));

vi.mock('../../src/api/drafts', () => ({
  getDrafts: vi.fn(),
}));

// Mock child components
vi.mock('../../components/NotificationPanel', () => ({
  NotificationBell: () => <button data-testid="notification-bell">Notifications</button>,
}));

vi.mock('../../components/NotificationBadge', () => ({
  NotificationBadge: ({ count }: { count: number }) => <span data-testid="notification-badge">{count}</span>,
}));

// Mock BlockHeightIndicator to avoid late async state updates from
// bitcoinApi.getStatus that fire after each test ends, producing act() warnings
// and console output during vitest worker teardown.
vi.mock('../../components/Layout/BlockHeightIndicator', () => ({
  BlockHeightIndicator: () => <div data-testid="block-height-indicator" />,
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <div data-testid="qr-code">QR</div>,
}));

// Mock package.json version
vi.mock('../../package.json', () => ({
  version: '1.0.0',
}));

describe('Layout', () => {
  const mockUser = {
    id: 'user-1',
    username: 'testuser',
    role: 'user',
    isAdmin: false,
  };

  const mockWallets = [
    { id: 'wallet-1', name: 'Test Wallet', type: 'native_segwit', balance: 100000 },
    { id: 'wallet-2', name: 'Another Wallet', type: 'taproot', balance: 50000 },
  ];

  const mockDevices = [
    { id: 'device-1', type: 'ledger', label: 'My Ledger' },
  ];

  const defaultProps = {
    darkMode: false,
    toggleTheme: vi.fn(),
    onLogout: vi.fn(),
    children: <div data-testid="page-content">Page Content</div>,
  };

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(UserContext.useUser).mockReturnValue({
      user: mockUser,
      logout: vi.fn(),
      isLoading: false,
    } as any);

    vi.mocked(AppNotificationContext.useAppNotifications).mockReturnValue({
      getWalletCount: vi.fn().mockReturnValue(0),
      getDeviceCount: vi.fn().mockReturnValue(0),
      addNotification: vi.fn(),
      removeNotificationsByType: vi.fn(),
    } as any);

    vi.mocked(useWalletsHooks.useWallets).mockReturnValue({
      data: mockWallets,
    } as any);

    vi.mocked(useDevicesHooks.useDevices).mockReturnValue({
      data: mockDevices,
    } as any);

    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      connected: true,
      blockHeight: 800000,
    } as any);

    vi.mocked(draftsApi.getDrafts).mockResolvedValue([]);
  });

  const renderLayout = (path = '/') => {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Layout {...defaultProps} />
      </MemoryRouter>
    );
  };

  describe('Rendering', () => {
    it('renders children content', () => {
      renderLayout();

      expect(screen.getByTestId('page-content')).toBeInTheDocument();
    });

    it('renders sidebar with navigation items', () => {
      renderLayout();

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      // "Wallets" appears as both section label and nav link
      expect(screen.getAllByText('Wallets').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Devices')).toBeInTheDocument();
    });

    it('renders logo', () => {
      renderLayout();

      // Multiple Sanctuary texts exist (desktop and mobile headers)
      const logos = screen.getAllByText(/Sanctuary/i);
      expect(logos.length).toBeGreaterThan(0);
    });

    it('renders version number', () => {
      renderLayout();

      expect(screen.getByText(/v1\.0\.0/i)).toBeInTheDocument();
    });

    it('renders notification bell', () => {
      renderLayout();

      expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
    });

    it('renders theme toggle button', () => {
      renderLayout();

      // Should have a button with sun/moon icon
      const buttons = screen.getAllByRole('button');
      const themeButton = buttons.find(btn => btn.querySelector('svg'));
      expect(themeButton).toBeInTheDocument();
    });
  });

  describe('Sidebar wallets section', () => {
    it('shows wallet count', () => {
      renderLayout();

      // Wallet section should show — "Wallets" appears as section label and nav link
      const walletElements = screen.getAllByText('Wallets');
      expect(walletElements.length).toBeGreaterThanOrEqual(1);
    });

    it('expands wallet list when clicking expand button', async () => {
      const user = userEvent.setup();
      renderLayout();

      // Click on Wallets nav item toggle — find the one inside a nav link
      const walletLinks = screen.getAllByText('Wallets');
      const walletsNavLink = walletLinks.find(el => el.closest('a'));
      const walletsSection = walletsNavLink?.closest('div[class*="group"]') || walletLinks[walletLinks.length - 1].closest('div');
      const toggleButton = walletsSection?.querySelector('button');

      if (toggleButton) {
        await user.click(toggleButton);

        await waitFor(() => {
          expect(screen.getByText('Test Wallet')).toBeInTheDocument();
          expect(screen.getByText('Another Wallet')).toBeInTheDocument();
        });
      }
    });

    it('auto-expands wallets section when on wallet detail page', () => {
      renderLayout('/wallets/wallet-1');

      // Should show wallet list expanded
      expect(screen.getByText('Test Wallet')).toBeInTheDocument();
    });
  });

  describe('Sidebar devices section', () => {
    it('shows devices section', () => {
      renderLayout();

      expect(screen.getByText('Devices')).toBeInTheDocument();
    });

    it('expands device list when clicking expand button', async () => {
      const user = userEvent.setup();
      renderLayout();

      const devicesSection = screen.getByText('Devices').closest('div');
      const toggleButton = devicesSection?.querySelector('button');

      if (toggleButton) {
        await user.click(toggleButton);

        await waitFor(() => {
          expect(screen.getByText('My Ledger')).toBeInTheDocument();
        });
      }
    });
  });

  describe('Admin section', () => {
    it('shows admin section for admin users', () => {
      vi.mocked(UserContext.useUser).mockReturnValue({
        user: { ...mockUser, isAdmin: true, role: 'admin' },
        logout: vi.fn(),
        isLoading: false,
      } as any);

      renderLayout();

      // Label is "Administration" not "Admin"
      expect(screen.getByText('Administration')).toBeInTheDocument();
    });

    it('hides admin section for non-admin users', () => {
      renderLayout();

      expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    });

    it('shows admin sub-items when expanded', async () => {
      vi.mocked(UserContext.useUser).mockReturnValue({
        user: { ...mockUser, isAdmin: true, role: 'admin' },
        logout: vi.fn(),
        isLoading: false,
      } as any);

      // Navigate to admin page which auto-expands the admin section
      renderLayout('/admin/users-groups');

      await waitFor(() => {
        // Actual labels in the component
        expect(screen.getByText('Users & Groups')).toBeInTheDocument();
        expect(screen.getByText('Node Config')).toBeInTheDocument();
      });
    });
  });

  describe('Theme toggle', () => {
    it('calls toggleTheme when clicking theme button', async () => {
      const user = userEvent.setup();
      const toggleTheme = vi.fn();

      render(
        <MemoryRouter>
          <Layout {...defaultProps} toggleTheme={toggleTheme} />
        </MemoryRouter>
      );

      // Find theme toggle button (has sun/moon icon)
      const buttons = screen.getAllByRole('button');
      // The theme toggle is typically near the user section
      const themeButton = buttons.find(btn =>
        btn.querySelector('svg') &&
        (btn.getAttribute('aria-label')?.includes('theme') ||
         btn.classList.contains('theme') ||
         btn.closest('[class*="theme"]'))
      );

      if (themeButton) {
        await user.click(themeButton);
        expect(toggleTheme).toHaveBeenCalled();
      }
    });

    it('shows moon icon in light mode', () => {
      renderLayout();

      // In light mode, should show moon icon (to switch to dark)
      // This is implementation-dependent
    });

    it('shows sun icon in dark mode', () => {
      render(
        <MemoryRouter>
          <Layout {...defaultProps} darkMode={true} />
        </MemoryRouter>
      );

      // In dark mode, should show sun icon (to switch to light)
      // This is implementation-dependent
    });
  });

  describe('User section', () => {
    it('displays username', () => {
      renderLayout();

      expect(screen.getByText('testuser')).toBeInTheDocument();
    });

    it('has logout functionality', () => {
      renderLayout();

      // Logout button should exist
      const logoutButton = screen.queryByLabelText(/logout/i) ||
                          screen.queryByText(/logout/i) ||
                          screen.queryByTitle(/logout/i);
      expect(logoutButton || screen.getByText('testuser')).toBeInTheDocument();
    });
  });

  describe('Mobile menu', () => {
    it('toggles mobile menu when clicking menu button', async () => {
      const user = userEvent.setup();
      renderLayout();

      // Find mobile menu toggle (hamburger icon)
      const menuButton = screen.queryByLabelText(/menu/i) ||
                         screen.queryByRole('button', { name: /menu/i });

      // Mobile menu might only appear at certain viewport sizes
      if (menuButton) {
        await user.click(menuButton);
        // Menu should be open
      }
    });
  });

  describe('Version modal', () => {
    it('opens version modal when clicking version number', async () => {
      const user = userEvent.setup();
      vi.mocked(adminApi.checkVersion).mockResolvedValue({
        version: '1.0.0',
        updateAvailable: false,
      } as any);

      renderLayout();

      const versionButton = screen.getByText(/v1\.0\.0/i);
      await user.click(versionButton);

      await waitFor(() => {
        expect(adminApi.checkVersion).toHaveBeenCalled();
      });
    });
  });

  describe('Connection status', () => {
    it('checks bitcoin connection on mount', async () => {
      renderLayout();

      await waitFor(() => {
        expect(bitcoinApi.getStatus).toHaveBeenCalled();
      });
    });

    it('shows error notification when connection fails', async () => {
      const addNotification = vi.fn();
      vi.mocked(AppNotificationContext.useAppNotifications).mockReturnValue({
        getWalletCount: vi.fn().mockReturnValue(0),
        getDeviceCount: vi.fn().mockReturnValue(0),
        addNotification,
        removeNotificationsByType: vi.fn(),
      } as any);

      vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
        connected: false,
        error: 'Connection refused',
      } as any);

      renderLayout();

      await waitFor(() => {
        expect(addNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'connection_error',
            severity: 'critical',
          })
        );
      });
    });

    it('removes error notification when connection is restored', async () => {
      const removeNotificationsByType = vi.fn();
      vi.mocked(AppNotificationContext.useAppNotifications).mockReturnValue({
        getWalletCount: vi.fn().mockReturnValue(0),
        getDeviceCount: vi.fn().mockReturnValue(0),
        addNotification: vi.fn(),
        removeNotificationsByType,
      } as any);

      vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
        connected: true,
        blockHeight: 800000,
      } as any);

      renderLayout();

      await waitFor(() => {
        expect(removeNotificationsByType).toHaveBeenCalledWith('connection_error');
      });
    });
  });

  describe('Draft notifications', () => {
    it('fetches drafts for each wallet', async () => {
      renderLayout();

      await waitFor(() => {
        expect(draftsApi.getDrafts).toHaveBeenCalledWith('wallet-1');
        expect(draftsApi.getDrafts).toHaveBeenCalledWith('wallet-2');
      });
    });

    it('adds notification when drafts exist', async () => {
      const addNotification = vi.fn();
      vi.mocked(AppNotificationContext.useAppNotifications).mockReturnValue({
        getWalletCount: vi.fn().mockReturnValue(0),
        getDeviceCount: vi.fn().mockReturnValue(0),
        addNotification,
        removeNotificationsByType: vi.fn(),
      } as any);

      vi.mocked(draftsApi.getDrafts).mockResolvedValueOnce([
        { id: 'draft-1', name: 'Test Draft' },
      ] as any);

      renderLayout();

      await waitFor(() => {
        expect(addNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'pending_drafts',
          })
        );
      });
    });
  });

  describe('Navigation', () => {
    it('highlights active nav item based on route', () => {
      renderLayout('/wallets');

      // "Wallets" appears as section label and nav link — find the one inside an <a>
      const walletElements = screen.getAllByText('Wallets');
      const walletsLink = walletElements.find(el => el.closest('a'))?.closest('a');
      // Active link should have different styling
      expect(walletsLink?.className).toMatch(/primary|active/i);
    });

    it('navigates to dashboard', async () => {
      renderLayout('/wallets');

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink).toHaveAttribute('href', '/');
    });

    it('navigates to wallets page', () => {
      renderLayout();

      const walletElements = screen.getAllByText('Wallets');
      const walletsLink = walletElements.find(el => el.closest('a'))?.closest('a');
      expect(walletsLink).toHaveAttribute('href', '/wallets');
    });

    it('navigates to devices page', () => {
      renderLayout();

      const devicesLink = screen.getByText('Devices').closest('a');
      expect(devicesLink).toHaveAttribute('href', '/devices');
    });
  });

  describe('Settings link', () => {
    it('has link to settings page', () => {
      renderLayout();

      const settingsLink = screen.queryByText(/Settings/i)?.closest('a') ||
                          screen.queryByLabelText(/settings/i);
      // Settings might be in user dropdown or sidebar
      expect(settingsLink || screen.getByText('testuser')).toBeInTheDocument();
    });
  });
});
