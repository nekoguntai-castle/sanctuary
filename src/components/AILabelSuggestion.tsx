import React from 'react';
import { SuggestionError } from './AILabelSuggestion/SuggestionError';
import { SuggestButton } from './AILabelSuggestion/SuggestButton';
import { SuggestionResult } from './AILabelSuggestion/SuggestionResult';
import type { AILabelSuggestionProps } from './AILabelSuggestion/types';
import { useAILabelSuggestion } from './AILabelSuggestion/useAILabelSuggestion';

export const AILabelSuggestion: React.FC<AILabelSuggestionProps> = ({
  transaction,
  existingLabels: _existingLabels,
  onSuggestionAccepted,
  className = '',
}) => {
  const {
    loading,
    suggestion,
    error,
    handleGetSuggestion,
    handleAcceptSuggestion,
    dismissSuggestion,
    dismissError,
  } = useAILabelSuggestion({
    transactionId: transaction.id,
    onSuggestionAccepted,
  });

  return (
    <div className={`space-y-3 ${className}`}>
      {!suggestion && !error && (
        <SuggestButton loading={loading} onClick={handleGetSuggestion} />
      )}

      {suggestion && (
        <SuggestionResult
          suggestion={suggestion}
          onAccept={handleAcceptSuggestion}
          onDismiss={dismissSuggestion}
        />
      )}

      {error && (
        <SuggestionError error={error} onDismiss={dismissError} />
      )}
    </div>
  );
};

export default AILabelSuggestion;
