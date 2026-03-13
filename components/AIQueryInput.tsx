/**
 * AI Natural Language Query Input
 *
 * Allows users to query their wallet data using natural language.
 * Examples: "Show my largest receives", "How much did I spend last month?"
 */

import React, { useState, useCallback } from 'react';
import { Brain, Loader2, AlertCircle, Search, X, Sparkles } from 'lucide-react';
import * as aiApi from '../src/api/ai';
import { createLogger } from '../utils/logger';

const log = createLogger('AIQueryInput');

interface AIQueryInputProps {
  walletId: string;
  onQueryResult?: (result: aiApi.NaturalQueryResult) => void;
  className?: string;
}

const EXAMPLE_QUERIES = [
  'Show my largest receives',
  'How much did I spend this month?',
  'Show unconfirmed transactions',
  'Find transactions labeled "Exchange"',
];

export const AIQueryInput: React.FC<AIQueryInputProps> = ({
  walletId,
  onQueryResult,
  className = '',
}) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<aiApi.NaturalQueryResult | null>(null);
  const [showExamples, setShowExamples] = useState(false);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await aiApi.executeNaturalQuery({
        query: query.trim(),
        walletId,
      });

      setResult(response);
      onQueryResult?.(response);
    } catch (err) {
      log.error('AI query failed', { error: err });

      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('503') || msg.includes('not enabled')) {
        setError('AI is not enabled. Configure it in Admin → AI Assistant.');
      } else if (msg.includes('429')) {
        setError('Too many requests. Please try again in a moment.');
      } else {
        setError('Failed to process query. AI may be unavailable.');
      }
    } finally {
      setLoading(false);
    }
  }, [query, walletId, onQueryResult]);

  const handleExampleClick = (example: string) => {
    setQuery(example);
    setShowExamples(false);
  };

  const clearQuery = () => {
    setQuery('');
    setResult(null);
    setError(null);
  };

  const formatResult = (result: aiApi.NaturalQueryResult) => {
    const parts: string[] = [];

    parts.push(`Type: ${result.type}`);

    if (result.filter && Object.keys(result.filter).length > 0) {
      parts.push(`Filter: ${JSON.stringify(result.filter)}`);
    }

    if (result.sort) {
      parts.push(`Sort: ${result.sort.field} (${result.sort.order})`);
    }

    if (result.limit) {
      parts.push(`Limit: ${result.limit}`);
    }

    if (result.aggregation) {
      parts.push(`Aggregation: ${result.aggregation}`);
    }

    return parts.join(' • ');
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Search Input */}
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative flex items-center">
          <div className="absolute left-3 text-primary-500">
            <Brain className="w-5 h-5" />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setShowExamples(true)}
            onBlur={() => setTimeout(() => setShowExamples(false), 200)}
            placeholder="Ask about your transactions..."
            className="w-full pl-10 pr-24 py-3 rounded-xl border border-sanctuary-300 dark:border-sanctuary-600 bg-white dark:bg-sanctuary-800 text-sanctuary-900 dark:text-sanctuary-100 placeholder:text-sanctuary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            disabled={loading}
          />
          <div className="absolute right-2 flex items-center space-x-1">
            {query && (
              <button
                type="button"
                onClick={clearQuery}
                className="p-1.5 text-sanctuary-400 hover:text-sanctuary-600 dark:hover:text-sanctuary-300 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Example Queries Dropdown */}
        {showExamples && !query && (
          <div className="absolute z-10 w-full mt-1 surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-700 shadow-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-sanctuary-100 dark:border-sanctuary-800">
              <div className="flex items-center space-x-2 text-xs text-sanctuary-500">
                <Sparkles className="w-3 h-3" />
                <span>Try asking...</span>
              </div>
            </div>
            <div className="py-1">
              {EXAMPLE_QUERIES.map((example, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleExampleClick(example)}
                  className="w-full px-3 py-2 text-left text-sm text-sanctuary-700 dark:text-sanctuary-300 hover:bg-sanctuary-50 dark:hover:bg-sanctuary-800 transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>

      {/* Result Display */}
      {result && (
        <div className="p-3 bg-primary-50 dark:bg-sanctuary-800 border border-primary-200 dark:border-sanctuary-600 rounded-lg">
          <div className="flex items-start gap-3">
            <Brain className="w-4 h-4 text-primary-600 dark:text-primary-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-primary-900 dark:text-sanctuary-100 mb-1">
                AI interpreted your query as:
              </p>
              <p className="text-sm text-primary-800 dark:text-sanctuary-200 font-mono break-all">
                {formatResult(result)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-rose-700 dark:text-rose-300 flex-1">
              {error}
            </p>
            <button
              onClick={() => setError(null)}
              className="text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/30 p-1 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIQueryInput;
