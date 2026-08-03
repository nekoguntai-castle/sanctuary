import {
  Send,
  Save,
  Shield,
  Layers,
} from 'lucide-react';
import { TransactionFlowPreview, FlowInput, FlowOutput } from '../../../TransactionFlowPreview';
import { FiatDisplay } from '../../../FiatDisplay';
import type { WizardStep, TransactionState } from '../../../../contexts/send/types';
import type { TransactionData } from '../../../../hooks/send/useSendTransactionActions';
import {
  getCoinControlLabel,
  getNetworkFeeSats,
  getPayjoinSummaryLabel,
  getRecipientAmountText,
  getRecipientHeading,
  getTotalIncludingFeeSats,
  getTotalSendingSats,
} from './transactionSummaryModel';

interface TransactionSummaryProps {
  state: TransactionState;
  flowData: {
    inputs: FlowInput[];
    outputs: FlowOutput[];
    totalInput: number;
    totalOutput: number;
    fee: number;
  };
  txData?: TransactionData | null;
  payjoinStatus: string;
  changeAmount: number;
  selectedTotal: number;
  estimatedFee: number;
  totalOutputAmount: number;
  txTypeLabel: string;
  isDraftMode: boolean;
  format: (sats: number) => string;
  goToStep: (step: WizardStep) => void;
}

export function TransactionSummary({
  state,
  flowData,
  txData,
  payjoinStatus,
  changeAmount,
  selectedTotal,
  estimatedFee,
  totalOutputAmount,
  txTypeLabel,
  isDraftMode,
  format,
  goToStep,
}: TransactionSummaryProps) {
  const handleEdit = (step: WizardStep) => {
    goToStep(step);
  };
  const networkFee = getNetworkFeeSats(txData, estimatedFee);
  const totalSendingSats = getTotalSendingSats(
    state.outputs,
    selectedTotal,
    estimatedFee,
    totalOutputAmount
  );
  const totalIncludingFeeSats = getTotalIncludingFeeSats(
    state.outputs,
    selectedTotal,
    totalOutputAmount,
    networkFee
  );

  return (
    <>
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          {isDraftMode ? 'Resume Draft' : 'Review Transaction'}
        </h2>
        <p className="text-sm text-sanctuary-500 mt-1">
          {isDraftMode
            ? 'Sign and broadcast this saved transaction'
            : 'Please verify all details before signing'
          }
        </p>
        {isDraftMode && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-medium">
            <Save className="w-3 h-3" />
            Saved Draft - Parameters Locked
          </div>
        )}
      </div>

      {/* Transaction Flow Visualization */}
      {flowData.inputs.length > 0 && flowData.outputs.length > 0 && (
        <TransactionFlowPreview
          inputs={flowData.inputs}
          outputs={flowData.outputs}
          fee={flowData.fee}
          feeRate={state.feeRate}
          totalInput={flowData.totalInput}
          totalOutput={flowData.totalOutput}
          isEstimate={!txData}
        />
      )}

      {/* Transaction Summary Card */}
      <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden">
        {/* Type Badge */}
        <div className="px-4 py-3 surface-secondary border-b border-sanctuary-200 dark:border-sanctuary-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary-100 dark:bg-primary-900/30">
              {state.transactionType === 'consolidation' ? (
                <Layers className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              ) : (
                <Send className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              )}
            </div>
            <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
              {txTypeLabel}
            </span>
          </div>
          {!isDraftMode && (
            <button
              onClick={() => handleEdit('type')}
              className="text-xs text-primary-600 hover:text-primary-700"
            >
              Change
            </button>
          )}
        </div>

        {/* Recipients Section */}
        <div className="p-4 border-b border-sanctuary-200 dark:border-sanctuary-700">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-sanctuary-500">
              {getRecipientHeading(state.outputs.length)}
            </h3>
            {!isDraftMode && (
              <button
                onClick={() => handleEdit('outputs')}
                className="text-xs text-primary-600 hover:text-primary-700"
              >
                Edit
              </button>
            )}
          </div>

          <div className="space-y-3">
            {state.outputs.map((output, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-lg surface-secondary"
              >
                <div className="flex-1 min-w-0 mr-4">
                  <div className="font-mono text-sm text-sanctuary-900 dark:text-sanctuary-100 truncate">
                    {output.address || '(no address)'}
                  </div>
                  {state.payjoinUrl && index === 0 && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-zen-indigo">
                      <Shield className="w-3 h-3" />
                      {getPayjoinSummaryLabel(payjoinStatus)}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                    {getRecipientAmountText(output, format)}
                  </div>
                  {!output.sendMax && (
                    <FiatDisplay
                      sats={parseInt(output.amount, 10) || 0}
                      size="xs"
                      showApprox
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Amounts Section */}
        <div className="p-4 space-y-3">
          {/* Total Send */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-sanctuary-500">Total Sending</span>
            <div className="text-right">
              <div className="font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                {format(totalSendingSats)}
              </div>
              <FiatDisplay
                sats={totalSendingSats}
                size="xs"
                showApprox
                mode="subtle"
              />
            </div>
          </div>

          {/* Fee */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-sanctuary-500">Network Fee</span>
              {!isDraftMode && (
                <button
                  onClick={() => handleEdit('outputs')}
                  className="text-xs text-primary-600 hover:text-primary-700"
                >
                  Edit
                </button>
              )}
            </div>
            <div className="text-right">
              <div className="font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                {format(networkFee)}
              </div>
              <div className="flex items-center gap-1.5 justify-end text-xs text-sanctuary-500">
                <span>{state.feeRate} sat/vB</span>
                <FiatDisplay sats={networkFee} size="xs" mode="subtle" />
              </div>
            </div>
          </div>

          {/* Change (if any) */}
          {changeAmount > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-sanctuary-500">Change</span>
              <div className="text-right">
                <div className="font-semibold text-sanctuary-900 dark:text-sanctuary-100">
                  {format(changeAmount)}
                </div>
                <FiatDisplay sats={changeAmount} size="xs" showApprox mode="subtle" />
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-sanctuary-200 dark:border-sanctuary-700 pt-3">
            <div className="flex justify-between items-center">
              <span className="font-medium text-sanctuary-900 dark:text-sanctuary-100">
                Total (including fee)
              </span>
              <div className="text-right">
                <div className="text-lg font-bold text-sanctuary-900 dark:text-sanctuary-100">
                  {format(totalIncludingFeeSats)}
                </div>
                <FiatDisplay
                  sats={totalIncludingFeeSats}
                  size="sm"
                  showApprox
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Options Summary */}
      <div className="surface-secondary rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-sanctuary-500">RBF (Replace-By-Fee)</span>
          <span className="text-sanctuary-900 dark:text-sanctuary-100">
            {state.rbfEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        {state.useDecoys && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-sanctuary-500">Decoy Outputs</span>
            <span className="text-sanctuary-900 dark:text-sanctuary-100">
              {state.decoyCount} decoys
            </span>
          </div>
        )}
        {state.showCoinControl && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-sanctuary-500">Coin Control</span>
            <span className="text-sanctuary-900 dark:text-sanctuary-100">
              {getCoinControlLabel(state.selectedUTXOs.size)}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
