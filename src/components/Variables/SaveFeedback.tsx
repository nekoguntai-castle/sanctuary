import { AlertCircle, Check } from 'lucide-react';

interface SaveFeedbackProps {
  saveSuccess: boolean;
  displayError: string | null;
}

export function SaveFeedback({ saveSuccess, displayError }: SaveFeedbackProps) {
  return (
    <>
      {saveSuccess && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400">
          <Check className="w-4 h-4" />
          <span className="text-sm">Settings saved successfully</span>
        </div>
      )}

      {displayError && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm">{displayError}</span>
        </div>
      )}
    </>
  );
}
