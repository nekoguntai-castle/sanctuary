import type { RefObject } from 'react';
import { Bell, Check, Trash2, X } from 'lucide-react';
import type { AppNotification } from '../../contexts/AppNotificationContext';
import { NotificationItem } from './NotificationItem';
import { sortNotifications } from './notificationPanelHelpers';
import type { NotificationPanelController } from './useNotificationPanelController';

interface NotificationPanelFrameProps {
  controller: NotificationPanelController;
  onClose: () => void;
}

export function NotificationPanelFrame({
  controller,
  onClose,
}: NotificationPanelFrameProps) {
  return (
    <div
      ref={controller.panelRef}
      className="absolute left-0 bottom-full mb-2 w-80 max-h-[70vh] surface-glass rounded-xl shadow-xl overflow-hidden z-50 animate-modal-enter"
    >
      <NotificationPanelHeader
        hasNotifications={controller.notifications.length > 0}
        totalCount={controller.totalCount}
        onClearAll={controller.clearAllNotifications}
        onClose={onClose}
      />
      <NotificationPanelContent
        notifications={sortNotifications(controller.notifications)}
        onDismiss={controller.dismissNotification}
        onNavigate={controller.handleNavigate}
      />
    </div>
  );
}

interface NotificationPanelHeaderProps {
  hasNotifications: boolean;
  totalCount: number;
  onClearAll: () => void;
  onClose: () => void;
}

function NotificationPanelHeader({
  hasNotifications,
  totalCount,
  onClearAll,
  onClose,
}: NotificationPanelHeaderProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-sanctuary-200 dark:border-sanctuary-800">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-sanctuary-500" />
        <h3 className="text-sm font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          Notifications
        </h3>
        {totalCount > 0 && (
          <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
            {totalCount}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {hasNotifications && (
          <button
            onClick={onClearAll}
            className="p-1.5 rounded-md text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
            title="Clear all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

interface NotificationPanelContentProps {
  notifications: AppNotification[];
  onDismiss: (id: string) => void;
  onNavigate: (url: string) => void;
}

function NotificationPanelContent({
  notifications,
  onDismiss,
  onNavigate,
}: NotificationPanelContentProps) {
  if (notifications.length === 0) {
    return (
      <div className="overflow-y-auto max-h-[calc(70vh-60px)]">
        <EmptyNotificationPanel />
      </div>
    );
  }

  return (
    <div className="overflow-y-auto max-h-[calc(70vh-60px)]">
      <div className="p-2 space-y-2">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onDismiss={onDismiss}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyNotificationPanel() {
  return (
    <div className="py-12 px-4 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-sanctuary-100 dark:bg-sanctuary-800 flex items-center justify-center">
        <Check className="w-6 h-6 text-success-500" />
      </div>
      <p className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        All caught up!
      </p>
      <p className="text-xs text-sanctuary-500 mt-1">
        No notifications at the moment
      </p>
    </div>
  );
}

export type NotificationPanelRef = RefObject<HTMLDivElement | null>;
