/**
 * Notification Badge Component
 *
 * Displays a badge with notification count. Used in sidebar and navigation.
 */

import React from 'react';

type NotificationSeverity = 'info' | 'warning' | 'critical';
type NotificationSize = 'sm' | 'md' | 'lg';

interface NotificationBadgeProps {
  count: number;
  severity?: NotificationSeverity;
  size?: NotificationSize;
  className?: string;
  maxCount?: number;
  showZero?: boolean;
  pulse?: boolean;
}

const badgeSizeClasses: Record<NotificationSize, string> = {
  sm: 'h-4 min-w-4 text-[10px]',
  md: 'h-5 min-w-5 text-xs',
  lg: 'h-6 min-w-6 text-sm',
};

const badgeSeverityClasses: Record<NotificationSeverity, string> = {
  info: 'bg-primary-500 text-white',
  warning: 'bg-rose-400 dark:bg-rose-500 text-white',
  critical: 'bg-rose-600 text-white',
};

const dotSizeClasses: Record<NotificationSize, string> = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
};

const dotSeverityClasses: Record<NotificationSeverity, string> = {
  info: 'bg-primary-500',
  warning: 'bg-rose-400 dark:bg-rose-500',
  critical: 'bg-rose-600',
};

function formatNotificationCount(count: number, maxCount: number) {
  return count > maxCount ? `${maxCount}+` : count.toString();
}

function joinClasses(classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function getBadgeClassName({
  size,
  severity,
  pulse,
  className,
}: {
  size: NotificationSize;
  severity: NotificationSeverity;
  pulse: boolean;
  className: string;
}) {
  return joinClasses([
    'inline-flex items-center justify-center rounded-full font-bold',
    badgeSizeClasses[size],
    badgeSeverityClasses[severity],
    pulse && 'animate-pulse',
    className,
  ]);
}

function getDotClassName({
  size,
  severity,
  pulse,
  className,
}: {
  size: NotificationSize;
  severity: NotificationSeverity;
  pulse: boolean;
  className: string;
}) {
  return joinClasses([
    'inline-block rounded-full',
    dotSizeClasses[size],
    dotSeverityClasses[severity],
    pulse && 'animate-pulse',
    className,
  ]);
}

export const NotificationBadge: React.FC<NotificationBadgeProps> = ({
  count,
  severity = 'warning',
  size = 'sm',
  className = '',
  maxCount = 9,
  showZero = false,
  pulse = false,
}) => {
  if (count === 0 && !showZero) return null;

  return (
    <span
      className={getBadgeClassName({ size, severity, pulse, className })}
      style={{ padding: '0 4px' }}
    >
      {formatNotificationCount(count, maxCount)}
    </span>
  );
};

/**
 * Notification Dot Component
 *
 * A simple dot indicator without a count.
 */
interface NotificationDotProps {
  severity?: NotificationSeverity;
  size?: NotificationSize;
  className?: string;
  pulse?: boolean;
  visible?: boolean;
}

export const NotificationDot: React.FC<NotificationDotProps> = ({
  severity = 'warning',
  size = 'sm',
  className = '',
  pulse = true,
  visible = true,
}) => {
  if (!visible) return null;

  return (
    <span
      className={getDotClassName({ size, severity, pulse, className })}
    />
  );
};

export default NotificationBadge;
