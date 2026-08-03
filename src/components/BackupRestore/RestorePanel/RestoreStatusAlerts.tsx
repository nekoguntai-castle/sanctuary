import { AlertCircle, Check } from 'lucide-react';

interface RestoreStatusAlertsProps {
  restoreSuccess: boolean;
  restoreError: string | null;
}

export function RestoreStatusAlerts({ restoreSuccess, restoreError }: RestoreStatusAlertsProps) {
  return (
    <>
      {restoreSuccess && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 text-success-600 dark:text-success-400">
          <Check className="w-4 h-4" />
          <span className="text-sm">Database restored successfully! Reloading...</span>
        </div>
      )}

      {restoreError && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{restoreError}</span>
        </div>
      )}
    </>
  );
}
