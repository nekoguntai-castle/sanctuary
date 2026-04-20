import { AlertTriangle } from 'lucide-react';

export function RestoreDangerWarning() {
  return (
    <div className="flex items-start space-x-3 p-4 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
      <AlertTriangle className="w-5 h-5 text-warning-600 dark:text-warning-400 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-warning-700 dark:text-warning-300">
        <strong>Warning:</strong> Restoring from a backup will <strong>delete all existing data</strong> and replace it
        with the backup contents. This action cannot be undone.
      </div>
    </div>
  );
}
