import React from 'react';
import { Brain } from 'lucide-react';
import type { NaturalQueryResult } from '../../src/api/ai';
import { formatNaturalQueryResult } from './useAIQueryInputController';

interface AIQueryInputResultProps {
  result: NaturalQueryResult | null;
}

export const AIQueryInputResult: React.FC<AIQueryInputResultProps> = ({ result }) => {
  if (!result) return null;

  return (
    <div className="p-3 bg-primary-50 dark:bg-sanctuary-800 border border-primary-200 dark:border-sanctuary-600 rounded-lg">
      <div className="flex items-start gap-3">
        <Brain className="w-4 h-4 text-primary-600 dark:text-primary-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-primary-900 dark:text-sanctuary-100 mb-1">
            AI transaction filter:
          </p>
          <p className="text-sm text-primary-800 dark:text-sanctuary-200 font-mono break-all">
            {formatNaturalQueryResult(result)}
          </p>
        </div>
      </div>
    </div>
  );
};
