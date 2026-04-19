import React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { TransactionFlowPreview } from '../TransactionFlowPreview';
import type { FlowPreviewData } from './types';

interface DraftFlowToggleProps {
  draftId: string;
  isExpanded: boolean;
  flowData: FlowPreviewData;
  onToggleExpand: (draftId: string) => void;
}

export const DraftFlowToggle: React.FC<DraftFlowToggleProps> = ({
  draftId,
  isExpanded,
  flowData,
  onToggleExpand,
}) => (
  <>
    <button
      onClick={() => onToggleExpand(draftId)}
      className="w-full mt-3 pt-3 border-t border-sanctuary-200 dark:border-sanctuary-700 flex items-center justify-center gap-1 text-sm text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 transition-colors"
    >
      {isExpanded ? (
        <>
          <ChevronUp className="w-4 h-4" />
          Hide Transaction Flow
        </>
      ) : (
        <>
          <ChevronDown className="w-4 h-4" />
          Show Transaction Flow
        </>
      )}
    </button>

    {isExpanded && (
      <div className="mt-4">
        <TransactionFlowPreview
          inputs={flowData.inputs}
          outputs={flowData.outputs}
          fee={flowData.fee}
          feeRate={flowData.feeRate}
          totalInput={flowData.totalInput}
          totalOutput={flowData.totalOutput}
          isEstimate={false}
        />
      </div>
    )}
  </>
);
