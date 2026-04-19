import React from 'react';
import { Loader2 } from 'lucide-react';
import type { Transaction } from '../../types';
import { TransactionFlowPreview } from '../TransactionFlowPreview';
import {
  getFlowInputs,
  getFlowOutputs,
  getTotalInput,
  getTotalOutput,
  hasFlowInputs,
} from './FlowPreview/flowPreviewModel';

interface FlowPreviewProps {
  selectedTx: Transaction;
  fullTxDetails: Transaction | null;
  loadingDetails: boolean;
}

export const FlowPreview: React.FC<FlowPreviewProps> = ({
  selectedTx,
  fullTxDetails,
  loadingDetails,
}) => {
  if (loadingDetails) {
    return <LoadingFlowPreview />;
  }

  if (!hasFlowInputs(fullTxDetails)) {
    return null;
  }

  return (
    <TransactionFlowPreview
      inputs={getFlowInputs(fullTxDetails)}
      outputs={getFlowOutputs(fullTxDetails)}
      fee={selectedTx.fee || 0}
      feeRate={0}
      totalInput={getTotalInput(fullTxDetails)}
      totalOutput={getTotalOutput(fullTxDetails)}
    />
  );
};

function LoadingFlowPreview() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-sanctuary-400" />
      <span className="ml-2 text-sanctuary-500">Loading transaction details...</span>
    </div>
  );
}
