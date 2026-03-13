import { fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import {
NotificationToast,
type Notification,
} from '../../components/NotificationToast';

vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x" />,
  ArrowDownLeft: () => <span data-testid="icon-down" />,
  ArrowUpRight: () => <span data-testid="icon-up" />,
  CheckCircle: () => <span data-testid="icon-check" />,
  TrendingUp: () => <span data-testid="icon-trending" />,
  Activity: () => <span data-testid="icon-activity" />,
  AlertTriangle: () => <span data-testid="icon-warning" />,
}));

const baseNotification: Notification = {
  id: 'toast-1',
  type: 'info',
  title: 'Title',
  message: 'Message',
};

const renderToast = (notification: Notification, onDismiss = vi.fn()) =>
  render(<NotificationToast notification={notification} onDismiss={onDismiss} />);

describe('NotificationToast branch coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    [{ type: 'transaction', data: { type: 'received' } }, 'icon-down', 'bg-primary-50'],
    [{ type: 'transaction', data: { type: 'consolidation' } }, 'icon-up', 'bg-sent-50'],
    [{ type: 'transaction', data: { type: 'sent' } }, 'icon-up', 'bg-sent-50'],
    [{ type: 'balance' }, 'icon-trending', 'surface-secondary'],
    [{ type: 'confirmation' }, 'icon-check', 'bg-success-50'],
    [{ type: 'block' }, 'icon-activity', 'surface-secondary'],
    [{ type: 'success' }, 'icon-check', 'bg-success-50'],
    [{ type: 'error' }, 'icon-x', 'bg-rose-50'],
    [{ type: 'warning' }, 'icon-warning', 'bg-amber-50'],
    [{ type: 'info' }, 'icon-activity', 'surface-secondary'],
  ] as const)(
    'renders expected icon/colors for %o',
    (partial, expectedIconTestId, expectedClass) => {
      renderToast({ ...baseNotification, ...partial } as Notification);

      expect(screen.queryAllByTestId(expectedIconTestId).length).toBeGreaterThan(0);
      expect(screen.getByRole('alert')).toHaveClass(expectedClass);
    }
  );

  it('clears previous exit timeout on repeated dismiss', () => {
    const onDismiss = vi.fn();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    renderToast(baseNotification, onDismiss);

    const dismiss = screen.getByRole('button', { name: /dismiss notification/i });
    fireEvent.click(dismiss);
    fireEvent.click(dismiss);

    expect(clearTimeoutSpy).toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('toast-1');
  });

  it('cleans up auto-dismiss timer on unmount', () => {
    const onDismiss = vi.fn();
    const { unmount } = renderToast(
      { ...baseNotification, duration: 500, type: 'success' },
      onDismiss
    );

    vi.advanceTimersByTime(200);
    unmount();
    vi.advanceTimersByTime(1000);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('cleans up exit timeout on unmount after manual dismiss', () => {
    const onDismiss = vi.fn();
    const { unmount } = renderToast(baseNotification, onDismiss);

    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));
    unmount();
    vi.advanceTimersByTime(1000);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
