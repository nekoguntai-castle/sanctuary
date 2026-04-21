import { useState, useEffect, useRef, useMemo } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import * as adminApi from '../../src/api/admin';
import type { FeatureFlagInfo, FeatureFlagAuditEntry } from '../../src/api/admin';
import { useLoadingState } from '../../hooks/useLoadingState';
import { FeatureFlagAuditHistory } from './FeatureFlagAuditHistory';
import { FeatureFlagGroup } from './FeatureFlagGroup';

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
        <h2 className="text-2xl font-medium text-sanctuary-900 dark:text-sanctuary-50">Feature Flags</h2>
        <p className="text-sanctuary-500">Toggle features without restarting the server.</p>
      </div>

      {/* Error Banner */}
      {actionError && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm">{actionError}</span>
        </div>
      )}

      {Object.entries(grouped).map(([category, categoryFlags]) => (
        <FeatureFlagGroup
          key={category}
          categoryFlags={categoryFlags}
          onReset={handleReset}
          onToggle={handleToggle}
          resettingKey={resettingKey}
          saveSuccess={saveSuccess}
          title={CATEGORY_LABELS[category] || category}
          togglingKey={togglingKey}
        />
      ))}

      <FeatureFlagAuditHistory
        auditLog={auditLog}
        isLoadingAudit={isLoadingAudit}
        onToggleAuditLog={handleToggleAuditLog}
        showAuditLog={showAuditLog}
      />
    </div>
  );
}
