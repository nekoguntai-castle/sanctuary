import React from 'react';
import type { MonitoringService } from '../../src/api/admin';

/**
 * Status badge showing service health with colored indicator dot
 */
export const StatusBadge: React.FC<{ status?: MonitoringService['status'] }> = ({ status }) => {
  if (!status || status === 'unknown') {
    return (
      <span className="flex items-center space-x-1 text-xs text-sanctuary-400">
        <span className="w-2 h-2 rounded-full bg-sanctuary-300 dark:bg-sanctuary-600" />
        <span>Unknown</span>
      </span>
    );
  }

  if (status === 'healthy') {
    return (
      <span className="flex items-center space-x-1 text-xs text-emerald-600 dark:text-emerald-400">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span>Running</span>
      </span>
    );
  }

  return (
    <span className="flex items-center space-x-1 text-xs text-rose-600 dark:text-rose-400">
      <span className="w-2 h-2 rounded-full bg-rose-500" />
      <span>Unreachable</span>
    </span>
  );
};
