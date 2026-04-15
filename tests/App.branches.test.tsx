import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import App from '../App';

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const {
  mockUseUser,
  mockUseNotifications,
  mockGetCurrentUser,
  mockUseWebSocketQueryInvalidation,
  mockReloadCurrentDocument,
} = vi.hoisted(() => ({
  mockUseUser: vi.fn(),
  mockUseNotifications: vi.fn(),
  mockGetCurrentUser: vi.fn(),
  mockUseWebSocketQueryInvalidation: vi.fn(),
  mockReloadCurrentDocument: vi.fn(),
}));

vi.mock('../hooks/websocket', () => ({
  useWebSocketQueryInvalidation: (...args: unknown[]) => mockUseWebSocketQueryInvalidation(...args),
}));

vi.mock('../src/app/browserNavigation', () => ({
  reloadCurrentDocument: (...args: unknown[]) => mockReloadCurrentDocument(...args),
}));

vi.mock('../src/api/auth', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));

vi.mock('../contexts/UserContext', () => ({
  UserProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useUser: (...args: unknown[]) => mockUseUser(...args),
}));

vi.mock('../contexts/NotificationContext', () => ({
  NotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNotifications: (...args: unknown[]) => mockUseNotifications(...args),
}));

vi.mock('../contexts/CurrencyContext', () => ({
  CurrencyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../contexts/AppNotificationContext', () => ({
  AppNotificationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../contexts/SidebarContext', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../providers/QueryProvider', () => ({
  QueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/Layout', () => ({
  Layout: ({
    children,
    toggleTheme,
    onLogout,
  }: {
    children: React.ReactNode;
    toggleTheme: () => void;
    onLogout: () => void;
  }) => (
    <div>
      <button onClick={toggleTheme}>toggle-theme</button>
      <button onClick={onLogout}>logout</button>
      {children}
    </div>
  ),
}));

vi.mock('../components/Login', () => ({
  Login: () => <div>Login Screen</div>,
}));

vi.mock('../components/Dashboard', () => ({
  Dashboard: () => <div>Dashboard Page</div>,
}));

vi.mock('../components/WalletList', () => ({
  WalletList: () => <div>Wallet List</div>,
}));

vi.mock('../components/WalletDetail', () => ({
  WalletDetail: () => <div>Wallet Detail</div>,
}));

vi.mock('../components/send', () => ({
  SendTransactionPage: () => <div>Send Transaction Page</div>,
}));

vi.mock('../components/CreateWallet', () => ({
  CreateWallet: () => <div>Create Wallet Page</div>,
}));

vi.mock('../components/ImportWallet', () => ({
  ImportWallet: () => <div>Import Wallet Page</div>,
}));

vi.mock('../components/DeviceList', () => ({
  DeviceList: () => <div>Device List Page</div>,
}));

vi.mock('../components/DeviceDetail', () => ({
  DeviceDetail: () => <div>Device Detail Page</div>,
}));

vi.mock('../components/ConnectDevice', () => ({
  ConnectDevice: () => <div>Connect Device Page</div>,
}));

vi.mock('../components/Settings', () => ({
  Settings: () => <div>Settings Page</div>,
}));

vi.mock('../components/Account', () => ({
  Account: () => <div>Account Page</div>,
}));

vi.mock('../components/NodeConfig', () => ({
  NodeConfig: () => <div>Node Config Page</div>,
}));

vi.mock('../components/UsersGroups', () => ({
  UsersGroups: () => <div>Users Groups Page</div>,
}));

vi.mock('../components/SystemSettings', () => ({
  SystemSettings: () => <div>System Settings Page</div>,
}));

vi.mock('../components/Variables', () => ({
  Variables: () => <div>Variables Page</div>,
}));

vi.mock('../components/BackupRestore', () => ({
  BackupRestore: () => <div>Backup Restore Page</div>,
}));

vi.mock('../components/AuditLogs', () => ({
  AuditLogs: () => <div>Audit Logs Page</div>,
}));

vi.mock('../components/AISettings', () => ({
  default: () => <div>AI Settings Page</div>,
}));

vi.mock('../components/Monitoring', () => ({
  default: () => <div>Monitoring Page</div>,
}));

vi.mock('../components/FeatureFlags', () => ({
  FeatureFlags: () => <div>Feature Flags Page</div>,
}));

vi.mock('../components/Intelligence', () => ({
  Intelligence: () => <div>Intelligence Page</div>,
}));

vi.mock('../components/NotificationToast', () => ({
  NotificationContainer: ({ notifications }: { notifications: unknown[] }) => (
    <div data-testid="notification-count">{notifications.length}</div>
  ),
}));

vi.mock('../components/AnimatedBackground', () => ({
  AnimatedBackground: ({
    pattern,
    darkMode,
    opacity,
  }: {
    pattern: string;
    darkMode: boolean;
    opacity: number;
  }) => (
    <div
      data-testid="animated-background"
      data-pattern={pattern}
      data-dark-mode={String(darkMode)}
      data-opacity={String(opacity)}
    />
  ),
}));

vi.mock('../components/ChangePasswordModal', () => ({
  ChangePasswordModal: ({ onPasswordChanged }: { onPasswordChanged: () => Promise<void> }) => (
    <button
      onClick={() => {
        void onPasswordChanged().catch(() => undefined);
      }}
    >
      password-changed
    </button>
  ),
}));

describe('App branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '#/';
    mockUseNotifications.mockReturnValue({
      notifications: [{ id: 'n1' }],
      removeNotification: vi.fn(),
    });
    mockUseWebSocketQueryInvalidation.mockImplementation(() => {});
    mockGetCurrentUser.mockResolvedValue({ id: 'user-1' });
  });

  it('renders login view when unauthenticated', () => {
    mockUseUser.mockReturnValue({
      isAuthenticated: false,
      logout: vi.fn(),
      user: null,
      updatePreferences: vi.fn(),
    });

    render(<App />);

    expect(screen.getByText('Login Screen')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument();
    expect(mockUseWebSocketQueryInvalidation).toHaveBeenCalled();
  });

  it('renders authenticated app with preference fallbacks and theme toggling', async () => {
    const updatePreferences = vi.fn();
    const logout = vi.fn();
    mockUseUser.mockReturnValue({
      isAuthenticated: true,
      logout,
      user: {
        usingDefaultPassword: false,
        preferences: {},
      },
      updatePreferences,
    });

    render(<App />);

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument();
    expect(screen.queryByTestId('animated-background')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('toggle-theme'));
    expect(updatePreferences).toHaveBeenCalledWith({ darkMode: true });

    fireEvent.click(screen.getByText('logout'));
    expect(logout).toHaveBeenCalled();
    expect(screen.queryByText('password-changed')).not.toBeInTheDocument();
  });

  it('shows force-password modal and applies explicit background preferences', async () => {
    mockUseUser.mockReturnValue({
      isAuthenticated: true,
      logout: vi.fn(),
      user: {
        usingDefaultPassword: true,
        preferences: {
          darkMode: true,
          background: 'sakura-petals',
          patternOpacity: 22,
        },
      },
      updatePreferences: vi.fn(),
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('password-changed')).toBeInTheDocument();
    });

    const bg = await screen.findByTestId('animated-background');
    expect(bg.getAttribute('data-pattern')).toBe('sakura-petals');
    expect(bg.getAttribute('data-opacity')).toBe('22');
    expect(bg.getAttribute('data-dark-mode')).toBe('true');
  });

  it('still renders modal for default-password users with missing optional preferences', async () => {
    mockUseUser.mockReturnValue({
      isAuthenticated: true,
      logout: vi.fn(),
      user: {
        usingDefaultPassword: true,
        preferences: {
          darkMode: false,
        },
      },
      updatePreferences: vi.fn(),
    });

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('password-changed')).toBeInTheDocument();
    });
  });

  it('resolves all lazy routes through hash navigation', async () => {
    mockUseUser.mockReturnValue({
      isAuthenticated: true,
      logout: vi.fn(),
      user: {
        usingDefaultPassword: false,
        preferences: {},
      },
      updatePreferences: vi.fn(),
    });

    const routes: Array<{ hash: string; text: string }> = [
      { hash: '#/wallets', text: 'Wallet List' },
      { hash: '#/wallets/wallet-1', text: 'Wallet Detail' },
      { hash: '#/wallets/create', text: 'Create Wallet Page' },
      { hash: '#/wallets/import', text: 'Import Wallet Page' },
      { hash: '#/wallets/abc/send', text: 'Send Transaction Page' },
      { hash: '#/devices', text: 'Device List Page' },
      { hash: '#/devices/connect', text: 'Connect Device Page' },
      { hash: '#/devices/device-1', text: 'Device Detail Page' },
      { hash: '#/account', text: 'Account Page' },
      { hash: '#/settings', text: 'Settings Page' },
      { hash: '#/admin/node-config', text: 'Node Config Page' },
      { hash: '#/admin/users-groups', text: 'Users Groups Page' },
      { hash: '#/admin/settings', text: 'System Settings Page' },
      { hash: '#/admin/variables', text: 'Variables Page' },
      { hash: '#/admin/backup', text: 'Backup Restore Page' },
      { hash: '#/admin/audit-logs', text: 'Audit Logs Page' },
      { hash: '#/admin/ai', text: 'AI Settings Page' },
      { hash: '#/admin/monitoring', text: 'Monitoring Page' },
      { hash: '#/admin/feature-flags', text: 'Feature Flags Page' },
      { hash: '#/intelligence', text: 'Intelligence Page' },
    ];

    for (const route of routes) {
      window.location.hash = route.hash;
      const rendered = render(<App />);

      await waitFor(() => {
        expect(screen.getByText(route.text)).toBeInTheDocument();
      });

      rendered.unmount();
    }
  }, 15_000);

  it('handles password refresh success and failure during forced password change', async () => {
    const baseUser = {
      isAuthenticated: true,
      logout: vi.fn(),
      user: {
        usingDefaultPassword: true,
        preferences: {},
      },
      updatePreferences: vi.fn(),
    };

    mockUseUser.mockReturnValue(baseUser);
    mockGetCurrentUser.mockResolvedValueOnce({ id: 'updated-user' });

    const firstRender = render(<App />);
    await waitFor(() => {
      expect(screen.getByText('password-changed')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('password-changed'));

    await waitFor(() => {
      expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
      expect(mockReloadCurrentDocument).toHaveBeenCalledTimes(1);
    });
    firstRender.unmount();

    mockUseUser.mockReturnValue(baseUser);
    mockGetCurrentUser.mockRejectedValueOnce(new Error('refresh failed'));

    const secondRender = render(<App />);
    await waitFor(() => {
      expect(screen.getByText('password-changed')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('password-changed'));

    await waitFor(() => {
      expect(mockGetCurrentUser).toHaveBeenCalledTimes(2);
      expect(mockReloadCurrentDocument).toHaveBeenCalledTimes(2);
    });

    secondRender.unmount();
  });
});
