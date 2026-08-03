import type { Transaction } from '../../types';

export interface AILabelSuggestionProps {
  transaction: Transaction;
  existingLabels?: string[];
  onSuggestionAccepted?: (suggestion: string) => void;
  className?: string;
}
