import React from 'react';
import { Brain, Loader2 } from 'lucide-react';

interface SuggestButtonProps {
  loading: boolean;
  onClick: () => void;
}

export const SuggestButton: React.FC<SuggestButtonProps> = ({
  loading,
  onClick,
}) => (
  <button
    onClick={onClick}
    disabled={loading}
    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {loading ? (
      <>
        <Loader2 className="w-4 h-4 animate-spin" />
        Getting suggestion...
      </>
    ) : (
      <>
        <Brain className="w-4 h-4" />
        Suggest with AI
      </>
    )}
  </button>
);
