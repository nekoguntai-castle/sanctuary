import { ChevronRight, X } from 'lucide-react';
import type { AppNotification } from '../../contexts/AppNotificationContext';
import {
  formatNotificationTime,
  getNotificationIcon,
  getSeverityColors,
} from './notificationPanelHelpers';

interface NotificationItemProps {
  notification: AppNotification;
  onDismiss: (id: string) => void;
  onNavigate: (url: string) => void;
}

export const NotificationItem = ({
  notification,
  onDismiss,
  onNavigate,
}: NotificationItemProps) => {
  const Icon = getNotificationIcon(notification.type, notification.severity);
  const colors = getSeverityColors(notification.severity);

  return (
    <div
      className={`
        p-3 rounded-lg border transition-colors
        ${colors.bg} ${colors.border}
        ${notification.actionUrl ? 'cursor-pointer hover:opacity-80' : ''}
      `}
      onClick={() => notification.actionUrl && onNavigate(notification.actionUrl)}
    >
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 mt-0.5 ${colors.icon}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <NotificationTitle notification={notification} titleClass={colors.title} />
              <NotificationMessage notification={notification} textClass={colors.text} />
              <p className="text-xs text-sanctuary-400 mt-1">
                {formatNotificationTime(notification.createdAt)}
              </p>
            </div>
            <NotificationItemActions
              notification={notification}
              onDismiss={onDismiss}
            />
          </div>
          <NotificationActionButton
            notification={notification}
            onNavigate={onNavigate}
            titleClass={colors.title}
          />
        </div>
      </div>
    </div>
  );
};

const NotificationTitle = ({
  notification,
  titleClass,
}: {
  notification: AppNotification;
  titleClass: string;
}) => (
  <p className={`text-sm font-medium ${titleClass}`}>
    {notification.title}
    {notification.count && notification.count > 1 && (
      <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-white/50 dark:bg-black/20">
        {notification.count}
      </span>
    )}
  </p>
);

const NotificationMessage = ({
  notification,
  textClass,
}: {
  notification: AppNotification;
  textClass: string;
}) => {
  if (!notification.message) return null;

  return (
    <p className={`text-xs mt-0.5 ${textClass}`}>
      {notification.message}
    </p>
  );
};

const NotificationItemActions = ({
  notification,
  onDismiss,
}: {
  notification: AppNotification;
  onDismiss: (id: string) => void;
}) => (
  <div className="flex items-center gap-1 flex-shrink-0">
    {notification.actionUrl && (
      <ChevronRight className="w-4 h-4 text-sanctuary-400" />
    )}
    {notification.dismissible && (
      <button
        onClick={(event) => {
          event.stopPropagation();
          onDismiss(notification.id);
        }}
        className="p-1 rounded-md hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors"
        title="Dismiss"
      >
        <X className="w-4 h-4 text-sanctuary-400" />
      </button>
    )}
  </div>
);

const NotificationActionButton = ({
  notification,
  onNavigate,
  titleClass,
}: {
  notification: AppNotification;
  onNavigate: (url: string) => void;
  titleClass: string;
}) => {
  if (!notification.actionLabel || !notification.actionUrl) return null;

  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onNavigate(notification.actionUrl!);
      }}
      className={`
        mt-2 text-xs font-medium px-2 py-1 rounded-md
        bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-black/30
        ${titleClass} transition-colors
      `}
    >
      {notification.actionLabel}
    </button>
  );
};
