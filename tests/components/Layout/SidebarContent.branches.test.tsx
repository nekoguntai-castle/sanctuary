import { fireEvent,render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { SidebarContent } from '../../../components/Layout/SidebarContent';
import { hasRequiredCapabilities } from '../../../src/app/capabilities';

const { defaultHasRequiredCapabilities } = vi.hoisted(() => ({
  defaultHasRequiredCapabilities: (
    requiredCapabilities: readonly string[] | undefined,
    capabilities: Record<string, boolean | undefined> = {}
  ) => {
    if (!requiredCapabilities || requiredCapabilities.length === 0) {
      return true;
    }

    return requiredCapabilities.every((capability) => capabilities[capability] === true);
  },
}));

vi.mock('../../../components/Layout/NavItem', () => ({
  NavItem: ({ label, onToggle }: any) => (
    <button type="button" onClick={onToggle}>
      {label}
    </button>
  ),
}));

vi.mock('../../../components/Layout/SubNavItem', () => ({
  SubNavItem: ({ label, to, activeColorClass, badgeCount, icon }: any) => (
    <div
      data-testid="subnav-item"
      data-label={label}
      data-to={to}
      data-active={activeColorClass || ''}
      data-badge={badgeCount ?? 0}
    >
      {label}
      {icon}
    </div>
  ),
}));

vi.mock('../../../components/NotificationPanel', () => ({
  NotificationBell: () => <span data-testid="notification-bell" />,
}));

vi.mock('../../../components/Layout/BlockHeightIndicator', () => ({
  BlockHeightIndicator: () => <span data-testid="block-height-indicator" />,
}));

vi.mock('../../../components/ui/CustomIcons', () => ({
  SanctuaryLogo: ({ className }: any) => <span data-testid="logo" className={className} />,
  getWalletIcon: (_type: any, className: string) => <span data-testid="wallet-icon" data-class={className} />,
  getDeviceIcon: (_type: any, className: string) => <span data-testid="device-icon" data-class={className} />,
}));

vi.mock('../../../src/app/capabilities', () => ({
  hasRequiredCapabilities: vi.fn(defaultHasRequiredCapabilities),
}));

const buildProps = (overrides: Partial<React.ComponentProps<typeof SidebarContent>> = {}) => ({
  user: { username: 'alice', isAdmin: true },
  wallets: [],
  devices: [],
  expanded: { wallets: true, devices: true, admin: true },
  darkMode: false,
  toggleTheme: vi.fn(),
  toggleSection: vi.fn(),
  logout: vi.fn(),
  getWalletCount: vi.fn(() => 0),
  getDeviceCount: vi.fn(() => 0),
  onVersionClick: vi.fn(),
  ...overrides,
});

describe('SidebarContent branch coverage', () => {
  beforeEach(() => {
    vi.mocked(hasRequiredCapabilities).mockImplementation(defaultHasRequiredCapabilities);
  });

  it('falls back to ? when username is missing', () => {
    const props = buildProps({ user: { username: '', isAdmin: false } });
    render(<SidebarContent {...props} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('covers empty wallets/devices state and all toggle callback paths', () => {
    const props = buildProps();
    render(<SidebarContent {...props} />);

    expect(screen.getByText('No wallets created')).toBeInTheDocument();
    expect(screen.getByText('No devices connected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Administration' }));
    expect(props.toggleSection).toHaveBeenCalledWith('admin');

    fireEvent.click(screen.getByRole('button', { name: 'Wallets' }));
    expect(props.toggleSection).toHaveBeenCalledWith('wallets');

    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    expect(props.toggleSection).toHaveBeenCalledWith('devices');
  });

  it('covers wallet/device mapping with multisig and single-sig icon/class branches', () => {
    render(
      <SidebarContent
        {...buildProps({
          user: { username: 'alice', isAdmin: false },
          wallets: [
            { id: 'w-b', name: 'Beta', type: 'single_sig' },
            { id: 'w-a', name: 'Alpha', type: 'multi_sig' },
          ] as any,
          devices: [
            { id: 'd-z', label: 'Zeta Device', type: 'ColdCard Mk4' },
            { id: 'd-a', label: 'Alpha Device', type: 'Trezor' },
          ] as any,
          getWalletCount: (id: string) => (id === 'w-a' ? 3 : 1),
          getDeviceCount: (id: string) => (id === 'd-a' ? 2 : 0),
        })}
      />
    );

    const labels = screen.getAllByTestId('subnav-item').map((node) => node.getAttribute('data-label'));
    expect(labels).toEqual(['Alpha', 'Beta', 'Alpha Device', 'Zeta Device']);

    const walletIconClasses = screen
      .getAllByTestId('wallet-icon')
      .map((node) => node.getAttribute('data-class') || '');
    expect(walletIconClasses.some((value) => value.includes('text-warning-500'))).toBe(true);
    expect(walletIconClasses.some((value) => value.includes('text-success-500'))).toBe(true);

    const activeClasses = screen
      .getAllByTestId('subnav-item')
      .slice(0, 2)
      .map((node) => node.getAttribute('data-active') || '');
    expect(activeClasses.some((value) => value.includes('text-warning-700'))).toBe(true);
    expect(activeClasses.some((value) => value.includes('text-success-700'))).toBe(true);
  });

  it('renders Intelligence nav item when its required capability is available', () => {
    const props = buildProps({ capabilities: { intelligence: true } });
    render(<SidebarContent {...props} />);

    expect(screen.getByText('Intelligence')).toBeInTheDocument();
  });

  it('hides Intelligence nav item when its required capability is unavailable', () => {
    const props = buildProps({ capabilities: { intelligence: false } });
    render(<SidebarContent {...props} />);

    expect(screen.queryByText('Intelligence')).not.toBeInTheDocument();
  });

  it('hides fixed sections when capability filtering excludes them', () => {
    vi.mocked(hasRequiredCapabilities).mockReturnValue(false);

    const props = buildProps({ user: { username: 'alice', isAdmin: true } });
    render(<SidebarContent {...props} />);

    expect(screen.queryByRole('button', { name: 'Wallets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Devices' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByText('No wallets created')).not.toBeInTheDocument();
    expect(screen.queryByText('No devices connected')).not.toBeInTheDocument();
  });

  it('renders dark mode theme button title and Sun icon when darkMode is true', () => {
    const props = buildProps({ darkMode: true });
    render(<SidebarContent {...props} />);

    expect(screen.getByTitle('Switch to light mode')).toBeInTheDocument();
  });

  it('covers all wallet sync status branches', () => {
    render(
      <SidebarContent
        {...buildProps({
          wallets: [
            { id: 'w-sync', name: 'Syncing', type: 'single_sig', syncInProgress: true, lastSyncStatus: null },
            { id: 'w-done', name: 'Synced', type: 'single_sig', syncInProgress: false, lastSyncStatus: 'success' },
            { id: 'w-fail', name: 'Failed', type: 'single_sig', syncInProgress: false, lastSyncStatus: 'failed' },
          ] as any,
        })}
      />
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByText('Syncing')).toBeInTheDocument();
  });
});
