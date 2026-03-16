import { useState, useEffect, useRef, useMemo } from 'react';
import { RotateCcw, Check, AlertCircle, ChevronDown, ChevronRight, Info, Clock, Loader2 } from 'lucide-react';
import { Toggle } from '../ui/Toggle';
import * as adminApi from '../../src/api/admin';
import type { FeatureFlagInfo, FeatureFlagAuditEntry } from '../../src/api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  experimental: 'Experimental',
};

export function FeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlagInfo[]>([]);
  const [auditLog, setAuditLog] = useState<FeatureFlagAuditEntry[]>([]);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [resettingKey, setResettingKey] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { loading, execute: runLoad } = useLoadingState({ initialLoading: true });
  const { loading: isLoadingAudit, execute: runLoadAudit } = useLoadingState();
  const { error: actionError, execute: runAction, clearError } = useLoadingState();

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    runLoad(async () => {
      const result = await adminApi.getFeatureFlags();
      setFlags(result);
    });
  }, []);

  const showSuccessMessage = (key: string) => {
    setSaveSuccess(key);
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => setSaveSuccess(null), 3000);
  };

  const handleFlagAction = async (
    flag: FeatureFlagInfo,
    action: () => Promise<FeatureFlagInfo>,
    setBusy: (key: string | null) => void,
  ) => {
    setBusy(flag.key);
    clearError();

    const result = await runAction(async () => {
      const updated = await action();
      setFlags(prev => prev.map(f => f.key === flag.key ? { ...f, ...updated } : f));
    });

    if (result !== null) {
      showSuccessMessage(flag.key);
    }

    setBusy(null);
  };

  const handleToggle = (flag: FeatureFlagInfo) =>
    handleFlagAction(flag, () => adminApi.updateFeatureFlag(flag.key, !flag.enabled), setTogglingKey);

  const handleReset = (flag: FeatureFlagInfo) =>
    handleFlagAction(flag, () => adminApi.resetFeatureFlag(flag.key), setResettingKey);

  const handleToggleAuditLog = async () => {
    if (showAuditLog) {
      setShowAuditLog(false);
      return;
    }

    setShowAuditLog(true);
    await runLoadAudit(async () => {
      const result = await adminApi.getFeatureFlagAuditLog(undefined, 50);
      setAuditLog(result.entries);
    });
  };

  const renderAuditContent = () => {
    if (isLoadingAudit) {
      return <div className="p-4 text-center text-sanctuary-400 text-sm">Loading audit log...</div>;
    }

    if (auditLog.length === 0) {
      return <div className="p-4 text-center text-sanctuary-400 text-sm">No changes recorded yet.</div>;
    }

    return (
      <div className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
        {auditLog.map(entry => (
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
  };

  // Group flags by category (must be before early returns to satisfy rules of hooks)
  const grouped = useMemo(() => flags.reduce<Record<string, FeatureFlagInfo[]>>((acc, flag) => {
    const cat = flag.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(flag);
    return acc;
  }, {}), [flags]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-light text-sanctuary-900 dark:text-sanctuary-50">Feature Flags</h2>
        <p className="text-sanctuary-500">Toggle features without restarting the server.</p>
      </div>

      {/* Error Banner */}
      {actionError && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{actionError}</span>
        </div>
      )}

      {/* Flag Groups */}
      {Object.entries(grouped).map(([category, categoryFlags]) => (
        <div key={category} className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
          <div className="p-4 border-b border-sanctuary-100 dark:border-sanctuary-800">
            <h3 className="text-base font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {CATEGORY_LABELS[category] || category}
            </h3>
          </div>

          <div className="divide-y divide-sanctuary-100 dark:divide-sanctuary-800">
            {categoryFlags.map(flag => (
              <div key={flag.key} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3 flex-1 min-w-0">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 font-mono">
                          {flag.key}
                        </span>
                        {saveSuccess === flag.key && (
                          <span className="flex items-center space-x-1 text-success-600 dark:text-success-400">
                            <Check className="w-3 h-3" />
                            <span className="text-[11px]">Saved</span>
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-sanctuary-500">{flag.description}</p>
                      {flag.modifiedBy && flag.modifiedBy !== 'system' && (
                        <p className="text-[11px] text-sanctuary-400">
                          Modified by {flag.modifiedBy}
                          {flag.updatedAt && ` on ${new Date(flag.updatedAt).toLocaleDateString()}`}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 ml-4">
                    {/* Reset button */}
                    <button
                      onClick={() => handleReset(flag)}
                      disabled={resettingKey === flag.key || togglingKey === flag.key}
                      className="p-1.5 rounded-lg text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Reset to environment default"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${resettingKey === flag.key ? 'animate-spin' : ''}`} />
                    </button>

                    {/* Toggle switch */}
                    <Toggle
                      checked={flag.enabled}
                      onChange={() => handleToggle(flag)}
                      disabled={togglingKey === flag.key || resettingKey === flag.key}
                    />
                  </div>
                </div>

                {/* Side-effect warning */}
                {flag.hasSideEffects && (
                  <div className="mt-2 flex items-start space-x-2 p-2 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400">
                    <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span className="text-[11px]">
                      {flag.sideEffectDescription || 'Toggling this flag has immediate runtime side effects.'}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Audit Log Section */}
      <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        <button
          onClick={handleToggleAuditLog}
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
            {renderAuditContent()}
          </div>
        )}
      </div>
    </div>
  );
}
