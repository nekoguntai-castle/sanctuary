import React from 'react';
import { X, CheckCircle, XCircle } from 'lucide-react';
import type { AuditLogEntry } from '../../src/api/admin';
import { categoryIcons, categoryColors, formatAction } from './constants';

interface LogDetailModalProps {
  log: AuditLogEntry | null;
  onClose: () => void;
}

function LogDetailField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div>
      <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  );
}

function LogUserField({ log }: { log: AuditLogEntry }) {
  return (
    <p className="text-sanctuary-900 dark:text-sanctuary-100">
      {log.username}
      {log.userId && (
        <span className="text-sanctuary-500 text-sm ml-2">
          ({log.userId.slice(0, 8)}...)
        </span>
      )}
    </p>
  );
}

function LogCategoryBadge({ category }: { category: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
        categoryColors[category] || categoryColors.system
      }`}
    >
      {categoryIcons[category]}
      <span className="ml-1">{category}</span>
    </span>
  );
}

function LogStatusBadge({ success }: { success: boolean }) {
  if (success) {
    return (
      <span className="inline-flex items-center text-success-600 dark:text-success-400">
        <CheckCircle className="w-4 h-4 mr-1" />
        Success
      </span>
    );
  }

  return (
    <span className="inline-flex items-center text-red-600 dark:text-red-400">
      <XCircle className="w-4 h-4 mr-1" />
      Failed
    </span>
  );
}

function LogErrorMessage({ errorMsg }: { errorMsg: string | null }) {
  if (!errorMsg) return null;

  return (
    <div>
      <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
        Error Message
      </label>
      <p className="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded-lg mt-1">
        {errorMsg}
      </p>
    </div>
  );
}

function LogDetailsSection({ details }: { details: AuditLogEntry['details'] }) {
  if (!details || Object.keys(details).length === 0) return null;

  return (
    <div>
      <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
        Details
      </label>
      <pre className="mt-1 p-3 rounded-lg bg-sanctuary-50 dark:bg-sanctuary-800 text-sm text-sanctuary-700 dark:text-sanctuary-300 overflow-x-auto">
        {JSON.stringify(details, null, 2)}
      </pre>
    </div>
  );
}

function LogUserAgent({ userAgent }: { userAgent: string | null }) {
  if (!userAgent) return null;

  return (
    <div>
      <label className="text-xs text-sanctuary-500 dark:text-sanctuary-400 uppercase tracking-wider">
        User Agent
      </label>
      <p className="text-sanctuary-600 dark:text-sanctuary-400 text-sm break-all">
        {userAgent}
      </p>
    </div>
  );
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
            <LogDetailField label="Timestamp">
              <p className="text-sanctuary-900 dark:text-sanctuary-100">
                {new Date(log.createdAt).toLocaleString()}
              </p>
            </LogDetailField>
            <LogDetailField label="User">
              <LogUserField log={log} />
            </LogDetailField>
            <LogDetailField label="Category">
              <p>
                <LogCategoryBadge category={log.category} />
              </p>
            </LogDetailField>
            <LogDetailField label="Action">
              <p className="text-sanctuary-900 dark:text-sanctuary-100">
                {formatAction(log.action)}
              </p>
            </LogDetailField>
            <LogDetailField label="Status">
              <p>
                <LogStatusBadge success={log.success} />
              </p>
            </LogDetailField>
            <LogDetailField label="IP Address">
              <p className="text-sanctuary-900 dark:text-sanctuary-100 font-mono">
                {log.ipAddress || '-'}
              </p>
            </LogDetailField>
          </div>

          <LogErrorMessage errorMsg={log.errorMsg} />
          <LogDetailsSection details={log.details} />
          <LogUserAgent userAgent={log.userAgent} />
        </div>
      </div>
    </div>
  );
};
