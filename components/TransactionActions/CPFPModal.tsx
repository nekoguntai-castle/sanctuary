import { ArrowUpCircle, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { InfoBox, ModalFrame } from './TransactionModalShared';
import type { TransactionActionHandlers, TransactionActionState } from './types';

export function CPFPModal({
  handlers,
  state,
}: {
  handlers: TransactionActionHandlers;
  state: TransactionActionState;
}) {
  if (!state.showCPFPModal) return null;

  return (
    <ModalFrame title="Accelerate Transaction (CPFP)">
      <InfoBox
        title="Child-Pays-For-Parent (CPFP)"
        body="Creates a new transaction spending from this one with a higher fee, incentivizing miners to confirm both."
      />
      <CPFPRateInput
        onChange={handlers.setTargetFeeRate}
        targetFeeRate={state.targetFeeRate}
      />
      <div className="flex space-x-3 pt-2">
        <Button
          variant="ghost"
          onClick={handlers.closeCPFPModal}
          disabled={state.processing}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          onClick={handlers.handleCPFP}
          disabled={state.processing || state.targetFeeRate < 1}
          className="flex-1"
        >
          <CPFPSubmitContent processing={state.processing} />
        </Button>
      </div>
    </ModalFrame>
  );
}

function CPFPRateInput({
  onChange,
  targetFeeRate,
}: {
  onChange: (feeRate: number) => void;
  targetFeeRate: number;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        Target Fee Rate (sat/vB)
      </label>
      <input
        type="number"
        value={targetFeeRate}
        onChange={(event) => onChange(parseFloat(event.target.value) || 0)}
        min={0.1}
        step={0.01}
        placeholder="e.g., 50"
        className="block w-full px-4 py-3 rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none"
      />
      <p className="text-xs text-sanctuary-500">
        The effective fee rate for both transactions combined
      </p>
    </div>
  );
}

function CPFPSubmitContent({
  processing,
}: {
  processing: boolean;
}) {
  if (processing) {
    return (
      <>
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Creating...
      </>
    );
  }

  return (
    <>
      <ArrowUpCircle className="w-4 h-4 mr-2" />
      Accelerate
    </>
  );
}
