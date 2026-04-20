import { useState } from 'react';
import * as aiApi from '../../src/api/ai';
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

  const handleGetSuggestion = async () => {
    setLoading(true);
    setError(null);
    setSuggestion(null);

    try {
      const result = await aiApi.suggestLabel({ transactionId });
      setSuggestion(result.suggestion);
    } catch (err) {
      log.error('Failed to get AI label suggestion', { error: err });
      setError(getAILabelSuggestionErrorMessage(err));
    } finally {
      setLoading(false);
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
