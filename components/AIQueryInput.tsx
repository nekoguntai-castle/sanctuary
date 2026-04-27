/**
 * AI transaction table filter input
 *
 * Allows users to filter wallet transactions using natural language.
 * Examples: "Show my largest receives", "How much did I spend last month?"
 */

import React from 'react';
import type { NaturalQueryResult } from '../src/api/ai';
import { AIQueryInputError } from './AIQueryInput/AIQueryInputError';
import { AIQueryInputForm } from './AIQueryInput/AIQueryInputForm';
import { AIQueryInputResult } from './AIQueryInput/AIQueryInputResult';
import { useAIQueryInputController } from './AIQueryInput/useAIQueryInputController';

interface AIQueryInputProps {
  walletId: string;
  onQueryResult?: (result: NaturalQueryResult | null) => void;
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
  const controller = useAIQueryInputController({ walletId, onQueryResult });

  return (
    <div className={`space-y-3 ${className}`}>
      <AIQueryInputForm controller={controller} examples={EXAMPLE_QUERIES} />
      <AIQueryInputResult result={controller.result} />
      <AIQueryInputError error={controller.error} onDismiss={controller.dismissError} />
    </div>
  );
};

export default AIQueryInput;
