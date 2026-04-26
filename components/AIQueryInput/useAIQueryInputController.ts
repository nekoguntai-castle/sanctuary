import { useCallback, useState, type FormEvent } from 'react';
import * as aiApi from '../../src/api/ai';
import { createLogger } from '../../utils/logger';

const log = createLogger('AIQueryInput');

interface UseAIQueryInputControllerArgs {
  walletId: string;
  onQueryResult?: (result: aiApi.NaturalQueryResult) => void;
}

const getAIQueryErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : '';

  if (message.includes('503') || message.includes('not enabled')) {
    return 'AI is not enabled. Configure it in Admin → AI Settings.';
  }

  if (message.includes('429')) {
    return 'AI rate limit reached — too many requests in a short period. Please wait a minute before trying again.';
  }

  return 'Failed to process query. AI may be unavailable.';
};

export const formatNaturalQueryResult = (result: aiApi.NaturalQueryResult): string => {
  const parts: string[] = [`Type: ${result.type}`];

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

export const useAIQueryInputController = ({
  walletId,
  onQueryResult,
}: UseAIQueryInputControllerArgs) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<aiApi.NaturalQueryResult | null>(null);
  const [showExamples, setShowExamples] = useState(false);

  const handleSubmit = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();

    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await aiApi.executeNaturalQuery({
        query: trimmedQuery,
        walletId,
      });

      setResult(response);
      onQueryResult?.(response);
    } catch (caughtError) {
      log.error('AI query failed', { error: caughtError });
      setError(getAIQueryErrorMessage(caughtError));
    } finally {
      setLoading(false);
    }
  }, [query, walletId, onQueryResult]);

  const handleExampleClick = useCallback((example: string) => {
    setQuery(example);
    setShowExamples(false);
  }, []);

  const clearQuery = useCallback(() => {
    setQuery('');
    setResult(null);
    setError(null);
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  return {
    query,
    loading,
    error,
    result,
    showExamples,
    setQuery,
    setShowExamples,
    handleSubmit,
    handleExampleClick,
    clearQuery,
    dismissError,
  };
};

export type AIQueryInputController = ReturnType<typeof useAIQueryInputController>;
