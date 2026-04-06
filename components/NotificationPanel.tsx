/**
 * Notification Panel Component
 *
 * A dropdown/slide-out panel showing all app notifications.
 */

import React, { useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  FileText,
  RefreshCw,
  Shield,
  Download,
  WifiOff,
  Check,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { useAppNotifications, AppNotification, NotificationType } from '../contexts/AppNotificationContext';
import { createLogger } from '../utils/logger';

const log = createLogger('NotificationPanel');

// Icon mapping for notification types
const getNotificationIcon = (type: NotificationType, severity: string) => {
  switch (type) {
    case 'pending_drafts':
      return FileText;
    case 'sync_error':
      return AlertTriangle;
    case 'sync_in_progress':
      return RefreshCw;
    case 'pending_signatures':
      return Shield;
    case 'security_alert':
      return AlertCircle;
    case 'update_available':
      return Download;
    case 'connection_error':
      return WifiOff;
    case 'backup_reminder':
      return Download;
    default:
      if (severity === 'critical') return AlertCircle;
      if (severity === 'warning') return AlertTriangle;
      return Info;
  }
};

// Get severity color classes - uses left border accent for visual hierarchy
const getSeverityColors = (severity: string) => {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-rose-50/50 dark:bg-rose-900/10',
        border: 'border border-rose-100 dark:border-rose-900/30 border-l-[3px] border-l-rose-500',
        icon: 'text-rose-500',
        title: 'text-rose-900 dark:text-rose-100',
        text: 'text-rose-700 dark:text-rose-300',
      };
    case 'warning':
      return {
        bg: 'bg-amber-50/50 dark:bg-amber-900/10',
        border: 'border border-amber-100 dark:border-amber-900/30 border-l-[3px] border-l-amber-500',
        icon: 'text-amber-500',
        title: 'text-sanctuary-900 dark:text-sanctuary-100',
        text: 'text-sanctuary-700 dark:text-sanctuary-300',
      };
    default:
      return {
        bg: 'bg-primary-50/50 dark:bg-primary-900/10',
        border: 'border border-primary-100 dark:border-primary-900/30 border-l-[3px] border-l-primary-500',
        icon: 'text-primary-500',
        title: 'text-sanctuary-900 dark:text-sanctuary-100',
        text: 'text-sanctuary-700 dark:text-sanctuary-300',
      };
  }
};

interface NotificationItemProps {
  notification: AppNotification;
  onDismiss: (id: string) => void;
  onNavigate: (url: string) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onDismiss,
  onNavigate,
}) => {
  const Icon = getNotificationIcon(notification.type, notification.severity);
  const colors = getSeverityColors(notification.severity);

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

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
              <p className={`text-sm font-medium ${colors.title}`}>
                {notification.title}
                {notification.count && notification.count > 1 && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-white/50 dark:bg-black/20">
                    {notification.count}
                  </span>
                )}
              </p>
              {notification.message && (
                <p className={`text-xs mt-0.5 ${colors.text}`}>
                  {notification.message}
                </p>
              )}
              <p className="text-xs text-sanctuary-400 mt-1">
                {formatTime(notification.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {notification.actionUrl && (
                <ChevronRight className="w-4 h-4 text-sanctuary-400" />
              )}
              {notification.dismissible && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(notification.id);
                  }}
                  className="p-1 rounded-md hover:bg-sanctuary-200 dark:hover:bg-sanctuary-700 transition-colors"
                  title="Dismiss"
                >
                  <X className="w-4 h-4 text-sanctuary-400" />
                </button>
              )}
            </div>
          </div>
          {notification.actionLabel && notification.actionUrl && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onNavigate(notification.actionUrl!);
              }}
              className={`
                mt-2 text-xs font-medium px-2 py-1 rounded-md
                bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-black/30
                ${colors.title} transition-colors
              `}
            >
              {notification.actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  isOpen,
  onClose,
  anchorRef,
}) => {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const {
    notifications,
    dismissNotification,
    clearAllNotifications,
    getTotalCount,
  } = useAppNotifications();

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        anchorRef?.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose, anchorRef]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  const handleNavigate = (url: string) => {
    log.debug('Navigating to action URL', { url });
    onClose();
    // Use setTimeout to ensure panel closes before navigation
    setTimeout(() => {
      navigate(url, { state: { activeTab: 'drafts' } });
    }, 0);
  };

  if (!isOpen) return null;

  // Sort by severity (critical first) then by date (newest first)
  const sortedNotifications = [...notifications].sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const totalCount = getTotalCount();

  return (
    <div
      ref={panelRef}
      className="absolute left-0 bottom-full mb-2 w-80 max-h-[70vh] surface-glass rounded-xl shadow-xl overflow-hidden z-50 animate-modal-enter"
    >
      {/* Header */}
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
          {notifications.length > 0 && (
            <button
              onClick={clearAllNotifications}
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

      {/* Content */}
      <div className="overflow-y-auto max-h-[calc(70vh-60px)]">
        {sortedNotifications.length === 0 ? (
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
        ) : (
          <div className="p-2 space-y-2">
            {sortedNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onDismiss={dismissNotification}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Notification Bell Button with Panel
 *
 * A button with badge that opens the notification panel.
 */
export const NotificationBell: React.FC = () => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { getTotalCount, isPanelOpen, togglePanel, closePanel } = useAppNotifications();
  const totalCount = getTotalCount();

  // Get highest severity for badge color
  const { notifications } = useAppNotifications();
  const hasCritical = notifications.some(n => n.severity === 'critical');
  const hasWarning = notifications.some(n => n.severity === 'warning');
  const severity = hasCritical ? 'critical' : hasWarning ? 'warning' : 'info';

  const badgeColors = {
    critical: 'bg-rose-600',
    warning: 'bg-rose-400 dark:bg-rose-500',
    info: 'bg-primary-500',
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={togglePanel}
        className="relative p-2 rounded-lg text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {totalCount > 0 && (
          <span
            className={`
              absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center
              rounded-full text-[10px] font-bold text-white px-1
              ${badgeColors[severity]}
              ${hasCritical ? 'animate-pulse' : ''}
            `}
          >
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>
      <NotificationPanel
        isOpen={isPanelOpen}
        onClose={closePanel}
        anchorRef={buttonRef}
      />
    </div>
  );
};

export default NotificationPanel;
