import { AlertTriangle } from 'lucide-react';

export function VariablesWarning() {
  return (
    <div className="flex items-start space-x-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
      <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
      <div>
        <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
          Advanced Settings
        </h4>
        <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
          These values affect how Sanctuary handles Bitcoin transactions. Do not change them unless you understand the
          implications.
        </p>
      </div>
    </div>
  );
}
