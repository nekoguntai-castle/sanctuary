import { Loader2, TrendingUp } from 'lucide-react';
import { Button } from '../ui/Button';
import { InfoBox, ModalFrame } from './TransactionModalShared';
import type { TransactionActionHandlers, TransactionActionState } from './types';
import { MOBILE_API_REQUEST_LIMITS } from '@sanctuary/shared/schemas/mobileApiRequests';

export function RBFModal({
  handlers,
  state,
}: {
  handlers: TransactionActionHandlers;
  state: TransactionActionState;
}) {
  if (!state.showRBFModal || !state.rbfStatus?.replaceable) return null;

  return (
    <ModalFrame title="Bump Transaction Fee (RBF)">
      <InfoBox
        title="Replace-By-Fee (RBF)"
        body="Creates a new version of this transaction with a higher fee to speed up confirmation."
      />
      <CurrentFeeRate currentFeeRate={state.rbfStatus.currentFeeRate} />
      <RBFRateInput
        minNewFeeRate={state.rbfStatus.minNewFeeRate}
        newFeeRate={state.newFeeRate}
        onChange={handlers.setNewFeeRate}
      />
      <div className="flex space-x-3 pt-2">
        <Button
          variant="ghost"
          onClick={handlers.closeRBFModal}
          disabled={state.processing}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          onClick={handlers.handleRBF}
          disabled={state.processing
            || state.newFeeRate < (state.rbfStatus.minNewFeeRate || MOBILE_API_REQUEST_LIMITS.minFeeRate)
            || state.newFeeRate > MOBILE_API_REQUEST_LIMITS.maxFeeRate}
          className="flex-1"
        >
          <RBFSubmitContent processing={state.processing} />
        </Button>
      </div>
    </ModalFrame>
  );
}

function CurrentFeeRate({
  currentFeeRate,
}: {
  currentFeeRate?: number;
}) {
  if (!currentFeeRate) return null;

  return (
    <div className="text-sm">
      <span className="text-sanctuary-500">Current fee rate:</span>{' '}
      <span className="font-medium">{currentFeeRate} sat/vB</span>
    </div>
  );
}

function RBFRateInput({
  minNewFeeRate,
  newFeeRate,
  onChange,
}: {
  minNewFeeRate?: number;
  newFeeRate: number;
  onChange: (feeRate: number) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">
        New Fee Rate (sat/vB)
      </label>
      <input
        type="number"
        value={newFeeRate}
        onChange={(event) => onChange(Math.min(
          parseFloat(event.target.value) || 0,
          MOBILE_API_REQUEST_LIMITS.maxFeeRate,
        ))}
        min={minNewFeeRate || 0.1}
        max={MOBILE_API_REQUEST_LIMITS.maxFeeRate}
        step={0.01}
        className="block w-full px-4 py-3 rounded-lg border border-sanctuary-300 dark:border-sanctuary-700 surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none"
      />
      {minNewFeeRate && (
        <p className="text-xs text-sanctuary-500">
          Minimum: {minNewFeeRate} sat/vB
        </p>
      )}
    </div>
  );
}

function RBFSubmitContent({
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
      <TrendingUp className="w-4 h-4 mr-2" />
      Bump Fee
    </>
  );
}
