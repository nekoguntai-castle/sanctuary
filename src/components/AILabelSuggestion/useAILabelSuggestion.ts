import { useEffect, useRef, useState } from 'react';
import * as aiApi from '../../api/ai';
import { createLogger } from '../../utils/logger';
import { getAILabelSuggestionErrorMessage } from './errorMessages';

const log = createLogger('AILabelSuggestion');

interface UseAILabelSuggestionOptions {
  transactionId: string;
  onSuggestionAccepted?: (suggestion: string) => void;
}

export const useAILabelSuggestion = ({
  transactionId,
  onSuggestionAccepted,
}: UseAILabelSuggestionOptions) => {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tracks the transaction the hook currently belongs to. A request whose
  // captured transactionId no longer matches this ref by the time it
  // settles is stale and must not write suggestion/error/loading state.
  const currentTransactionIdRef = useRef(transactionId);

  useEffect(() => {
    if (currentTransactionIdRef.current === transactionId) {
      return;
    }
    currentTransactionIdRef.current = transactionId;
    setSuggestion(null);
    setError(null);
    setLoading(false);
  }, [transactionId]);

  const handleGetSuggestion = async () => {
    const requestTransactionId = transactionId;
    setLoading(true);
    setError(null);
    setSuggestion(null);

    try {
      const result = await aiApi.suggestLabel({ transactionId: requestTransactionId });
      if (currentTransactionIdRef.current !== requestTransactionId) {
        return;
      }
      setSuggestion(result.suggestion);
    } catch (err) {
      if (currentTransactionIdRef.current !== requestTransactionId) {
        return;
      }
      log.error('Failed to get AI label suggestion', { error: err });
      setError(getAILabelSuggestionErrorMessage(err));
    } finally {
      if (currentTransactionIdRef.current === requestTransactionId) {
        setLoading(false);
      }
    }
  };

  const handleAcceptSuggestion = () => {
    if (suggestion && onSuggestionAccepted) {
      onSuggestionAccepted(suggestion);
      setSuggestion(null);
    }
  };

  return {
    loading,
    suggestion,
    error,
    handleGetSuggestion,
    handleAcceptSuggestion,
    dismissSuggestion: () => setSuggestion(null),
    dismissError: () => setError(null),
  };
};
