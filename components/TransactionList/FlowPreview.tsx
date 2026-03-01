import React from 'react';
import { Transaction } from '../../types';
import { TransactionFlowPreview } from '../TransactionFlowPreview';
import { Loader2 } from 'lucide-react';

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
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-sanctuary-400" />
        <span className="ml-2 text-sanctuary-500">Loading transaction details...</span>
      </div>
    );
  }

  if (!fullTxDetails?.inputs || fullTxDetails.inputs.length === 0) {
    return null;
  }

  return (
    <TransactionFlowPreview
      inputs={fullTxDetails.inputs.map(input => ({
        txid: input.txid,
        vout: input.vout,
        address: input.address,
        amount: input.amount,
      }))}
      outputs={(fullTxDetails.outputs || []).map(output => ({
        address: output.address,
        amount: output.amount,
        isChange: output.outputType === 'change',
        label: output.outputType !== 'unknown' ? output.outputType : undefined,
      }))}
      fee={selectedTx.fee || 0}
      feeRate={0}
      totalInput={fullTxDetails.inputs.reduce((sum, i) => sum + i.amount, 0)}
      totalOutput={(fullTxDetails.outputs || []).reduce((sum, o) => sum + o.amount, 0)}
    />
  );
};
