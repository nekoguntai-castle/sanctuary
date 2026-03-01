import React from 'react';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { AuditLogEntry } from '../../src/api/admin';
import { categoryIcons, categoryColors, formatAction, formatRelativeTime } from './constants';

interface LogTableProps {
  logs: AuditLogEntry[];
  loading: boolean;
  total: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onSelectLog: (log: AuditLogEntry) => void;
}

/**
 * Displays audit log entries in a table with pagination controls.
 */
export const LogTable: React.FC<LogTableProps> = ({
  logs,
  loading,
  total,
  currentPage,
  pageSize,
  onPageChange,
  onSelectLog,
}) => {
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="surface-elevated rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="surface-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Time
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Category
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Action
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                IP Address
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
            {loading && logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sanctuary-500">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading audit logs...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sanctuary-500">
                  No audit logs found
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr
                  key={log.id}
                  onClick={() => onSelectLog(log)}
                  className="hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center text-sm">
                      <Clock className="w-4 h-4 text-sanctuary-400 mr-2" />
                      <span
                        className="text-sanctuary-900 dark:text-sanctuary-100"
                        title={new Date(log.createdAt).toLocaleString()}
                      >
                        {formatRelativeTime(log.createdAt)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">
                      {log.username}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        categoryColors[log.category] || categoryColors.system
                      }`}
                    >
                      {categoryIcons[log.category]}
                      <span className="ml-1">{log.category}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
                      {formatAction(log.action)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {log.success ? (
                      <span className="inline-flex items-center text-success-600 dark:text-success-400">
                        <CheckCircle className="w-4 h-4 mr-1" />
                        <span className="text-sm">Success</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-red-600 dark:text-red-400">
                        <XCircle className="w-4 h-4 mr-1" />
                        <span className="text-sm">Failed</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400 font-mono">
                      {log.ipAddress || '-'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-sanctuary-100 dark:border-sanctuary-800">
          <p className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
            Showing {(currentPage - 1) * pageSize + 1} to{' '}
            {Math.min(currentPage * pageSize, total)} of {total} entries
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
