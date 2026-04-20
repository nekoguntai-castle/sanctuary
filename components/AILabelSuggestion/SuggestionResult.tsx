import React from 'react';
import { Brain } from 'lucide-react';

interface SuggestionResultProps {
  suggestion: string;
  onAccept: () => void;
  onDismiss: () => void;
}

export const SuggestionResult: React.FC<SuggestionResultProps> = ({
  suggestion,
  onAccept,
  onDismiss,
}) => (
  <div className="p-3 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg">
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-4 h-4 text-primary-600 dark:text-primary-400" />
          <span className="text-sm font-medium text-primary-900 dark:text-primary-100">
            AI Suggestion
          </span>
        </div>
        <p className="text-sm text-primary-700 dark:text-primary-300 font-medium">
          {suggestion}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onAccept}
          className="px-3 py-1.5 bg-primary-600 dark:bg-primary-400 hover:bg-primary-700 dark:hover:bg-primary-300 text-white dark:text-primary-950 text-sm font-medium rounded-lg transition-colors"
        >
          Use This
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 text-sm font-medium rounded-lg transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  </div>
);
