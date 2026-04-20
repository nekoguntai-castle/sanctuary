import React from 'react';
import { AlertCircle } from 'lucide-react';

interface SuggestionErrorProps {
  error: string;
  onDismiss: () => void;
}

export const SuggestionError: React.FC<SuggestionErrorProps> = ({
  error,
  onDismiss,
}) => (
  <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg">
    <div className="flex items-start gap-2">
      <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30 p-1 rounded transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
);
