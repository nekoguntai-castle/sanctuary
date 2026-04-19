import React from 'react';
import type { DraftTransaction } from '../../src/api/drafts';
import { FiatDisplaySubtle } from '../FiatDisplay';
import { truncateAddress } from '../../utils/formatters';
import { isAgentFundingDraft } from './draftRowData';

interface DraftRecipientSummaryProps {
  draft: DraftTransaction;
  format: (sats: number) => string;
}

function DraftMultiOutputRows({
  outputs,
  format,
}: {
  outputs: NonNullable<DraftTransaction['outputs']>;
  format: (sats: number) => string;
}) {
  return (
    <div className="mt-1 space-y-1">
      {outputs.map((output, idx) => (
        <div key={idx} className="flex items-center justify-between text-sm">
          <span className="font-mono text-sanctuary-700 dark:text-sanctuary-300">
            {truncateAddress(output.address)}
          </span>
          <span className="ml-2 text-sanctuary-600 dark:text-sanctuary-400 flex items-center gap-1">
            {output.sendMax ? 'MAX' : format(output.amount)}
            {!output.sendMax && <FiatDisplaySubtle sats={output.amount} size="xs" />}
          </span>
        </div>
      ))}
    </div>
  );
}

function DraftRecipientValue({
  draft,
  format,
}: DraftRecipientSummaryProps) {
  if (isAgentFundingDraft(draft)) {
    return (
      <span className="text-sm text-sanctuary-700 dark:text-sanctuary-300">
        Linked operational wallet{' '}
        <span className="font-mono text-sanctuary-500 dark:text-sanctuary-400">
          {truncateAddress(draft.recipient)}
        </span>
      </span>
    );
  }

  if (!draft.outputs || draft.outputs.length === 0) {
    return (
      <span className="font-mono text-sm text-sanctuary-700 dark:text-sanctuary-300">
        {truncateAddress(draft.recipient)}
      </span>
    );
  }

  if (draft.outputs.length === 1) {
    return (
      <span className="font-mono text-sm text-sanctuary-700 dark:text-sanctuary-300">
        {truncateAddress(draft.outputs[0].address)}
      </span>
    );
  }

  return <DraftMultiOutputRows outputs={draft.outputs} format={format} />;
}

export const DraftRecipientSummary: React.FC<DraftRecipientSummaryProps> = ({
  draft,
  format,
}) => (
  <div className="mb-2">
    <span className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
      To:{' '}
    </span>
    <DraftRecipientValue draft={draft} format={format} />
  </div>
);
