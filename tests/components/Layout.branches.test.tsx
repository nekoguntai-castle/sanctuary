import { act,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { Layout } from '../../components/Layout/Layout';
import * as AppNotificationContext from '../../contexts/AppNotificationContext';
import * as UserContext from '../../contexts/UserContext';
import * as useDevicesHooks from '../../hooks/queries/useDevices';
import * as useWalletsHooks from '../../hooks/queries/useWallets';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import * as draftsApi from '../../src/api/drafts';

vi.mock('../../contexts/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('../../contexts/AppNotificationContext', () => ({
  useAppNotifications: vi.fn(),
}));

vi.mock('../../hooks/queries/useWallets', () => ({
  useWallets: vi.fn(),
}));

vi.mock('../../hooks/queries/useDevices', () => ({
  useDevices: vi.fn(),
}));

vi.mock('../../hooks/useAppCapabilities', () => ({
  useAppCapabilities: vi.fn(() => ({ intelligence: false })),
}));

vi.mock('../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../src/api/admin', () => ({
  checkVersion: vi.fn(),
}));

vi.mock('../../src/api/drafts', () => ({
  getDrafts: vi.fn(),
}));

vi.mock('../../utils/errorHandler', () => ({
  logError: vi.fn(),
}));

vi.mock('../../components/Layout/SidebarContent', () => ({
  SidebarContent: ({
    onVersionClick,
    toggleSection,
    toggleTheme,
    logout,
  }: {
    onVersionClick: () => void;
    toggleSection: (section: 'wallets' | 'devices' | 'admin') => void;
    toggleTheme: () => void;
    logout: () => void;
  }) => (
    <div data-testid="sidebar-content">
      <button onClick={() => toggleSection('wallets')}>toggle-wallets</button>
      <button onClick={() => toggleSection('devices')}>toggle-devices</button>
      <button onClick={() => toggleSection('admin')}>toggle-admin</button>
      <button onClick={toggleTheme}>theme-toggle</button>
      <button onClick={logout}>logout-button</button>
      <button onClick={onVersionClick}>version-click</button>
    </div>
  ),
}));

vi.mock('../../components/Layout/AboutModal', () => ({
  AboutModal: ({
    show,
    onClose,
    copiedAddress,
    onCopyAddress,
  }: {
    show: boolean;
    onClose: () => void;
    copiedAddress: string | null;
    onCopyAddress: (text: string, type: string) => void;
  }) =>
    show ? (
      <div data-testid="about-modal">
        <button onClick={onClose}>close-modal</button>
        <button onClick={() => onCopyAddress('bc1q-test-address', 'btc')}>copy-btc</button>
        <span data-testid="copied-address">{copiedAddress ?? 'none'}</span>
      </div>
    ) : null,
}));

describe('Layout branch coverage', () => {
  const baseUser = {
    id: 'user-1',
    username: 'testuser',
    isAdmin: false,
    usingDefaultPassword: false,
  };

  const wallets = [
    { id: 'wallet-1', name: 'Alpha Wallet', type: 'native_segwit', balance: 1000 },
    { id: 'wallet-2', name: 'Beta Wallet', type: 'taproot', balance: 2000 },
  ];

  const addNotification = vi.fn();
  const removeNotificationsByType = vi.fn();
  const toggleTheme = vi.fn();
  const logout = vi.fn();

  const renderLayout = (path = '/') =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Layout darkMode={false} toggleTheme={toggleTheme} onLogout={logout}>
          <div>content</div>
        </Layout>
      </MemoryRouter>
    );

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(UserContext.useUser).mockReturnValue({
      user: baseUser,
      logout,
      isLoading: false,
    } as any);

    vi.mocked(AppNotificationContext.useAppNotifications).mockReturnValue({
      getWalletCount: vi.fn().mockReturnValue(0),
      getDeviceCount: vi.fn().mockReturnValue(0),
      addNotification,
      removeNotificationsByType,
    } as any);

    vi.mocked(useWalletsHooks.useWallets).mockReturnValue({
      data: wallets,
    } as any);

    vi.mocked(useDevicesHooks.useDevices).mockReturnValue({
      data: [{ id: 'device-1', label: 'Device', type: 'ledger' }],
    } as any);

    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      connected: true,
      blockHeight: 100,
    } as any);

    vi.mocked(adminApi.checkVersion).mockResolvedValue({
      version: '1.0.0',
      latestVersion: '1.0.0',
      updateAvailable: false,
    } as any);

    vi.mocked(draftsApi.getDrafts).mockResolvedValue([]);

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns early when user is null for drafts and connection checks', async () => {
    vi.mocked(UserContext.useUser).mockReturnValue({
      user: null,
      logout,
      isLoading: false,
    } as any);

    renderLayout();

    await waitFor(() => {
      expect(draftsApi.getDrafts).not.toHaveBeenCalled();
      expect(bitcoinApi.getStatus).not.toHaveBeenCalled();
    });
  });

  it('handles draft pluralization and wallet-level cleanup branches', async () => {
    vi.mocked(draftsApi.getDrafts)
      .mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }] as any)
      .mockResolvedValueOnce([] as any);

    renderLayout();

    await waitFor(() => {
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pending_drafts',
          scopeId: 'wallet-1',
          title: '2 pending drafts',
        })
      );
      expect(removeNotificationsByType).toHaveBeenCalledWith('pending_drafts', 'wallet-2');
    });
  });

  it('continues processing remaining wallets when draft fetch fails for one wallet', async () => {
    vi.mocked(draftsApi.getDrafts)
      .mockRejectedValueOnce(new Error('draft fetch failed'))
      .mockResolvedValueOnce([]);

    renderLayout();

    await waitFor(() => {
      expect(draftsApi.getDrafts).toHaveBeenCalledTimes(2);
      expect(removeNotificationsByType).toHaveBeenCalledWith('pending_drafts', 'wallet-2');
    });
  });

  it('uses fallback message and no admin action for disconnected non-admin status', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      connected: false,
      error: '',
    } as any);

    renderLayout();

    await waitFor(() => {
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connection_error',
          message: 'Unable to connect to blockchain. Wallet data may be outdated.',
        })
      );
    });

    const call = addNotification.mock.calls.find(
      ([payload]) => payload?.type === 'connection_error'
    )?.[0];
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty('actionUrl');
    expect(call).not.toHaveProperty('actionLabel');
  });

  it('adds admin action for disconnected admin status', async () => {
    vi.mocked(UserContext.useUser).mockReturnValue({
      user: { ...baseUser, isAdmin: true },
      logout,
      isLoading: false,
    } as any);
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      connected: false,
      error: 'node offline',
    } as any);

    renderLayout();

    await waitFor(() => {
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connection_error',
          actionUrl: '/admin/node',
          actionLabel: 'Configure Node',
        })
      );
    });
  });

  it('adds admin action when getStatus throws for admin user', async () => {
    vi.mocked(UserContext.useUser).mockReturnValue({
      user: { ...baseUser, isAdmin: true },
      logout,
      isLoading: false,
    } as any);
    vi.mocked(bitcoinApi.getStatus).mockRejectedValue(new Error('status failed'));

    renderLayout();

    await waitFor(() => {
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connection_error',
          actionUrl: '/admin/node',
          actionLabel: 'Configure Node',
        })
      );
    });
  });

  it('omits admin action when getStatus throws for non-admin user', async () => {
    vi.mocked(bitcoinApi.getStatus).mockRejectedValue(new Error('status failed'));

    renderLayout();

    await waitFor(() => {
      expect(addNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'connection_error',
        })
      );
    });

    const call = addNotification.mock.calls.find(
      ([payload]) => payload?.type === 'connection_error'
    )?.[0];
    expect(call).toBeDefined();
    expect(call).not.toHaveProperty('actionUrl');
    expect(call).not.toHaveProperty('actionLabel');
  });

  it('fetches version info only on first version click and supports close callback', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByText('version-click'));
    await waitFor(() => {
      expect(adminApi.checkVersion).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('about-modal')).toBeInTheDocument();
    });

    await user.click(screen.getByText('close-modal'));
    await waitFor(() => {
      expect(screen.queryByTestId('about-modal')).not.toBeInTheDocument();
    });

    await user.click(screen.getByText('version-click'));
    await waitFor(() => {
      expect(adminApi.checkVersion).toHaveBeenCalledTimes(1);
    });
  });

  it('handles version check failure branch', async () => {
    const user = userEvent.setup();
    vi.mocked(adminApi.checkVersion).mockRejectedValue(new Error('version failed'));
    renderLayout();

    await user.click(screen.getByText('version-click'));
    await waitFor(() => {
      expect(adminApi.checkVersion).toHaveBeenCalledTimes(1);
    });
  });

  it('handles clipboard success path', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const timeoutCallbacks: Array<() => void> = [];
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: TimerHandler, ms?: number) => {
        if (typeof cb === 'function' && ms === 2000) {
          timeoutCallbacks.push(cb as () => void);
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeout(cb, ms);
      }) as typeof setTimeout);

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderLayout();

    await user.click(screen.getByText('version-click'));
    await user.click(screen.getByText('copy-btc'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('bc1q-test-address');
      expect(screen.getByTestId('copied-address')).toHaveTextContent('btc');
    });

    expect(timeoutCallbacks.length).toBeGreaterThan(0);
    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });
    expect(screen.getByTestId('copied-address')).toHaveTextContent('none');

    setTimeoutSpy.mockRestore();
  });

  it('handles clipboard failure path', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('copy failed'));
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderLayout();

    await user.click(screen.getByText('version-click'));
    await user.click(screen.getByText('copy-btc'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('bc1q-test-address');
      expect(screen.getByTestId('copied-address')).toHaveTextContent('none');
    });
  });

  it('toggles mobile overlay and closes it through backdrop click', async () => {
    const user = userEvent.setup();
    const { container } = renderLayout();

    const mobileToggle = screen.getByRole('button', { name: /open sidebar/i });
    await user.click(mobileToggle);

    const overlay = container.querySelector('.bg-black\\/50');
    expect(overlay).toBeInTheDocument();

    if (!overlay) throw new Error('Expected overlay to exist');
    await user.click(overlay);

    await waitFor(() => {
      expect(container.querySelector('.bg-black\\/50')).not.toBeInTheDocument();
    });
  });

  it('shows default password banner only for admin user with default password', () => {
    vi.mocked(UserContext.useUser).mockReturnValue({
      user: { ...baseUser, isAdmin: true, usingDefaultPassword: true },
      logout,
      isLoading: false,
    } as any);

    renderLayout();

    expect(
      screen.getByText('Security Warning: You are using the default password.')
    ).toBeInTheDocument();
  });
});
