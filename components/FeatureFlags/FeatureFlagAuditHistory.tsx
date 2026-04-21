import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import type { FeatureFlagAuditEntry } from '../../src/api/admin';

function FeatureFlagAuditContent({
  auditLog,
  isLoadingAudit,
}: {
  auditLog: FeatureFlagAuditEntry[];
  isLoadingAudit: boolean;
}) {
  if (isLoadingAudit) {
    return <div className="p-4 text-center text-sanctuary-400 text-sm">Loading audit log...</div>;
  }

  if (auditLog.length === 0) {
    return <div className="p-4 text-center text-sanctuary-400 text-sm">No changes recorded yet.</div>;
  }

  return (
    <div className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
      {auditLog.map((entry) => (
        <div key={entry.id} className="p-3 flex items-start space-x-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-mono text-sanctuary-900 dark:text-sanctuary-100">{entry.key}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                entry.newValue
                  ? 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-400'
                  : 'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400'
              }`}>
                {entry.newValue ? 'enabled' : 'disabled'}
              </span>
            </div>
            <div className="flex items-center space-x-2 mt-0.5">
              <span className="text-[11px] text-sanctuary-400">
                by {entry.changedBy} &middot; {new Date(entry.createdAt).toLocaleString()}
              </span>
            </div>
            {entry.reason && (
              <p className="text-[11px] text-sanctuary-500 mt-0.5">{entry.reason}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface FeatureFlagAuditHistoryProps {
  auditLog: FeatureFlagAuditEntry[];
  isLoadingAudit: boolean;
  onToggleAuditLog: () => void;
  showAuditLog: boolean;
}

export function FeatureFlagAuditHistory({
  auditLog,
  isLoadingAudit,
  onToggleAuditLog,
  showAuditLog,
}: FeatureFlagAuditHistoryProps) {
  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
      <button
        onClick={onToggleAuditLog}
        className="w-full p-4 flex items-center justify-between hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-sanctuary-500" />
          <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100">Change History</span>
        </div>
        {showAuditLog ? (
          <ChevronDown className="w-4 h-4 text-sanctuary-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-sanctuary-400" />
        )}
      </button>

      {showAuditLog && (
        <div className="border-t border-sanctuary-100 dark:border-sanctuary-800">
          <FeatureFlagAuditContent auditLog={auditLog} isLoadingAudit={isLoadingAudit} />
        </div>
      )}
    </div>
  );
}
