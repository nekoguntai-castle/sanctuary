import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TransactionActionModals } from './TransactionActions/TransactionActionModals';
import { TransactionActionsPanel } from './TransactionActions/TransactionActionsPanel';
import type { TransactionActionsProps } from './TransactionActions/types';
import { useTransactionActions } from './TransactionActions/useTransactionActions';

export const TransactionActions: React.FC<TransactionActionsProps> = ({
  txid,
  walletId,
  confirmed,
  isReceived,
  onActionComplete,
}) => {
  const navigate = useNavigate();
  const { handlers, state } = useTransactionActions({
    txid,
    walletId,
    confirmed,
    isReceived,
    onActionComplete,
    navigate,
  });

  if (state.loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-sanctuary-400" />
      </div>
    );
  }

  if (confirmed) {
    return null; // No actions available for confirmed transactions
  }

  return (
    <>
      <TransactionActionsPanel
        handlers={handlers}
        isReceived={isReceived}
        state={state}
      />
      <TransactionActionModals handlers={handlers} state={state} />
    </>
  );
};
