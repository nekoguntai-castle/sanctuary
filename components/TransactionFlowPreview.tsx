/**
 * Transaction Flow Preview Component
 *
 * Visualizes Bitcoin transaction inputs and outputs in a flow diagram,
 * styled similar to mempool.space's transaction visualization.
 */

import React, { useMemo } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';
import {
  FlowConnector,
  InputsColumn,
  OutputsColumn,
  PreviewFooter,
  PreviewHeader,
  getBarHeight,
  getMaxFlowAmount,
} from './TransactionFlowPreviewParts';

export interface FlowInput {
  txid: string;
  vout: number;
  address: string;
  amount: number;
  label?: string;
}

export interface FlowOutput {
  address: string;
  amount: number;
  isChange?: boolean;
  label?: string;
}

interface TransactionFlowPreviewProps {
  inputs: FlowInput[];
  outputs: FlowOutput[];
  fee: number;
  feeRate: number;
  totalInput: number;
  totalOutput: number;
  isEstimate?: boolean;
  className?: string;
}

export const TransactionFlowPreview: React.FC<TransactionFlowPreviewProps> = ({
  inputs,
  outputs,
  fee,
  feeRate,
  totalInput,
  totalOutput,
  isEstimate = false,
  className = '',
}) => {
  const { format, formatFiat } = useCurrency();
  const maxAmount = useMemo(() => getMaxFlowAmount(inputs, outputs, fee), [inputs, outputs, fee]);
  const barHeight = (amount: number) => getBarHeight(amount, maxAmount);

  if (inputs.length === 0 && outputs.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-3xl overflow-hidden bg-[#1d1f31] shadow-xl shadow-black/20 ring-1 ring-white/10 ${className}`}>
      <PreviewHeader isEstimate={isEstimate} inputCount={inputs.length} outputCount={outputs.length} />

      <div className="p-3 overflow-x-auto">
        <div className="flex items-stretch gap-2 min-h-[80px] min-w-0">
          <InputsColumn
            inputs={inputs}
            barHeight={barHeight}
            format={format}
            formatFiat={formatFiat}
            isEstimate={isEstimate}
          />
          <FlowConnector />
          <OutputsColumn
            outputs={outputs}
            fee={fee}
            feeRate={feeRate}
            barHeight={barHeight}
            format={format}
            formatFiat={formatFiat}
            isEstimate={isEstimate}
          />
        </div>
      </div>

      <PreviewFooter
        totalInput={totalInput}
        totalOutput={totalOutput}
        format={format}
        formatFiat={formatFiat}
        isEstimate={isEstimate}
      />
    </div>
  );
};

export default TransactionFlowPreview;
