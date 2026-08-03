import {
  AlertCircle,
  AlertTriangle,
  Download,
  FileText,
  Info,
  RefreshCw,
  Shield,
  WifiOff,
} from 'lucide-react';
import type {
  AppNotification,
  NotificationSeverity,
  NotificationType,
} from '../../contexts/AppNotificationContext';

const iconByNotificationType: Record<string, typeof Info> = {
  pending_drafts: FileText,
  sync_error: AlertTriangle,
  sync_in_progress: RefreshCw,
  pending_signatures: Shield,
  security_alert: AlertCircle,
  update_available: Download,
  connection_error: WifiOff,
  backup_reminder: Download,
};

const severityOrder: Record<NotificationSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const badgeColorClasses: Record<NotificationSeverity, string> = {
  critical: 'bg-rose-600',
  warning: 'bg-rose-400 dark:bg-rose-500',
  info: 'bg-primary-500',
};

export const getNotificationIcon = (
  type: NotificationType,
  severity: NotificationSeverity
) => {
  return iconByNotificationType[type] ?? getDefaultNotificationIcon(severity);
};

const getDefaultNotificationIcon = (severity: NotificationSeverity) => {
  if (severity === 'critical') return AlertCircle;
  if (severity === 'warning') return AlertTriangle;
  return Info;
};

export const getSeverityColors = (severity: NotificationSeverity) => {
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

export const formatNotificationTime = (date: Date, now = new Date()) => {
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

export const sortNotifications = (notifications: AppNotification[]) => {
  return [...notifications].sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
};

export const getHighestNotificationSeverity = (
  notifications: AppNotification[]
): NotificationSeverity => {
  if (notifications.some((notification) => notification.severity === 'critical')) {
    return 'critical';
  }

  if (notifications.some((notification) => notification.severity === 'warning')) {
    return 'warning';
  }

  return 'info';
};

export const getBadgeColorClass = (severity: NotificationSeverity) => {
  return badgeColorClasses[severity];
};
