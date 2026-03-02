import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { NotificationPanel } from '../../components/NotificationPanel';
import { AppNotificationProvider, useAppNotifications } from '../../contexts/AppNotificationContext';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('lucide-react', () => {
  const makeIcon = (name: string) => (props: any) => <svg data-testid={`icon-${name}`} {...props} />;
  return {
    Bell: makeIcon('Bell'),
    X: makeIcon('X'),
    AlertTriangle: makeIcon('AlertTriangle'),
    AlertCircle: makeIcon('AlertCircle'),
    Info: makeIcon('Info'),
    FileText: makeIcon('FileText'),
    RefreshCw: makeIcon('RefreshCw'),
    Shield: makeIcon('Shield'),
    Download: makeIcon('Download'),
    Wifi: makeIcon('Wifi'),
    WifiOff: makeIcon('WifiOff'),
    Check: makeIcon('Check'),
    ChevronRight: makeIcon('ChevronRight'),
    Trash2: makeIcon('Trash2'),
  };
});

type SeedNotification = {
  type: string;
  title: string;
  severity?: 'info' | 'warning' | 'critical';
  message?: string;
  count?: number;
  actionUrl?: string;
  actionLabel?: string;
  dismissible?: boolean;
  scopeId?: string;
  createdAt?: Date;
};

const NotificationSeed: React.FC<{ notifications: SeedNotification[] }> = ({ notifications }) => {
  const ctx = useAppNotifications();

  React.useEffect(() => {
    notifications.forEach((notification) => {
      const { createdAt, ...input } = notification;
      const id = ctx.addNotification({
        scope: 'global',
        severity: 'info',
        dismissible: true,
        ...input,
      });

      if (createdAt) {
        ctx.updateNotification(id, { createdAt } as any);
      }
    });
  }, []);

  return null;
};

const renderPanel = ({
  notifications = [],
  withAnchor = false,
  onClose = vi.fn(),
}: {
  notifications?: SeedNotification[];
  withAnchor?: boolean;
  onClose?: () => void;
}) => {
  const anchorRef = withAnchor ? React.createRef<HTMLButtonElement>() : undefined;

  render(
    <AppNotificationProvider>
      {withAnchor && (
        <button ref={anchorRef} data-testid="panel-anchor">
          anchor
        </button>
      )}
      <NotificationSeed notifications={notifications} />
      <NotificationPanel
        isOpen={true}
        onClose={onClose}
        anchorRef={anchorRef as React.RefObject<HTMLElement>}
      />
    </AppNotificationProvider>
  );

  return { onClose };
};

describe('NotificationPanel branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it.each([
    ['pending_drafts', 'warning', 'icon-FileText'],
    ['sync_error', 'critical', 'icon-AlertTriangle'],
    ['sync_in_progress', 'info', 'icon-RefreshCw'],
    ['pending_signatures', 'warning', 'icon-Shield'],
    ['security_alert', 'critical', 'icon-AlertCircle'],
    ['update_available', 'info', 'icon-Download'],
    ['connection_error', 'critical', 'icon-WifiOff'],
    ['backup_reminder', 'warning', 'icon-Download'],
    ['custom_critical_type', 'critical', 'icon-AlertCircle'],
    ['custom_warning_type', 'warning', 'icon-AlertTriangle'],
    ['custom_info_type', 'info', 'icon-Info'],
  ] as const)('maps %s (%s) to the expected icon', (type, severity, iconTestId) => {
    renderPanel({
      notifications: [
        {
          type,
          severity,
          title: `notification-${type}`,
          scopeId: `scope-${type}`,
        },
      ],
    });

    const item = screen.getByText(`notification-${type}`).closest('div.p-3');
    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByTestId(iconTestId)).toBeInTheDocument();
  });

  it('formats timestamps for minute, hour, and day branches', () => {
    const now = Date.now();

    renderPanel({
      notifications: [
        {
          type: 'minutes_ago',
          title: 'Minutes old',
          createdAt: new Date(now - 5 * 60 * 1000),
        },
        {
          type: 'hours_ago',
          title: 'Hours old',
          createdAt: new Date(now - 3 * 60 * 60 * 1000),
        },
        {
          type: 'days_ago',
          title: 'Days old',
          createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
        },
      ],
    });

    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  it('shows count badge only when count is greater than one', () => {
    renderPanel({
      notifications: [
        { type: 'count_one', title: 'Count One', count: 1 },
        { type: 'count_two', title: 'Count Two', count: 2 },
      ],
    });

    const countOneItem = screen.getByText('Count One').closest('div.p-3');
    const countTwoItem = screen.getByText('Count Two').closest('div.p-3');

    expect(countOneItem).not.toBeNull();
    expect(countTwoItem).not.toBeNull();
    expect(within(countOneItem as HTMLElement).queryByText(/^1$/)).not.toBeInTheDocument();
    expect(within(countTwoItem as HTMLElement).getByText('2')).toBeInTheDocument();
  });

  it('does not close when mousedown happens inside the panel', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    fireEvent.mouseDown(screen.getByText('Notifications'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on outside click when no anchorRef is provided', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    fireEvent.mouseDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close when clicking the anchor element', () => {
    const onClose = vi.fn();
    renderPanel({ withAnchor: true, onClose });

    fireEvent.mouseDown(screen.getByTestId('panel-anchor'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when clicking outside both panel and anchor', () => {
    const onClose = vi.fn();
    renderPanel({ withAnchor: true, onClose });

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores non-Escape key presses for close handler', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('sorts equal-severity notifications by newest date first', () => {
    const now = Date.now();

    renderPanel({
      notifications: [
        {
          type: 'warning_old',
          severity: 'warning',
          title: 'Older warning',
          createdAt: new Date(now - 2 * 60 * 60 * 1000),
        },
        {
          type: 'warning_new',
          severity: 'warning',
          title: 'Newer warning',
          createdAt: new Date(now - 10 * 60 * 1000),
        },
      ],
    });

    const titles = Array.from(document.querySelectorAll('p.text-sm.font-medium')).map((el) => el.textContent);
    expect(titles[0]).toContain('Newer warning');
    expect(titles[1]).toContain('Older warning');
  });

  it('covers action-label button callback navigation path', async () => {
    const onClose = vi.fn();
    renderPanel({
      onClose,
      notifications: [
        {
          type: 'action-item',
          severity: 'warning',
          title: 'Needs attention',
          actionLabel: 'Open Wallet',
          actionUrl: '/wallets/w1',
        },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open Wallet' }));

    expect(onClose).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/wallets/w1', {
        state: { activeTab: 'drafts' },
      });
    });
  });
});
