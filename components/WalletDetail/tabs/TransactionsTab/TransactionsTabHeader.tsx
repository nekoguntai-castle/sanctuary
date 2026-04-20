import React from 'react';
import { Download } from 'lucide-react';
import { AIQueryInput } from '../../../AIQueryInput';
import type { NaturalQueryResult } from '../../../../src/api/ai';

interface TransactionsTabHeaderProps {
  walletId: string;
  aiEnabled: boolean;
  transactionsCount: number;
  onAiQueryChange: (result: NaturalQueryResult | null) => void;
  onShowTransactionExport: () => void;
}

export const TransactionsTabHeader: React.FC<TransactionsTabHeaderProps> = ({
  walletId,
  aiEnabled,
  transactionsCount,
  onAiQueryChange,
  onShowTransactionExport,
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
    {aiEnabled && (
      <div className="flex-1 max-w-xl">
        <AIQueryInput
          walletId={walletId}
          onQueryResult={(result) => onAiQueryChange(result)}
        />
      </div>
    )}
    {transactionsCount > 0 && (
      <button
        onClick={onShowTransactionExport}
        className="flex items-center px-3 py-1.5 text-sm text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded-lg transition-colors self-end sm:self-auto"
      >
        <Download className="w-4 h-4 mr-1.5" />
        Export
      </button>
    )}
  </div>
);
