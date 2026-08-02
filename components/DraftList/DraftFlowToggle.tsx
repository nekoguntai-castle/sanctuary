import React, { useId } from 'react';
import { TransactionFlowPreview } from '../TransactionFlowPreview';
import { ShowMoreToggle } from '../ui/ShowMoreToggle';
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
}) => {
  const flowId = useId();

  // A true disclosure — the flow preview mounts and unmounts — so `controls`
  // applies here, unlike the truncating callers of ShowMoreToggle.
  return (
  <>
    <ShowMoreToggle
      expanded={isExpanded}
      onToggle={() => onToggleExpand(draftId)}
      collapsedLabel="Show Transaction Flow"
      expandedLabel="Hide Transaction Flow"
      iconPosition="leading"
      controls={flowId}
      className="w-full mt-3 pt-3 border-t border-sanctuary-200 dark:border-sanctuary-700 rounded-none"
    />

    {isExpanded && (
      <div id={flowId} className="mt-4">
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
};
