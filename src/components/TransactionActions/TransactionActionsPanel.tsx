import { AlertTriangle, ArrowUpCircle, CheckCircle, TrendingUp } from 'lucide-react';
import { Button } from '../ui/Button';
import type { TransactionActionHandlers, TransactionActionState } from './types';

export function TransactionActionsPanel({
  handlers,
  isReceived,
  state,
}: {
  handlers: TransactionActionHandlers;
  isReceived: boolean;
  state: TransactionActionState;
}) {
  return (
    <div className="space-y-4">
      <ActionMessage type="success" message={state.success} />
      <ActionMessage type="error" message={state.error} />
      <ActionButtons
        handlers={handlers}
        isReceived={isReceived}
        rbfStatus={state.rbfStatus}
      />
    </div>
  );
}

function ActionMessage({
  message,
  type,
}: {
  message: string | null;
  type: 'error' | 'success';
}) {
  if (!message) return null;

  const Icon = type === 'success' ? CheckCircle : AlertTriangle;
  return (
    <div className={`flex items-center p-4 rounded-lg ${actionMessageClass(type)}`}>
      <Icon className="w-5 h-5 mr-3 flex-shrink-0" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

function ActionButtons({
  handlers,
  isReceived,
  rbfStatus,
}: {
  handlers: TransactionActionHandlers;
  isReceived: boolean;
  rbfStatus: TransactionActionState['rbfStatus'];
}) {
  return (
    <div className="surface-elevated p-4 rounded-lg border border-sanctuary-200 dark:border-sanctuary-800">
      <h4 className="text-sm font-medium text-sanctuary-900 dark:text-sanctuary-100 mb-3">
        Transaction Actions
      </h4>

      <div className="space-y-2">
        <RBFActionButton
          isReceived={isReceived}
          onClick={handlers.openRBFModal}
          rbfStatus={rbfStatus}
        />
        <CPFPActionButton
          isReceived={isReceived}
          onClick={handlers.openCPFPModal}
        />
        <RBFUnavailableReason isReceived={isReceived} rbfStatus={rbfStatus} />
      </div>
    </div>
  );
}

function RBFActionButton({
  isReceived,
  onClick,
  rbfStatus,
}: {
  isReceived: boolean;
  onClick: () => void;
  rbfStatus: TransactionActionState['rbfStatus'];
}) {
  if (isReceived || !rbfStatus?.replaceable) return null;

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      className="w-full justify-start"
    >
      <TrendingUp className="w-4 h-4 mr-2" />
      Bump Fee (RBF)
      {rbfStatus.currentFeeRate && (
        <span className="ml-auto text-xs text-sanctuary-500">
          Current: {rbfStatus.currentFeeRate} sat/vB
        </span>
      )}
    </Button>
  );
}

function CPFPActionButton({
  isReceived,
  onClick,
}: {
  isReceived: boolean;
  onClick: () => void;
}) {
  if (!isReceived) return null;

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      className="w-full justify-start"
    >
      <ArrowUpCircle className="w-4 h-4 mr-2" />
      Accelerate (CPFP)
    </Button>
  );
}

function RBFUnavailableReason({
  isReceived,
  rbfStatus,
}: {
  isReceived: boolean;
  rbfStatus: TransactionActionState['rbfStatus'];
}) {
  if (isReceived || rbfStatus?.replaceable || !rbfStatus?.reason) return null;

  return (
    <div className="text-xs text-sanctuary-500 p-2 surface-secondary/30 rounded">
      {rbfStatus.reason}
    </div>
  );
}

function actionMessageClass(type: 'error' | 'success'): string {
  if (type === 'success') {
    return 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/20 text-green-800 dark:text-green-200';
  }

  return 'bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-rose-800 dark:text-rose-200';
}
