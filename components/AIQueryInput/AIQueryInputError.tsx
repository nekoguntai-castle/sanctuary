import React from 'react';
import { AlertCircle, X } from 'lucide-react';

interface AIQueryInputErrorProps {
  error: string | null;
  onDismiss: () => void;
}

export const AIQueryInputError: React.FC<AIQueryInputErrorProps> = ({
  error,
  onDismiss,
}) => {
  if (!error) return null;

  return (
    <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-rose-700 dark:text-rose-300 flex-1">
          {error}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30 p-1 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
