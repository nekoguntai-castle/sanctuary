import { act, fireEvent, render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import {
NotificationContainer,
NotificationToast,
generateNotificationId,
type Notification,
} from '../../components/NotificationToast';

vi.mock('lucide-react', () => ({
  X: () => <span data-testid="x-icon" />,
  ArrowDownLeft: () => <span data-testid="down-icon" />,
  ArrowUpRight: () => <span data-testid="up-icon" />,
  CheckCircle: () => <span data-testid="check-icon" />,
  TrendingUp: () => <span data-testid="trend-icon" />,
  Activity: () => <span data-testid="activity-icon" />,
}));

const baseNotification: Notification = {
  id: 'notif-1',
  type: 'transaction',
  title: 'Transaction received',
  message: '0.01 BTC received',
  duration: undefined,
  data: { type: 'received' },
};

describe('NotificationToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it('renders notification content and icon', () => {
    render(<NotificationToast notification={baseNotification} onDismiss={vi.fn()} />);
    expect(screen.getByText('Transaction received')).toBeInTheDocument();
    expect(screen.getByText('0.01 BTC received')).toBeInTheDocument();
    expect(screen.getByTestId('down-icon')).toBeInTheDocument();
  });

  it('dismisses when close button clicked', () => {
    const onDismiss = vi.fn();

    render(<NotificationToast notification={baseNotification} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledWith('notif-1');
  });

  it('auto-dismisses after duration', () => {
    const onDismiss = vi.fn();

    render(
      <NotificationToast
        notification={{ ...baseNotification, duration: 500 }}
        onDismiss={onDismiss}
      />
    );

    act(() => {
      vi.advanceTimersByTime(500);
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledWith('notif-1');
  });

  it('applies error styles', () => {
    const { container } = render(
      <NotificationToast
        notification={{ ...baseNotification, type: 'error' }}
        onDismiss={vi.fn()}
      />
    );

    expect(container.firstChild).toHaveClass('bg-rose-50');
  });
});

describe('NotificationContainer', () => {
  it('renders nothing when empty', () => {
    const { container } = render(
      <NotificationContainer notifications={[]} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders multiple toasts', () => {
    render(
      <NotificationContainer
        notifications={[baseNotification, { ...baseNotification, id: '2', title: 'Second' }]}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText('Transaction received')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('shows singular overflow when exactly one notification is hidden', () => {
    const notifications = Array.from({ length: 5 }, (_, i) => ({
      ...baseNotification,
      id: `notif-${i}`,
      title: `Notification ${i}`,
    }));
    render(<NotificationContainer notifications={notifications} onDismiss={vi.fn()} />);
    expect(screen.getByText('+1 more notification')).toBeInTheDocument();
  });

  it('shows plural overflow when multiple notifications are hidden', () => {
    const notifications = Array.from({ length: 7 }, (_, i) => ({
      ...baseNotification,
      id: `notif-${i}`,
      title: `Notification ${i}`,
    }));
    render(<NotificationContainer notifications={notifications} onDismiss={vi.fn()} />);
    expect(screen.getByText('+3 more notifications')).toBeInTheDocument();
  });
});

describe('generateNotificationId', () => {
  it('returns a unique-ish string', () => {
    const id = generateNotificationId();
    expect(id).toMatch(/^notification-\d+-[a-z0-9]+$/);
  });
});
