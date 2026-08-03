import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle,
  TrendingUp,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Notification, NotificationType } from './types';

type StandardNotificationType = Exclude<NotificationType, 'transaction'>;

const standardIconRenderers: Record<StandardNotificationType, () => ReactNode> = {
  balance: () => <TrendingUp className="w-5 h-5 text-primary-600 dark:text-primary-400" />,
  confirmation: () => <CheckCircle className="w-5 h-5 text-success-600 dark:text-success-400" />,
  block: () => <Activity className="w-5 h-5 text-primary-600 dark:text-primary-400" />,
  success: () => <CheckCircle className="w-5 h-5 text-success-600 dark:text-success-400" />,
  error: () => <X className="w-5 h-5 text-rose-600 dark:text-rose-400" />,
  warning: () => <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
  info: () => <Activity className="w-5 h-5 text-primary-600 dark:text-primary-400" />,
};

const standardColors: Record<StandardNotificationType, string> = {
  balance: 'surface-secondary border-primary-200 dark:border-primary-700',
  confirmation: 'bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-700',
  block: 'surface-secondary border-primary-200 dark:border-primary-700',
  success: 'bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-700',
  error: 'bg-rose-50 dark:bg-rose-950/80 border-rose-300 dark:border-rose-700',
  warning: 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-700',
  info: 'surface-secondary border-primary-200 dark:border-primary-700',
};

const isReceivedTransaction = (notification: Notification) =>
  notification.type === 'transaction' && notification.data?.type === 'received';

const isSentLikeTransaction = (notification: Notification) =>
  notification.type === 'transaction' && notification.data?.type !== 'received';

export const getNotificationIcon = (notification: Notification) => {
  if (isReceivedTransaction(notification)) {
    return <ArrowDownLeft className="w-5 h-5 text-primary-600 dark:text-primary-400" />;
  }

  if (isSentLikeTransaction(notification)) {
    return <ArrowUpRight className="w-5 h-5 text-sent-600 dark:text-sent-400" />;
  }

  return standardIconRenderers[notification.type as StandardNotificationType]();
};

export const getNotificationColors = (notification: Notification) => {
  if (isReceivedTransaction(notification)) {
    return 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-700';
  }

  if (isSentLikeTransaction(notification)) {
    return 'bg-sent-50 dark:bg-sent-900/30 border-sent-200 dark:border-sent-700';
  }

  return standardColors[notification.type as StandardNotificationType];
};
