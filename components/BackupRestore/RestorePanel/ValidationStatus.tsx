import { AlertCircle, AlertTriangle, Check, Loader2 } from 'lucide-react';
import type { ValidationResult } from '../../../src/api/admin';

interface ValidationStatusProps {
  isValidating: boolean;
  validationResult: ValidationResult | null;
}

export function ValidationStatus({ isValidating, validationResult }: ValidationStatusProps) {
  if (isValidating) {
    return (
      <div className="flex items-center space-x-2 p-3 rounded-lg bg-sanctuary-100 dark:bg-sanctuary-800">
        <Loader2 className="w-4 h-4 animate-spin text-sanctuary-500" />
        <span className="text-sm text-sanctuary-600 dark:text-sanctuary-400">Validating backup...</span>
      </div>
    );
  }

  if (!validationResult) {
    return null;
  }

  return (
    <div className="space-y-2">
      {validationResult.valid ? <ValidationSuccess /> : <ValidationIssues issues={validationResult.issues} />}
      {validationResult.warnings.length > 0 && <ValidationWarnings warnings={validationResult.warnings} />}
    </div>
  );
}

function ValidationSuccess() {
  return (
    <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-800 text-success-600 dark:text-success-400">
      <Check className="w-4 h-4" />
      <span className="text-sm">Backup is valid and ready to restore</span>
    </div>
  );
}

function ValidationIssues({ issues }: { issues: string[] }) {
  return (
    <div className="flex items-start space-x-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
      <AlertCircle className="w-4 h-4 mt-0.5" />
      <div className="text-sm">
        <p className="font-medium">Backup validation failed:</p>
        <ul className="list-disc list-inside mt-1">
          {issues.map((issue, index) => (
            <li key={index}>{issue}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ValidationWarnings({ warnings }: { warnings: string[] }) {
  return (
    <div className="flex items-start space-x-2 p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 text-warning-700 dark:text-warning-400">
      <AlertTriangle className="w-4 h-4 mt-0.5" />
      <div className="text-sm">
        <p className="font-medium">Warnings:</p>
        <ul className="list-disc list-inside mt-1">
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
