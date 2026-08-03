import React from 'react';
import { Brain, Loader2, Search, Sparkles, X } from 'lucide-react';
import type { AIQueryInputController } from './useAIQueryInputController';

interface AIQueryInputFormProps {
  controller: AIQueryInputController;
  examples: string[];
}

interface ExampleQueryListProps {
  examples: string[];
  onSelect: (example: string) => void;
}

const ExampleQueryList: React.FC<ExampleQueryListProps> = ({ examples, onSelect }) => (
  <div className="absolute z-10 w-full mt-1 surface-elevated rounded-lg border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg overflow-hidden">
    <div className="px-3 py-2 border-b border-sanctuary-100 dark:border-sanctuary-800">
      <div className="flex items-center space-x-2 text-xs text-sanctuary-500">
        <Sparkles className="w-3 h-3" />
        <span>Try asking...</span>
      </div>
    </div>
    <div className="py-1">
      {examples.map((example, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => onSelect(example)}
          className="w-full px-3 py-2 text-left text-sm text-sanctuary-700 dark:text-sanctuary-300 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors"
        >
          {example}
        </button>
      ))}
    </div>
  </div>
);

export const AIQueryInputForm: React.FC<AIQueryInputFormProps> = ({
  controller,
  examples,
}) => {
  const showExampleList = controller.showExamples && !controller.query;

  return (
    <form onSubmit={controller.handleSubmit} className="relative">
      <div className="relative flex items-center">
        <div className="absolute left-3 text-primary-500">
          <Brain className="w-5 h-5" />
        </div>
        <input
          type="text"
          value={controller.query}
          onChange={(event) => controller.setQuery(event.target.value)}
          onFocus={() => controller.setShowExamples(true)}
          onBlur={() => setTimeout(() => controller.setShowExamples(false), 200)}
          placeholder="Filter transactions with AI..."
          className="w-full pl-10 pr-24 py-3 rounded-md border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 placeholder:text-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          disabled={controller.loading}
        />
        <div className="absolute right-2 flex items-center space-x-1">
          {controller.query && (
            <button
              type="button"
              aria-label="Clear AI transaction filter"
              onClick={controller.clearQuery}
              className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="submit"
            aria-label="Apply AI transaction filter"
            disabled={controller.loading || !controller.query.trim()}
            className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            {controller.loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {showExampleList && (
        <ExampleQueryList
          examples={examples}
          onSelect={controller.handleExampleClick}
        />
      )}
    </form>
  );
};
