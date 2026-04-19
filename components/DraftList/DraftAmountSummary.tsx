import React from 'react';
import type { DraftTransaction } from '../../src/api/drafts';
import { Amount } from '../Amount';
import { FiatDisplaySubtle } from '../FiatDisplay';

interface DraftAmountSummaryProps {
  draft: DraftTransaction;
}

export const DraftAmountSummary: React.FC<DraftAmountSummaryProps> = ({ draft }) => (
  <div className="flex items-center gap-4">
    <div>
      <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
        Amount:{' '}
      </span>
      <Amount
        sats={draft.effectiveAmount}
        className="font-medium text-sanctuary-900 dark:text-sanctuary-100"
      />
    </div>
    <div>
      <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
        Fee:{' '}
      </span>
      <span className="text-sm text-sanctuary-600 dark:text-sanctuary-300">
        {draft.fee.toLocaleString()} sats ({draft.feeRate} sat/vB)
      </span>
      <FiatDisplaySubtle sats={draft.fee} size="xs" className="ml-1" />
    </div>
  </div>
);
