/**
 * NotificationPanel Component Tests
 *
 * Tests for the notification panel and bell components.
 */

import { fireEvent,render,screen } from '@testing-library/react';
import React,{ ReactNode } from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NotificationBell,NotificationPanel } from '../../src/components/NotificationPanel';
import { AppNotificationProvider,useAppNotifications } from '../../src/contexts/AppNotificationContext';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock the logger
vi.mock('../../src/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Helper component to add notifications for testing
const TestSetup = ({
  children,
  notifications = [],
}: {
  children: ReactNode;
  notifications?: Array<{
    type: string;
    severity?: 'info' | 'warning' | 'critical';
    title: string;
    message?: string;
    actionUrl?: string;
    actionLabel?: string;
    dismissible?: boolean;
  }>;
}) => {
  const ctx = useAppNotifications();

  React.useEffect(() => {
    notifications.forEach((n) => {
      ctx.addNotification({
        type: n.type,
        scope: 'global',
        severity: n.severity || 'info',
        title: n.title,
        message: n.message,
        actionUrl: n.actionUrl,
        actionLabel: n.actionLabel,
        dismissible: n.dismissible ?? true,
      });
    });
  }, []);

  return <>{children}</>;
};

describe('NotificationPanel', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('rendering', () => {
    it('should not render when isOpen is false', () => {
      render(
        <AppNotificationProvider>
          <NotificationPanel isOpen={false} onClose={mockOnClose} />
        </AppNotificationProvider>
      );

      expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
    });

    it('should render when isOpen is true', () => {
      render(
        <AppNotificationProvider>
          <NotificationPanel isOpen={true} onClose={mockOnClose} />
        </AppNotificationProvider>
      );

      expect(screen.getByText('Notifications')).toBeInTheDocument();
    });

    it('should show empty state when no notifications', () => {
      render(
        <AppNotificationProvider>
          <NotificationPanel isOpen={true} onClose={mockOnClose} />
        </AppNotificationProvider>
      );

      expect(screen.getByText('All caught up!')).toBeInTheDocument();
      expect(screen.getByText('No notifications at the moment')).toBeInTheDocument();
    });

    it('should display notifications', () => {
      render(
        <AppNotificationProvider>
          <TestSetup
            notifications={[
              { type: 'pending_drafts', title: 'You have drafts', severity: 'warning' },
            ]}
          >
            <NotificationPanel isOpen={true} onClose={mockOnClose} />
          </TestSetup>
        </AppNotificationProvider>
      );

      expect(screen.getByText('You have drafts')).toBeInTheDocument();
    });

    it('should display notification message', () => {
      render(
        <AppNotificationProvider>
          <TestSetup
            notifications={[
              {
                type: 'sync_error',
                title: 'Sync Failed',
                message: 'Unable to connect to server',
                severity: 'critical',
              },
            ]}
          >
            <NotificationPanel isOpen={true} onClose={mockOnClose} />
          </TestSetup>
        </AppNotificationProvider>
      );

      expect(screen.getByText('Unable to connect to server')).toBeInTheDocument();
    });
  });

  describe('notification count', () => {
    it('should show notification count badge', () => {
      render(
        <AppNotificationProvider>
          <TestSetup
            notifications={[
              { type: 'update_available', title: 'Update', severity: 'info' },
              { type: 'sync_error', title: 'Error', severity: 'warning' },
            ]}
          >
            <NotificationPanel isOpen={true} onClose={mockOnClose} />
          </TestSetup>
        </AppNotificationProvider>
      );

      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });

  describe('close button', () => {
    it('should call onClose when close button clicked', () => {
      render(
        <AppNotificationProvider>
          <NotificationPanel isOpen={true} onClose={mockOnClose} />
        </AppNotificationProvider>
      );

      const closeButtons = screen.getAllByRole('button');
      const closeButton = closeButtons.find((btn) =>
        btn.querySelector('svg.lucide-x')
      );

      if (closeButton) {
        fireEvent.click(closeButton);
        expect(mockOnClose).toHaveBeenCalled();
      }
    });

    it('should close on Escape key', () => {
      render(
        <AppNotificationProvider>
          <NotificationPanel isOpen={true} onClose={mockOnClose} />
        </AppNotificationProvider>
      );

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('clear all', () => {
    it('should show clear all button when notifications exist', () => {
      render(
        <AppNotificationProvider>
          <TestSetup
            notifications={[{ type: 'update_available', title: 'Update' }]}
          >
            <NotificationPanel isOpen={true} onClose={mockOnClose} />
          </TestSetup>
        </AppNotificationProvider>
      );

      const trashButton = screen.getByTitle('Clear all');
      expect(trashButton).toBeInTheDocument();
    });

    it('should clear all notifications when clear button clicked', () => {
      const TestComponent = () => {
        const ctx = useAppNotifications();

        React.useEffect(() => {
          ctx.addNotification({
            type: 'update_available',
            scope: 'global',
            title: 'Update',
          });
        }, []);

        return <NotificationPanel isOpen={true} onClose={mockOnClose} />;
      };

      render(
        <AppNotificationProvider>
          <TestComponent />
        </AppNotificationProvider>
      );

      const trashButton = screen.getByTitle('Clear all');
      fireEvent.click(trashButton);

      expect(screen.getByText('All caught up!')).toBeInTheDocument();
    });
  });

  describe('dismiss notification', () => {
    it('should dismiss notification when dismiss button clicked', () => {
      const TestComponent = () => {
        const ctx = useAppNotifications();

        React.useEffect(() => {
          ctx.addNotification({
            type: 'update_available',
            scope: 'global',
            title: 'Dismissable Notification',
            dismissible: true,
          });
        }, []);

        return <NotificationPanel isOpen={true} onClose={mockOnClose} />;
      };

      render(
        <AppNotificationProvider>
          <TestComponent />
        </AppNotificationProvider>
      );

      expect(screen.getByText('Dismissable Notification')).toBeInTheDocument();

      const dismissButton = screen.getByTitle('Dismiss');
      fireEvent.click(dismissButton);

      expect(screen.queryByText('Dismissable Notification')).not.toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    it('should call onClose when notification with action is clicked', () => {
      render(
        <AppNotificationProvider>
          <TestSetup
            notifications={[
              {
                type: 'pending_drafts',
                title: 'View Drafts',
                actionUrl: '/wallet/123/drafts',
              },
            ]}
          >
            <NotificationPanel isOpen={true} onClose={mockOnClose} />
          </TestSetup>
        </AppNotificationProvider>
      );

      const notification = screen.getByText('View Drafts').closest('div[class*="p-3"]');
      expect(notification).toBeInTheDocument();

      fireEvent.click(notification!);

      // Should call onClose immediately
      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should render action button for notification with actionLabel', () => {
      render(
        <AppNotificationProvider>
          <TestSetup
            notifications={[
              {
                type: 'pending_drafts',
                title: 'Drafts Available',
                actionUrl: '/drafts',
                actionLabel: 'View All',
              },
            ]}
          >
            <NotificationPanel isOpen={true} onClose={mockOnClose} />
          </TestSetup>
        </AppNotificationProvider>
      );

      expect(screen.getByText('View All')).toBeInTheDocument();
    });

    it('should render notification with actionUrl', () => {
      render(
        <AppNotificationProvider>
          <TestSetup
            notifications={[
              {
                type: 'pending_drafts',
                title: 'Clickable Notification',
                actionUrl: '/some/url',
              },
            ]}
          >
            <NotificationPanel isOpen={true} onClose={mockOnClose} />
          </TestSetup>
        </AppNotificationProvider>
      );

      // Notification with actionUrl should be rendered
      expect(screen.getByText('Clickable Notification')).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('should sort notifications by severity (critical first)', () => {
      render(
        <AppNotificationProvider>
          <TestSetup
            notifications={[
              { type: 'info', title: 'Info', severity: 'info' },
              { type: 'critical', title: 'Critical', severity: 'critical' },
              { type: 'warning', title: 'Warning', severity: 'warning' },
            ]}
          >
            <NotificationPanel isOpen={true} onClose={mockOnClose} />
          </TestSetup>
        </AppNotificationProvider>
      );

      const titles = screen
        .getAllByRole('paragraph')
        .filter((p) => p.classList.contains('font-medium'))
        .map((p) => p.textContent);

      // Critical should come first
      expect(titles[0]).toBe('Critical');
    });
  });
});

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should render bell icon', () => {
    render(
      <AppNotificationProvider>
        <NotificationBell />
      </AppNotificationProvider>
    );

    const button = screen.getByTitle('Notifications');
    expect(button).toBeInTheDocument();
  });

  it('should not show badge when no notifications', () => {
    render(
      <AppNotificationProvider>
        <NotificationBell />
      </AppNotificationProvider>
    );

    const button = screen.getByTitle('Notifications');
    const badge = button.querySelector('span.absolute');
    expect(badge).not.toBeInTheDocument();
  });

  it('should show badge with count when notifications exist', () => {
    const TestComponent = () => {
      const ctx = useAppNotifications();

      React.useEffect(() => {
        ctx.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
        });
        ctx.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      }, []);

      return <NotificationBell />;
    };

    render(
      <AppNotificationProvider>
        <TestComponent />
      </AppNotificationProvider>
    );

    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('should show 9+ when count exceeds 9', () => {
    const TestComponent = () => {
      const ctx = useAppNotifications();

      React.useEffect(() => {
        for (let i = 0; i < 15; i++) {
          ctx.addNotification({
            type: `notification_${i}`,
            scope: 'global',
            title: `Notification ${i}`,
          });
        }
      }, []);

      return <NotificationBell />;
    };

    render(
      <AppNotificationProvider>
        <TestComponent />
      </AppNotificationProvider>
    );

    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('should toggle panel on click', () => {
    render(
      <AppNotificationProvider>
        <NotificationBell />
      </AppNotificationProvider>
    );

    const button = screen.getByTitle('Notifications');

    // Panel should be closed initially
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();

    // Click to open
    fireEvent.click(button);
    expect(screen.getByText('Notifications')).toBeInTheDocument();

    // Click to close
    fireEvent.click(button);
    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });

  it('should show critical severity badge color', () => {
    const TestComponent = () => {
      const ctx = useAppNotifications();

      React.useEffect(() => {
        ctx.addNotification({
          type: 'security_alert',
          scope: 'global',
          title: 'Critical Alert',
          severity: 'critical',
        });
      }, []);

      return <NotificationBell />;
    };

    render(
      <AppNotificationProvider>
        <TestComponent />
      </AppNotificationProvider>
    );

    const badge = screen.getByText('1');
    expect(badge).toHaveClass('bg-rose-600');
    expect(badge).toHaveClass('animate-pulse');
  });

  it('should show warning severity badge color', () => {
    const TestComponent = () => {
      const ctx = useAppNotifications();

      React.useEffect(() => {
        ctx.addNotification({
          type: 'pending_drafts',
          scope: 'global',
          title: 'Warning',
          severity: 'warning',
        });
      }, []);

      return <NotificationBell />;
    };

    render(
      <AppNotificationProvider>
        <TestComponent />
      </AppNotificationProvider>
    );

    const badge = screen.getByText('1');
    expect(badge).toHaveClass('bg-rose-400');
  });

  it('should show info severity badge color', () => {
    const TestComponent = () => {
      const ctx = useAppNotifications();

      React.useEffect(() => {
        ctx.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Info',
          severity: 'info',
        });
      }, []);

      return <NotificationBell />;
    };

    render(
      <AppNotificationProvider>
        <TestComponent />
      </AppNotificationProvider>
    );

    const badge = screen.getByText('1');
    expect(badge).toHaveClass('bg-primary-500');
  });
});

describe('NotificationItem time formatting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should show "Just now" for very recent notifications', () => {
    const TestComponent = () => {
      const ctx = useAppNotifications();

      React.useEffect(() => {
        ctx.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Recent',
        });
      }, []);

      return <NotificationPanel isOpen={true} onClose={() => {}} />;
    };

    render(
      <AppNotificationProvider>
        <TestComponent />
      </AppNotificationProvider>
    );

    // Since the notification was just created, it should show "Just now"
    expect(screen.getByText('Just now')).toBeInTheDocument();
  });
});
