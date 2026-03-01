import React from 'react';
import { FileText, AlertTriangle } from 'lucide-react';
import type { AuditLogStats } from '../../src/api/admin';
import { categoryIcons, categoryColors } from './constants';

interface StatCardsProps {
  stats: AuditLogStats;
}

/**
 * Displays overview statistics for audit logs including total events,
 * failed events, and events by category.
 */
export const StatCards: React.FC<StatCardsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="surface-elevated rounded-xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-sanctuary-500 dark:text-sanctuary-400 text-sm">
            Total Events (30d)
          </span>
          <FileText className="w-5 h-5 text-sanctuary-400" />
        </div>
        <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-2">
          {stats.totalEvents.toLocaleString()}
        </p>
      </div>
      <div className="surface-elevated rounded-xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-sanctuary-500 dark:text-sanctuary-400 text-sm">
            Failed Events
          </span>
          <AlertTriangle className="w-5 h-5 text-warning-500" />
        </div>
        <p className="text-2xl font-semibold text-sanctuary-900 dark:text-sanctuary-100 mt-2">
          {stats.failedEvents.toLocaleString()}
        </p>
      </div>
      <div className="surface-elevated rounded-xl p-4 col-span-2">
        <span className="text-sanctuary-500 dark:text-sanctuary-400 text-sm">
          Events by Category
        </span>
        <div className="flex flex-wrap gap-2 mt-2">
          {Object.entries(stats.byCategory).map(([cat, count]) => (
            <span
              key={cat}
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                categoryColors[cat] || categoryColors.system
              }`}
            >
              {categoryIcons[cat]}
              <span className="ml-1">{cat}</span>
              <span className="ml-1 opacity-75">({count})</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
