import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { NotificationBadge } from '../NotificationBadge';
import { SubNavItemProps } from './types';

export const SubNavItem: React.FC<SubNavItemProps> = ({ to, label, icon, activeColorClass, badgeCount, badgeSeverity, statusDot }) => {
  const location = useLocation();
  const isActive = location.pathname === to;

  const dotColors = {
    synced: 'bg-success-500',
    syncing: 'bg-primary-500 animate-pulse',
    error: 'bg-rose-500',
    pending: 'bg-sanctuary-400',
  };

  return (
    <Link
      to={to}
      className={`group flex items-center justify-between pl-8 pr-3 py-2 text-sm font-medium transition-all duration-200 border-l-2 ml-3 min-w-0 ${
        isActive
          ? `border-primary-500 dark:border-primary-500 text-primary-700 dark:text-primary-400 ${activeColorClass || ''}`
          : 'border-sanctuary-200 dark:border-sanctuary-800 text-sanctuary-500 dark:text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:border-sanctuary-300'
      }`}
      title={label}
    >
      <span className="flex items-center min-w-0">
        {icon && <span className="mr-2 opacity-70 flex-shrink-0">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-1.5">
        {(badgeCount ?? 0) > 0 && (
          <NotificationBadge count={badgeCount!} severity={badgeSeverity || 'warning'} size="sm" />
        )}
        {statusDot && (
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColors[statusDot]}`} title={statusDot} />
        )}
      </span>
    </Link>
  );
};
