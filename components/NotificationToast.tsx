import { X } from 'lucide-react';
import {
  getNotificationColors,
  getNotificationIcon,
} from './NotificationToast/notificationToastHelpers';
import type { Notification } from './NotificationToast/types';
import { useToastDismiss } from './NotificationToast/useToastDismiss';

export type { Notification, NotificationData, NotificationType } from './NotificationToast/types';

interface NotificationToastProps {
  notification: Notification;
  onDismiss: (id: string) => void;
}

export const NotificationToast = ({ notification, onDismiss }: NotificationToastProps) => {
  const { isExiting, handleDismiss } = useToastDismiss({
    notificationId: notification.id,
    duration: notification.duration,
    onDismiss,
  });

  return (
    <div
      className={`
        flex items-start space-x-3 p-4 rounded-lg border shadow-xl backdrop-blur-xl
        ${getNotificationColors(notification)}
        ${isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right'}
        transition-all duration-300
      `}
      style={{ WebkitBackdropFilter: 'blur(16px)' }}
      role="alert"
    >
      <div className="flex-shrink-0 mt-0.5">{getNotificationIcon(notification)}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-50">
          {notification.title}
        </p>
        {notification.message && (
          <p className="text-xs text-sanctuary-600 dark:text-sanctuary-400 mt-1">
            {notification.message}
          </p>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 p-1 rounded-lg hover:bg-sanctuary-200/50 dark:hover:bg-sanctuary-700/50 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4 text-sanctuary-500" />
      </button>
    </div>
  );
};

interface NotificationContainerProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

const MAX_VISIBLE_NOTIFICATIONS = 4;

export const NotificationContainer = ({
  notifications,
  onDismiss,
}: NotificationContainerProps) => {
  if (notifications.length === 0) return null;

  const visibleNotifications = notifications.slice(0, MAX_VISIBLE_NOTIFICATIONS);
  const hiddenCount = notifications.length - visibleNotifications.length;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col space-y-3 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="space-y-3 pointer-events-auto">
        {visibleNotifications.map((notification) => (
          <NotificationToast
            key={notification.id}
            notification={notification}
            onDismiss={onDismiss}
          />
        ))}
        {hiddenCount > 0 && (
          <div className="text-center text-xs text-sanctuary-500 dark:text-sanctuary-400 surface-elevated rounded-lg py-1.5 px-3 border border-sanctuary-200 dark:border-sanctuary-800 shadow-sm">
            +{hiddenCount} more notification{hiddenCount > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
};

export const generateNotificationId = (): string => {
  return `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
