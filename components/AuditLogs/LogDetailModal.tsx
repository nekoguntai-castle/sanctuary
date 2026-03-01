import React from 'react';
import { X, CheckCircle, XCircle } from 'lucide-react';
import type { AuditLogEntry } from '../../src/api/admin';
import { categoryIcons, categoryColors, formatAction } from './constants';

interface LogDetailModalProps {
  log: AuditLogEntry | null;
  onClose: () => void;
}

/**
 * Modal showing detailed information about a single audit log entry.
 */
export const LogDetailModal: React.FC<LogDetailModalProps> = ({ log, onClose }) => {
  if (!log) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-sanctuary-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-sanctuary-200 dark:border-sanctuary-800 bg-white dark:bg-sanctuary-900">
          <h3 className="text-lg font-semibold text-sanctuary-900 dark:text-sanctuary-100">
            Audit Log Details
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Timestamp
              </label>
              <p className="text-sanctuary-900 dark:text-sanctuary-100">
                {new Date(log.createdAt).toLocaleString()}
              </p>
            </div>
            <div>
              <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                User
              </label>
              <p className="text-sanctuary-900 dark:text-sanctuary-100">
                {log.username}
                {log.userId && (
                  <span className="text-sanctuary-500 text-sm ml-2">
                    ({log.userId.slice(0, 8)}...)
                  </span>
                )}
              </p>
            </div>
            <div>
              <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Category
              </label>
              <p>
                <span
                  className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    categoryColors[log.category] || categoryColors.system
                  }`}
                >
                  {categoryIcons[log.category]}
                  <span className="ml-1">{log.category}</span>
                </span>
              </p>
            </div>
            <div>
              <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Action
              </label>
              <p className="text-sanctuary-900 dark:text-sanctuary-100">
                {formatAction(log.action)}
              </p>
            </div>
            <div>
              <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Status
              </label>
              <p>
                {log.success ? (
                  <span className="inline-flex items-center text-success-600 dark:text-success-400">
                    <CheckCircle className="w-4 h-4 mr-1" />
                    Success
                  </span>
                ) : (
                  <span className="inline-flex items-center text-red-600 dark:text-red-400">
                    <XCircle className="w-4 h-4 mr-1" />
                    Failed
                  </span>
                )}
              </p>
            </div>
            <div>
              <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                IP Address
              </label>
              <p className="text-sanctuary-900 dark:text-sanctuary-100 font-mono">
                {log.ipAddress || '-'}
              </p>
            </div>
          </div>

          {log.errorMsg && (
            <div>
              <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Error Message
              </label>
              <p className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg mt-1">
                {log.errorMsg}
              </p>
            </div>
          )}

          {log.details && Object.keys(log.details).length > 0 && (
            <div>
              <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                Details
              </label>
              <pre className="mt-1 p-3 rounded-lg bg-sanctuary-50 dark:bg-sanctuary-800 text-sm text-sanctuary-700 dark:text-sanctuary-300 overflow-x-auto">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            </div>
          )}

          {log.userAgent && (
            <div>
              <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
                User Agent
              </label>
              <p className="text-sanctuary-600 dark:text-sanctuary-400 text-sm break-all">
                {log.userAgent}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
